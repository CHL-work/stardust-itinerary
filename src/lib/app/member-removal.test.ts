import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppForbiddenError } from "@/lib/app/repository";

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/app/trip-authorization", () => ({ lockCurrentTripActor: mocks.authorize }));
import { getTripMemberRemovalPreview, memberRemovalInputSchema, proposalReferencesMember, removeTripMemberSafely } from "@/lib/app/member-removal";

const tripId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000002";
const session = { tripId, memberId: actorId, userId: "30000000-0000-4000-8000-000000000001", role: "owner" } as AuthenticatedSession;
const member = { id: targetId, display_name: "Synthetic member", role: "editor", status: "active", current_revision: 4, user_id: userId };
const event = { id: "40000000-0000-4000-8000-000000000001", current_revision: 2, viewer_member_ids: [targetId], is_viewer: true,
  created_by_member_id: actorId, title: "Synthetic private event", visibility: "private", status: "planned", trip_day_id: "synthetic-day" };
const expense = { id: "50000000-0000-4000-8000-000000000001", current_revision: 1, currency: "JPY", amount_minor: "101",
  payer_member_id: targetId, share_minor: "51", description: "Synthetic expense", status: "posted", can_view: true,
  itinerary_item_id: null, occurred_at: "2030-04-01T12:00:00Z", splits: [{ memberId: targetId, shareMinor: "51" }, { memberId: actorId, shareMinor: "50" }],
  eligible_members: [{ id: actorId, displayName: "Synthetic owner" }] };
const payment = { trip_id: tripId, id: "51000000-0000-4000-8000-000000000001", from_member_id: targetId, to_member_id: actorId,
  accounting_from_member_id: targetId, accounting_to_member_id: actorId, current_revision: 1, currency: "JPY", amount_minor: "101",
  occurred_at: "2020-04-01T12:00:00Z", note: "External cash", status: "posted", created_by_member_id: actorId,
  created_by_user_id: session.userId, created_at: "2020-04-01T12:00:00Z", updated_at: "2020-04-01T12:00:00Z",
  from_member_name: "Synthetic member", to_member_name: "Synthetic owner", accounting_from_member_name: "Synthetic member", accounting_to_member_name: "Synthetic owner" };

function fixture(options: {
  member?: typeof member | null; beforeUserId?: string | null; owners?: Array<{ id: string; user_id: string }>;
  events?: Array<Record<string, unknown>>; expenses?: Array<typeof expense>; proposals?: Array<Record<string, unknown>>;
  failAudit?: boolean;
  reusableInvites?: Array<{ id: string }>;
  payments?: Array<typeof payment>; paymentCandidates?: Array<{ id: string; displayName: string }>;
} = {}) {
  const target = options.member === undefined ? member : options.member;
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    void _values;
    const text = sql.replace(/\s+/gu, " ").trim();
    if (text.startsWith("SELECT user_id FROM trip_members")) return { rows: [{ user_id: options.beforeUserId === undefined ? target?.user_id : options.beforeUserId }], rowCount: 1 };
    if (text.startsWith("SELECT to_regclass('member_payments')")) return { rows: [{ available: options.payments !== undefined }], rowCount: 1 };
    if (text.startsWith('SELECT id, display_name AS "displayName"')) return { rows: options.paymentCandidates ?? [{ id: actorId, displayName: "Synthetic owner" }], rowCount: 1 };
    if (text.startsWith("SELECT id, display_name")) return { rows: target ? [target] : [], rowCount: target ? 1 : 0 };
    if (text.startsWith("SELECT id, user_id FROM trip_members")) return { rows: options.owners ?? [{ id: actorId, user_id: session.userId }], rowCount: 1 };
    if (text.startsWith("SELECT item.*")) return { rows: options.events ?? [], rowCount: 0 };
    if (text.startsWith("SELECT expense.id")) return { rows: options.expenses ?? [], rowCount: 0 };
    if (text.startsWith("SELECT payment.*")) return { rows: options.payments ?? [], rowCount: 0 };
    if (text.startsWith("UPDATE member_payments")) {
      const row = options.payments?.find((entry) => entry.id === _values?.[1]);
      return { rows: row ? [{ ...row, current_revision: row.current_revision + 1,
        ...(text.includes("SET status") ? { status: "void" } : { accounting_from_member_id: _values?.[2], accounting_to_member_id: _values?.[3] }) }] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith("SELECT id, proposal_revision")) return { rows: options.proposals ?? [], rowCount: 0 };
    if (text.startsWith("SELECT (SELECT count(*) FROM ai_requests")) return { rows: [{ requests: "7", conversations: "2" }], rowCount: 1 };
    if (text.startsWith("SELECT id FROM trip_join_links")) return { rows: options.reusableInvites ?? [], rowCount: 0 };
    if (text.startsWith("UPDATE ai_conversations")) return { rows: [{ id: "60000000-0000-4000-8000-000000000001" }], rowCount: 1 };
    if (text.startsWith("INSERT INTO audit_events") && options.failAudit) throw new Error("Synthetic audit failure");
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, query, release };
}

