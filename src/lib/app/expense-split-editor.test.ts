import { describe, expect, it } from "vitest";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import { parseExpenseShareAmount } from "@/lib/app/expense-entry";
import { changeExpenseSplitMode, expenseSplitPatch, expenseSplitPreview, initializeExpenseSplits, readExpenseSplitAmounts } from "./expense-split-editor";

const draft = { amount: "100", currency: "JPY", splitMemberIds: ["a", "b"], splitMode: "equal" as const };
const saved = { amountMinor: 100, currency: "JPY", splitMemberIds: ["a", "b"],
  splitAmounts: [{ memberId: "a", amountMinor: 80 }, { memberId: "b", amountMinor: 20 }] };
const custom = () => ({ ...draft, ...initializeExpenseSplits(100, "JPY", saved.splitMemberIds, saved.splitAmounts) });

describe("exact expense split editor", () => {
  it.each([["JPY", "0", 0], ["KRW", "123", 123], ["HKD", "12.34", 1234], ["USD", "0.01", 1],
    ["HKD", "90071992547409.91", Number.MAX_SAFE_INTEGER], ["JPY", "1.10", null], ["HKD", "1.001", null],
    ["JPY", "", null], ["HKD", "-1", null], ["JPY", "1e2", null], ["HKD", "90071992547409.92", null]])(
    "parses a %s share %s exactly", (currency, input, expected) => {
      expect(parseExpenseShareAmount(String(input), String(currency))).toBe(expected);
    });
  it.each(["JPY", "KRW", "HKD", "USD"])("round trips zero and maximum safe minor units in %s", (currency) => {
    for (const amount of [0, 1, Number.MAX_SAFE_INTEGER]) expect(parseExpenseShareAmount(expenseAmountInput(amount, currency), currency)).toBe(amount);
  });
  it("defaults equal and seeds custom from the deterministic allocation", () => {
    expect(readExpenseSplitAmounts(draft, 100)).toBeUndefined();
    expect(changeExpenseSplitMode(draft, "custom")).toMatchObject({ splitMode: "custom", splitTouched: true, splitAmountInputs: { a: "50", b: "50" } });
  });
  it("reopens unequal saved shares and keeps sparse unrelated edits", () => {
    expect(custom()).toMatchObject({ splitMode: "custom", splitAmountInputs: { a: "80", b: "20" }, splitTouched: false });
    expect(expenseSplitPatch(custom(), 100, saved)).toEqual({});
    expect(expenseSplitPatch({ ...custom(), splitMemberIds: ["b", "a"] }, 100, saved)).toEqual({});
  });
  it("preserves equal remainder owners even when their order is different", () => {
    const original = { amountMinor: 10, currency: "JPY", splitMemberIds: ["a", "b", "c"],
      splitAmounts: [{ memberId: "a", amountMinor: 3 }, { memberId: "b", amountMinor: 4 }, { memberId: "c", amountMinor: 3 }] };
    const next = { amount: "10", currency: "JPY", splitMemberIds: original.splitMemberIds,
      ...initializeExpenseSplits(10, "JPY", original.splitMemberIds, original.splitAmounts) };
    expect(next.splitMode).toBe("equal"); expect(expenseSplitPatch(next, 10, original)).toEqual({});
    expect(changeExpenseSplitMode(next, "custom").splitAmountInputs).toEqual({ a: "3", b: "4", c: "3" });
  });
  it("switching to equal is explicit redistribution, not a preserved custom split", () => {
    const equal = changeExpenseSplitMode(custom(), "equal");
    expect(expenseSplitPatch(equal, 100, saved)).toEqual({ splitMemberIds: ["a", "b"] });
    expect(changeExpenseSplitMode(equal, "custom").splitAmountInputs).toEqual({ a: "50", b: "50" });
  });
  it("accepts explicit zero, never assumes a blank means zero", () => {
    const zero = { ...custom(), splitAmountInputs: { a: "100", b: "0" } };
    expect(readExpenseSplitAmounts(zero, 100)).toEqual([{ memberId: "a", amountMinor: 100 }, { memberId: "b", amountMinor: 0 }]);
    expect(expenseSplitPreview(zero).valid).toBe(true);
    expect(() => readExpenseSplitAmounts({ ...zero, splitAmountInputs: { a: "100", b: "" } }, 100)).toThrow();
  });
  it("requires full reconciliation after custom total, currency or participant changes", () => {
    for (const next of [{ ...custom(), amount: "101" }, { ...custom(), splitMemberIds: ["a"] },
      { ...custom(), splitMemberIds: ["a", "b", "c"] }, { ...custom(), splitMemberIds: ["a", "a"] }]) {
      expect(expenseSplitPreview(next).valid).toBe(false);
      expect(() => readExpenseSplitAmounts(next, Number(next.amount))).toThrow();
    }
    const decimal = { ...custom(), currency: "HKD", amount: "1.00", splitAmountInputs: { a: "0.80", b: "0.20" } };
    expect(expenseSplitPreview(decimal).valid).toBe(true);
    expect(expenseSplitPreview({ ...decimal, currency: "JPY" }).valid).toBe(false);
  });
  it("reports exact assigned and overallocated amounts without unsafe sum rounding", () => {
    const next = { ...custom(), currency: "HKD", amount: "90071992547409.91", splitAmountInputs: { a: "90071992547409.91", b: "90071992547409.91" } };
    expect(expenseSplitPreview(next)).toMatchObject({ assigned: 18014398509481982n, remaining: -9007199254740991n, valid: false });
  });
});
