import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppConflictError, AppForbiddenError } from "@/lib/app/repository";

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/app/trip-authorization", () => ({ lockCurrentTripActor: mocks.authorize }));
import { createMemberPayment, loadMemberPayments, memberPaymentActionSchema, memberPaymentCapabilities,
  memberPaymentCreateSchema, memberPaymentSnapshot, updateMemberPayment,
  type MemberPaymentActor, type MemberPaymentCreateInput, type MemberPaymentRow } from "./member-payments";

const tripId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";
const recipientId = "20000000-0000-4000-8000-000000000002";
const otherId = "20000000-0000-4000-8000-000000000003";
const paymentId = "40000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";
const clientRequestId = "50000000-0000-4000-8000-000000000001";
const session = { tripId, memberId, userId, role: "editor" } as AuthenticatedSession;
const actor: MemberPaymentActor = { tripId, memberId, isOwner: false, canEditExpenses: true, expenseRequiresApproval: false };
const input: MemberPaymentCreateInput = { fromMemberId: memberId, toMemberId: recipientId,
  currency: "JPY", amountMinor: 101, occurredAt: "2020-04-01T12:34:56.123Z", clientRequestId, confirmation: true };
const row: MemberPaymentRow = { trip_id: tripId, id: paymentId, from_member_id: memberId, to_member_id: recipientId,
  accounting_from_member_id: memberId, accounting_to_member_id: recipientId, currency: "JPY", amount_minor: "101",
  occurred_at: input.occurredAt, note: null, status: "posted", current_revision: 1,
  created_by_member_id: memberId, created_by_user_id: userId, created_at: "2020-04-01T12:40:00Z", updated_at: "2020-04-01T12:40:00Z",
  from_member_name: "Synthetic sender", to_member_name: "Synthetic recipient", accounting_from_member_name: "Synthetic sender",
  accounting_to_member_name: "Synthetic recipient" };

function fixture(options: { role?: string; canEdit?: boolean; requiresApproval?: boolean; row?: MemberPaymentRow | null;
  eligible?: string[]; replayHash?: string; failAudit?: boolean; updateRace?: boolean; committedMinor?: string } = {}) {
  let current = options.row === undefined ? { ...row } : options.row;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    const text = sql.replace(/\s+/gu, " ").trim();
    const data = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    if (text.startsWith("SELECT tm.role")) return data([{ role: options.role ?? "editor", can_edit_expenses: options.canEdit ?? true,
      expense_requires_approval: options.requiresApproval ?? false }]);
    if (text.startsWith("SELECT payment_id, request_hash")) return data(options.replayHash
      ? [{ payment_id: paymentId, request_hash: options.replayHash }] : []);
    if (text.endsWith("AS committed_minor")) return data([{ committed_minor: options.committedMinor ?? "0" }]);
    if (text.startsWith("SELECT payment.*")) return data(current ? [current] : []);
    if (text.startsWith("SELECT id FROM trip_members")) return data((options.eligible ?? values?.[1] as string[]).map((id) => ({ id })));
    if (text.startsWith("INSERT INTO member_payments ")) {
      current = { ...row, id: String(values?.[1]), from_member_id: String(values?.[2]), to_member_id: String(values?.[3]),
        accounting_from_member_id: String(values?.[2]), accounting_to_member_id: String(values?.[3]),
        currency: String(values?.[4]), amount_minor: Number(values?.[5]), occurred_at: String(values?.[6]),
        note: values?.[7] as string | null, status: values?.[8] as MemberPaymentRow["status"] };
      return data([current]);
    }
    if (text.startsWith("UPDATE member_payments ")) {
      if (options.updateRace || !current) return data([]);
      current = { ...current, status: values?.[3] as MemberPaymentRow["status"], current_revision: current.current_revision + 1 };
      return data([current]);
    }
    if (text.startsWith("INSERT INTO audit_events") && options.failAudit) throw new Error("Synthetic audit failure");
    return data([]);
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { query, pool, client, release };
}
function mutationCalls(f: ReturnType<typeof fixture>) {
  return f.query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/u.test(sql));
}
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue(undefined); });

