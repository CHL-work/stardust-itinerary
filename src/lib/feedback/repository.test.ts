import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AppConflictError, AppForbiddenError } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import type { FeedbackSubmission } from "./contracts";
import { FeedbackPolicyChangedError, FeedbackScopeChangedError, feedbackPayloadHash, feedbackScope, submitFeedback } from "./repository";

const now = new Date("2030-04-01T12:00:00.000Z");
const secret = "synthetic-feedback-secret-".repeat(3);
const session: AuthenticatedSession = {
  tripId: "10000000-0000-4000-8000-000000000001", memberId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001", sessionId: "60000000-0000-4000-8000-000000000001",
  role: "editor", expiresAt: new Date("2030-04-02T00:00:00.000Z"), absoluteExpiresAt: new Date("2030-04-30T00:00:00.000Z"),
  displayName: "Synthetic feedback member", issuer: "https://accounts.google.com", subject: "synthetic", generation: 1,
};
const input: FeedbackSubmission = {
  scope: feedbackScope(session, secret), clientRequestId: "40000000-0000-4000-8000-000000000001",
  title: "Synthetic settings error", description: "The save action did not finish.", kind: "bug", allowIssuePublication: true,
  diagnostics: { page: "settings", locale: "en", formFactor: "phone", osFamily: "ios", browserFamily: "safari", online: true,
    breadcrumbs: [{ page: "settings", action: "settings_save", at: now.toISOString() },
      { page: "ai", action: "ai_submit", at: "2030-04-01T11:30:00.000Z" }] },
};

// Frozen pre-policy hash shape: consent and the original 30-minute diagnostic
// payload are hashed before server retention filtering, without the request ID.
function legacyHash(payload: FeedbackSubmission): Buffer {
  return createHash("sha256").update(JSON.stringify({ tripId: session.tripId, memberId: session.memberId,
    scope: payload.scope, title: payload.title, description: payload.description, kind: payload.kind,
    allowIssuePublication: payload.allowIssuePublication, diagnostics: payload.diagnostics })).digest();
}

function historicalRow(payload: FeedbackSubmission) {
  return { id: "50000000-0000-4000-8000-000000000001", trip_id: session.tripId, actor_member_id: session.memberId,
    actor_user_id: session.userId, status: "queued", title: payload.title, description: payload.description, kind: payload.kind,
    allow_issue_publication: payload.allowIssuePublication, diagnostics: structuredClone(payload.diagnostics), build_version: null,
    created_at: now, payload_hash: legacyHash(payload) };
}

function database(options: { prior?: ReturnType<typeof historicalRow>; active?: boolean; capped?: boolean } = {}) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    let rows: unknown[] = [];
    if (sql === "SELECT id FROM trips WHERE id = $1 FOR UPDATE") rows = [{ id: session.tripId }];
    else if (sql.includes("SELECT role FROM trip_members")) rows = options.active === false ? [] : [{ role: session.role }];
    else if (sql.includes("SELECT * FROM feedback_reports")) rows = options.prior ? [options.prior] : [];
    else if (sql.includes("AS recent_hour")) rows = [{ recent_hour: options.capped ? 5 : 0, recent_day: 0, retry_after: 60, now }];
    else if (sql.includes("INSERT INTO feedback_reports")) rows = [{ ...historicalRow(input), id: values[0], payload_hash: values[5],
      title: values[6], description: values[7], kind: values[8], allow_issue_publication: values[9],
      diagnostics: JSON.parse(String(values[10])) }];
    else if (!sql.startsWith("SELECT pg_advisory_xact_lock") && !sql.startsWith("INSERT INTO feedback_events")
      && !["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) throw new Error("Unexpected synthetic database query");
    return { rows, rowCount: rows.length };
  });
  const release = vi.fn();
  return { pool: { connect: async () => ({ query, release }) } as unknown as Pool, query, release,
    calls: () => query.mock.calls.map(([sql]) => sql) };
}

