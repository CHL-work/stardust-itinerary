export type LedgerExpense = {
  id: string;
  currency: string;
  amountMinor: number;
  payerMemberId: string;
  splits: Array<{ memberId: string; shareMinor: number }>;
};

export type MemberBalance = {
  memberId: string;
  currency: string;
  paidMinor: number;
  shareMinor: number;
  netMinor: number;
};

export type Settlement = {
  currency: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
};

/** A recorded repayment, using current bookkeeping identities (not a new expense). */
export type LedgerPayment = {
  currency: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
};

function safeSum(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new RangeError("ledger exceeds safe integer precision");
  return sum;
}

export function calculateMemberBalances(
  expenses: readonly LedgerExpense[],
  payments: readonly LedgerPayment[] = [],
): MemberBalance[] {
  const balances = new Map<string, MemberBalance>();
  const get = (memberId: string, currency: string) => {
    const key = `${currency}\0${memberId}`;
    let balance = balances.get(key);
    if (!balance) {
      balance = { memberId, currency, paidMinor: 0, shareMinor: 0, netMinor: 0 };
      balances.set(key, balance);
    }
    return balance;
  };

  for (const expense of expenses) {
    if (!Number.isSafeInteger(expense.amountMinor) || expense.amountMinor <= 0) {
      throw new RangeError("expense amount must be a positive safe integer");
    }
    const splitTotal = expense.splits.reduce((sum, split) => {
      if (!Number.isSafeInteger(split.shareMinor) || split.shareMinor < 0) {
        throw new RangeError("expense shares must be nonnegative safe integers");
      }
      return safeSum(sum, split.shareMinor);
    }, 0);
    if (splitTotal !== expense.amountMinor) {
      throw new RangeError(`expense ${expense.id} splits do not equal its amount`);
    }
    const payer = get(expense.payerMemberId, expense.currency);
    payer.paidMinor = safeSum(payer.paidMinor, expense.amountMinor);
    for (const split of expense.splits) {
      const participant = get(split.memberId, expense.currency);
      participant.shareMinor = safeSum(participant.shareMinor, split.shareMinor);
    }
  }

  for (const balance of balances.values()) {
    balance.netMinor = safeSum(balance.paidMinor, -balance.shareMinor);
  }
  for (const payment of payments) {
    if (!Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0) {
      throw new RangeError("payment amount must be a positive safe integer");
    }
    if (!payment.fromMemberId || !payment.toMemberId) throw new RangeError("payment members are required");
    const sender = get(payment.fromMemberId, payment.currency);
    const recipient = get(payment.toMemberId, payment.currency);
    // A removal may explicitly attribute both historical payment legs to one
    // remaining member. Keep the record but do not create a self-debt or overflow.
    if (sender === recipient) continue;
    sender.netMinor = safeSum(sender.netMinor, payment.amountMinor);
    recipient.netMinor = safeSum(recipient.netMinor, -payment.amountMinor);
  }

  return [...balances.values()]
    .sort((left, right) => left.currency.localeCompare(right.currency) || left.memberId.localeCompare(right.memberId));
}

export function calculateSettlements(balances: readonly MemberBalance[]): Settlement[] {
  const currencies = [...new Set(balances.map((balance) => balance.currency))].sort();
  const settlements: Settlement[] = [];

  for (const currency of currencies) {
    const currencyBalances = balances.filter((balance) => balance.currency === currency);
    // Several individually safe balances can exceed the number range while
    // summing and later cancel. Reconcile exactly, then operate on safe amounts.
    const total = currencyBalances.reduce((sum, balance) => {
      if (!Number.isSafeInteger(balance.netMinor)) throw new RangeError("balance exceeds safe integer precision");
      return sum + BigInt(balance.netMinor);
    }, 0n);
    if (total !== 0n) throw new RangeError(`balances for ${currency} do not reconcile`);

    const debtors = currencyBalances
      .filter((balance) => balance.netMinor < 0)
      .map((balance) => ({ memberId: balance.memberId, remaining: -balance.netMinor }))
      .sort((left, right) => left.memberId.localeCompare(right.memberId));
    const creditors = currencyBalances
      .filter((balance) => balance.netMinor > 0)
      .map((balance) => ({ memberId: balance.memberId, remaining: balance.netMinor }))
      .sort((left, right) => left.memberId.localeCompare(right.memberId));

    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex]!;
      const creditor = creditors[creditorIndex]!;
      const amountMinor = Math.min(debtor.remaining, creditor.remaining);
      settlements.push({
        currency,
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        amountMinor,
      });
      debtor.remaining -= amountMinor;
      creditor.remaining -= amountMinor;
      if (debtor.remaining === 0) debtorIndex += 1;
      if (creditor.remaining === 0) creditorIndex += 1;
    }
  }

  return settlements;
}
