import { describe, expect, it } from "vitest";
import { buildExpenseSummary, type ExpenseSummaryOverview, type SummaryExpense } from "./expense-summary";

function expense(overrides: Partial<SummaryExpense> = {}): SummaryExpense {
  return { id: "bill-a", currency: "JPY", status: "posted", amountMinor: 1000, payerMemberId: "member-a", splits: [{ memberId: "member-a", shareMinor: 500 }, { memberId: "member-b", shareMinor: 500 }], ...overrides };
}

function overview(expenses: SummaryExpense[], isOwner = false): ExpenseSummaryOverview {
  return {
    session: { memberId: "member-a", isOwner }, trip: { defaultCurrency: "JPY" }, expenses,
    expenseLedger: { settlements: [
      { currency: "JPY", fromMemberId: "member-b", fromMemberName: "Member B", toMemberId: "member-a", toMemberName: "Member A", amountMinor: 500 },
      { currency: "HKD", fromMemberId: "member-c", fromMemberName: "Member C", toMemberId: "member-d", toMemberName: "Member D", amountMinor: 200 },
    ] },
  };
}

describe("personal whole-trip expense summary", () => {
  it("distinguishes spending from advancing money for others", () => {
    expect(buildExpenseSummary(overview([expense()])).personal).toEqual([
      { memberId: "member-a", currency: "JPY", paidMinor: 1000, shareMinor: 500, netMinor: 500 },
    ]);
  });

  it("includes the whole trip beyond 60 records and dates, not only displayed cards", () => {
    const bills = Array.from({ length: 81 }, (_, index) => ({ ...expense({ id: `bill-${index}` }), occurredAt: `2026-09-${String(index % 20 + 1).padStart(2, "0")}T12:00:00Z` }));
    expect(buildExpenseSummary(overview(bills, true))).toMatchObject({
      personal: [{ paidMinor: 81000, shareMinor: 40500, netMinor: 40500 }],
      visibleTripTotals: [{ currency: "JPY", amountMinor: 81000 }],
    });
  });

  it("counts independently paid bills for the same event without merging or double-charging", () => {
    const bills = [
      { ...expense({ amountMinor: 900, splits: [{ memberId: "member-a", shareMinor: 900 }] }), itineraryItemId: "shared-restaurant" },
      { ...expense({ id: "bill-b", amountMinor: 1300, payerMemberId: "member-b", splits: [{ memberId: "member-b", shareMinor: 1300 }] }), itineraryItemId: "shared-restaurant" },
    ];
    expect(buildExpenseSummary(overview(bills, true))).toMatchObject({
      personal: [{ paidMinor: 900, shareMinor: 900, netMinor: 0 }],
      visibleTripTotals: [{ currency: "JPY", amountMinor: 2200 }],
    });
  });

  it.each(["pending", "draft", "void", "rejected", "unknown"])("excludes %s even when it resembles a valid recorded charge", (status) => {
    const result = buildExpenseSummary(overview([expense(), expense({ id: "not-posted", status })], true));
    expect(result.personal[0]?.shareMinor).toBe(500);
    expect(result.visibleTripTotals).toEqual([{ currency: "JPY", amountMinor: 1000 }]);
  });

  it("retains separate minor-unit currencies, including two-decimal and zero-decimal money", () => {
    const result = buildExpenseSummary(overview([
      expense(), expense({ id: "hkd", currency: "HKD", amountMinor: 175501, splits: [{ memberId: "member-a", shareMinor: 87751 }, { memberId: "member-b", shareMinor: 87750 }] }),
    ], true));
    expect(result.personal.map(({ currency, shareMinor }) => ({ currency, shareMinor }))).toEqual([{ currency: "HKD", shareMinor: 87751 }, { currency: "JPY", shareMinor: 500 }]);
    expect(result.visibleTripTotals).toEqual([{ currency: "HKD", amountMinor: 175501 }, { currency: "JPY", amountMinor: 1000 }]);
  });

  it("shows zero in the trip currency for someone without a recorded personal share or payment", () => {
    const result = buildExpenseSummary(overview([expense({ payerMemberId: "member-b", splits: [{ memberId: "member-b", shareMinor: 1000 }] })]));
    expect(result.personal).toEqual([{ memberId: "member-a", currency: "JPY", shareMinor: 0, paidMinor: 0, netMinor: 0 }]);
  });

  it("shows an amount owed when the current member did not pay their share", () => {
    expect(buildExpenseSummary(overview([expense({ payerMemberId: "member-b" })])).personal[0]).toMatchObject({ paidMinor: 0, shareMinor: 500, netMinor: -500 });
  });

  it("shows money advanced without treating it as personal spending", () => {
    expect(buildExpenseSummary(overview([expense({ splits: [{ memberId: "member-b", shareMinor: 1000 }] })])).personal[0]).toMatchObject({ paidMinor: 1000, shareMinor: 0, netMinor: 1000 });
  });

  it("only exposes group totals and third-party settlements to the owner UI", () => {
    const member = buildExpenseSummary(overview([expense()]));
    expect(member.visibleTripTotals).toBeNull();
    expect(member.ownerSettlements).toBeNull();
    expect(member.personalSettlements.map((row) => row.fromMemberId)).toEqual(["member-b"]);
    expect(buildExpenseSummary(overview([expense()], true)).ownerSettlements).toHaveLength(2);
  });

  it("never invents omitted private expenses in an owner's visible totals", () => {
    const result = buildExpenseSummary(overview([expense({ amountMinor: 111, splits: [{ memberId: "member-a", shareMinor: 111 }] })], true));
    expect(result.visibleTripTotals).toEqual([{ currency: "JPY", amountMinor: 111 }]);
  });

  it("rejects invalid allocations rather than showing plausible financial totals", () => {
    expect(() => buildExpenseSummary(overview([expense({ splits: [{ memberId: "member-a", shareMinor: 499 }] })]))).toThrow("splits do not equal");
  });

  it("does not display an imprecise aggregate above the safe integer range", () => {
    const huge = expense({ amountMinor: Number.MAX_SAFE_INTEGER, splits: [{ memberId: "member-a", shareMinor: Number.MAX_SAFE_INTEGER }] });
    expect(() => buildExpenseSummary(overview([huge, { ...huge, id: "huge-b" }]))).toThrow("safe integer precision");
  });

  it("does not mutate the authorized projection while summarizing", () => {
    const input = overview([expense()], true);
    const before = structuredClone(input);
    buildExpenseSummary(input);
    expect(input).toEqual(before);
  });

  const payment = { status: "posted", currency: "JPY", amountMinor: 200,
    accountingFromMemberId: "member-b", accountingToMemberId: "member-a" };
  it("adjusts the leading personal balance but never spending, daily bill totals or paid-by-me", () => {
    const result = buildExpenseSummary({ ...overview([expense()], true), memberPayments: [payment] });
    expect(result.personal).toEqual([{ memberId: "member-a", currency: "JPY", paidMinor: 1000, shareMinor: 500, netMinor: 300 }]);
    expect(result.personalRepayments).toEqual([{ currency: "JPY", sentMinor: 0, receivedMinor: 200 }]);
    expect(result.visibleTripTotals).toEqual([{ currency: "JPY", amountMinor: 1000 }]);
  });
  it.each(["pending", "rejected", "void", "unknown"])("excludes %s repayments from financial summary", (status) => {
    const result = buildExpenseSummary({ ...overview([expense()], true), memberPayments: [{ ...payment, status }] });
    expect(result.personal[0]?.netMinor).toBe(500);
    expect(result.personalRepayments).toEqual([]);
  });
  it("retains personal payment-only currencies and zero spending", () => {
    const result = buildExpenseSummary({ ...overview([], true), memberPayments: [{ ...payment, currency: "HKD", amountMinor: 10050 }] });
    expect(result.personal).toEqual([{ memberId: "member-a", currency: "HKD", paidMinor: 0, shareMinor: 0, netMinor: -10050 }]);
    expect(result.visibleTripTotals).toEqual([]);
  });
  it("uses only the authorized payment projection and hides third-party repayment totals", () => {
    const result = buildExpenseSummary({ ...overview([expense()]), memberPayments: [
      { ...payment, accountingFromMemberId: "member-c", accountingToMemberId: "member-d" },
    ] });
    expect(result.personal[0]?.netMinor).toBe(500);
    expect(result.personalRepayments).toEqual([]);
    expect(result.ownerSettlements).toBeNull();
  });
});

