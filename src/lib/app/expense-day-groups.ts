import { tripLocalDateKey } from "./day-view";

type DatedRecord = { occurredAt: string };
type ExpenseRecord = DatedRecord & {
  status: string;
  currency: string;
  currentMemberShareMinor: number;
};

export type ExpenseDayGroup<E extends ExpenseRecord, P extends DatedRecord, M extends DatedRecord> = {
  date: string;
  label: string | null;
  expenses: E[];
  pendingExpenses: P[];
  payments: M[];
  totals: Array<[string, number]>;
};

/** Presentation only: retain the complete server-authorized rows, never infer an audience or a balance. */
export function groupExpenseDays<E extends ExpenseRecord, P extends DatedRecord, M extends DatedRecord = DatedRecord>({
  days, expenses, pendingExpenses, memberPayments = [], timeZone,
}: {
  days: readonly { date: string; label: string | null }[];
  expenses: readonly E[];
  pendingExpenses: readonly P[];
  memberPayments?: readonly M[];
  timeZone: string;
}): ExpenseDayGroup<E, P, M>[] {
  const groups = new Map<string, ExpenseDayGroup<E, P, M>>();
  const create = (date: string, label: string | null = null): ExpenseDayGroup<E, P, M> => ({
    date, label, expenses: [], pendingExpenses: [], payments: [], totals: [],
  });
  for (const day of days) groups.set(day.date, create(day.date, day.label));
  const groupFor = (record: DatedRecord) => {
    const date = tripLocalDateKey(record.occurredAt, timeZone);
    let group = groups.get(date);
    if (!group) { group = create(date); groups.set(date, group); }
    return group;
  };
  for (const expense of expenses) groupFor(expense).expenses.push(expense);
  for (const expense of pendingExpenses) groupFor(expense).pendingExpenses.push(expense);
  for (const payment of memberPayments) groupFor(payment).payments.push(payment);
  for (const group of groups.values()) {
    const totals = new Map<string, number>();
    for (const expense of group.expenses) {
      if (expense.status !== "posted" || !(expense.currentMemberShareMinor > 0)) continue;
      totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.currentMemberShareMinor);
    }
    group.totals = [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  }
  return [...groups.values()].sort((left, right) => left.date.localeCompare(right.date));
}

/** Callers namespace keys by record kind; equal wall-clock text need not mean equal instants. */
export function compareExpenseDayEntries(left: { key: string; at: string }, right: { key: string; at: string }): number {
  return Date.parse(left.at) - Date.parse(right.at) || left.key.localeCompare(right.key);
}
