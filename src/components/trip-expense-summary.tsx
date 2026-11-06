import { formatPaymentMoney } from "@/lib/app/member-payment-format";
import { buildExpenseSummary, type ExpenseSummaryOverview, type SummarySettlement } from "@/lib/domain/expense-summary";
import { expenseSummaryCopy, type ExpenseSummaryCopy } from "@/lib/expense-copy";
import type { Locale } from "@/lib/i18n";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import styles from "./trip-expense-summary.module.css";

type SummaryProps = { overview: ExpenseSummaryOverview; locale: Locale };

function money(amountMinor: number, currency: string, locale: Locale): string {
  return formatPaymentMoney(amountMinor, currency, locale);
}

function balanceLabel(netMinor: number, copy: ExpenseSummaryCopy): string {
  return netMinor > 0 ? copy.receive : netMinor < 0 ? copy.owe : copy.balanced;
}

function balanceClass(netMinor: number): string {
  return netMinor > 0 ? styles.positive : netMinor < 0 ? styles.negative : styles.neutral;
}

function MetricHelp({ label, help, helpLabel }: { label: string; help: string; helpLabel: string }) {
  return <details className={styles.metricHelp}>
    <summary aria-label={`${label}: ${helpLabel}`}><span>{label}</span><span className={styles.question} aria-hidden="true">?</span></summary>
    <p className={styles.metricExplanation}>{help}</p>
  </details>;
}

function Settlements({ rows, locale, copy, record, memberId, busy }: { rows: readonly SummarySettlement[]; locale: Locale; copy: ExpenseSummaryCopy;
  record?: (suggestion?: SummarySettlement) => void; memberId?: string; busy?: boolean }) {
  return <ul className={styles.settlements}>{rows.map((settlement) => <li key={`${settlement.currency}:${settlement.fromMemberId}:${settlement.toMemberId}`}>
    <span className={styles.names}>{settlement.fromMemberName} <span className={styles.transfer}>{copy.transfer}</span> {settlement.toMemberName}</span>
    <div className={styles.settlementAction}><strong className={styles.amount}>{money(settlement.amountMinor, settlement.currency, locale)} <small>{settlement.currency}</small></strong>
      {record && settlement.fromMemberId === memberId && <button type="button" className="mini-button" disabled={busy} onClick={() => record(settlement)}>{memberPaymentMessages(locale).record}</button>}</div>
  </li>)}</ul>;
}