async function confirmation(pool: Pool) {
  const preview = await getTripMemberRemovalPreview(pool, session, tripId, targetId);
  return { confirmation: true as const, expectedRevision: preview.member.revision, previewDigest: preview.previewDigest };
}

beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue(undefined); });

describe("safe linked-member removal", () => {
  it("requires explicit confirmation and a bound preview revision/hash", () => {
    expect(memberRemovalInputSchema.safeParse({}).success).toBe(false);
    expect(memberRemovalInputSchema.safeParse({ confirmation: false, expectedRevision: 1, previewDigest: "a".repeat(64) }).success).toBe(false);
    expect(memberRemovalInputSchema.safeParse({ confirmation: true, expectedRevision: 0, previewDigest: "a".repeat(64) }).success).toBe(false);
  });

  it("denies non-owners and cross-trip calls before database access", async () => {
    const f = fixture();
    await expect(getTripMemberRemovalPreview(f.pool, { ...session, role: "editor" }, tripId, targetId)).rejects.toBeInstanceOf(AppForbiddenError);
    await expect(getTripMemberRemovalPreview(f.pool, session, "another-trip", targetId)).rejects.toBeInstanceOf(AppForbiddenError);
    expect(f.pool.connect).not.toHaveBeenCalled();
  });

  it("revalidates live owner access and rolls back a stale session", async () => {
    mocks.authorize.mockRejectedValue(new AppForbiddenError("Role changed"));
    const f = fixture();
    await expect(getTripMemberRemovalPreview(f.pool, session, tripId, targetId)).rejects.toThrow("Role changed");
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), session, { owner: true });
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("returns exact visible financial impact but only counts for inaccessible private expenses", async () => {
    const f = fixture({ expenses: [expense, { ...expense, id: "private-id", description: "Never expose private venue", currency: "USD", amount_minor: "9999", can_view: false }] });
    const preview = await getTripMemberRemovalPreview(f.pool, session, tripId, targetId);
    expect(preview.blockedReason).toBe("financial_links");
    expect(preview.expenses).toEqual([{ id: expense.id, revision: 1, currency: "JPY", amountMinor: 101, shareMinor: 51, paidByTarget: true, description: "Synthetic expense",
      requiresPayerReplacement: true, requiresShareRecipient: true, eligibleMembers: expense.eligible_members }]);
    expect(preview.hiddenPrivateExpenseCount).toBe(1);
    expect(JSON.stringify(preview)).not.toContain("Never expose");
    expect(JSON.stringify(preview)).not.toContain("private-id");
    expect(JSON.stringify(preview)).not.toContain("9999");
  });

  it.each(["posted", "draft"])("refuses unresolved %s expense links without changing money or access", async (status) => {
    const f = fixture({ expenses: [{ ...expense, status }] });
    const input = await confirmation(f.pool);
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, input)).rejects.toThrow("No money was changed");
    expect(f.query.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE|INSERT)/u.test(sql))).toBe(false);
  });

  it("allows retained void financial history and never rewrites ledger amounts or attribution", async () => {
    const f = fixture({ expenses: [{ ...expense, status: "void" }] });
    const input = await confirmation(f.pool);
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, input)).resolves.toMatchObject({ removed: true });
    expect(f.query.mock.calls.some(([sql]) => /(?:UPDATE|DELETE FROM) (?:expenses|expense_splits|expense_revisions)/u.test(sql))).toBe(false);
  });

  it("finds only structured custom-share references, including nested linked expenses", () => {
    expect(proposalReferencesMember({ splitAmounts: [{ memberId: targetId, amountMinor: 0 }] }, targetId)).toBe(true);
    expect(proposalReferencesMember({ linkedExpense: { splitAmounts: [{ memberId: targetId, amountMinor: 21 }] } }, targetId)).toBe(true);
    for (const splitAmounts of [null, targetId, [targetId], [[{ memberId: targetId }]], [{ notes: targetId }], [{ memberId: actorId, notes: targetId }]]) {
      expect(proposalReferencesMember({ splitAmounts }, targetId)).toBe(false);
    }
  });

  it.each(["pending", "rejected"])("invalidates a %s custom-share-only update to retained void history", async (status) => {
    const patch = { splitAmounts: [{ memberId: actorId, amountMinor: 81 }, { memberId: targetId, amountMinor: 20 }] };
    const f = fixture({ expenses: [{ ...expense, status: "void" }], proposals: [{
      id: "custom-only", entity_type: "expense", entity_id: expense.id, proposal_revision: 1,
      status, requested_by_member_id: actorId, proposed_patch: patch,
    }] });
    const preview = await getTripMemberRemovalPreview(f.pool, session, tripId, targetId);
    expect(preview.counts.actionableProposals).toBe(1);
    expect(preview.counts.expenses).toBe(0);
    const result = await removeTripMemberSafely(f.pool, session, tripId, targetId, {
      confirmation: true, expectedRevision: preview.member.revision, previewDigest: preview.previewDigest,
    });
    expect(result.invalidatedProposalCount).toBe(1);
    expect(f.query.mock.calls.some(([sql, values]) => sql.includes("UPDATE change_requests SET invalidated_at") && values?.[1] === "custom-only")).toBe(true);
    expect(f.query.mock.calls.some(([sql]) => /(?:UPDATE|DELETE FROM) (?:expenses|expense_splits|expense_revisions)/u.test(sql))).toBe(false);
    expect(patch).toEqual({ splitAmounts: [{ memberId: actorId, amountMinor: 81 }, { memberId: targetId, amountMinor: 20 }] });
  });

  it("applies explicit payer/share choices exactly, preserving the total and non-recipient shares", async () => {
    const otherId = "20000000-0000-4000-8000-000000000003";
    const f = fixture({ expenses: [{ ...expense, amount_minor: "201", splits: [...expense.splits, { memberId: otherId, shareMinor: "100" }] }] });
    const input = await confirmation(f.pool);
    await removeTripMemberSafely(f.pool, session, tripId, targetId, { ...input, expenseReassignments: [
      { expenseId: expense.id, expectedRevision: 1, replacementPayerMemberId: actorId, shareRecipientMemberId: actorId },
    ] });
    const revision = f.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO expense_revisions"));
    expect(JSON.parse(String(revision?.[1]?.[4]))).toMatchObject({ amountMinor: 201, currency: "JPY", payerMemberId: actorId, currentRevision: 2,
      splits: [{ memberId: actorId, shareMinor: 101 }, { memberId: otherId, shareMinor: 100 }] });
    expect(f.query.mock.calls.some(([sql]) => sql.includes("SET amount_minor"))).toBe(false);
  });

  it.each([
    { expenseId: expense.id, expectedRevision: 1, replacementPayerMemberId: targetId, shareRecipientMemberId: actorId },
    { expenseId: expense.id, expectedRevision: 1, replacementPayerMemberId: actorId },
    { expenseId: expense.id, expectedRevision: 2, replacementPayerMemberId: actorId, shareRecipientMemberId: actorId },
  ])("rejects missing, stale or ineligible financial choices with no writes", async (plan) => {
    const f = fixture({ expenses: [expense] });
    const input = await confirmation(f.pool);
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, { ...input, expenseReassignments: [plan] })).rejects.toThrow("No money was changed");
    expect(f.query.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE|INSERT)/u.test(sql))).toBe(false);
  });

  it("cannot use reassignment choices to bypass a private expense audience", async () => {
    const f = fixture({ expenses: [{ ...expense, can_view: false }] });
    const input = await confirmation(f.pool);
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, { ...input, expenseReassignments: [
      { expenseId: expense.id, expectedRevision: 1, replacementPayerMemberId: actorId, shareRecipientMemberId: actorId },
    ] })).rejects.toThrow("No money was changed");
  });

  it("retains authorship and AI records while removing access and viewer participation", async () => {
    const f = fixture({ events: [event, { ...event, id: "created-only", is_viewer: false, created_by_member_id: targetId, viewer_member_ids: [] }] });
    const input = await confirmation(f.pool);
    f.query.mockClear();
    const result = await removeTripMemberSafely(f.pool, session, tripId, targetId, input);
    expect(result).toMatchObject({ removed: true, removedViewerLinkCount: 1 });
    const commands = f.query.mock.calls.map(([sql]) => sql);
    expect(commands.some((sql) => /DELETE FROM (?:trip_members|app_users|oidc_identities|ai_|preferences|itinerary_items|expenses)/u.test(sql))).toBe(false);
    expect(commands.some((sql) => /SET created_by_member_id/u.test(sql))).toBe(false);
    expect(commands.some((sql) => /SET status = 'removed'/u.test(sql))).toBe(true);
    expect(commands.findIndex((sql) => /SET status = 'removed'/u.test(sql))).toBeLessThan(commands.findIndex((sql) => /DELETE FROM itinerary_item_viewers/u.test(sql)));
    const revision = f.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO itinerary_revisions"));
    expect(JSON.parse(String(revision?.[1]?.[4]))).toMatchObject({ currentRevision: 3, createdByMemberId: actorId, visibility: "private", viewerMemberIds: [] });
    for (const table of ["calendar_connections", "calendar_event_links", "weather_refresh_leases"]) {
      expect(f.query).toHaveBeenCalledWith(`DELETE FROM ${table} WHERE trip_id = $1 AND member_id = $2`, [tripId, targetId]);
    }
    expect(commands.some((sql) => sql.includes("history_revoked_at = CURRENT_TIMESTAMP"))).toBe(true);
    expect(commands.some((sql) => sql.includes("error_code = 'AiRequestInterruptedError'"))).toBe(true);
    expect(f.query).toHaveBeenCalledWith("COMMIT");
    expect(f.release).toHaveBeenCalled();
  });

  it("invalidates dependent pending/rejected requests without overwriting their patch or status", async () => {
    const f = fixture({ proposals: [
      { id: "pending", proposal_revision: 1, status: "pending", requested_by_member_id: actorId, proposed_patch: { linkedExpense: { payerMemberId: targetId } } },
      { id: "rejected", proposal_revision: 2, status: "rejected", requested_by_member_id: targetId, proposed_patch: {} },
      { id: "unrelated", proposal_revision: 3, status: "pending", requested_by_member_id: actorId, proposed_patch: { notes: targetId } },
    ] });
    const input = await confirmation(f.pool);
    const result = await removeTripMemberSafely(f.pool, session, tripId, targetId, input);
    expect(result.invalidatedProposalCount).toBe(2);
    const updates = f.query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE change_requests"));
    expect(updates).toHaveLength(2);
    expect(updates.map(([, values]) => values?.[1])).toEqual(["pending", "rejected"]);
    expect(updates.every(([sql]) => !sql.includes("proposed_patch =") && !sql.includes("status ="))).toBe(true);
  });

  it("protects the last bound owner but permits another owner to be removed", async () => {
    const sole = fixture({ member: { ...member, role: "owner" }, owners: [] });
    const input = await confirmation(sole.pool);
    await expect(removeTripMemberSafely(sole.pool, session, tripId, targetId, input)).rejects.toThrow("at least one");
    const multiple = fixture({ member: { ...member, role: "owner" } });
    await expect(removeTripMemberSafely(multiple.pool, session, tripId, targetId, await confirmation(multiple.pool))).resolves.toMatchObject({ removed: true });
    expect(multiple.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE trips SET owner_user_id"))).toBe(true);
  });

  it("invalidates partial edits only when removal changes their canonical expense or viewer audience", async () => {
    const untouchedEvent = { ...event, id: "creator-only", is_viewer: false, created_by_member_id: targetId, viewer_member_ids: [] };
    const f = fixture({ events: [event, untouchedEvent], expenses: [expense, { ...expense, id: "void-history", status: "void" }], proposals: [
      { id: "partial-expense", proposal_revision: 1, status: "pending", requested_by_member_id: actorId, entity_type: "expense", entity_id: expense.id, proposed_patch: { description: "Corrected receipt" } },
      { id: "partial-event", proposal_revision: 1, status: "rejected", requested_by_member_id: actorId, entity_type: "itinerary_item", entity_id: event.id, proposed_patch: { title: "Corrected venue" } },
      { id: "retained-creator", proposal_revision: 1, status: "pending", requested_by_member_id: actorId, entity_type: "itinerary_item", entity_id: untouchedEvent.id, proposed_patch: { title: "Still valid" } },
      { id: "retained-void", proposal_revision: 1, status: "pending", requested_by_member_id: actorId, entity_type: "expense", entity_id: "void-history", proposed_patch: { description: "Retained history" } },
    ] });
    const input = await confirmation(f.pool);
    const result = await removeTripMemberSafely(f.pool, session, tripId, targetId, { ...input, expenseReassignments: [
      { expenseId: expense.id, expectedRevision: 1, replacementPayerMemberId: actorId, shareRecipientMemberId: actorId },
    ] });
    expect(result.invalidatedProposalCount).toBe(2);
    expect(f.query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE change_requests")).map(([, values]) => values?.[1]))
      .toEqual(["partial-expense", "partial-event"]);
  });

  it("rejects stale preview revisions and digests before access changes", async () => {
    const f = fixture();
    const input = await confirmation(f.pool);
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, { ...input, expectedRevision: 3 })).rejects.toThrow("changed");
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, { ...input, previewDigest: "0".repeat(64) })).rejects.toThrow("changed");
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE trip_members"))).toBe(false);
  });

  it("binds and revokes only previewed active reusable invitations issued by this member", async () => {
    const links = [{ id: "70000000-0000-4000-8000-000000000001" }];
    const f = fixture({ reusableInvites: links });
    const preview = await getTripMemberRemovalPreview(f.pool, session, tripId, targetId);
    expect(preview.counts.reusableInvites).toBe(1);
    const input = await confirmation(f.pool);
    await removeTripMemberSafely(f.pool, session, tripId, targetId, input);
    expect(f.query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE trip_join_links.*revoked_at = CURRENT_TIMESTAMP/su), [tripId, targetId, links.map((link) => link.id)]);
    const update = f.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE trip_join_links"));
    expect(update?.[0]).toContain("created_by_member_id = $2");
    expect(update?.[0]).toContain("exhausted_at IS NULL");
    links.push({ id: "70000000-0000-4000-8000-000000000002" });
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, input)).rejects.toThrow("changed");
  });

  it("rejects a changed Google binding under the shared trip mutation fence", async () => {
    const target = { ...member };
    const f = fixture({ member: target });
    const input = await confirmation(f.pool);
    target.user_id = "different-bound-user";
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, input)).rejects.toThrow("changed");
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), session, { owner: true });
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE trip_members"))).toBe(false);
  });

  it("reports a missing or already removed member without writes", async () => {
    const f = fixture({ member: null });
    await expect(getTripMemberRemovalPreview(f.pool, session, tripId, targetId)).rejects.toThrow("Member not found");
  });

  it("rolls back all removal changes when its audit cannot be recorded", async () => {
    const f = fixture({ failAudit: true });
    const input = await confirmation(f.pool);
    f.query.mockClear();
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, input)).rejects.toThrow("Synthetic audit failure");
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.query).not.toHaveBeenCalledWith("COMMIT");
  });
});

