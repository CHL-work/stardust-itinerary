import type { ReactNode } from "react";
import { Clock3, PencilLine } from "lucide-react";
import { currencyFactor } from "@/lib/app/event-expense-editor";
import { mobileCardsMessages } from "@/lib/app/mobile-cards-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";
import styles from "./expense-display-card.module.css";

export type DisplayExpense = {
  description: string; amountMinor: number; currency: string; status: string;
  payerMemberId: string; payerName: string; itineraryItemTitle: string | null; occurredAt: string;
  splits: Array<{ memberId: string; memberName: string; shareMinor: number }>;
};

export function ExpenseDisplayCard({ expense, memberId, locale, timeZone, children, pendingNote, recordId }: {
  expense: DisplayExpense; memberId?: string; locale: Locale; timeZone: string;
  children?: ReactNode; pendingNote?: string;
  recordId?: string;
}) {
  const copy = mobileCardsMessages(locale);
  const proposed = expense.status === "pending" || expense.status === "draft";
  const share = expense.splits.find((split) => split.memberId === memberId)?.shareMinor ?? 0;
  const money = (amount: number) => new Intl.NumberFormat(locale, {
    style: "currency", currency: expense.currency, maximumFractionDigits: currencyFactor(expense.currency) === 1 ? 0 : 2,
  }).format(amount / currencyFactor(expense.currency));
  return <article id={recordId ? `expense-${recordId}` : undefined} className={styles.card} data-expense-status={expense.status}>
    {expense.status !== "posted" ? <div className={styles.status}>
      <span className={proposed ? styles.draft : styles.void}>
        {proposed ? expense.status === "pending" ? <Clock3 size={15} aria-hidden="true" /> : <PencilLine size={15} aria-hidden="true" /> : null}
        {expense.status === "pending" ? copy.pending : expense.status === "draft" ? copy.draft : copy.void}
      </span>
    </div> : null}
    <div className={styles.main}>
      <div className={styles.description}>
        <h3>{expense.description}</h3>
        {expense.itineraryItemTitle ? <p>{expense.itineraryItemTitle}</p> : null}
        <time dateTime={expense.occurredAt}>{new Intl.DateTimeFormat(locale, {
          timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        }).format(new Date(expense.occurredAt))}</time>
      </div>
      <div className={styles.amount}>
        <span>{proposed ? copy.proposedShare : expense.status === "posted" && expense.payerMemberId === memberId ? copy.paidMyShare : copy.myShare}</span>
        <strong data-personal-share data-zero={share === 0}>{money(share)}</strong>
        <small>{copy.total} <b>{money(expense.amountMinor)}</b></small>
        <small>{formatMessage(proposed ? copy.proposedPayer : copy.payer, { name: expense.payerName })}</small>
      </div>
    </div>
    <details className={styles.splits}><summary>{copy.splits}</summary>
      <ul>{expense.splits.map((split) => <li key={split.memberId}><span>{split.memberName}</span><strong>{money(split.shareMinor)}</strong></li>)}</ul>
    </details>
    {proposed ? <p className={styles.note}>{pendingNote ?? copy.excluded}</p> : null}
    {children ? <div className={`card-actions ${styles.actions}`}>{children}</div> : null}
  </article>;
}