export function TripExpenseSummary({ overview, locale, recordRepayment, busy }: SummaryProps & {
  recordRepayment?: (suggestion?: SummarySettlement) => void; busy?: boolean;
}) {
  const copy = expenseSummaryCopy(locale);
  const summary = buildExpenseSummary(overview);
  const hasReassignedRepayments = (overview.memberPayments ?? []).some((payment) => payment.status === "posted" && (
    (payment.accountingFromMemberId === overview.session.memberId && payment.fromMemberId !== undefined && payment.fromMemberId !== payment.accountingFromMemberId)
    || (payment.accountingToMemberId === overview.session.memberId && payment.toMemberId !== undefined && payment.toMemberId !== payment.accountingToMemberId)
  ));
  return <section className={styles.summary} aria-label={copy.title}>
    <header className={styles.header}><h2>{copy.title}</h2><p className={styles.hint}>{copy.scope}</p></header>
    <div className={styles.currencies}>{summary.personal.map((balance) => <article className={styles.currencyCard} key={balance.currency} aria-label={`${copy.title} · ${balance.currency}`}>
      <span className={styles.currency}>{balance.currency}</span>
      <div className={styles.metrics}>
        <dl className={styles.primary}><dt><MetricHelp label={copy.myShare} help={copy.myShareHelp} helpLabel={copy.helpLabel} /></dt><dd data-zero={balance.shareMinor === 0}>{money(balance.shareMinor, balance.currency, locale)}</dd></dl>
        <div className={styles.secondary}>
          <dl><dt><MetricHelp label={copy.paid} help={copy.paidHelp} helpLabel={copy.helpLabel} /></dt><dd data-zero={balance.paidMinor === 0}>{money(balance.paidMinor, balance.currency, locale)}</dd></dl>
          <dl><dt><MetricHelp label={balanceLabel(balance.netMinor, copy)} help={copy.balanceHelp} helpLabel={copy.helpLabel} /></dt><dd className={balanceClass(balance.netMinor)}>{money(Math.abs(balance.netMinor), balance.currency, locale)}</dd></dl>
        </div>
      </div>
    </article>)}</div>
    {summary.personalRepayments.length > 0 && <div>{summary.personalRepayments.map((payment) => <p className={styles.hint} key={payment.currency}>
      {payment.currency} · {memberPaymentMessages(locale).sent}: {money(payment.sentMinor, payment.currency, locale)} · {memberPaymentMessages(locale).received}: {money(payment.receivedMinor, payment.currency, locale)}
    </p>)}{hasReassignedRepayments && <p className={styles.hint}>{memberPaymentMessages(locale).reassignedTotals}</p>}</div>}
    <section className={styles.settlementSection} aria-label={copy.personalSettlements}>
      <div className={styles.settlementHeading}><h3>{copy.personalSettlements}</h3>{recordRepayment && <button type="button" className="primary-button fit-button" disabled={busy} onClick={() => recordRepayment()}>{memberPaymentMessages(locale).record}</button>}</div>
      {summary.personalSettlements.length ? <Settlements rows={summary.personalSettlements} locale={locale} copy={copy} record={recordRepayment} memberId={overview.session.memberId} busy={busy}/> : <p className={styles.hint}>{copy.noPersonalSettlements}</p>}
      <p className={styles.hint}>{copy.settlementHint}</p>
    </section>
    {summary.visibleTripTotals && <details className={styles.owner}>
      <summary>{copy.ownerDetails}</summary>
      <p className={styles.hint}>{copy.ownerScope}</p>
      {summary.visibleTripTotals.length ? <dl className={styles.ownerTotals}>{summary.visibleTripTotals.map((total) => <div className={styles.total} key={total.currency}>
        <dt>{copy.visibleTotal} · {total.currency}</dt><dd>{money(total.amountMinor, total.currency, locale)}</dd>
      </div>)}</dl> : <p className={styles.hint}>{copy.noExpenses}</p>}
      <h3>{copy.allSettlements}</h3>
      {summary.ownerSettlements?.length ? <Settlements rows={summary.ownerSettlements} locale={locale} copy={copy}/> : <p className={styles.hint}>{copy.noSettlements}</p>}
      <p className={styles.hint}>{copy.settlementHint}</p>
    </details>}
  </section>;
}

export function PersonalExpenseWidget({ overview, locale, openExpenses, addExpense }: SummaryProps & {
  openExpenses: () => void;
  addExpense?: () => void;
}) {
  const copy = expenseSummaryCopy(locale);
  const summary = buildExpenseSummary(overview);
  return <section className={styles.widget} aria-label={copy.title}>
    <h3>{copy.title}</h3><p className={styles.hint}>{copy.scope}</p>
    <div className={styles.widgetFigures}>{summary.personal.map((balance) => <div className={styles.widgetFigure} key={balance.currency}>
      <span className={styles.currency}>{balance.currency}</span>
      <dl className={styles.widgetMetrics}>
        <div><dt><MetricHelp label={copy.myShare} help={copy.myShareHelp} helpLabel={copy.helpLabel} /></dt><dd className={styles.widgetAmount} data-zero={balance.shareMinor === 0}>{money(balance.shareMinor, balance.currency, locale)}</dd></div>
        <div><dt><MetricHelp label={copy.paid} help={copy.paidHelp} helpLabel={copy.helpLabel} /></dt><dd>{money(balance.paidMinor, balance.currency, locale)}</dd></div>
        <div><dt><MetricHelp label={balanceLabel(balance.netMinor, copy)} help={copy.balanceHelp} helpLabel={copy.helpLabel} /></dt><dd className={balanceClass(balance.netMinor)}>{money(Math.abs(balance.netMinor), balance.currency, locale)}</dd></div>
      </dl>
    </div>)}</div>
    <div className={styles.widgetActions}><button data-feedback-action="navigate" type="button" onClick={openExpenses}>{copy.viewExpenses}</button>{addExpense && <button data-feedback-action="expense_open" type="button" onClick={addExpense}>{copy.addExpense}</button>}</div>
  </section>;
}
