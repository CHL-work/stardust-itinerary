import type { ExpensePatch } from "@/lib/app/types";
import { areExpenseSplitsEqual, resolveExpenseSplits, type ExpenseAllocation } from "@/lib/domain/expenses";

type SplitPatch = Pick<ExpensePatch, "amountMinor" | "splitMemberIds" | "splitAmounts">;
type StoredSplits = { amountMinor: number; splits: readonly ExpenseAllocation[] };

/** Null means keep the stored allocation rows, not recalculate equal shares. */
export function expenseSplitsForPatch(patch: SplitPatch, current?: StoredSplits): ExpenseAllocation[] | null {
  if (!current) {
    if (patch.amountMinor === undefined || patch.splitMemberIds === undefined) {
      throw new RangeError("An expense total and participants are required.");
    }
    return resolveExpenseSplits(patch.amountMinor,
      patch.splitAmounts === undefined ? [...new Set(patch.splitMemberIds)] : patch.splitMemberIds,
      patch.splitAmounts);
  }
  const amount = patch.amountMinor ?? current.amountMinor;
  if (patch.splitMemberIds === undefined && patch.splitAmounts === undefined) {
    if (amount === current.amountMinor) return null;
    if (!areExpenseSplitsEqual(current.amountMinor, current.splits)) {
      throw new RangeError("Changing an unequal expense total requires explicit reconciled shares or equal-split participants.");
    }
  }
  const participants = patch.splitMemberIds ?? current.splits.map((split) => split.participantId).sort();
  return resolveExpenseSplits(amount,
    patch.splitAmounts === undefined ? [...new Set(participants)] : participants,
    patch.splitAmounts);
}
