import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "@/lib/app/repository";
import { FEEDBACK_BATCH_LIMIT, feedbackFingerprint, issuePayloadHash, projectReviewReport,
  renderFeedbackIssue, sanitizeFeedbackText, unsafeFeedbackInstructions, validateReviewOutput,
  type KnownFeedbackIssue, type ReviewReport, type ReviewResult } from "./review-contract";
import { validateIssuePayload, type DeliveryOutcome, type IssuePayload } from "./github-publisher";

type ReportRow = { id: string; title: string; description: string; kind: "bug" | "feedback";
  diagnostics: unknown; build_version: string | null; private_names: string[] };
type KnownRow = { id: string; title: string; dedupe_key: Buffer; state: string };
export type ClaimedFeedbackRun = { id: string; leaseOwner: string; reports: ReviewReport[];
  reportIds: string[]; known: KnownFeedbackIssue[]; knownRows: KnownRow[] };
export type ClaimedFeedbackIssue = IssuePayload & { leaseOwner: string; postAttempts: number; reconciliationAttempts: number };
const LEASE_MINUTES = 15;

async function event(client: PoolClient, runId: string | null, outboxId: string | null, type: string, metadata: Record<string, unknown> = {}) {
  await client.query("INSERT INTO feedback_events(run_id,outbox_id,event_type,metadata) VALUES($1,$2,$3,$4::jsonb)", [runId, outboxId, type, JSON.stringify(metadata)]);
}

/** One provider attempt per UTC day across workers, including retries of earlier batches. */
export async function claimFeedbackRun(pool: Pool): Promise<ClaimedFeedbackRun | null> {
  return inTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('stardust-feedback-daily-review',0))");
    const exhausted = await client.query<{ id: string }>(`UPDATE feedback_triage_runs SET state='failed',error_code='lease_expired',lease_owner=NULL,lease_until=NULL,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE state='running' AND attempt_count=3 AND lease_until<clock_timestamp() RETURNING id`);
    for (const row of exhausted.rows) await event(client, row.id, null, "triage.exhausted", { errorCode: "lease_expired" });
    const spent = await client.query("SELECT 1 FROM feedback_triage_runs WHERE last_attempt_date=(clock_timestamp() AT TIME ZONE 'UTC')::date LIMIT 1");
    if (spent.rowCount) return null;
    const pending = await client.query<{ id: string }>(`SELECT id FROM feedback_triage_runs WHERE state IN ('queued','failed','running') AND attempt_count<3
      AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY run_date,id LIMIT 1 FOR UPDATE`);
    let runId = pending.rows[0]?.id;
    if (!runId) {
      const candidates = await client.query<{ id: string }>(`SELECT r.id FROM feedback_reports r WHERE status='queued' AND allow_issue_publication
        AND NOT EXISTS(SELECT 1 FROM feedback_triage_items i WHERE i.report_id=r.id) ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`, [FEEDBACK_BATCH_LIMIT]);
      if (!candidates.rowCount) return null;
      runId = randomUUID();
      await client.query("INSERT INTO feedback_triage_runs(id,run_date) VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date)", [runId]);
      await client.query("INSERT INTO feedback_triage_items(run_id,report_id) SELECT $1,unnest($2::uuid[])", [runId, candidates.rows.map((row) => row.id)]);
    }
    const leaseOwner = randomUUID();
    await client.query(`UPDATE feedback_triage_runs SET state='running',lease_owner=$2,lease_until=clock_timestamp()+interval '${LEASE_MINUTES} minutes',
      attempt_count=attempt_count+1,last_attempt_date=(clock_timestamp() AT TIME ZONE 'UTC')::date,
      started_at=clock_timestamp(),completed_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1`, [runId, leaseOwner]);
    const raw = await client.query<ReportRow>(`SELECT r.id,r.title,r.description,r.kind,r.diagnostics,r.build_version,
      ARRAY(SELECT DISTINCT name FROM (SELECT m.display_name AS name FROM trip_members m WHERE m.trip_id=r.trip_id
        UNION SELECT u.display_name FROM app_users u WHERE u.id=r.actor_user_id
        UNION SELECT t.name FROM trips t WHERE t.id=r.trip_id
        UNION SELECT i.title FROM itinerary_items i WHERE i.trip_id=r.trip_id
        UNION SELECT i.location_name FROM itinerary_items i WHERE i.trip_id=r.trip_id
        UNION SELECT i.departure_location_name FROM itinerary_items i WHERE i.trip_id=r.trip_id
        UNION SELECT i.destination_location_name FROM itinerary_items i WHERE i.trip_id=r.trip_id
        UNION SELECT e.description FROM expenses e WHERE e.trip_id=r.trip_id
        UNION SELECT c.proposed_patch->>'title' FROM change_requests c WHERE c.trip_id=r.trip_id
        UNION SELECT c.proposed_patch->>'locationName' FROM change_requests c WHERE c.trip_id=r.trip_id
        UNION SELECT c.proposed_patch->>'departureLocationName' FROM change_requests c WHERE c.trip_id=r.trip_id
        UNION SELECT c.proposed_patch->>'destinationLocationName' FROM change_requests c WHERE c.trip_id=r.trip_id
        UNION SELECT c.proposed_patch->>'description' FROM change_requests c WHERE c.trip_id=r.trip_id
        UNION SELECT c.proposed_patch->'linkedExpense'->>'description' FROM change_requests c WHERE c.trip_id=r.trip_id) names WHERE length(name)>=1) AS private_names
      FROM feedback_triage_items i JOIN feedback_reports r ON r.id=i.report_id
      WHERE i.run_id=$1 AND i.processed_at IS NULL AND r.allow_issue_publication ORDER BY r.created_at,r.id`, [runId]);
    const knownResult = await client.query<KnownRow>("SELECT id,title,dedupe_key,state FROM feedback_issue_outbox ORDER BY created_at DESC,id DESC LIMIT 30");
    const reports = raw.rows.map((row, index) => projectReviewReport(row, `R${index + 1}`, row.private_names));
    const known = knownResult.rows.map((row, index) => ({ key: `K${index + 1}`, title: sanitizeFeedbackText(row.title, [], 160) }));
    await event(client, runId, null, "triage.claimed", { reports: reports.length });
    return { id: runId, leaseOwner, reports, reportIds: raw.rows.map((row) => row.id), known, knownRows: knownResult.rows };
  });
}

