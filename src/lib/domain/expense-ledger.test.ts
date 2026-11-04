import { describe, expect, it } from "vitest";

import { calculateMemberBalances, calculateSettlements, type LedgerPayment } from "@/lib/domain/expense-ledger";

describe("expense ledger", () => {
  it("calculates per-member shares and deterministic settlements per currency", () => {
    const balances = calculateMemberBalances([
      {
        id: "dinner",
        currency: "JPY",
        amountMinor: 9000,
        payerMemberId: "owner",
        splits: [
          { memberId: "owner", shareMinor: 3000 },
          { memberId: "member-a", shareMinor: 3000 },
          { memberId: "member-b", shareMinor: 3000 },
        ],
      },
      {
        id: "taxi",
        currency: "JPY",
        amountMinor: 3000,
        payerMemberId: "member-a",
        splits: [
          { memberId: "owner", shareMinor: 1000 },
          { memberId: "member-a", shareMinor: 1000 },
          { memberId: "member-b", shareMinor: 1000 },
        ],
      },
    ]);

    expect(balances).toEqual([
      { memberId: "member-a", currency: "JPY", paidMinor: 3000, shareMinor: 4000, netMinor: -1000 },
      { memberId: "member-b", currency: "JPY", paidMinor: 0, shareMinor: 4000, netMinor: -4000 },
      { memberId: "owner", currency: "JPY", paidMinor: 9000, shareMinor: 4000, netMinor: 5000 },
    ]);
    expect(calculateSettlements(balances)).toEqual([
      { currency: "JPY", fromMemberId: "member-a", toMemberId: "owner", amountMinor: 1000 },
      { currency: "JPY", fromMemberId: "member-b", toMemberId: "owner", amountMinor: 4000 },
    ]);
  });

  it("rejects a ledger whose splits do not reconcile", () => {
    expect(() => calculateMemberBalances([
      { id: "bad", currency: "USD", amountMinor: 100, payerMemberId: "a", splits: [{ memberId: "a", shareMinor: 99 }] },
    ])).toThrow(/splits do not equal/);
  });

  const sharedBill = { id: "shared", currency: "JPY", amountMinor: 1000, payerMemberId: "alice",
    splits: [{ memberId: "alice", shareMinor: 500 }, { memberId: "bob", shareMinor: 500 }] };
  const repayment: LedgerPayment = { currency: "JPY", amountMinor: 200, fromMemberId: "bob", toMemberId: "alice" };

  it("reduces the remaining debt for a partial repayment without increasing spending or bills paid", () => {
    const balances = calculateMemberBalances([sharedBill], [repayment]);
    expect(balances).toEqual([
      { memberId: "alice", currency: "JPY", paidMinor: 1000, shareMinor: 500, netMinor: 300 },
      { memberId: "bob", currency: "JPY", paidMinor: 0, shareMinor: 500, netMinor: -300 },
    ]);
    expect(calculateSettlements(balances)).toEqual([{ ...repayment, amountMinor: 300 }]);
  });
  it("settles exactly with multiple partial payments and supports correction by excluding a void record", () => {
    expect(calculateSettlements(calculateMemberBalances([sharedBill], [repayment,
      { ...repayment, amountMinor: 300 }]))).toEqual([]);
    expect(calculateSettlements(calculateMemberBalances([sharedBill], [repayment]))[0]?.amountMinor).toBe(300);
  });
  it("retains actual overpayments as reversed balances instead of silently capping money", () => {
    expect(calculateSettlements(calculateMemberBalances([sharedBill], [{ ...repayment, amountMinor: 600 }])))
      .toEqual([{ currency: "JPY", amountMinor: 100, fromMemberId: "alice", toMemberId: "bob" }]);
  });
  it("supports repayment-only currencies without automatic currency conversion", () => {
    const balances = calculateMemberBalances([sharedBill], [{ ...repayment, currency: "HKD", amountMinor: 10050 }]);
    expect(calculateSettlements(balances)).toEqual([
      { currency: "HKD", amountMinor: 10050, fromMemberId: "alice", toMemberId: "bob" },
      { currency: "JPY", amountMinor: 500, fromMemberId: "bob", toMemberId: "alice" },
    ]);
    expect(balances.filter((row) => row.currency === "HKD").every((row) => row.paidMinor === 0 && row.shareMinor === 0)).toBe(true);
  });
  it("uses removal bookkeeping legs without leaving the original removed member in current balances", () => {
    const reassignedBill = { ...sharedBill, splits: [{ memberId: "alice", shareMinor: 500 }, { memberId: "carol", shareMinor: 500 }] };
    const balances = calculateMemberBalances([reassignedBill], [{ ...repayment, fromMemberId: "carol" }]);
    expect(balances.map((row) => row.memberId)).toEqual(["alice", "carol"]);
    expect(calculateSettlements(balances)).toEqual([{ ...repayment, fromMemberId: "carol", amountMinor: 300 }]);
  });
  it("retains neutral same-person bookkeeping legs without self-debt after explicit removal", () => {
    const balances = calculateMemberBalances([], [{ ...repayment, fromMemberId: "alice", amountMinor: Number.MAX_SAFE_INTEGER }]);
    expect(balances).toEqual([{ memberId: "alice", currency: "JPY", paidMinor: 0, shareMinor: 0, netMinor: 0 }]);
    expect(calculateSettlements(balances)).toEqual([]);
  });
  it.each([0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid repayment minor units %s", (amountMinor) => {
    expect(() => calculateMemberBalances([], [{ ...repayment, amountMinor }])).toThrow(/positive safe integer/);
  });
  it("rejects overflow instead of presenting rounded financial obligations", () => {
    expect(() => calculateMemberBalances([], [{ ...repayment, amountMinor: Number.MAX_SAFE_INTEGER }, repayment]))
      .toThrow(/safe integer precision/);
  });
  it("conserves per-currency value for deterministic multi-member partial repayment scenarios", () => {
    for (let amount = 1; amount <= 1000; amount += 17) {
      const balances = calculateMemberBalances([sharedBill], [
        { ...repayment, amountMinor: amount },
        { ...repayment, currency: "USD", amountMinor: amount + 1, fromMemberId: "carol" },
        { ...repayment, amountMinor: amount + 2, fromMemberId: "alice", toMemberId: "carol" },
      ]);
      for (const currency of ["JPY", "USD"]) {
        expect(balances.filter((row) => row.currency === currency).reduce((total, row) => total + row.netMinor, 0)).toBe(0);
      }
      expect(() => calculateSettlements(balances)).not.toThrow();
    }
  });
  it("reconciles many individually safe balances without an imprecise intermediate total", () => {
    const large = Number.MAX_SAFE_INTEGER;
    const balances = [large, large - 1, -large, -(large - 1)].map((netMinor, index) => ({
      memberId: `member-${index}`, currency: "JPY", paidMinor: 0, shareMinor: 0, netMinor,
    }));
    expect(calculateSettlements(balances)).toHaveLength(2);
    expect(() => calculateSettlements([{ ...balances[0]!, netMinor: large + 1 }])).toThrow(/safe integer/);
  });
});