describe("member repayment validation and snapshots", () => {
  it("retains exact minor units, subminute actual time and immutable original identity", () => {
    expect(memberPaymentCreateSchema.parse(input)).toEqual(input);
    expect(memberPaymentSnapshot({ ...row, accounting_from_member_id: otherId, accounting_to_member_id: otherId })).toEqual({
      id: paymentId, fromMemberId: memberId, toMemberId: recipientId, accountingFromMemberId: otherId,
      accountingToMemberId: otherId, currency: "JPY", amountMinor: 101, occurredAt: input.occurredAt,
      note: null, status: "posted", currentRevision: 1, createdByMemberId: memberId, createdByUserId: userId,
    });
  });
  it.each([{ amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 0.5 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { amountMinor: Infinity }, { currency: "jpy" }, { currency: "US" }, { occurredAt: "tomorrow" },
    { occurredAt: "2026-02-30T12:00:00Z" }, { occurredAt: "2026-09-09T10:00" }, { confirmation: false },
    { confirmation: undefined }, { toMemberId: memberId }, { clientRequestId: "invalid" }, { note: "x".repeat(1001) },
    { status: "posted" }, { accountingFromMemberId: otherId }])("rejects invalid/expanded create %j", (patch) => {
    expect(memberPaymentCreateSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it.each([{ expectedRevision: 0 }, { expectedRevision: 1.5 }, { confirmation: false }, { reason: "x".repeat(501) },
    { action: "delete" }, { amountMinor: 22 }])("rejects malformed or financial-rewriting actions %j", (patch) => {
    expect(memberPaymentActionSchema.safeParse({ action: "void", expectedRevision: 1, confirmation: true, clientRequestId, ...patch }).success).toBe(false);
  });
  it("rejects unsafe numeric records rather than rounding financial history", () => {
    expect(() => memberPaymentSnapshot({ ...row, amount_minor: "9007199254740992" })).toThrow("numeric range");
  });
  it("normalizes UUID case before self-payment and stable-key comparisons", () => {
    const id = "abcdefab-0000-4000-8000-000000000001";
    expect(memberPaymentCreateSchema.safeParse({ ...input, fromMemberId: id, toMemberId: id.toUpperCase() }).success).toBe(false);
    expect(memberPaymentCreateSchema.parse({ ...input, fromMemberId: id.toUpperCase() }).fromMemberId).toBe(id);
  });
});

describe("member payment authorization and transitions", () => {
  it.each(["pending", "rejected"] as const)("creator can withdraw %s even after losing edit permission", (status) => {
    expect(memberPaymentCapabilities({ ...row, status }, { ...actor, canEditExpenses: false, expenseRequiresApproval: true }))
      .toEqual({ canVoid: true, canReview: false });
  });
  it.each([
    [{ ...actor }, true], [{ ...actor, canEditExpenses: false }, false], [{ ...actor, expenseRequiresApproval: true }, false],
    [{ ...actor, memberId: recipientId }, false], [{ ...actor, memberId: otherId }, false],
    [{ ...actor, memberId: otherId, isOwner: true, canEditExpenses: false }, true],
  ] as const)("restricts posted corrections to owner or authorized original creator", (viewer, expected) => {
    expect(memberPaymentCapabilities(row, viewer).canVoid).toBe(expected);
  });
  it("void is terminal even for owners", () => {
    expect(memberPaymentCapabilities({ ...row, status: "void" }, { ...actor, isOwner: true }))
      .toEqual({ canVoid: false, canReview: false });
  });
  it("rejects cross-trip and stale live membership before money writes", async () => {
    const f = fixture();
    await expect(createMemberPayment(f.pool, session, otherId, input)).rejects.toBeInstanceOf(AppForbiddenError);
    expect(f.pool.connect).not.toHaveBeenCalled();
    mocks.authorize.mockRejectedValueOnce(new AppForbiddenError("Role changed"));
    await expect(createMemberPayment(f.pool, session, tripId, input)).rejects.toThrow("Role changed");
    expect(mutationCalls(f)).toHaveLength(0);
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
  });
  it.each([{ canEdit: false }, { role: "viewer" }, { input: { ...input, fromMemberId: otherId } }])(
    "refuses recording another person's money or missing expense permission", async (options) => {
      const f = fixture(options);
      await expect(createMemberPayment(f.pool, session, tripId, options.input ?? input)).rejects.toBeInstanceOf(AppForbiddenError);
      expect(mutationCalls(f)).toHaveLength(0);
    });
  it.each([{ eligible: [] }, { eligible: [memberId] }])("requires every counterparty be an enabled current trip member", async ({ eligible }) => {
    const f = fixture({ eligible });
    await expect(createMemberPayment(f.pool, session, tripId, input)).rejects.toThrow("current, enabled");
    expect(mutationCalls(f)).toHaveLength(0);
  });
  it("rejects future planned transfers but permits actual times outside trip dates", async () => {
    const f = fixture();
    await expect(createMemberPayment(f.pool, session, tripId, { ...input, occurredAt: new Date(Date.now() + 6 * 60_000).toISOString() }))
      .rejects.toThrow("already have happened");
    expect(mutationCalls(f)).toHaveLength(0);
    const result = await createMemberPayment(f.pool, session, tripId, input);
    expect(result.occurredAt).toBe(input.occurredAt);
  });
  it.each([false, true])("records one atomic version, audit and stable-key receipt with approval policy %s", async (requiresApproval) => {
    const f = fixture({ requiresApproval });
    const result = await createMemberPayment(f.pool, session, tripId, input);
    expect(result).toMatchObject({ amountMinor: 101, status: requiresApproval ? "pending" : "posted", revision: 1 });
    expect(mocks.authorize).toHaveBeenCalledWith(f.client, session);
    const calls = mutationCalls(f).map(([sql]) => sql);
    expect(calls).toHaveLength(4);
    for (const table of ["member_payments", "member_payment_revisions", "member_payment_actions", "audit_events"]) {
      expect(calls.some((sql) => sql.includes(`INSERT INTO ${table}`))).toBe(true);
    }
    expect(calls.join(" ")).not.toMatch(/INSERT INTO expenses|UPDATE expenses|expense_splits/u);
    expect(f.query).toHaveBeenCalledWith("COMMIT");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("owner can explicitly record for another sender without inheriting member approval defaults", async () => {
    const f = fixture({ role: "owner", requiresApproval: true, canEdit: false });
    const result = await createMemberPayment(f.pool, { ...session, role: "owner" }, tripId, { ...input, fromMemberId: otherId });
    expect(result).toMatchObject({ status: "posted", fromMemberId: otherId, createdByMemberId: memberId });
  });
  it("rolls back the entire money mutation when audit storage fails", async () => {
    const f = fixture({ failAudit: true });
    await expect(createMemberPayment(f.pool, session, tripId, input)).rejects.toThrow("Synthetic audit failure");
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.query).not.toHaveBeenCalledWith("COMMIT");
  });
  it.each([String(Number.MAX_SAFE_INTEGER), "99999999999999999999999999"])("rejects aggregate overflow %s before payment or history writes", async (committedMinor) => {
    const f = fixture({ committedMinor });
    await expect(createMemberPayment(f.pool, session, tripId, { ...input, amountMinor: 1 })).rejects.toThrow("supported financial range");
    expect(mutationCalls(f)).toHaveLength(0);
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("sum(amount_minor)"), [tripId, "JPY"]);
    const aggregateSql = f.query.mock.calls.find(([sql]) => sql.includes("AS committed_minor"))?.[0] ?? "";
    expect(aggregateSql).toContain("FROM expenses");
    expect(aggregateSql).toContain("FROM member_payments");
    expect(aggregateSql).not.toContain("app_member_can_view");
  });
  it("allows an exact safe boundary including posted expenses, with integer rather than floating arithmetic", async () => {
    const f = fixture({ committedMinor: String(Number.MAX_SAFE_INTEGER - 101) });
    await expect(createMemberPayment(f.pool, session, tripId, input)).resolves.toMatchObject({ status: "posted" });
  });
  it("allows pending entry without reserving money, but rejects unsafe approval without rewriting its history", async () => {
    const pending = fixture({ requiresApproval: true, committedMinor: String(Number.MAX_SAFE_INTEGER) });
    await expect(createMemberPayment(pending.pool, session, tripId, input)).resolves.toMatchObject({ status: "pending" });
    expect(pending.query.mock.calls.some(([sql]) => sql.includes("AS committed_minor"))).toBe(false);
    const approval = fixture({ role: "owner", row: { ...row, status: "pending" }, committedMinor: String(Number.MAX_SAFE_INTEGER) });
    await expect(updateMemberPayment(approval.pool, { ...session, role: "owner" }, tripId, paymentId,
      { action: "approve", expectedRevision: 1, confirmation: true, clientRequestId })).rejects.toThrow("supported financial range");
    expect(mutationCalls(approval)).toHaveLength(0);
  });
  it("does not block voiding an existing record when the surrounding ledger exceeds the display range", async () => {
    const f = fixture({ committedMinor: String(Number.MAX_SAFE_INTEGER) });
    await expect(updateMemberPayment(f.pool, session, tripId, paymentId,
      { action: "void", expectedRevision: 1, confirmation: true, clientRequestId })).resolves.toMatchObject({ status: "void" });
    expect(f.query.mock.calls.some(([sql]) => sql.includes("AS committed_minor"))).toBe(false);
  });
  it.each(["pending", "rejected"] as const)("owner can approve %s using exact current revision", async (status) => {
    const f = fixture({ role: "owner", row: { ...row, status } });
    const result = await updateMemberPayment(f.pool, { ...session, role: "owner" }, tripId, paymentId,
      { action: "approve", expectedRevision: 1, confirmation: true, clientRequestId });
    expect(result).toMatchObject({ status: "posted", revision: 2, canReview: false });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("current_revision = $3"), [tripId, paymentId, 1, "posted"]);
  });
  it.each(["approve", "reject"] as const)("nonowner cannot %s their own payment", async (action) => {
    const f = fixture({ row: { ...row, status: "pending" } });
    await expect(updateMemberPayment(f.pool, session, tripId, paymentId,
      { action, expectedRevision: 1, confirmation: true, clientRequestId })).rejects.toThrow("Only a trip owner");
    expect(mutationCalls(f)).toHaveLength(0);
  });
  it.each(["posted", "rejected", "void"] as const)("reject action cannot reject %s history", async (status) => {
    const f = fixture({ role: "owner", row: { ...row, status } });
    await expect(updateMemberPayment(f.pool, { ...session, role: "owner" }, tripId, paymentId,
      { action: "reject", expectedRevision: 1, confirmation: true, clientRequestId })).rejects.toBeInstanceOf(AppConflictError);
    expect(mutationCalls(f)).toHaveLength(0);
  });
  it("cannot approve a stale proposal involving a removed/disabled participant", async () => {
    const f = fixture({ role: "owner", row: { ...row, status: "pending" }, eligible: [memberId] });
    await expect(updateMemberPayment(f.pool, { ...session, role: "owner" }, tripId, paymentId,
      { action: "approve", expectedRevision: 1, confirmation: true, clientRequestId })).rejects.toThrow("current, enabled");
    expect(mutationCalls(f)).toHaveLength(0);
  });
  it.each([{ row: { ...row, current_revision: 2 } }, { updateRace: true }])("rejects stale revision or lost optimistic update", async (options) => {
    const f = fixture(options);
    await expect(updateMemberPayment(f.pool, session, tripId, paymentId,
      { action: "void", expectedRevision: 1, confirmation: true, clientRequestId })).rejects.toBeInstanceOf(AppConflictError);
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO member_payment_revisions"))).toBe(false);
  });
  it("does not expose another member's nonexistent/unauthorized payment", async () => {
    const f = fixture({ row: null });
    await expect(updateMemberPayment(f.pool, session, tripId, paymentId,
      { action: "void", expectedRevision: 1, confirmation: true, clientRequestId })).rejects.toThrow("Payment not found");
  });
});

describe("payload-bound repayment retry receipts and private projection", () => {
  const createHashValue = () => createHash("sha256").update(JSON.stringify({ action: "create", fromMemberId: memberId,
    toMemberId: recipientId, currency: "JPY", amountMinor: 101, occurredAt: input.occurredAt, note: null })).digest("hex");
  it("returns current void truth on uncertain create retry without checking obsolete participants or writing again", async () => {
    const f = fixture({ row: { ...row, status: "void", current_revision: 3 }, replayHash: createHashValue(), eligible: [], canEdit: false });
    expect(await createMemberPayment(f.pool, session, tripId, input)).toMatchObject({ status: "void", revision: 3 });
    expect(mutationCalls(f)).toHaveLength(0);
    expect(f.query.mock.calls.some(([sql]) => sql.includes("SELECT id FROM trip_members"))).toBe(false);
    expect(f.query.mock.calls.some(([sql]) => sql.includes("AS committed_minor"))).toBe(false);
  });
  it("binds retries to original payload, not just a client UUID", async () => {
    const f = fixture({ replayHash: createHashValue() });
    await expect(createMemberPayment(f.pool, session, tripId, { ...input, amountMinor: 102 })).rejects.toThrow("different values");
    expect(mutationCalls(f)).toHaveLength(0);
  });
  it("does not rerun an approved/rejected/void action with stale expected revision on identical retry", async () => {
    const action = { action: "void" as const, expectedRevision: 1, confirmation: true as const, clientRequestId, reason: "Duplicate entry" };
    const requestHash = createHash("sha256").update(JSON.stringify({ action: "void", paymentId, expectedRevision: 1, reason: action.reason })).digest("hex");
    const f = fixture({ row: { ...row, status: "void", current_revision: 2 }, replayHash: requestHash });
    expect(await updateMemberPayment(f.pool, session, tripId, paymentId, action)).toMatchObject({ status: "void", revision: 2 });
    expect(mutationCalls(f)).toHaveLength(0);
  });
  it("projects all authorized financial history including original tombstone names, without expense joins or arbitrary caps", async () => {
    const f = fixture({ row: { ...row, from_member_name: "Synthetic removed sender", accounting_from_member_id: otherId,
      accounting_from_member_name: "Synthetic replacement" } });
    const result = await loadMemberPayments(f.client, actor);
    expect(result[0]).toMatchObject({ fromMemberId: memberId, fromMemberName: "Synthetic removed sender",
      accountingFromMemberId: otherId, accountingFromMemberName: "Synthetic replacement" });
    const sql = f.query.mock.calls[0][0];
    expect(sql).toContain("payment.trip_id = $1");
    expect(sql).toContain("viewer.status = 'active'");
    expect(sql).toContain("viewer.role = 'owner'");
    expect(sql).toContain("payment.created_by_member_id");
    expect(sql).toContain("payment.accounting_to_member_id");
    expect(sql).not.toMatch(/expenses|expense_splits|LIMIT|sender\.status/u);
  });
});
