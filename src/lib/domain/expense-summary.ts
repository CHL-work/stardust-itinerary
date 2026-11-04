import { calculateMemberBalances, type LedgerExpense } from "./expense-ledger";

export type SummaryExpense = LedgerExpense & { status: string };

export type SummaryMemberPayment = {
  status: string;
  currency: string;
  amountMinor: number;
  accountingFromMemberId: string;
  accountingToMemberId: string;
  fromMemberId?: string;
  toMemberId?: string;
};

export type SummarySettlement = {
  currency: string;
  fromMemberId: string;
  fromMemberName: string;
  toMemberId: string;
  toMemberName: string;
  amountMinor: number;
};

export type ExpenseSummaryOverview = {
  session: { memberId: string; isOwner: boolean };
  trip: { defaultCurrency: string };
  expenses: readonly SummaryExpense[];
  memberPayments?: readonly SummaryMemberPayment[];
  expenseLedger: { settlements: readonly SummarySettlement[] };
};

/** Uses the complete server-authorized expense projection, never a date/card slice. */
export function buildExpenseSummary(overview: ExpenseSummaryOverview) {
  const posted = overview.expenses.filter((expense) => expense.status === "posted");
  const postedPayments = (overview.memberPayments ?? []).filter((payment) => payment.status === "posted");
  const balances = calculateMemberBalances(posted, postedPayments.map((payment) => ({
    currency: payment.currency, amountMinor: payment.amountMinor,
    fromMemberId: payment.accountingFromMemberId, toMemberId: payment.accountingToMemberId,
  })));
  for (const balance of balances) {
    if (![balance.paidMinor, balance.shareMinor, balance.netMinor].every(Number.isSafeInteger)) {
      throw new RangeError("expense summary exceeds safe integer precision");
    }
  }
  const personal = balances.filter((balance) => balance.memberId === overview.session.memberId);
  if (!personal.length) {
    personal.push({ memberId: overview.session.memberId, currency: overview.trip.defaultCurrency, paidMinor: 0, shareMinor: 0, netMinor: 0 });
  }

  const repaymentTotals = new Map<string, { currency: string; sentMinor: number; receivedMinor: number }>();
  for (const payment of postedPayments) {
    const sent = payment.accountingFromMemberId === overview.session.memberId;
    const received = payment.accountingToMemberId === overview.session.memberId;
    if (!sent && !received) continue;
    const total = repaymentTotals.get(payment.currency) ?? { currency: payment.currency, sentMinor: 0, receivedMinor: 0 };
    if (sent) total.sentMinor += payment.amountMinor;
    if (received) total.receivedMinor += payment.amountMinor;
    if (!Number.isSafeInteger(total.sentMinor) || !Number.isSafeInteger(total.receivedMinor)) {
      throw new RangeError("repayment summary exceeds safe integer precision");
    }
    repaymentTotals.set(payment.currency, total);
  }

  // An owner can inspect only the same authorized records: ownership is not a private-data bypass.
  const visibleTripTotals = overview.session.isOwner ? [...posted.reduce((totals, expense) => {
    const amount = (totals.get(expense.currency) ?? 0) + expense.amountMinor;
    if (!Number.isSafeInteger(amount)) throw new RangeError("expense summary exceeds safe integer precision");
    totals.set(expense.currency, amount);
    return totals;
  }, new Map<string, number>())].map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((left, right) => left.currency.localeCompare(right.currency)) : null;

  return {
    personal,
    personalRepayments: [...repaymentTotals.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
    personalSettlements: overview.expenseLedger.settlements.filter((settlement) => (
      settlement.fromMemberId === overview.session.memberId || settlement.toMemberId === overview.session.memberId
    )),
    visibleTripTotals,
    ownerSettlements: overview.session.isOwner ? overview.expenseLedger.settlements : null,
  };
}
