import { describe, expect, expectTypeOf, it } from "vitest";
import { compareExpenseDayEntries, groupExpenseDays } from "./expense-day-groups";

const expense = (id: string, occurredAt = "2030-04-01T03:00:00Z", extra = {}) => ({
  id, occurredAt, status: "posted", currency: "JPY", currentMemberShareMinor: 700, amountMinor: 1400,
  description: "Synthetic lunch", ...extra,
});
const pending = (requestId: string, occurredAt = "2030-04-01T04:00:00Z") => ({
  requestId, occurredAt, status: "pending", currency: "JPY", currentMemberShareMinor: 2000,
});
const payment = (id: string, occurredAt = "2030-04-01T05:00:00Z", extra = {}) => ({
  id, occurredAt, status: "posted", currency: "JPY", amountMinor: 10000,
  fromMemberId: "sender", toMemberId: "recipient", accountingFromMemberId: "assignee",
  accountingToMemberId: "recipient", createdAt: "2030-04-03T00:00:00Z", canReview: false, canVoid: true,
  ...extra,
});
const defaults = { days: [{ date: "2030-04-01", label: "Synthetic first day" }],
  expenses: [] as ReturnType<typeof expense>[], pendingExpenses: [] as ReturnType<typeof pending>[],
  memberPayments: [] as ReturnType<typeof payment>[], timeZone: "Asia/Tokyo" };

describe("authorized expense and repayment date groups", () => {
  it("retains supplied empty trip days and sorts the union with payment-only out-of-trip dates", () => {
    const early = payment("before", "2030-03-30T23:00:00Z");
    const late = payment("after", "2030-04-05T00:00:00Z");
    const groups = groupExpenseDays({ ...defaults,
      days: [{ date: "2030-04-02", label: null }, ...defaults.days], memberPayments: [late, early] });
    expect(groups.map((group) => [group.date, group.label])).toEqual([
      ["2030-03-31", null], ["2030-04-01", "Synthetic first day"], ["2030-04-02", null], ["2030-04-05", null],
    ]);
    expect(groups[0]?.payments).toEqual([early]); expect(groups[3]?.payments).toEqual([late]);
    expect(groups[1]).toMatchObject({ expenses: [], pendingExpenses: [], payments: [], totals: [] });
  });
  it("groups actual payment time across Tokyo midnight, not creation time or UTC calendar date", () => {
    const before = payment("before", "2030-04-01T14:59:59.999Z");
    const midnight = payment("midnight", "2030-04-01T15:00:00Z");
    const groups = groupExpenseDays({ ...defaults, memberPayments: [before, midnight] });
    expect(groups.map((group) => [group.date, group.payments.map((row) => row.id)]))
      .toEqual([["2030-04-01", ["before"]], ["2030-04-02", ["midnight"]]]);
    expect(groups.map((group) => group.date)).not.toContain("2030-04-03");
  });
  it.each([
    ["2030-03-10T04:59:59Z", "2030-03-09"], ["2030-03-10T05:00:00Z", "2030-03-10"],
    ["2030-03-10T06:30:00Z", "2030-03-10"], ["2030-03-10T07:30:00Z", "2030-03-10"],
    ["2030-11-03T05:30:00Z", "2030-11-03"], ["2030-11-03T06:30:00Z", "2030-11-03"],
  ])("uses the trip's DST rules for %s", (occurredAt, date) => {
    expect(groupExpenseDays({ ...defaults, days: [], timeZone: "America/New_York", memberPayments: [payment("dst", occurredAt)] })[0]?.date).toBe(date);
  });
  it("adds outside-trip dates from canonical and pending expenses as before", () => {
    const groups = groupExpenseDays({ ...defaults, expenses: [expense("early", "2030-03-01T00:00:00Z")],
      pendingExpenses: [pending("late", "2030-05-01T00:00:00Z")] });
    expect(groups.map((group) => group.date)).toEqual(["2030-03-01", "2030-04-01", "2030-05-01"]);
    expect(groups[0]?.expenses[0]?.id).toBe("early"); expect(groups[2]?.pendingExpenses[0]?.requestId).toBe("late");
  });
  it("retains all repayment states, original accounting facts and server-projected permissions without filtering", () => {
    const rows = ["posted", "pending", "rejected", "void"].map((status) => payment(status, undefined, { status }));
    const group = groupExpenseDays({ ...defaults, memberPayments: rows })[0]!;
    expect(group.payments).toEqual(rows); expect(group.payments).not.toBe(rows);
    rows.forEach((row, index) => expect(group.payments[index]).toBe(row));
    expect(group.expenses).toEqual([]); expect(group.pendingExpenses).toEqual([]); expect(group.totals).toEqual([]);
  });
  it("counts only posted personal expense shares, never repayment money, pending shares or bill totals", () => {
    const data = { ...defaults, expenses: [expense("posted"), expense("also-posted", undefined, { currentMemberShareMinor: 300 }),
      expense("draft", undefined, { status: "draft" }), expense("void", undefined, { status: "void" }),
      expense("zero", undefined, { currentMemberShareMinor: 0 }), expense("negative", undefined, { currentMemberShareMinor: -20 }),
      expense("usd", undefined, { currency: "USD", currentMemberShareMinor: 101 }),
      expense("hkd", undefined, { currency: "HKD", currentMemberShareMinor: 234 })], pendingExpenses: [pending("pending")],
      memberPayments: [payment("paid"), payment("currency-only", undefined, { currency: "EUR", amountMinor: 999999 })] };
    const group = groupExpenseDays(data)[0]!;
    expect(group.totals).toEqual([["HKD", 234], ["JPY", 1000], ["USD", 101]]);
    expect(group.expenses).toHaveLength(8); expect(group.pendingExpenses).toHaveLength(1); expect(group.payments).toHaveLength(2);
    expect(groupExpenseDays({ ...data, memberPayments: [] })[0]?.totals).toEqual(group.totals);
  });
  it("keeps optional old-schema payment projection and entirely empty inputs compatible", () => {
    const withoutPayments = { ...defaults, memberPayments: undefined };
    expect(groupExpenseDays(withoutPayments)[0]?.payments).toEqual([]);
    expect(groupExpenseDays({ days: [], expenses: [], pendingExpenses: [], timeZone: "Asia/Tokyo" })).toEqual([]);
  });
  it("does not mutate or reorder inputs and preserves each complete generic row type and reference", () => {
    const expenses = Object.freeze([Object.freeze(expense("late", "2030-04-01T10:00:00Z")), Object.freeze(expense("early"))]);
    const pendingExpenses = Object.freeze([Object.freeze(pending("pending"))]);
    const memberPayments = Object.freeze([Object.freeze(payment("second", "2030-04-01T09:00:00Z")), Object.freeze(payment("first"))]);
    const days = Object.freeze(defaults.days.map((day) => Object.freeze(day)));
    const input = Object.freeze({ ...defaults, days, expenses, pendingExpenses, memberPayments });
    const original = JSON.stringify(input);
    const group = groupExpenseDays(input)[0]!;
    expectTypeOf(group.expenses[0]!).toEqualTypeOf<(typeof expenses)[number]>();
    expectTypeOf(group.pendingExpenses[0]!).toEqualTypeOf<(typeof pendingExpenses)[number]>();
    expectTypeOf(group.payments[0]!).toEqualTypeOf<(typeof memberPayments)[number]>();
    expect(group.expenses[0]).toBe(expenses[0]); expect(group.payments[0]).toBe(memberPayments[0]);
    expect(group.pendingExpenses[0]).toBe(pendingExpenses[0]);
    expect(group.expenses.map((row) => row.id)).toEqual(["late", "early"]);
    expect(group.payments.map((row) => row.id)).toEqual(["second", "first"]);
    expect(JSON.stringify(input)).toBe(original);
  });
});

