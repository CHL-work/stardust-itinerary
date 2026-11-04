import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppOverview } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { buildExpenseSummary, type ExpenseSummaryOverview } from "@/lib/domain/expense-summary";

const paymentRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/app/member-payments", () => ({ loadMemberPayments: paymentRead }));
const id = (n: number) => `b0280000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2030-04-01T04:00:00Z");
const session: AuthenticatedSession = { tripId: id(1), memberId: id(2), userId: id(3), sessionId: id(4),
  role: "editor", displayName: "Synthetic member", expiresAt: at, absoluteExpiresAt: at,
  issuer: "synthetic", subject: "synthetic", generation: 1 };
const payment = (status = "posted") => ({
  id: id(5), fromMemberId: id(6), toMemberId: id(2), accountingFromMemberId: id(6), accountingToMemberId: id(2),
  fromMemberName: "Synthetic other", toMemberName: "Synthetic member", accountingFromMemberName: "Synthetic other",
  accountingToMemberName: "Synthetic member", currency: "JPY", amountMinor: 200, occurredAt: at.toISOString(),
  note: "Synthetic repayment", status, revision: 1, createdByMemberId: id(6), createdAt: at.toISOString(),
  canVoid: false, canReview: false,
});

async function overview(available = true, role: "owner" | "editor" = "editor") {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const client = { release: vi.fn(), query: vi.fn(async (statement: unknown, values: unknown[] = []) => {
    const sql = String(statement); statements.push({ sql, values });
    let rows: Array<Record<string, unknown>> = [];
    if (sql.includes("AS weather_available")) rows = [{ weather_available: false, disruptions_available: false,
      disruption_localizations_available: false, member_payments_available: available }];
    else if (sql.includes("FROM trips WHERE id = $1")) rows = [{ id: id(1), name: "Synthetic trip", destination_name: "Synthetic city",
      time_zone: "Asia/Tokyo", default_locale: "en", default_currency: "JPY", starts_on: "2030-04-01", ends_on: "2030-04-02" }];
    else if (sql.includes("SELECT tm.role, mp.can_edit_itinerary")) rows = [{ role, can_edit_expenses: true, expense_requires_approval: true }];
    else if (sql.includes("SELECT tm.id, tm.display_name, tm.role")) rows = [
      { id: id(2), display_name: "Synthetic member", role, status: "active", current_revision: 1, identity_bound: true },
      { id: id(6), display_name: "Synthetic other", role: "editor", status: "active", current_revision: 1, identity_bound: true },
    ];
    else if (sql.includes("SELECT e.id, e.description")) rows = [{ id: id(7), description: "Synthetic shared bill", amount_minor: "1000",
      currency: "JPY", status: "posted", occurred_at: at, current_revision: 1, payer_member_id: id(2), payer_name: "Synthetic member" }];
    else if (sql.includes("SELECT es.expense_id")) rows = [
      { expense_id: id(7), member_id: id(2), member_name: "Synthetic member", share_minor: "500" },
      { expense_id: id(7), member_id: id(6), member_name: "Synthetic other", share_minor: "500" },
    ];
    return { rows, rowCount: rows.length };
  }) };
  const result = await getAppOverview({ connect: async () => client } as unknown as Pool, { ...session, role });
  return { result, statements, client };
}

describe("repayment overview and summary integration", () => {
  beforeEach(() => paymentRead.mockReset());
  it("passes current membership/expense policy into the authorized reader within the overview snapshot", async () => {
    paymentRead.mockResolvedValue([payment()]);
    const { result, statements, client } = await overview();
    expect(paymentRead).toHaveBeenCalledWith(client, { tripId: id(1), memberId: id(2), isOwner: false,
      canEditExpenses: true, expenseRequiresApproval: true });
    expect(result.memberPayments).toEqual([payment()]);
    expect(statements[0]?.sql).toContain("REPEATABLE READ READ ONLY");
    expect(statements.at(-1)?.sql).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });
  it("keeps server suggestions and the leading UI balance consistent while not increasing expenses", async () => {
    paymentRead.mockResolvedValue([payment()]);
    const { result } = await overview();
    expect(result.expenseLedger).toMatchObject({ balances: [
      { memberId: id(2), paidMinor: 1000, shareMinor: 500, netMinor: 300 },
      { memberId: id(6), paidMinor: 0, shareMinor: 500, netMinor: -300 },
    ], settlements: [{ currency: "JPY", fromMemberId: id(6), toMemberId: id(2), amountMinor: 300 }] });
    const summary = buildExpenseSummary(result as unknown as ExpenseSummaryOverview);
    expect(summary.personal[0]).toMatchObject({ paidMinor: 1000, shareMinor: 500, netMinor: 300 });
    expect((result.expenses as unknown[])).toHaveLength(1);
  });
  it.each(["pending", "rejected", "void"])("retains %s history without altering financial totals", async (status) => {
    paymentRead.mockResolvedValue([payment(status)]);
    const { result } = await overview();
    expect((result.memberPayments as unknown[])).toHaveLength(1);
    expect(buildExpenseSummary(result as unknown as ExpenseSummaryOverview).personal[0]?.netMinor).toBe(500);
    expect(result.approvalPendingCount).toBe(0);
  });
  it("counts payment review alongside normal approvals only for owners", async () => {
    paymentRead.mockResolvedValue([payment("pending"), payment("rejected")]);
    const { result } = await overview(true, "owner");
    expect(result.approvalPendingCount).toBe(1);
  });
  it("keeps the overview readable during additive upgrade without querying a nonexistent ledger", async () => {
    const { result } = await overview(false);
    expect(paymentRead).not.toHaveBeenCalled();
    expect(result.memberPayments).toEqual([]);
    expect(buildExpenseSummary(result as unknown as ExpenseSummaryOverview).personal[0]?.netMinor).toBe(500);
  });
  it("does not invent hidden payments and rolls back if financial reads fail", async () => {
    paymentRead.mockResolvedValue([]);
    expect((await overview()).result.memberPayments).toEqual([]);
    paymentRead.mockRejectedValueOnce(new Error("Synthetic financial read failed"));
    await expect(overview()).rejects.toThrow("Synthetic financial read failed");
  });
});
