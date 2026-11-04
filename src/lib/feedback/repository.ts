import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppConflictError, AppForbiddenError, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { isPlatformOperator } from "@/lib/auth/operator-access";
import { feedbackRepository } from "@/lib/feedback/github-publisher";
import { FEEDBACK_ACTIVITY_WINDOW_MS, feedbackSubmissionSchema, type FeedbackContext, type FeedbackDiagnostics, type FeedbackReceipt,
  type FeedbackSubmission, type FeedbackSubmissionResult, type PrivateFeedbackReport, type FeedbackOperatorStatus } from "@/lib/feedback/contracts";

export const FEEDBACK_HOURLY_LIMIT = 5;
export const FEEDBACK_DAILY_LIMIT = 20;
export class FeedbackRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) { super("Please wait before sending another report."); }
}
export class FeedbackScopeChangedError extends AppConflictError {
  constructor() { super("Your signed-in trip has changed. Reopen feedback before sending this report."); }
}
export class FeedbackPolicyChangedError extends Error {
  constructor() { super("Refresh the page to review the updated feedback policy before sending a new report."); }
}
type FeedbackRow = { id: string; trip_id: string; actor_member_id: string; actor_user_id: string;
  status: FeedbackReceipt["status"]; title: string; description: string; kind: "bug" | "feedback";
  allow_issue_publication: boolean; diagnostics: FeedbackDiagnostics | null; build_version: string | null;
  created_at: Date | string; payload_hash: Buffer };
type Queryable = Pick<PoolClient, "query">;

export function feedbackBuildVersion(): string | null {
  const value = process.env.STARDUST_BUILD_VERSION?.trim();
  return value && /^[a-f0-9]{7,40}$/iu.test(value) ? value.toLowerCase() : null;
}
export function feedbackScope(session: Pick<AuthenticatedSession,"tripId"|"memberId"|"userId">, authSecret: string): FeedbackContext["scope"] {
  if (authSecret.length < 32) throw new Error("Feedback requires the configured authentication secret.");
  return { tripId: session.tripId, memberId: session.memberId, scopeKey: createHmac("sha256", authSecret)
    .update(JSON.stringify(["stardust-feedback-scope-v1", session.tripId, session.memberId, session.userId])).digest("hex") };
}
export function feedbackPayloadHash(session: Pick<AuthenticatedSession, "tripId" | "memberId">, input: FeedbackSubmission): Buffer {
  const { clientRequestId: _requestId, ...payload } = feedbackSubmissionSchema.parse(input);
  void _requestId;
  return createHash("sha256").update(JSON.stringify({ tripId: session.tripId, memberId: session.memberId, ...payload })).digest();
}
export function recentFeedbackDiagnostics(diagnostics: FeedbackDiagnostics | undefined, now: Date): FeedbackDiagnostics | null {
  if (!diagnostics) return null;
  return { ...diagnostics, breadcrumbs: diagnostics.breadcrumbs
    .filter((item) => { const time = Date.parse(item.at); return time >= now.getTime() - FEEDBACK_ACTIVITY_WINDOW_MS && time <= now.getTime() + 60_000; })
    .map((item) => ({ ...item, at: new Date(item.at).toISOString() })) };
}
function receipt(row: FeedbackRow): FeedbackReceipt {
  return { id: row.id, status: row.status, createdAt: new Date(row.created_at).toISOString(), title: row.title,
    kind: row.kind, allowIssuePublication: row.allow_issue_publication };
}
export async function getFeedbackContext(pool: Pool, session: AuthenticatedSession, authSecret: string): Promise<FeedbackContext> {
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    return { scope: feedbackScope(session, authSecret),
      isOperator: await isPlatformOperator(client, session.userId), buildVersion: feedbackBuildVersion() };
  });
}
export async function submitFeedback(pool: Pool, session: AuthenticatedSession, inputValue: FeedbackSubmission, authSecret: string): Promise<FeedbackSubmissionResult> {
  const input = feedbackSubmissionSchema.parse(inputValue);
  const payloadHash = feedbackPayloadHash(session, input);
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const currentScope = feedbackScope(session, authSecret);
    if (input.scope.tripId !== session.tripId || input.scope.memberId !== session.memberId
      || !timingSafeEqual(Buffer.from(input.scope.scopeKey, "hex"), Buffer.from(currentScope.scopeKey, "hex"))) throw new FeedbackScopeChangedError();
    // The account-wide lock makes parallel tabs/trips obey the same admission cap.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify([session.userId, "feedback-submission"])]);
    const existing = await client.query<FeedbackRow>("SELECT * FROM feedback_reports WHERE actor_user_id=$1 AND client_request_id=$2 FOR UPDATE", [session.userId, input.clientRequestId]);
    const prior = existing.rows[0];
    if (prior) {
      if (prior.payload_hash.length !== payloadHash.length || !timingSafeEqual(prior.payload_hash, payloadHash)) {
        throw new AppConflictError("This report submission was already used with different content. Start a new report.");
      }
      return { report: receipt(prior), replayed: true };
    }
    // Old declined reports remain replayable, but a stale client must review the
    // current policy before creating a report. Never promote its false payload.
    if (!input.allowIssuePublication) throw new FeedbackPolicyChangedError();
    const limits = await client.query<{ recent_hour: number; recent_day: number; retry_after: number; now: Date }>(
      `SELECT count(*) FILTER (WHERE created_at>clock_timestamp()-interval '1 hour')::int AS recent_hour,
        count(*) FILTER (WHERE created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS recent_day,
        GREATEST(1,EXTRACT(EPOCH FROM (min(created_at) FILTER (WHERE created_at>clock_timestamp()-interval '1 hour')+interval '1 hour'-clock_timestamp())))::int AS retry_after,
        clock_timestamp() AS now FROM feedback_reports WHERE actor_user_id=$1 AND created_at>clock_timestamp()-interval '1 day'`, [session.userId]);
    const limit = limits.rows[0];
    if (limit.recent_day >= FEEDBACK_DAILY_LIMIT) {
      const now = new Date(limit.now);
      const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      throw new FeedbackRateLimitError(Math.max(1, Math.ceil((tomorrow - now.getTime()) / 1000)));
    }
    if (limit.recent_hour >= FEEDBACK_HOURLY_LIMIT) throw new FeedbackRateLimitError(Math.max(1, Math.min(3600, limit.retry_after)));
    const inserted = await client.query<FeedbackRow>(
      `INSERT INTO feedback_reports(id,trip_id,actor_member_id,actor_user_id,client_request_id,payload_hash,title,description,kind,allow_issue_publication,diagnostics,build_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING *`,
      [randomUUID(), session.tripId, session.memberId, session.userId, input.clientRequestId, payloadHash, input.title, input.description, input.kind,
        input.allowIssuePublication, JSON.stringify(recentFeedbackDiagnostics(input.diagnostics, limit.now)), feedbackBuildVersion()]);
    const row = inserted.rows[0];
    await client.query("INSERT INTO feedback_events(report_id,event_type,metadata) VALUES($1,'submitted',$2::jsonb)",
      [row.id, JSON.stringify({ diagnosticsIncluded: input.diagnostics !== undefined, allowIssuePublication: input.allowIssuePublication })]);
    return { report: receipt(row), replayed: false };
  });
}
export async function listSelfFeedback(pool: Pool, session: AuthenticatedSession): Promise<FeedbackReceipt[]> {
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const result = await client.query<FeedbackRow>(
      `SELECT * FROM feedback_reports WHERE trip_id=$1 AND actor_member_id=$2 AND actor_user_id=$3 ORDER BY created_at DESC,id DESC LIMIT 20`,
      [session.tripId, session.memberId, session.userId]);
    return result.rows.map(receipt);
  });
}
export async function assertFeedbackOperator(client: Queryable, session: AuthenticatedSession): Promise<void> {
  await lockCurrentTripActor(client, session);
  if (!(await isPlatformOperator(client, session.userId))) throw new AppForbiddenError("Only the application operator can review private feedback.");
}
export async function listOperatorFeedback(pool: Pool, session: AuthenticatedSession): Promise<PrivateFeedbackReport[]> {
  return inTransaction(pool, async (client) => {
    await assertFeedbackOperator(client, session);
    const result = await client.query<FeedbackRow>("SELECT * FROM feedback_reports ORDER BY created_at DESC,id DESC LIMIT 100");
    return result.rows.map((row) => ({ ...receipt(row), description: row.description, diagnostics: row.diagnostics,
      buildVersion: row.build_version, tripId: row.trip_id, actorMemberId: row.actor_member_id, actorUserId: row.actor_user_id }));
  });
}

