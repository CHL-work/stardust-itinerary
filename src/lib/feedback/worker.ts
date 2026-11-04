import type { Pool } from "pg";
import { withOperatorAiCredential } from "@/lib/ai/credential-context";
import { reviewFeedback, type FeedbackReviewer } from "./review-provider";
import { feedbackRepository, postFeedbackIssue, reconcileFeedbackIssue, validateIssuePayload, verifyPrivateFeedbackRepository,
  type FeedbackTarget } from "./github-publisher";
import { unsafeFeedbackInstructions, validateReviewOutput, type ReviewDecision } from "./review-contract";
import { claimFeedbackRun, completeFeedbackRun, failFeedbackRun, claimFeedbackIssue,
  beginFeedbackDelivery, completeFeedbackDelivery, blockFeedbackIssue } from "./worker-repository";

export type FeedbackWorkerResult = { triage: "disabled" | "idle" | "completed" | "failed";
  publishing: "unconfigured" | "enabled" | "refused"; publishingError?: string;
  reviewed: number; queued: number; published: number; uncertain: number; blocked: number };
export type FeedbackWorkerOptions = { triageEnabled: boolean; githubToken?: string; githubRepository?: string;
  reviewer?: FeedbackReviewer; request?: typeof fetch };

/** Operational entry point only. No request session/member quota, canonical writes, or provider/tool-controlled dispatch. */
export async function runFeedbackWorker(pool: Pool, options: FeedbackWorkerOptions): Promise<FeedbackWorkerResult> {
  // Publishing needs both a token and a target repository, which must turn out to be private.
  const token = options.githubToken?.trim();
  const repository = feedbackRepository(options.githubRepository);
  const summary: FeedbackWorkerResult = { triage: options.triageEnabled ? "idle" : "disabled",
    publishing: token && repository ? "enabled" : "unconfigured", reviewed: 0, queued: 0, published: 0, uncertain: 0, blocked: 0 };
  if (options.triageEnabled) {
    const claim = await claimFeedbackRun(pool);
    if (claim) {
      try {
        const safeReports = claim.reports.filter((report) => !unsafeFeedbackInstructions(`${report.title} ${report.description}`));
        // Operator-funded: the reviewer runs on the operator's key, never a user's.
        const result = safeReports.length ? await withOperatorAiCredential(() => (options.reviewer ?? reviewFeedback)(safeReports, claim.known))
          : { decisions: [], inputTokens: 0, outputTokens: 0 };
        validateReviewOutput({ decisions: result.decisions }, safeReports, claim.known);
        const decisions = claim.reports.map((report): ReviewDecision => result.decisions.find((decision) => decision.key === report.key)
          ?? { key: report.key, decision: "ignore", duplicateKey: null, title: "", evidence: [], reproductionSteps: [], expected: "", actual: "", hypotheses: [], missingInformation: [] });
        summary.queued = await completeFeedbackRun(pool, claim, { ...result, decisions });
        summary.triage = "completed";
        summary.reviewed = safeReports.length;
      } catch (error) {
        const code = error instanceof Error && error.message === "output_invalid" ? "output_invalid" : "provider_unavailable";
        await failFeedbackRun(pool, claim, code);
        summary.triage = "failed";
      }
    }
  }
  if (!token || !repository) return summary;
  let target: FeedbackTarget | null = null;
  for (let count = 0; count < 5; count += 1) {
    const claim = await claimFeedbackIssue(pool);
    if (!claim) break;
    try { validateIssuePayload(claim); }
    catch { await blockFeedbackIssue(pool, claim); summary.blocked += 1; continue; }
    // Checked once per run, before the first delivery is marked: a public, missing or archived
    // repository leaves every issue queued, and its short lease lets a later run retry.
    if (!target) {
      const check = await verifyPrivateFeedbackRepository({ repository, token }, options.request);
      if (check.state !== "private") {
        summary.publishing = "refused";
        summary.publishingError = check.errorCode;
        break;
      }
      target = { repository: check.repository, token };
    }
    if (!await beginFeedbackDelivery(pool, claim)) continue;
    const outcome = claim.postAttempts === 0
      ? await postFeedbackIssue(claim, target, options.request)
      : await reconcileFeedbackIssue(claim, target, options.request);
    // If this DB write fails after a known201, leave durable uncertain state and
    // stop this invocation. A later worker only reconciles the original marker.
    await completeFeedbackDelivery(pool, claim, outcome);
    summary[outcome.state] += 1;
  }
  return summary;
}
