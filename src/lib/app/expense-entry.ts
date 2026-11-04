import { currencyFactor } from "@/lib/app/expense-currency";

/** Parse a user-entered decimal directly into the ledger's integer minor units. */
export function parseExpenseAmount(amount: string, currency: string): number | null {
  const value = parseExpenseShareAmount(amount, currency);
  return value !== null && value > 0 ? value : null;
}

/** Shares can be explicitly zero, but blank, negative or rounded inputs are invalid. */
export function parseExpenseShareAmount(amount: string, currency: string): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return null;
  const decimals = currencyFactor(currency) === 1 ? 0 : 2;
  const fraction = match[2] ?? "";
  if (fraction.slice(decimals).replaceAll("0", "").length) return null;
  const digits = match[1] + fraction.slice(0, decimals).padEnd(decimals, "0");
  const value = Number(digits);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