describe("explanation invariants on an already authorized expense projection", () => {
  // Visibility is fixture context only. This pure summary cannot enforce SQL
  // audiences; actual private-row authorization is tested at the repository/DB boundary.
  const authorizedBills = () => [
    { ...expense({ id: "synthetic-private-solo", amountMinor: 600,
      splits: [{ memberId: "member-a", shareMinor: 600 }] }), visibility: "private", occurredAt: "2030-03-30T00:00:00Z" },
    { ...expense({ id: "synthetic-private-shared", amountMinor: 1000, payerMemberId: "member-b",
      splits: [{ memberId: "member-a", shareMinor: 250 }, { memberId: "member-b", shareMinor: 750 }] }), visibility: "private", occurredAt: "2030-04-01T00:00:00Z" },
    { ...expense({ id: "synthetic-trip-shared", amountMinor: 1800,
      splits: [{ memberId: "member-a", shareMinor: 400 }, { memberId: "member-b", shareMinor: 600 }, { memberId: "member-c", shareMinor: 800 }] }), visibility: "trip", occurredAt: "2030-04-03T00:00:00Z" },
    { ...expense({ id: "synthetic-advance-only", amountMinor: 300,
      splits: [{ memberId: "member-b", shareMinor: 300 }] }), visibility: "trip", occurredAt: "2030-04-04T00:00:00Z" },
    { ...expense({ id: "synthetic-viewer-zero-share", amountMinor: 500, payerMemberId: "member-b",
      splits: [{ memberId: "member-a", shareMinor: 0 }, { memberId: "member-b", shareMinor: 500 }] }), visibility: "private", occurredAt: "2030-04-05T00:00:00Z" },
  ];
  const repayment = (amountMinor: number, from = "member-a", to = "member-b", status = "posted", currency = "JPY") => ({
    status, currency, amountMinor, accountingFromMemberId: from, accountingToMemberId: to,
  });

  it("adds authorized private solo/private shared/public portions, not every visible bill's full cost", () => {
    const result = buildExpenseSummary(overview(authorizedBills(), true));
    expect(result.personal).toEqual([{ memberId: "member-a", currency: "JPY", paidMinor: 2700, shareMinor: 1250, netMinor: 1450 }]);
    expect(result.visibleTripTotals).toEqual([{ currency: "JPY", amountMinor: 4200 }]);
    expect(result.personal[0]?.shareMinor).not.toBe(result.visibleTripTotals?.[0]?.amountMinor);
  });

  it("does not equate a fully paid personal expense's share with money still owed", () => {
    const result = buildExpenseSummary(overview([authorizedBills()[0]!]));
    expect(result.personal[0]).toMatchObject({ shareMinor: 600, paidMinor: 600, netMinor: 0 });
  });

  it("retains responsibility when another member paid, without counting that bill as paid by the viewer", () => {
    const result = buildExpenseSummary(overview([authorizedBills()[1]!]));
    expect(result.personal[0]).toMatchObject({ shareMinor: 250, paidMinor: 0, netMinor: -250 });
  });

  it("distinguishes payer-only advances and zero-share viewers from personal spending", () => {
    const advance = buildExpenseSummary(overview([authorizedBills()[3]!]));
    expect(advance.personal[0]).toMatchObject({ shareMinor: 0, paidMinor: 300, netMinor: 300 });
    const viewer = buildExpenseSummary(overview([authorizedBills()[4]!]));
    expect(viewer.personal[0]).toMatchObject({ shareMinor: 0, paidMinor: 0, netMinor: 0 });
  });

  it("does not reconstruct omitted private bills when the same projected viewer becomes an owner", () => {
    const publicProjection = authorizedBills().filter((bill) => bill.visibility === "trip");
    const member = buildExpenseSummary(overview(publicProjection));
    const owner = buildExpenseSummary(overview(publicProjection, true));
    expect(owner.personal).toEqual(member.personal);
    expect(owner.personal[0]).toMatchObject({ shareMinor: 400, paidMinor: 2100, netMinor: 1700 });
    expect(owner.visibleTripTotals).toEqual([{ currency: "JPY", amountMinor: 2100 }]);
    expect(member.visibleTripTotals).toBeNull();
  });

  it("includes all supplied trip expense dates and ignores plan-only amounts or selected-day metadata", () => {
    const data = { ...overview(authorizedBills()), selectedDate: "2030-04-01",
      itinerary: [{ id: "synthetic-no-bill", estimatedCostMinor: 9876 }], pendingExpenses: [{ amountMinor: 5432 }] };
    expect(buildExpenseSummary(data).personal[0]).toMatchObject({ shareMinor: 1250, paidMinor: 2700, netMinor: 1450 });
    const anotherDay = { ...data, selectedDate: "2030-04-05" };
    expect(buildExpenseSummary(anotherDay).personal).toEqual(buildExpenseSummary(data).personal);
  });

  it("excludes draft/pending/void expenses and non-posted repayments without reducing recorded shares", () => {
    const bills = authorizedBills();
    const excluded = ["pending", "draft", "void"].map((status) => expense({ id: `synthetic-${status}`, status,
      amountMinor: 5000, splits: [{ memberId: "member-a", shareMinor: 5000 }] }));
    const data = { ...overview([...bills, ...excluded], true), memberPayments: [
      repayment(999, "member-a", "member-b", "pending"), repayment(999, "member-b", "member-a", "rejected"),
      repayment(999, "member-a", "member-b", "void"),
    ] };
    expect(buildExpenseSummary(data)).toMatchObject({ personal: buildExpenseSummary(overview(bills)).personal,
      visibleTripTotals: [{ currency: "JPY", amountMinor: 4200 }], personalRepayments: [] });
  });

  it("applies sent minus received repayments only to net, never personal share, full bills paid or trip totals", () => {
    const result = buildExpenseSummary({ ...overview(authorizedBills(), true),
      memberPayments: [repayment(100), repayment(350, "member-b", "member-a")] });
    expect(result.personal[0]).toMatchObject({ shareMinor: 1250, paidMinor: 2700, netMinor: 1200 });
    expect(result.personalRepayments).toEqual([{ currency: "JPY", sentMinor: 100, receivedMinor: 350 }]);
    expect(result.personal[0]?.netMinor).toBe(2700 - 1250 + 100 - 350);
    expect(result.visibleTripTotals).toEqual([{ currency: "JPY", amountMinor: 4200 }]);
  });

  it("keeps exact minor-unit currencies and repayment-only currencies separate from each other", () => {
    const hkd = expense({ id: "synthetic-hkd", currency: "HKD", amountMinor: 355, payerMemberId: "member-b",
      splits: [{ memberId: "member-a", shareMinor: 55 }, { memberId: "member-b", shareMinor: 300 }] });
    const result = buildExpenseSummary({ ...overview([...authorizedBills(), hkd], true), memberPayments: [
      repayment(30, "member-a", "member-b", "posted", "HKD"), repayment(80, "member-b", "member-a", "posted", "EUR"),
    ] });
    expect(result.personal).toEqual([
      { memberId: "member-a", currency: "EUR", shareMinor: 0, paidMinor: 0, netMinor: -80 },
      { memberId: "member-a", currency: "HKD", shareMinor: 55, paidMinor: 0, netMinor: -25 },
      { memberId: "member-a", currency: "JPY", shareMinor: 1250, paidMinor: 2700, netMinor: 1450 },
    ]);
    expect(result.visibleTripTotals).toEqual([{ currency: "HKD", amountMinor: 355 }, { currency: "JPY", amountMinor: 4200 }]);
  });

  it("uses reassigned bookkeeping legs rather than original cash identities and nets equal legs to zero", () => {
    const repayments = [
      { ...repayment(80), fromMemberId: "synthetic-removed", toMemberId: "member-b" },
      { ...repayment(30, "member-b", "member-a"), fromMemberId: "member-b", toMemberId: "synthetic-removed" },
      { ...repayment(50, "member-a", "member-a"), fromMemberId: "synthetic-removed", toMemberId: "member-a" },
    ];
    const input = { ...overview(authorizedBills()), memberPayments: repayments };
    const before = structuredClone(input);
    const result = buildExpenseSummary(input);
    expect(result.personal[0]).toMatchObject({ shareMinor: 1250, paidMinor: 2700, netMinor: 1500 });
    expect(result.personalRepayments).toEqual([{ currency: "JPY", sentMinor: 130, receivedMinor: 80 }]);
    expect(result.personal[0]?.netMinor).toBe(2700 - 1250 + 130 - 80);
    expect(input).toEqual(before);
  });

  it("describes full bills by their current recorded payer, not historical or bank-confirmed payment identity", () => {
    const reassigned = { ...expense({ id: "synthetic-reassigned-bill", amountMinor: 600,
      splits: [{ memberId: "member-b", shareMinor: 600 }] }), originalPayerMemberId: "synthetic-removed" };
    expect(buildExpenseSummary(overview([reassigned])).personal[0]).toMatchObject({ shareMinor: 0, paidMinor: 600, netMinor: 600 });
  });
});