async function lockRun(client: PoolClient, claim: ClaimedFeedbackRun) {
  const locked = await client.query(`WITH current_run AS MATERIALIZED (SELECT * FROM feedback_triage_runs WHERE id=$1 AND lease_owner=$2 FOR UPDATE)
    SELECT 1 FROM current_run WHERE state='running' AND lease_until>clock_timestamp()`, [claim.id, claim.leaseOwner]);
  if (!locked.rowCount) throw new Error("lease_expired");
}

export async function completeFeedbackRun(pool: Pool, claim: ClaimedFeedbackRun, result: ReviewResult): Promise<number> {
  const decisions = validateReviewOutput({ decisions: result.decisions }, claim.reports, claim.known);
  if (![result.inputTokens, result.outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("output_invalid");
  return inTransaction(pool, async (client) => {
    await lockRun(client, claim);
    const claimCheck = await client.query<{ report_id: string }>("SELECT report_id FROM feedback_triage_items WHERE run_id=$1 AND processed_at IS NULL ORDER BY report_id FOR UPDATE", [claim.id]);
    if (claimCheck.rows.map((row) => row.report_id).sort().join() !== [...claim.reportIds].sort().join()) throw new Error("lease_expired");
    let queued = 0;
    const resolvedIssues = new Map(claim.known.map((known, index) => [known.key, claim.knownRows[index]!]));
    for (const [index, report] of claim.reports.entries()) {
      const decision = decisions[index]!;
      const reportId = claim.reportIds[index]!;
      const fingerprint = feedbackFingerprint(report);
      const existing = await client.query<{ id: string; state: string }>("SELECT id,state FROM feedback_issue_outbox WHERE dedupe_key=$1", [fingerprint]);
      const unsafe = unsafeFeedbackInstructions(`${report.title} ${report.description}`);
      const effectiveDecision = unsafe ? "ignore" : existing.rowCount ? "duplicate" : decision.decision;
      let duplicate = existing.rows[0] ?? (decision.duplicateKey ? resolvedIssues.get(decision.duplicateKey) : undefined);
      if (effectiveDecision === "duplicate" && !duplicate) throw new Error("output_invalid");
      if (duplicate) {
        // Serialize linking with publication: an issue can publish after the
        // model's known-issue snapshot but before this duplicate is persisted.
        const current = await client.query<{ id: string; state: string }>("SELECT id,state FROM feedback_issue_outbox WHERE id=$1 FOR UPDATE", [duplicate.id]);
        if (!current.rows[0]) throw new Error("output_invalid");
        duplicate = current.rows[0];
      }
      await client.query(`UPDATE feedback_triage_items SET decision=$3,structured_result=$4::jsonb,processed_at=clock_timestamp()
        WHERE run_id=$1 AND report_id=$2 AND processed_at IS NULL`, [claim.id, reportId, effectiveDecision,
        JSON.stringify({ ...decision, decision: effectiveDecision, ...(duplicate ? { duplicateOutboxId: duplicate.id } : {}) })]);
      if (effectiveDecision === "issue") {
        const outboxId = randomUUID();
        const payload = renderFeedbackIssue(outboxId, report, decision);
        const payloadHash = issuePayloadHash(payload.title, payload.body);
        validateIssuePayload({ id: outboxId, ...payload, payloadHash });
        await client.query(`INSERT INTO feedback_issue_outbox(id,run_id,dedupe_key,report_ids,title,body,payload_hash)
          VALUES($1,$2,$3,$4::uuid[],$5,$6,$7)`, [outboxId, claim.id, fingerprint, [reportId], payload.title, payload.body, payloadHash]);
        await event(client, claim.id, outboxId, "issue.queued");
        resolvedIssues.set(report.key, { id: outboxId, title: payload.title, state: "queued", dedupe_key: fingerprint });
        queued += 1;
      }
      await client.query("UPDATE feedback_reports SET status=$2 WHERE id=$1", [reportId, effectiveDecision === "ignore" ? "ignored"
        : duplicate?.state === "published" ? "published" : "triaged"]);
    }
    await client.query(`UPDATE feedback_triage_runs SET state='succeeded',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp(),
      input_tokens=input_tokens+$3,output_tokens=output_tokens+$4,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_owner=$2`,
    [claim.id, claim.leaseOwner, result.inputTokens, result.outputTokens]);
    await event(client, claim.id, null, "triage.completed", { reports: claim.reports.length, issuesQueued: queued, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return queued;
  });
}

export async function failFeedbackRun(pool: Pool, claim: ClaimedFeedbackRun, errorCode: "provider_unavailable" | "output_invalid" | "worker_failed"): Promise<void> {
  await inTransaction(pool, async (client) => {
    const result = await client.query(`UPDATE feedback_triage_runs SET state='failed',lease_owner=NULL,lease_until=NULL,error_code=$3,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND lease_owner=$2 AND state='running'`, [claim.id, claim.leaseOwner, errorCode]);
    if (result.rowCount) await event(client, claim.id, null, "triage.failed", { errorCode });
  });
}

/** Claim without reserving another POST: uncertain rows keep their terminal POST count. */
export async function claimFeedbackIssue(pool: Pool): Promise<ClaimedFeedbackIssue | null> {
  return inTransaction(pool, async (client) => {
    const selected = await client.query<{ id: string; title: string; body: string; payload_hash: Buffer; post_attempts: number; reconciliation_attempts: number }>(`SELECT id,title,body,payload_hash,post_attempts,reconciliation_attempts FROM feedback_issue_outbox
      WHERE state IN ('queued','claimed','uncertain') AND (lease_until IS NULL OR lease_until<clock_timestamp())
      AND (post_attempts=0 OR (reconciliation_attempts<12 AND updated_at<clock_timestamp()-interval '1 hour'))
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = selected.rows[0];
    if (!row) return null;
    const leaseOwner = randomUUID();
    await client.query(`UPDATE feedback_issue_outbox SET state=CASE WHEN post_attempts=0 THEN 'claimed' ELSE 'uncertain' END,
      lease_owner=$2,lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() WHERE id=$1`, [row.id, leaseOwner]);
    return { id: row.id, title: row.title, body: row.body, payloadHash: row.payload_hash, leaseOwner,
      postAttempts: row.post_attempts, reconciliationAttempts: row.reconciliation_attempts };
  });
}

/** Durable boundary before dispatch. A crash even one instruction later never allows a second POST. */
export async function beginFeedbackDelivery(pool: Pool, claim: ClaimedFeedbackIssue): Promise<boolean> {
  validateIssuePayload(claim);
  return inTransaction(pool, async (client) => {
    const result = await client.query(`WITH locked AS MATERIALIZED (SELECT * FROM feedback_issue_outbox WHERE id=$1 AND lease_owner=$2 FOR UPDATE)
      UPDATE feedback_issue_outbox target SET state='uncertain',post_attempts=1,
      reconciliation_attempts=target.reconciliation_attempts+CASE WHEN target.post_attempts=1 THEN 1 ELSE 0 END,
      updated_at=clock_timestamp() FROM locked WHERE target.id=locked.id AND locked.lease_until>clock_timestamp()
      AND locked.post_attempts=$3 AND locked.state IN ('claimed','uncertain') AND locked.reconciliation_attempts=$4 AND locked.reconciliation_attempts<12
      RETURNING target.id`, [claim.id, claim.leaseOwner, claim.postAttempts, claim.reconciliationAttempts]);
    if (result.rowCount) await event(client, null, claim.id, claim.postAttempts ? "issue.reconciliation.started" : "issue.post.started");
    return Boolean(result.rowCount);
  });
}
export async function completeFeedbackDelivery(pool: Pool, claim: ClaimedFeedbackIssue, outcome: DeliveryOutcome): Promise<void> {
  await inTransaction(pool, async (client) => {
    const state = outcome.state === "uncertain" && claim.reconciliationAttempts + 1 >= 12 ? "blocked" : outcome.state;
    const code = state === "blocked" && outcome.state === "uncertain" ? "reconciliation_exhausted" : outcome.state === "published" ? null : outcome.errorCode;
    const result = await client.query(`UPDATE feedback_issue_outbox SET state=$3,issue_number=$4,issue_url=$5,error_code=$6,
      lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_owner=$2 AND state='uncertain' RETURNING report_ids`,
    [claim.id, claim.leaseOwner, state, outcome.state === "published" ? outcome.receipt.number : null,
      outcome.state === "published" ? outcome.receipt.url : null, code]);
    if (!result.rowCount) throw new Error("lease_expired");
    if (state === "published") await client.query(`UPDATE feedback_reports SET status='published' WHERE id=ANY($1::uuid[])
      OR id IN (SELECT report_id FROM feedback_triage_items WHERE decision='duplicate' AND structured_result->>'duplicateOutboxId'=$2)`, [result.rows[0].report_ids, claim.id]);
    await event(client, null, claim.id, `issue.${state}`, code ? { errorCode: code } : {});
  });
}

export async function blockFeedbackIssue(pool: Pool, claim: ClaimedFeedbackIssue): Promise<void> {
  await inTransaction(pool, async (client) => {
    const result = await client.query(`UPDATE feedback_issue_outbox SET state='blocked',error_code='payload_invalid',lease_owner=NULL,
      lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_owner=$2 AND state IN ('claimed','uncertain')`, [claim.id, claim.leaseOwner]);
    if (result.rowCount) await event(client, null, claim.id, "issue.blocked", { errorCode: "payload_invalid" });
  });
}
