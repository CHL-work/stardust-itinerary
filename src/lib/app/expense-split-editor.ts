import { areExpenseSplitsEqual, resolveExpenseSplits, type ExpenseSplitAmount } from "@/lib/domain/expenses";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import { parseExpenseAmount, parseExpenseShareAmount } from "@/lib/app/expense-entry";

export type ExpenseSplitDraft = {
  splitMode?: "equal" | "custom";
  splitAmountInputs?: Record<string, string>;
  splitTouched?: boolean;
};
type SplitFields = ExpenseSplitDraft & { amount: string; currency: string; splitMemberIds: string[] };
export type SavedExpenseSplits = { amountMinor: number; currency: string; splitMemberIds: string[]; splitAmounts?: ExpenseSplitAmount[] };

export function initializeExpenseSplits(totalMinor: number, currency: string, memberIds: string[], amounts?: ExpenseSplitAmount[]): ExpenseSplitDraft {
  const allocations = amounts?.map((share) => ({ participantId: share.memberId, amountMinor: share.amountMinor }))
    ?? resolveExpenseSplits(totalMinor, memberIds);
  return {
    splitMode: areExpenseSplitsEqual(totalMinor, allocations) ? "equal" : "custom",
    splitAmountInputs: Object.fromEntries(allocations.map((share) => [share.participantId, expenseAmountInput(share.amountMinor, currency)])),
    splitTouched: false,
  };
}

/** Mode changes are explicit financial intent. Custom participant changes never guess a new share. */
export function changeExpenseSplitMode<T extends SplitFields>(draft: T, splitMode: "equal" | "custom"): T {
  if ((draft.splitMode ?? "equal") === splitMode) return draft;
  let splitAmountInputs = draft.splitAmountInputs ?? {};
  if (splitMode === "custom") {
    const total = parseExpenseAmount(draft.amount, draft.currency);
    if (total !== null && draft.splitMemberIds.length) {
      const hasSaved = !draft.splitTouched && draft.splitMemberIds.every((id) => splitAmountInputs[id] !== undefined)
        && draft.splitMemberIds.reduce((sum, id) => sum + BigInt(parseExpenseShareAmount(splitAmountInputs[id], draft.currency) ?? -1), 0n) === BigInt(total);
      if (!hasSaved) splitAmountInputs = Object.fromEntries(resolveExpenseSplits(total, draft.splitMemberIds)
        .map((share) => [share.participantId, expenseAmountInput(share.amountMinor, draft.currency)]));
    }
  }
  return { ...draft, splitMode, splitAmountInputs, splitTouched: true };
}

export function readExpenseSplitAmounts(draft: SplitFields, totalMinor: number): ExpenseSplitAmount[] | undefined {
  if (draft.splitMode !== "custom") {
    resolveExpenseSplits(totalMinor, draft.splitMemberIds);
    return undefined;
  }
  const amounts = draft.splitMemberIds.map((memberId) => {
    const amountMinor = parseExpenseShareAmount(draft.splitAmountInputs?.[memberId] ?? "", draft.currency);
    if (amountMinor === null) throw new RangeError("Enter every custom share with valid currency precision");
    return { memberId, amountMinor };
  });
  resolveExpenseSplits(totalMinor, draft.splitMemberIds, amounts);
  return amounts;
}

/** Sparse updates preserve saved equal remainders and custom shares on unrelated edits. */
export function expenseSplitPatch(draft: SplitFields, totalMinor: number, original?: SavedExpenseSplits | null):
  { splitMemberIds?: string[]; splitAmounts?: ExpenseSplitAmount[] } {
  const splitAmounts = readExpenseSplitAmounts(draft, totalMinor);
  const sameMembers = original && original.splitMemberIds.length === draft.splitMemberIds.length
    && original.splitMemberIds.every((id) => draft.splitMemberIds.includes(id));
  if (original && sameMembers && original.amountMinor === totalMinor && original.currency === draft.currency && !draft.splitTouched) {
    const previous = resolveExpenseSplits(original.amountMinor, original.splitMemberIds, original.splitAmounts);
    if (!splitAmounts || splitAmounts.every((share) => previous.some((old) => old.participantId === share.memberId && old.amountMinor === share.amountMinor))) return {};
  }
  return { splitMemberIds: draft.splitMemberIds, ...(splitAmounts ? { splitAmounts } : {}) };
}

export function expenseSplitPreview(draft: SplitFields) {
  const total = parseExpenseAmount(draft.amount, draft.currency);
  const inputs = draft.splitMemberIds.map((id) => parseExpenseShareAmount(draft.splitAmountInputs?.[id] ?? "", draft.currency));
  const assigned = inputs.reduce<bigint>((sum, amount) => sum + BigInt(amount ?? 0), 0n);
  const remaining = total === null ? null : BigInt(total) - assigned;
  return { assigned, remaining, complete: inputs.length > 0 && inputs.every((value) => value !== null),
    valid: total !== null && inputs.length > 0 && new Set(draft.splitMemberIds).size === inputs.length
      && inputs.every((value) => value !== null) && remaining === 0n };
}