describe("repayment-safe member removal", () => {
  const plan = { paymentId: payment.id, expectedRevision: 1, replacementAccountingFromMemberId: actorId };
  it("previews posted accounting choices separately from original cash facts and unapproved invalidation", async () => {
    const f = fixture({ payments: [payment, { ...payment, id: "pending", status: "pending" }, { ...payment, id: "rejected", status: "rejected" }] });
    const preview = await getTripMemberRemovalPreview(f.pool, session, tripId, targetId);
    expect(preview).toMatchObject({ blockedReason: "financial_links", canRemove: false, canRemoveWithReassignment: true,
      counts: { payments: 1, pendingPayments: 2 }, payments: [{ id: payment.id, revision: 1, amountMinor: 101,
        fromMemberName: "Synthetic member", toMemberName: "Synthetic owner", requiresFromReplacement: true, requiresToReplacement: false }] });
    expect(f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT payment.*"))?.[0]).toContain("FOR UPDATE OF payment");
    expect(f.query.mock.calls.find(([sql]) => sql.includes('AS "displayName"'))?.[0]).toContain("FOR UPDATE");
  });
  it("requires explicit choices even if the only remaining member is the other payment participant", async () => {
    const f = fixture({ payments: [payment] });
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, await confirmation(f.pool))).rejects.toThrow("No money was changed");
    expect(f.query.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE|INSERT)/u.test(sql))).toBe(false);
  });
  it.each([
    { ...plan, expectedRevision: 2 }, { ...plan, replacementAccountingFromMemberId: targetId },
    { ...plan, replacementAccountingFromMemberId: "20000000-0000-4000-8000-000000000099" },
    { ...plan, replacementAccountingToMemberId: actorId },
  ])("rejects stale, missing, ineligible or irrelevant payment choices before expense writes", async (choice) => {
    const f = fixture({ payments: [payment], expenses: [expense] });
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, { ...await confirmation(f.pool), paymentReassignments: [choice],
      expenseReassignments: [{ expenseId: expense.id, expectedRevision: 1, replacementPayerMemberId: actorId, shareRecipientMemberId: actorId }] })).rejects.toThrow("No money was changed");
    expect(f.query.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE|INSERT)/u.test(sql))).toBe(false);
  });
  it("preserves immutable payment facts while allowing neutral same-person accounting with revision and audit", async () => {
    const f = fixture({ payments: [payment] });
    await removeTripMemberSafely(f.pool, session, tripId, targetId, { ...await confirmation(f.pool), paymentReassignments: [plan] });
    const revision = f.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO member_payment_revisions"));
    expect(JSON.parse(String(revision?.[1]?.[5]))).toMatchObject({ fromMemberId: targetId, toMemberId: actorId,
      accountingFromMemberId: actorId, accountingToMemberId: actorId, amountMinor: 101, currency: "JPY", status: "posted", currentRevision: 2,
      createdByMemberId: actorId, createdByUserId: session.userId, note: "External cash" });
    expect(revision?.[1]?.[6]).toBe("member_reassigned");
    const audit = f.query.mock.calls.find(([sql, values]) => sql.includes("INSERT INTO audit_events") && values?.includes("member_payment"));
    expect(JSON.stringify(audit)).toContain("originalPaymentRetained");
    expect(f.query.mock.calls.some(([sql]) => /SET (?:amount_minor|from_member_id|to_member_id|created_by_member_id)/u.test(sql))).toBe(false);
  });
  it.each(["pending", "rejected"])("permanently voids %s payments without turning them into reassigned cash", async (status) => {
    const f = fixture({ payments: [{ ...payment, status }] });
    await removeTripMemberSafely(f.pool, session, tripId, targetId, await confirmation(f.pool));
    const revision = f.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO member_payment_revisions"));
    expect(JSON.parse(String(revision?.[1]?.[5]))).toMatchObject({ status: "void", currentRevision: 2,
      fromMemberId: targetId, toMemberId: actorId, accountingFromMemberId: targetId, amountMinor: 101 });
    expect(revision?.[1]?.[6]).toBe("void");
  });
  it("includes changed payment revisions and active candidate eligibility in the preview digest", async () => {
    const payments = [{ ...payment }];
    const candidates = [{ id: actorId, displayName: "Owner" }];
    const f = fixture({ payments, paymentCandidates: candidates });
    const input = { ...await confirmation(f.pool), paymentReassignments: [plan] };
    payments[0].current_revision++;
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, input)).rejects.toThrow("changed");
    payments[0].current_revision--;
    candidates.splice(0);
    await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, input)).rejects.toThrow("changed");
  });
  it("rejects duplicate or stale extra payment rows and leaves all writes untouched", async () => {
    const f = fixture({ payments: [payment] });
    for (const paymentReassignments of [[plan, plan], [{ ...plan, paymentId: "51000000-0000-4000-8000-000000000099" }]]) {
      await expect(removeTripMemberSafely(f.pool, session, tripId, targetId, { ...await confirmation(f.pool), paymentReassignments })).rejects.toThrow("No money was changed");
    }
    expect(f.query.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE|INSERT)/u.test(sql))).toBe(false);
  });
});

describe("proposal member-reference inventory", () => {
  it.each([
    { payerMemberId: targetId }, { splitMemberIds: [targetId] }, { viewerMemberIds: [targetId] },
    { linkedExpense: { splitMemberIds: [targetId] } }, { itineraryAudienceSnapshot: { createdByMemberId: targetId } },
  ])("finds structured membership links", (patch) => expect(proposalReferencesMember(patch, targetId)).toBe(true));
  it("does not treat prose, prices or arbitrary keys as member references", () => {
    expect(proposalReferencesMember({ notes: targetId, arbitrary: { payerMemberId: targetId } }, targetId)).toBe(false);
    expect(proposalReferencesMember(null, targetId)).toBe(false);
  });
});