describe("chronological heterogeneous expense-day entries", () => {
  it("compares actual instants rather than different offset spellings", () => {
    const early = { key: "payment:early", at: "2030-04-01T10:00:00+09:00" };
    const late = { key: "expense:late", at: "2030-04-01T02:00:00Z" };
    expect([late, early].sort(compareExpenseDayEntries)).toEqual([early, late]);
    expect(compareExpenseDayEntries(early, late)).toBeLessThan(0);
  });
  it("orders the repeated DST hour by instant, not the visually smaller wall time", () => {
    const early = { key: "pending:early", at: "2030-11-03T01:45:00-04:00" };
    const late = { key: "payment:late", at: "2030-11-03T01:15:00-05:00" };
    expect([late, early].sort(compareExpenseDayEntries)).toEqual([early, late]);
  });
  it("uses namespaced keys to resolve equal instants and cross-table ID collisions deterministically", () => {
    const entries = [
      { key: "pending:shared-id", at: "2030-04-01T10:00:00+09:00" },
      { key: "payment:shared-id", at: "2030-04-01T01:00:00.000Z" },
      { key: "expense:shared-id", at: "2030-04-01T02:00:00+01:00" },
    ];
    expect([...entries].sort(compareExpenseDayEntries).map((row) => row.key))
      .toEqual(["expense:shared-id", "payment:shared-id", "pending:shared-id"]);
    expect(compareExpenseDayEntries(entries[0]!, entries[0]!)).toBe(0);
    expect(entries[0]?.key).toBe("pending:shared-id");
  });
});
