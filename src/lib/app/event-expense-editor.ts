import type { LinkedExpenseInput } from "@/lib/app/types";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import { parseExpenseAmount } from "@/lib/app/expense-entry";
import { readExpenseSplitAmounts, type ExpenseSplitDraft } from "@/lib/app/expense-split-editor";
export { currencyFactor } from "@/lib/app/expense-currency";

export type EventExpenseMember = { id: string; status: string };
export type EventExpenseAudience = {
  createdByMemberId: string;
  visibility: "trip" | "private";
  viewerMemberIds: readonly string[];
};
export type EventExpenseDraft = ExpenseSplitDraft & {
  enabled: boolean;
  description: string;
  amount: string;
  currency: string;
  payerMemberId: string;
  occurredAt: string;
  status: "draft" | "posted";
  splitMemberIds: string[];
};
export type EventExpenseIssue = "noMembers" | "participants" | "description" | "amount" | "currency" | "date" | "splits";

export function eventExpenseMembers<T extends EventExpenseMember>(
  members: readonly T[],
  audience: EventExpenseAudience,
): T[] {
  return members.filter((member) => (member.status === "active" || member.status === "invited")
    && (audience.visibility === "trip" || member.id === audience.createdByMemberId
      || audience.viewerMemberIds.includes(member.id)));
}

export function eventExpenseDefaults(
  members: readonly EventExpenseMember[],
  audience: EventExpenseAudience,
  preferredPayerId: string,
): Pick<EventExpenseDraft, "payerMemberId" | "splitMemberIds"> {
  const ids = eventExpenseMembers(members, audience).map((member) => member.id);
  return {
    payerMemberId: ids.includes(preferredPayerId) ? preferredPayerId
      : ids.includes(audience.createdByMemberId) ? audience.createdByMemberId : ids[0] ?? "",
    splitMemberIds: ids,
  };
}

/** Only new, unsaved expense selections may follow an audience change automatically. */
export function constrainNewEventExpense(
  draft: EventExpenseDraft,
  members: readonly EventExpenseMember[],
  audience: EventExpenseAudience,
): EventExpenseDraft {
  const defaults = eventExpenseDefaults(members, audience, draft.payerMemberId);
  const splits = draft.splitMemberIds.filter((id) => defaults.splitMemberIds.includes(id));
  return { ...draft, payerMemberId: defaults.payerMemberId,
    splitMemberIds: splits.length || draft.splitMode === "custom" ? splits : defaults.splitMemberIds };
}

export function validateEventExpense(
  draft: EventExpenseDraft,
  members: readonly EventExpenseMember[],
  audience: EventExpenseAudience,
  original?: LinkedExpenseInput | null,
): EventExpenseIssue | null {
  if (!draft.enabled) return null;
  const ids = new Set(eventExpenseMembers(members, audience).map((member) => member.id));
  if (!ids.size) return "noMembers";
  if (!ids.has(draft.payerMemberId) || !draft.splitMemberIds.length
    || new Set(draft.splitMemberIds).size !== draft.splitMemberIds.length
    || draft.splitMemberIds.some((id) => !ids.has(id))) return "participants";
  if (!draft.description.trim() || draft.description.trim().length > 240) return "description";
  if (!/^[A-Z]{3}$/.test(draft.currency)) return "currency";
  const amount = original && unchangedDisplayedAmount(original, draft.currency, draft.amount)
    ? original.amountMinor : parseExpenseAmount(draft.amount, draft.currency);
  if (amount === null) return "amount";
  try { readExpenseSplitAmounts(draft, amount); } catch { return "splits"; }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.occurredAt)
    || !Number.isFinite(Date.parse(`${draft.occurredAt}:00Z`))
    || new Date(`${draft.occurredAt}:00Z`).toISOString().slice(0, 16) !== draft.occurredAt) return "date";
  return null;
}

function unchangedDisplayedAmount(original: LinkedExpenseInput, currency: string, amount: string): boolean {
  return original.currency === currency && expenseAmountInput(original.amountMinor, original.currency) === amount;
}

/** Keep untouched saved precision/status/participant order rather than rewriting a charge. */
export function preserveUnchangedLinkedExpense(
  original: LinkedExpenseInput | null | undefined,
  next: LinkedExpenseInput,
  originalWallTime: string,
  currentWallTime: string,
  currentAmount: string,
): LinkedExpenseInput {
  if (!original) return next;
  const preserved = { ...next,
    occurredAt: originalWallTime === currentWallTime ? original.occurredAt : next.occurredAt,
    amountMinor: unchangedDisplayedAmount(original, next.currency, currentAmount) ? original.amountMinor : next.amountMinor,
  };
  if (original.description === preserved.description
    && original.amountMinor === preserved.amountMinor && original.currency === preserved.currency
    && original.payerMemberId === preserved.payerMemberId
    && (original.status ?? "posted") === (preserved.status ?? "posted")
    && original.occurredAt === preserved.occurredAt
    && original.splitMemberIds.length === preserved.splitMemberIds.length
    && original.splitMemberIds.every((id, index) => id === preserved.splitMemberIds[index])
    && JSON.stringify(original.splitAmounts) === JSON.stringify(preserved.splitAmounts)) return original;
  return preserved;
}
