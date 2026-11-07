import { useId, type FormEvent } from "react";
import { EventEditorFeedback } from "@/components/event-editor-feedback";
import type { MemberPayment } from "@/lib/app/member-payments";
import { currencyFactor } from "@/lib/app/event-expense-editor";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { formatPaymentMoney } from "@/lib/app/member-payment-format";
import { parseExpenseAmount } from "@/lib/app/expense-entry";
import { countLabel, formatMessage, type Locale } from "@/lib/i18n";
import styles from "./member-payment-controls.module.css";

export type PaymentDraft = { fromMemberId: string; toMemberId: string; amount: string; currency: string;
  occurredAt: string; note: string; confirmation: boolean;
  suggestion?: { fromMemberId: string; toMemberId: string; currency: string; amountMinor: number } };
export type PaymentAction = "approve" | "reject" | "void";
export type PaymentDecision = { payment: MemberPayment; action: PaymentAction; reason: string; confirmation: boolean };
type MemberOption = { id: string; displayName: string; status: string };
export const eligiblePaymentMember = (member: MemberOption) => member.status === "active" || member.status === "invited";

export function MemberPaymentForm({ draft, members, isOwner, locale, timeZone, busy, locked, error, change, submit, close }: {
  draft: PaymentDraft; members: readonly MemberOption[]; isOwner: boolean; locale: Locale; timeZone: string;
  busy: boolean; locked: boolean; error: string | null; change: (draft: PaymentDraft) => void;
  submit: (event: FormEvent) => void; close: () => void;
}) {
  const copy = memberPaymentMessages(locale); const identity = useId();
  const eligible = members.filter(eligiblePaymentMember);
  const exceedsSuggestion = draft.suggestion?.fromMemberId === draft.fromMemberId && draft.suggestion.toMemberId === draft.toMemberId
    && draft.suggestion.currency === draft.currency && (parseExpenseAmount(draft.amount, draft.currency) ?? 0) > draft.suggestion.amountMinor;
  return <form className={styles.form} onSubmit={submit}>
    <div className={styles.full}><EventEditorFeedback error={error} /></div>
    <p className={`${styles.full} ${styles.hint}`}>{copy.explanation}</p>
    <fieldset disabled={busy || locked}>
      <label>{copy.from}<select required disabled={!isOwner} value={draft.fromMemberId} onChange={(event) => change({ ...draft, fromMemberId: event.target.value, confirmation: false })}>
        {!eligible.some((member) => member.id === draft.fromMemberId) && <option value={draft.fromMemberId} disabled>{members.find((member) => member.id === draft.fromMemberId)?.displayName ?? "—"}</option>}
        {eligible.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
      </select></label>
      <label>{copy.to}<select required value={draft.toMemberId} onChange={(event) => change({ ...draft, toMemberId: event.target.value, confirmation: false })}>
        <option value="">{copy.recipient}</option>
        {draft.toMemberId && !eligible.some((member) => member.id === draft.toMemberId) && <option value={draft.toMemberId} disabled>{members.find((member) => member.id === draft.toMemberId)?.displayName ?? "—"}</option>}
        {eligible.filter((member) => member.id !== draft.fromMemberId).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
      </select></label>
      <label>{copy.amount}<input required type="number" inputMode="decimal" min={1 / currencyFactor(draft.currency)} step={1 / currencyFactor(draft.currency)} value={draft.amount} onChange={(event) => change({ ...draft, amount: event.target.value, confirmation: false })} /></label>
      <label>{copy.currency}<input required pattern="[A-Z]{3}" maxLength={3} value={draft.currency} onChange={(event) => change({ ...draft, currency: event.target.value.toUpperCase(), confirmation: false })} /></label>
      <label className={styles.full}>{formatMessage(copy.date, { timeZone })}<input required type="datetime-local" value={draft.occurredAt} onChange={(event) => change({ ...draft, occurredAt: event.target.value, confirmation: false })} /></label>
      <label className={styles.full}>{copy.note}<textarea rows={2} maxLength={1000} value={draft.note} onChange={(event) => change({ ...draft, note: event.target.value, confirmation: false })} /></label>
      <label className={`${styles.full} ${styles.confirmation}`} htmlFor={`${identity}-confirmed`}><input id={`${identity}-confirmed`} required type="checkbox" checked={draft.confirmation} onChange={(event) => change({ ...draft, confirmation: event.target.checked })} /><span>{copy.confirm}</span></label>
    </fieldset>
    <p className={`${styles.full} ${styles.hint}`}>{copy.partial} {copy.visibility}</p>
    {exceedsSuggestion && <p role="status" className={`${styles.full} ${styles.hint}`}>{copy.aboveSuggestion}</p>}
    <div className={`${styles.full} ${styles.actions}`}><button type="submit" className="primary-button fit-button" disabled={busy || !draft.confirmation}>{busy ? copy.saving : locked ? copy.retry : copy.record}</button><button type="button" className="ghost-button" disabled={busy} onClick={close}>{copy.cancel}</button></div>
  </form>;
}

function PaymentFacts({ payment, locale, timeZone }: { payment: MemberPayment; locale: Locale; timeZone: string }) {
  const copy = memberPaymentMessages(locale);
  return <><div className={styles.top}><div className={styles.names}><strong>{payment.fromMemberName}</strong> → <strong>{payment.toMemberName}</strong>
    <p className={styles.hint}>{new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(payment.occurredAt))}</p></div>
    <strong className={styles.amount}>{formatPaymentMoney(payment.amountMinor, payment.currency, locale)}<small>{payment.currency}</small></strong></div>
    {(payment.accountingFromMemberId !== payment.fromMemberId || payment.accountingToMemberId !== payment.toMemberId) && <p className={styles.hint}>{formatMessage(copy.accounting, { from: payment.accountingFromMemberName, to: payment.accountingToMemberName })}</p>}
  </>;
}

export function MemberPaymentDecisionForm({ decision, locale, timeZone, busy, locked, error, change, submit, close }: {
  decision: PaymentDecision; locale: Locale; timeZone: string; busy: boolean; locked: boolean; error: string | null;
  change: (value: PaymentDecision) => void; submit: (event: FormEvent) => void; close: () => void;
}) {
  const copy = memberPaymentMessages(locale);
  return <form className={styles.form} onSubmit={submit}>
    <div className={styles.full}><EventEditorFeedback error={error} /><PaymentFacts payment={decision.payment} locale={locale} timeZone={timeZone} /></div>
    <p className={`${styles.full} ${styles.hint}`}>{decision.action === "void" ? copy.voidHelp : copy.reviewHelp}</p>
    <fieldset disabled={busy || locked}>
      <label className={styles.full}>{copy.reason}<textarea required={decision.action !== "approve"} maxLength={500} value={decision.reason} onChange={(event) => change({ ...decision, reason: event.target.value, confirmation: false })} /></label>
      <label className={`${styles.full} ${styles.confirmation}`}><input required type="checkbox" checked={decision.confirmation} onChange={(event) => change({ ...decision, confirmation: event.target.checked })} /><span>{copy.actionConfirm}</span></label>
    </fieldset>
    <div className={`${styles.full} ${styles.actions}`}><button type="submit" className={decision.action === "approve" ? "primary-button fit-button" : "ghost-button danger-button"} disabled={busy || !decision.confirmation}>{busy ? copy.saving : locked ? copy.retry : copy[decision.action]}</button><button type="button" className="ghost-button" disabled={busy} onClick={close}>{copy.cancel}</button></div>
  </form>;
}

export function MemberPaymentCard({ payment, locale, timeZone, busy, isOwner, act }: {
  payment: MemberPayment; locale: Locale; timeZone: string; busy: boolean; isOwner: boolean;
  act: (payment: MemberPayment, action: PaymentAction) => void;
}) {
  const copy = memberPaymentMessages(locale);
  return <article className={styles.card} data-status={payment.status} aria-label={copy.repayment}>
      <p className={styles.kind}>{copy.repayment}</p>
      <PaymentFacts payment={payment} locale={locale} timeZone={timeZone} />
      <span className={styles.status}>{payment.status === "void" ? copy.voidStatus : copy[payment.status]}</span>
      {(payment.status === "pending" || payment.status === "rejected") && <p className={styles.hint}>{copy.pendingHelp}</p>}
      {payment.status === "void" && <p className={styles.hint}>{copy.voidedHelp}</p>}
      {payment.note && <details><summary>{copy.note}</summary><p className={styles.note}>{payment.note}</p></details>}
      <div className={styles.actions}>
        {isOwner && payment.canReview && (payment.status === "pending" || payment.status === "rejected") && <button type="button" className="mini-button" disabled={busy} onClick={() => act(payment, "approve")}>{copy.approve}</button>}
        {isOwner && payment.canReview && payment.status === "pending" && <button type="button" className="mini-button danger-button" disabled={busy} onClick={() => act(payment, "reject")}>{copy.reject}</button>}
        {payment.canVoid && payment.status !== "void" && <button type="button" className="mini-button danger-button" disabled={busy} onClick={() => act(payment, "void")}>{copy.void}</button>}
      </div>
    </article>;
}

export function MemberPaymentHistory({ payments, locale, timeZone, busy, isOwner, reviewOnly = false, act }: {
  payments: readonly MemberPayment[]; locale: Locale; timeZone: string; busy: boolean; isOwner: boolean;
  reviewOnly?: boolean; act: (payment: MemberPayment, action: PaymentAction) => void;
}) {
  const copy = memberPaymentMessages(locale);
  const rows = payments.filter((payment) => !reviewOnly || payment.status === "pending" || payment.status === "rejected")
    .slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const content = <div className={styles.rows}>{!rows.length ? <p className={styles.hint}>{reviewOnly ? copy.reviewEmpty : copy.empty}</p> : rows.map((payment) => <MemberPaymentCard key={payment.id} payment={payment} locale={locale} timeZone={timeZone} busy={busy} isOwner={isOwner} act={act} />)}</div>;
  return reviewOnly ? <section className={styles.history} aria-label={copy.reviewTitle}><h3>{copy.reviewTitle}</h3>{content}</section>
    : <details className={styles.history}><summary><strong>{copy.history}</strong><span className={styles.hint}>{countLabel(rows.length, copy.historyCountOne, copy.historyCount, { pending: rows.filter((payment) => payment.status === "pending").length })}</span></summary>{content}</details>;
}
