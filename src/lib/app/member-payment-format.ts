import { currencyFactor } from "@/lib/app/event-expense-editor";

/** Preserve integer minor units even at the edge of JavaScript's safe range. */
export function paymentAmountInput(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return "";
  const factor = BigInt(currencyFactor(currency)); const amount = BigInt(amountMinor);
  return factor === 1n ? String(amount) : `${amount / factor}.${String(amount % factor).padStart(2, "0")}`;
}

export function formatPaymentMoney(amountMinor: number, currency: string, locale: string): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("Money must use safe integer minor units.");
  const factor = BigInt(currencyFactor(currency)); const amount = BigInt(amountMinor);
  const absolute = amount < 0n ? -amount : amount; const whole = absolute / factor;
  const signedWhole = amount < 0n ? (whole === 0n ? -0 : -whole) : whole;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: factor === 1n ? 0 : 2,
    maximumFractionDigits: factor === 1n ? 0 : 2 }).formatToParts(signedWhole)
    .map((part) => part.type === "fraction" ? String(absolute % factor).padStart(2, "0") : part.value).join("");
}
