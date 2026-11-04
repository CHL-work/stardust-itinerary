import { describe, expect, it } from "vitest";
import { expenseSplitsForPatch } from "@/lib/app/expense-split-patch";

const one = "10000000-0000-4000-8000-000000000001";
const two = "10000000-0000-4000-8000-000000000002";
const stored = { amountMinor: 101, splits: [{ participantId: two, amountMinor: 70 }, { participantId: one, amountMinor: 31 }] };
const amounts = [{ memberId: one, amountMinor: 0 }, { memberId: two, amountMinor: 101 }];

describe("expense split patch semantics", () => {
  it("retains the legacy equal default and duplicate normalization", () => {
    expect(expenseSplitsForPatch({ amountMinor: 101, splitMemberIds: [one, two, one] })).toEqual([
      { participantId: one, amountMinor: 51 }, { participantId: two, amountMinor: 50 },
    ]);
  });
  it("uses explicit custom values including zero, in participant order", () => {
    expect(expenseSplitsForPatch({ amountMinor: 101, splitMemberIds: [two, one], splitAmounts: amounts })).toEqual([
      { participantId: two, amountMinor: 101 }, { participantId: one, amountMinor: 0 },
    ]);
  });
  it.each([{}, { amountMinor: 101 }])("does not recalculate unchanged saved allocations", (patch) => {
    expect(expenseSplitsForPatch(patch, stored)).toBeNull();
    expect(stored.splits).toEqual([{ participantId: two, amountMinor: 70 }, { participantId: one, amountMinor: 31 }]);
  });
  it("rejects a changed unequal total without explicit reconciled intent", () => {
    expect(() => expenseSplitsForPatch({ amountMinor: 103 }, stored)).toThrow(/reconciled/);
  });
  it("allows amount-only updates of genuinely equal saved allocations, regardless of remainder recipient", () => {
    expect(expenseSplitsForPatch({ amountMinor: 103 }, { amountMinor: 101,
      splits: [{ participantId: two, amountMinor: 51 }, { participantId: one, amountMinor: 50 }] })).toEqual([
      { participantId: one, amountMinor: 52 }, { participantId: two, amountMinor: 51 },
    ]);
  });
  it("supports explicit equal reset from a custom saved split", () => {
    expect(expenseSplitsForPatch({ amountMinor: 103, splitMemberIds: [two, one] }, stored)).toEqual([
      { participantId: two, amountMinor: 52 }, { participantId: one, amountMinor: 51 },
    ]);
  });
  it("resolves a sparse custom map against the current exact participants and total", () => {
    expect(expenseSplitsForPatch({ splitAmounts: amounts }, stored)).toEqual([
      { participantId: one, amountMinor: 0 }, { participantId: two, amountMinor: 101 },
    ]);
  });
  it("requires a complete custom map even when no new participant list is sent", () => {
    expect(() => expenseSplitsForPatch({ splitAmounts: [{ memberId: one, amountMinor: 101 }] }, stored)).toThrow();
    expect(() => expenseSplitsForPatch({ amountMinor: 102, splitAmounts: amounts }, stored)).toThrow();
  });
  it("never silently deduplicates a custom participant list or custom amount entries", () => {
    expect(() => expenseSplitsForPatch({ amountMinor: 101, splitMemberIds: [one, two, one], splitAmounts: amounts })).toThrow();
    expect(() => expenseSplitsForPatch({ amountMinor: 101, splitMemberIds: [one, two], splitAmounts: [amounts[1]!, amounts[1]!] })).toThrow();
  });
  it("requires a total and participant list for a new expense", () => {
    expect(() => expenseSplitsForPatch({ splitAmounts: amounts })).toThrow();
    expect(() => expenseSplitsForPatch({ amountMinor: 101, splitAmounts: amounts })).toThrow();
  });
});
