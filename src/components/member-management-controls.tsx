"use client";

import { useState, type FormEvent } from "react";
import { memberManagementMessages } from "@/lib/app/member-management-i18n";
import { buildMemberRemovalInput, canChooseMemberRole, type MemberRole, type RemovalChoices, type PaymentRemovalChoices } from "@/lib/app/member-management-client";
import type { MemberRemovalInput, MemberRemovalPreview } from "@/lib/app/member-removal";
import { formatMessage, type Locale } from "@/lib/i18n";
import "./member-management-controls.css";

export function MemberRoleControl({ member, locale, busy, save }: {
  member: { id: string; role: string; status: string; identityBound: boolean; currentRevision?: number };
  locale: Locale; busy: boolean; save: (role: MemberRole) => Promise<void>;
}) {
  const copy = memberManagementMessages(locale);
  const [role, setRole] = useState(member.role as MemberRole);
  const [confirmed, setConfirmed] = useState(false);
  const changed = role !== member.role;
  return <form data-feedback-action="member_change" className="member-role-control" onSubmit={(event: FormEvent) => {
    event.preventDefault();
    if (confirmed && changed && member.currentRevision && canChooseMemberRole(member, role) && !busy) void save(role);
  }}>
    <label>{copy.role}<select value={role} disabled={busy || !member.currentRevision} onChange={(event) => { setRole(event.target.value as MemberRole); setConfirmed(false); }}>
      {(["owner", "editor", "viewer"] as const).map((value) => <option key={value} value={value} disabled={value !== member.role && !canChooseMemberRole(member, value)}>{copy[value]}</option>)}
    </select></label>
    {changed ? <label className="member-confirmation"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>{copy.roleConfirmation}</span></label> : null}
    <button className="mini-button" disabled={busy || !changed || !confirmed || !member.currentRevision || !canChooseMemberRole(member, role)}>{copy.saveRole}</button>
  </form>;
}

function money(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { style: "currency", currency }).format(amount / (["JPY", "KRW"].includes(currency) ? 1 : 100));
}

export function MemberRemovalReview({ preview, locale, busy, submit, cancel }: {
  preview: MemberRemovalPreview; locale: Locale; busy: boolean;
  submit: (input: MemberRemovalInput) => Promise<void>; cancel: () => void;
}) {
  const copy = memberManagementMessages(locale);
  const [choices, setChoices] = useState<RemovalChoices>({});
  const [paymentChoices, setPaymentChoices] = useState<PaymentRemovalChoices>({});
  const [confirmed, setConfirmed] = useState(false);
  const input = buildMemberRemovalInput(preview, choices, confirmed, paymentChoices);
  const choose = (id: string, field: "replacementPayerMemberId" | "shareRecipientMemberId", value: string) => {
    setChoices((current) => ({ ...current, [id]: { ...current[id], [field]: value } })); setConfirmed(false);
  };
  const choosePayment = (id: string, field: "replacementAccountingFromMemberId" | "replacementAccountingToMemberId", value: string) => {
    setPaymentChoices((current) => ({ ...current, [id]: { ...current[id], [field]: value } })); setConfirmed(false);
  };
  return <form data-feedback-action="member_change" className="member-removal-review" onSubmit={(event: FormEvent) => { event.preventDefault(); if (input && !busy) void submit(input); }}>
    <p>{formatMessage(copy.warning, { name: preview.member.displayName })}</p><p>{copy.retained}</p>
    <dl className="member-removal-counts">{Object.entries(preview.counts).map(([key, count]) => <div key={key}><dt>{copy[key as keyof MemberRemovalPreview["counts"]]}</dt><dd>{count}</dd></div>)}</dl>
    {preview.counts.reusableInvites > 0 ? <p>{copy.inviteWarning}</p> : null}
    {preview.blockedReason === "last_bound_owner" ? <p className="member-removal-warning" role="alert">{copy.lastOwner}</p> : null}
    {preview.hiddenPrivateExpenseCount > 0 ? <p className="member-removal-warning" role="alert">{formatMessage(copy.hiddenExpenses, { count: preview.hiddenPrivateExpenseCount })}</p> : null}
    {preview.expenses.length ? <><p>{copy.financial}</p><div className="member-removal-expenses">{preview.expenses.map((expense) => <fieldset key={expense.id} disabled={busy}>
      <legend>{expense.description}</legend><p>{copy.total}: {money(expense.amountMinor, expense.currency, locale)} · {copy.share}: {money(expense.shareMinor, expense.currency, locale)}</p>
      {([["requiresPayerReplacement", "replacementPayerMemberId", "payerReplacement"], ["requiresShareRecipient", "shareRecipientMemberId", "shareRecipient"]] as const).map(([required, field, label]) => expense[required] ? <label key={field}>{copy[label]}<select required value={choices[expense.id]?.[field] ?? ""} onChange={(event) => choose(expense.id, field, event.target.value)}>
        <option value="">{copy.choose}</option>{expense.eligibleMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
      </select></label> : null)}
      {(expense.requiresPayerReplacement || expense.requiresShareRecipient) && !expense.eligibleMembers.length ? <p className="member-removal-warning">{copy.noEligible}</p> : null}
    </fieldset>)}</div></> : null}
    {preview.payments?.length ? <><p>{copy.paymentFinancial}</p><div className="member-removal-expenses member-removal-payments">{preview.payments.map((payment) => <fieldset key={payment.id} disabled={busy}>
      <legend>{money(payment.amountMinor, payment.currency, locale)}</legend>
      <p>{copy.paymentOriginal}: {payment.fromMemberName} → {payment.toMemberName}</p>
      <p>{copy.paymentAccounting}: {payment.accountingFromMemberName} → {payment.accountingToMemberName}</p>
      {([["requiresFromReplacement", "replacementAccountingFromMemberId", "paymentFromReplacement"], ["requiresToReplacement", "replacementAccountingToMemberId", "paymentToReplacement"]] as const).map(([required, field, label]) => payment[required] ? <label key={field}>{copy[label]}<select required value={paymentChoices[payment.id]?.[field] ?? ""} onChange={(event) => choosePayment(payment.id, field, event.target.value)}>
        <option value="">{copy.choosePaymentMember}</option>{payment.eligibleMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
      </select></label> : null)}
      {!payment.eligibleMembers.length ? <p className="member-removal-warning">{copy.noEligiblePayment}</p> : null}
    </fieldset>)}</div></> : null}
    {(preview.counts.pendingPayments ?? 0) > 0 ? <p className="member-removal-warning">{copy.pendingPaymentWarning}</p> : null}
    <label className="member-confirmation"><input type="checkbox" checked={confirmed} disabled={busy || (!preview.canRemove && !preview.canRemoveWithReassignment)} onChange={(event) => setConfirmed(event.target.checked)} /><span>{copy.confirmRemoval}</span></label>
    <div className="dialog-actions"><button type="button" className="ghost-button" disabled={busy} onClick={cancel}>{copy.cancel}</button><button type="submit" className="primary-button fit-button danger-button" disabled={busy || !input}>{busy ? copy.removing : copy.removeConfirm}</button></div>
  </form>;
}
