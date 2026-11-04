export type ExpenseAllocation = {
  participantId: string;
  amountMinor: number;
};

export type ExpenseSplitAmount = {
  memberId: string;
  amountMinor: number;
};

/** A complete explicit allocation, or the existing deterministic equal default. */
export function resolveExpenseSplits(
  totalMinor: number,
  participantIds: readonly string[],
  splitAmounts?: readonly ExpenseSplitAmount[],
): ExpenseAllocation[] {
  const equal = splitExpenseEqually(totalMinor, participantIds);
  if (splitAmounts === undefined) return equal;
  if (splitAmounts.length !== participantIds.length) {
    throw new RangeError("Custom shares must include every selected participant exactly once");
  }
  const amounts = new Map<string, number>();
  const participants = new Set(participantIds);
  let total = 0n;
  for (const share of splitAmounts) {
    if (!participants.has(share.memberId) || amounts.has(share.memberId)) {
      throw new RangeError("Custom shares must match the selected participants exactly once");
    }
    if (!Number.isSafeInteger(share.amountMinor) || share.amountMinor < 0) {
      throw new RangeError("Custom shares must be nonnegative safe integer minor units");
    }
    amounts.set(share.memberId, share.amountMinor);
    total += BigInt(share.amountMinor);
  }
  if (total !== BigInt(totalMinor)) {
    throw new RangeError("Custom shares must add up to the expense total");
  }
  return participantIds.map((participantId) => ({ participantId, amountMinor: amounts.get(participantId)! }));
}

/** Legacy equal shares may assign remainder units to any selected participant. */
export function areExpenseSplitsEqual(totalMinor: number, allocations: readonly ExpenseAllocation[]): boolean {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0 || !allocations.length
      || new Set(allocations.map((share) => share.participantId)).size !== allocations.length
      || allocations.some((share) => !Number.isSafeInteger(share.amountMinor) || share.amountMinor < 0)) return false;
  const base = Math.floor(totalMinor / allocations.length);
  const remainder = totalMinor % allocations.length;
  return allocations.every((share) => share.amountMinor === base || share.amountMinor === base + 1)
    && allocations.filter((share) => share.amountMinor === base + 1).length === remainder;
}

export function splitExpenseEqually(
  totalMinor: number,
  participantIds: readonly string[],
): ExpenseAllocation[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new RangeError("totalMinor must be a positive safe integer");
  }

  const uniqueParticipants = new Set(participantIds);
  if (participantIds.length === 0 || uniqueParticipants.size !== participantIds.length) {
    throw new RangeError("participantIds must be non-empty and unique");
  }

  const base = Math.floor(totalMinor / participantIds.length);
  const remainder = totalMinor % participantIds.length;

  return participantIds.map((participantId, index) => ({
    participantId,
    amountMinor: base + (index < remainder ? 1 : 0),
  }));
}

export function allocationTotal(
  allocations: readonly ExpenseAllocation[],
): number {
  return allocations.reduce((total, item) => total + item.amountMinor, 0);
}
