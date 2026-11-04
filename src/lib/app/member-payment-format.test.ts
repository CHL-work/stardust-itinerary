import { describe, expect, it } from "vitest";
import { formatPaymentMoney, paymentAmountInput } from "./member-payment-format";
import { parseExpenseAmount } from "./expense-entry";

describe("repayment exact minor-unit presentation", () => {
  it.each(["JPY", "KRW", "HKD", "USD"])("roundtrips even maximum safe %s amounts", (currency) => {
    for (const amount of [1, 99, 101, Number.MAX_SAFE_INTEGER]) {
      expect(parseExpenseAmount(paymentAmountInput(amount, currency), currency)).toBe(amount);
    }
  });
  it("keeps the last cent without floating-point division", () => {
    expect(paymentAmountInput(Number.MAX_SAFE_INTEGER, "HKD")).toBe("90071992547409.91");
    expect(formatPaymentMoney(Number.MAX_SAFE_INTEGER, "HKD", "en")).toBe("HK$90,071,992,547,409.91");
    expect(formatPaymentMoney(-Number.MAX_SAFE_INTEGER, "HKD", "en")).toBe("-HK$90,071,992,547,409.91");
  });
  it.each(["en", "zh-HK", "ja"])("preserves Intl currency, grouping and negative subunits in %s", (locale) => {
    for (const amount of [-101, -1, 0, 1, 101]) {
      expect(formatPaymentMoney(amount, "HKD", locale)).toBe(new Intl.NumberFormat(locale, { style: "currency", currency: "HKD" }).format(amount / 100));
    }
  });
  it("rejects unsafe values and never prefills a negative or zero repayment", () => {
    for (const invalid of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(paymentAmountInput(invalid, "HKD")).toBe("");
    expect(() => formatPaymentMoney(0.1, "JPY", "en")).toThrow(RangeError);
  });
});