describe("feedback submission policy and historical idempotency", () => {
  it("persists and audits new eligible reports while retaining only ten-minute diagnostics", async () => {
    const db = database();
    const result = await submitFeedback(db.pool, session, input, secret);
    expect(result.replayed).toBe(false);
    expect(result.report.allowIssuePublication).toBe(true);
    const insert = db.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO feedback_reports"));
    expect(insert?.[1]?.[9]).toBe(true);
    expect(insert?.[1]?.[5]).toEqual(legacyHash(input));
    expect(JSON.parse(String(insert?.[1]?.[10])).breadcrumbs).toEqual([input.diagnostics?.breadcrumbs[0]]);
    const audit = db.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO feedback_events"));
    expect(JSON.parse(String(audit?.[1]?.[1]))).toEqual({ diagnosticsIncluded: true, allowIssuePublication: true });
    expect(db.calls().at(-1)).toBe("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it("rejects a new declined payload after identity/scope/locking and lookup, before quota or insert", async () => {
    const db = database({ capped: true });
    const declined = { ...input, allowIssuePublication: false };
    await expect(submitFeedback(db.pool, session, declined, secret)).rejects.toBeInstanceOf(FeedbackPolicyChangedError);
    const calls = db.calls();
    const membership = calls.findIndex((sql) => sql.includes("SELECT role FROM trip_members"));
    const accountLock = db.query.mock.calls.findIndex(([sql, values]) => sql.startsWith("SELECT pg_advisory_xact_lock")
      && String(values?.[0]).includes("feedback-submission"));
    const existing = calls.findIndex((sql) => sql.includes("SELECT * FROM feedback_reports"));
    expect(membership).toBeGreaterThan(0);
    expect(accountLock).toBeGreaterThan(membership);
    expect(existing).toBeGreaterThan(accountLock);
    expect(calls.some((sql) => sql.includes("AS recent_hour") || sql.startsWith("INSERT"))).toBe(false);
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(declined.allowIssuePublication).toBe(false);
  });

  it.each([false, true])("replays historical consent=%s with its original 30-minute payload before quotas", async (allowIssuePublication) => {
    const historicalInput = { ...input, allowIssuePublication };
    const prior = historicalRow(historicalInput);
    const snapshot = structuredClone(prior.diagnostics);
    const db = database({ prior, capped: true });
    expect(feedbackPayloadHash(session, historicalInput)).toEqual(prior.payload_hash);
    const result = await submitFeedback(db.pool, session, historicalInput, secret);
    expect(result).toEqual({ report: { id: prior.id, status: "queued", createdAt: now.toISOString(),
      title: input.title, kind: input.kind, allowIssuePublication }, replayed: true });
    expect(prior.diagnostics).toEqual(snapshot);
    expect(prior.diagnostics?.breadcrumbs).toHaveLength(2);
    expect(db.calls().some((sql) => sql.includes("AS recent_hour") || sql.startsWith("INSERT") || sql.startsWith("UPDATE"))).toBe(false);
    expect(db.calls().at(-1)).toBe("COMMIT");
  });

  it.each([{ description: "Changed report" }, { allowIssuePublication: true },
    { diagnostics: { ...input.diagnostics!, breadcrumbs: [input.diagnostics!.breadcrumbs[0]] } }])(
    "conflicts rather than promoting or rewriting a historical declined report %#", async (change) => {
      const historicalInput = { ...input, allowIssuePublication: false };
      const prior = historicalRow(historicalInput);
      const db = database({ prior, capped: true });
      await expect(submitFeedback(db.pool, session, { ...historicalInput, ...change }, secret)).rejects.toBeInstanceOf(AppConflictError);
      expect(prior.allow_issue_publication).toBe(false);
      expect(db.calls().some((sql) => sql.includes("AS recent_hour") || sql.startsWith("INSERT") || sql.startsWith("UPDATE"))).toBe(false);
    },
  );

  it("enforces current membership and scope before looking up a historical declined report", async () => {
    const historicalInput = { ...input, allowIssuePublication: false };
    const prior = historicalRow(historicalInput);
    const revoked = database({ prior, active: false });
    await expect(submitFeedback(revoked.pool, session, historicalInput, secret)).rejects.toBeInstanceOf(AppForbiddenError);
    expect(revoked.calls().some((sql) => sql.includes("SELECT * FROM feedback_reports"))).toBe(false);
    const stale = database({ prior });
    await expect(submitFeedback(stale.pool, session, { ...historicalInput,
      scope: { ...historicalInput.scope, scopeKey: "0".repeat(64) } }, secret)).rejects.toBeInstanceOf(FeedbackScopeChangedError);
    expect(stale.calls().some((sql) => sql.includes("SELECT * FROM feedback_reports"))).toBe(false);
  });
});