export async function getFeedbackOperatorStatus(pool: Pool, session: AuthenticatedSession): Promise<FeedbackOperatorStatus> {
  return inTransaction(pool, async (client) => {
    await assertFeedbackOperator(client, session);
    const counts = await client.query<{ reports: number; queued_issues: number; uncertain_issues: number; blocked_issues: number; published_issues: number }>(
      `SELECT (SELECT count(*)::int FROM feedback_reports WHERE status='queued') AS reports,
        count(*) FILTER(WHERE state IN ('queued','claimed'))::int AS queued_issues,
        count(*) FILTER(WHERE state='uncertain')::int AS uncertain_issues,
        count(*) FILTER(WHERE state='blocked')::int AS blocked_issues,
        count(*) FILTER(WHERE state='published')::int AS published_issues FROM feedback_issue_outbox`);
    const runs = await client.query<{ run_date: string | Date; state: "queued" | "running" | "succeeded" | "failed";
      attempt_count: number; started_at: Date | null; completed_at: Date | null; model: "gpt-6-astra"; effort: "medium"; error_code: string | null }>(
      "SELECT run_date::text, state,attempt_count,started_at,completed_at,model,effort,error_code FROM feedback_triage_runs ORDER BY run_date DESC LIMIT 1");
    const count = counts.rows[0];
    const run = runs.rows[0];
    return { configuration: { triageConfigured: process.env.STARDUST_FEEDBACK_TRIAGE_ENABLED === "true", publishingConfigured: Boolean(process.env.STARDUST_FEEDBACK_GITHUB_TOKEN?.trim() && feedbackRepository(process.env.STARDUST_FEEDBACK_REPOSITORY)) },
      queue: { reports: count.reports, queuedIssues: count.queued_issues, uncertainIssues: count.uncertain_issues, blockedIssues: count.blocked_issues, publishedIssues: count.published_issues },
      lastRun: run ? { runDate: String(run.run_date), state: run.state, attemptCount: run.attempt_count,
        startedAt: run.started_at?.toISOString() ?? null, completedAt: run.completed_at?.toISOString() ?? null,
        model: run.model, effort: run.effort, errorCode: run.error_code } : null };
  });
}
