import { describe, expect, it } from "vitest";
import { parseExpenseAmount } from "@/lib/app/expense-entry";

describe("expense decimal entry to exact integer minor units", () => {
  it.each([
    ["JPY", "1600", 1600], ["JPY", "1600.00", 1600], ["KRW", "0012", 12],
    ["HKD", "17.55", 1755], ["USD", "0.09", 9], ["HKD", " 12.3 ", 1230],
    ["HKD", "12.3400", 1234], ["JPY", "9007199254740991", Number.MAX_SAFE_INTEGER],
    ["HKD", "90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("parses %s %s without float multiplication or rounding", (currency, amount, expected) => {
    expect(parseExpenseAmount(String(amount), String(currency))).toBe(expected);
  });
  it.each([
    ["JPY", "1.5"], ["JPY", "0.01"], ["KRW", "12.01"], ["HKD", "12.345"],
    ["HKD", "0.001"], ["JPY", "0"], ["HKD", "0.000"], ["JPY", "-10"],
    ["HKD", "NaN"], ["JPY", "Infinity"], ["HKD", "1e3"], ["HKD", "0x10"],
    ["JPY", "1,000"], ["HKD", "12.3.4"], ["JPY", ""], ["HKD", "   "],
    ["JPY", "9007199254740992"], ["HKD", "90071992547409.92"],
  ])("rejects %s %s rather than silently altering a financial amount", (currency, amount) => {
    expect(parseExpenseAmount(amount, currency)).toBeNull();
  });
});
