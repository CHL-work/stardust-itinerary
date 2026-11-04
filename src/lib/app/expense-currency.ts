export function currencyFactor(currency: string): number {
  return ["JPY", "KRW"].includes(currency) ? 1 : 100;
}

/** Decimal input without floating-point division, including an explicit zero share. */
export function expenseAmountInput(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return "";
  const factor = BigInt(currencyFactor(currency));
  const amount = BigInt(amountMinor);
  return factor === 1n ? String(amount) : `${amount / factor}.${String(amount % factor).padStart(2, "0")}`;
}
