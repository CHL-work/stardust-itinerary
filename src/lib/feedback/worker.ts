import type { Pool } from "pg";
import { reviewFeedback, type FeedbackReviewer } from "./review-provider";
import { postFeedbackIssue, reconcileFeedbackIssue, validateIssuePayload } from "./github-publisher";
import { unsafeFeedbackInstructions, validateReviewOutput, type ReviewDecision } from "./review-contract";
import { claimFeedbackRun, completeFeedbackRun, failFeedbackRun, claimFeedbackIssue,
  beginFeedbackDelivery, completeFeedbackDelivery, blockFeedbackIssue } from "./worker-repository";

export type FeedbackWorkerResult = { triage: "disabled" | "idle" | "completed" | "failed";
  publishing: "unconfigured" | "enabled"; reviewed: number; queued: number; published: number; uncertain: number; blocked: number };
export type FeedbackWorkerOptions = { triageEnabled: boolean; githubToken?: string; reviewer?: FeedbackReviewer; request?: typeof fetch };

/** Operational entry point only. No request session/member quota, canonical writes, or provider/tool-controlled dispatch. */
export async function runFeedbackWorker(pool: Pool, options: FeedbackWorkerOptions): Promise<FeedbackWorkerResult> {
  const summary: FeedbackWorkerResult = { triage: options.triageEnabled ? "idle" : "disabled",
    publishing: options.githubToken?.trim() ? "enabled" : "unconfigured", reviewed: 0, queued: 0, published: 0, uncertain: 0, blocked: 0 };
  if (options.triageEnabled) {
    const claim = await claimFeedbackRun(pool);
    if (claim) {
      try {
        const safeReports = claim.reports.filter((report) => !unsafeFeedbackInstructions(`${report.title} ${report.description}`));
        const result = safeReports.length ? await (options.reviewer ?? reviewFeedback)(safeReports, claim.known)
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
  if (!options.githubToken?.trim()) return summary;
  for (let count = 0; count < 5; count += 1) {
    const claim = await claimFeedbackIssue(pool);
    if (!claim) break;
    try { validateIssuePayload(claim); }
    catch { await blockFeedbackIssue(pool, claim); summary.blocked += 1; continue; }
    if (!await beginFeedbackDelivery(pool, claim)) continue;
    const outcome = claim.postAttempts === 0
      ? await postFeedbackIssue(claim, options.githubToken, options.request)
      : await reconcileFeedbackIssue(claim, options.githubToken, options.request);
    // If this DB write fails after a known201, leave durable uncertain state and
    // stop this invocation. A later worker only reconciles the original marker.
    await completeFeedbackDelivery(pool, claim, outcome);
    summary[outcome.state] += 1;
  }
  return summary;
}
