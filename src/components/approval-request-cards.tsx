"use client";

import { CalendarDays, Check, Clock3, Lock, MapPin, ReceiptText, X } from "lucide-react";
import { EventTypeIcon } from "@/components/event-type-icon";
import { flightMessages } from "@/lib/app/flight-i18n";
import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import { approvalMessages, type ApprovalMessages } from "@/lib/app/approval-i18n";
import type { ApprovalEventDisplay, ApprovalExpenseDisplay } from "@/lib/app/approval-presentation-types";
import type { ApprovalRequest } from "@/lib/app/types";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import { formatMessage, type Locale, type Messages } from "@/lib/i18n";
import "./approval-request-cards.css";

function displayLocale(locale: Locale) { return locale === "zh-HK-lihkg" ? "zh-HK" : locale; }
/** On the event place's clock, with no zone name such as "GMT+9" (D-109). */
function dateTime(value: string | null, locale: Locale, timeZone: string, unknown: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return unknown;
  return new Intl.DateTimeFormat(displayLocale(locale), { timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function dayLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(displayLocale(locale), { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", weekday: "short" }).format(new Date(`${value}T00:00:00Z`));
}
export function approvalMoney(amountMinor: number, currency: string, locale: Locale) {
  // Match the canonical ledger's supported minor-unit convention.
  return new Intl.NumberFormat(displayLocale(locale), { style: "currency", currency }).format(amountMinor / (["JPY", "KRW"].includes(currency) ? 1 : 100));
}
function mapLink(name: string, stored: string | null) {
  if (stored && isTrustedGoogleMapsUrl(stored)) {
    const url = new URL(stored);
    if (!url.username && !url.password) return url.href;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
}
function labelOperation(operation: string, copy: ApprovalMessages): string {
  return operation === "create" ? copy.create : operation === "update" ? copy.update : operation === "cancel" ? copy.cancel : operation === "restore" ? copy.restore : operation === "void" ? copy.void : copy.change;
}
function labelStatus(status: ApprovalRequest["status"], messages: Messages) {
  return status === "pending" ? messages.requestStatusPending : status === "rejected" ? messages.requestStatusRejected : status === "approved" ? messages.requestStatusApproved : messages.requestStatusSuperseded;
}
function labelEventType(type: ApprovalEventDisplay["itemType"], messages: Messages) {
  return type === "meal" ? messages.eventTypeMeal : type === "lodging" ? messages.eventTypeLodging : type === "transport" ? messages.eventTypeTransport : type === "note" ? messages.eventTypeNote : messages.eventTypeActivity;
}

export function ApprovalExpenseSummary({ expense, locale, timeZone, copy, messages, pending, linked = false }: {
  expense: ApprovalExpenseDisplay; locale: Locale; timeZone: string; copy: ApprovalMessages; messages: Messages; pending: boolean; linked?: boolean;
}) {
  return <section className="approval-expense-summary" aria-label={linked ? copy.linkedExpense : copy.expense}>
    <div className="approval-expense-heading"><div><small><ReceiptText size={15} aria-hidden="true" />{linked ? copy.linkedExpense : copy.expense}</small><h4>{expense.description}</h4></div>
      <div className="approval-expense-total"><small>{copy.total}</small><strong>{approvalMoney(expense.amountMinor, expense.currency, locale)}</strong></div></div>
    <p><strong>{copy.payer}:</strong> {expense.payerName ?? copy.memberUnavailable}</p>
    <p><Clock3 size={14} aria-hidden="true" />{dateTime(expense.occurredAt, locale, timeZone, copy.untimed)}</p>
    {expense.hasLinkedEvent ? <p>{copy.linkedEvent}</p> : null}
    <dl className="approval-expense-shares" aria-label={copy.shares}>{expense.splits.map((split, index) => <div key={index}><dt>{split.memberName ?? copy.memberUnavailable}</dt><dd>{approvalMoney(split.shareMinor, expense.currency, locale)}</dd></div>)}</dl>
    {pending ? <p className="approval-muted">{messages.pendingExpenseNotIncluded}</p> : null}
  </section>;
}

function ApprovalEventSummary({ event, locale, timeZone, copy, messages, pending }: {
  event: ApprovalEventDisplay; locale: Locale; timeZone: string; copy: ApprovalMessages; messages: Messages; pending: boolean;
}) {
  const flight = resolveEventTimeZones({ ...event,
    flightPresentation: event.flightPresentation ?? (event.isFlight ? { isFlight: true } : undefined) }, timeZone);
  const endpoints = event.itemType === "transport" ? [
    event.departureLocationName ? { kind: "departure" as const, label: copy.departure, name: event.departureLocationName, map: event.departureMapUrl, at: event.startsAt, zone: flight.departureTimeZone } : null,
    event.destinationLocationName ? { kind: "arrival" as const, label: copy.arrival, name: event.destinationLocationName, map: event.destinationMapUrl, at: event.endsAt, zone: flight.arrivalTimeZone } : null,
  ].filter((endpoint) => endpoint !== null) : [];
  return <>
    <div className="approval-event-badges"><span className="status-tag"><EventTypeIcon itemType={event.itemType} isFlight={flight.isFlight} size={16} />{flight.isFlight ? flightMessages(locale).fields : labelEventType(event.itemType, messages)}</span>
      {event.visibility === "private" ? <span className="status-tag"><Lock size={12} aria-hidden="true" />{messages.privateEvent}</span> : <span className="approval-muted">{copy.tripVisible}</span>}
      {event.isLocked ? <span className="status-tag"><Lock size={12} aria-hidden="true" />{copy.locked}</span> : null}</div>
    {event.dayDate ? <p className="approval-event-date"><CalendarDays size={16} aria-hidden="true" /><time dateTime={event.dayDate}>{dayLabel(event.dayDate, locale)}</time></p> : null}
    {endpoints.length ? <div className="approval-transport-points">{endpoints.map((endpoint) => <div className="approval-transport-point" key={endpoint.label}>
      <div><EventTypeIcon itemType={event.itemType} isFlight={flight.isFlight} endpoint={endpoint.kind} size={17} /><strong>{endpoint.label}</strong><time dateTime={endpoint.at ?? undefined}>{dateTime(endpoint.at, locale, endpoint.zone, copy.untimed)}</time></div>
      <a href={mapLink(endpoint.name, endpoint.map)} target="_blank" rel="noopener noreferrer"><MapPin size={15} aria-hidden="true" />{endpoint.name}</a>
    </div>)}</div> : <>
      <div className="approval-event-times"><p><strong>{copy.starts}</strong><time>{dateTime(event.startsAt, locale, flight.departureTimeZone, copy.untimed)}</time></p>
        {event.endsAt ? <p><strong>{copy.ends}</strong><time>{dateTime(event.endsAt, locale, flight.arrivalTimeZone, copy.untimed)}</time></p> : null}</div>
      {event.locationName ? <a className="approval-event-location" href={mapLink(event.locationName, event.mapUrl)} target="_blank" rel="noopener noreferrer"><MapPin size={16} aria-hidden="true" />{event.locationName}</a> : null}
    </>}
    {event.visibility === "private" ? <p className="approval-event-audience"><strong>{copy.audience}:</strong> {event.audienceNames.map((name) => name ?? copy.memberUnavailable).join(" · ")}</p> : null}
    {event.notes ? <div className="approval-event-notes"><strong>{copy.notes}</strong><p>{event.notes}</p></div> : null}
    {event.linkedExpense ? <ApprovalExpenseSummary expense={event.linkedExpense} locale={locale} timeZone={timeZone} copy={copy} messages={messages} pending={pending} linked /> : null}
  </>;
}

export function ApprovalRequestCards({ requests, locale, messages, timeZone = "Asia/Tokyo", busy, review, readOnly = false }: {
  requests: ApprovalRequest[]; locale: Locale; messages: Messages; timeZone?: string; busy: boolean;
  review: (requestId: string, decision: "approve" | "reject", proposalRevision: number) => void;
  readOnly?: boolean;
}) {
  if (!requests.length) return <p className="empty-state">{messages.noApprovalHistory}</p>;
  const copy = approvalMessages(locale);
  return <div className="approval-review-list">{requests.map((request) => {
    const display = request.display ?? { kind: "unavailable" as const };
    const title = display.kind === "itinerary" ? display.event.title : display.kind === "expense" ? display.expense.description : request.entityType === "expense" ? copy.expense : copy.event;
    // Capture the version actually rendered. A background replacement or edit
    // must not authorize approving a newer, unseen proposal at click time.
    const requestId = request.id;
    const proposalRevision = typeof request.proposalRevision === "number" && Number.isSafeInteger(request.proposalRevision) && request.proposalRevision > 0 ? request.proposalRevision : null;
    const blocked = Boolean(request.reviewBlockedReason);
    const canApprove = !blocked && proposalRevision !== null && display.kind !== "unavailable" && (request.status === "pending" || request.status === "rejected");
    const canReject = !blocked && proposalRevision !== null && request.status === "pending";
    const reviewRendered = (decision: "approve" | "reject") => { if (proposalRevision !== null) review(requestId, decision, proposalRevision); };
    const source = request.source === "ai" ? copy.ai : request.source === "owner" ? copy.owner : request.source === "member" ? copy.member : request.source === "import" ? copy.import : copy.change;
    return <article className={`approval-review-card approval-review-${request.status}`} key={request.id}>
      <header><div className="approval-review-status"><span className={`status-tag status-${request.status}`}>{labelStatus(request.status, messages)}</span><span>{labelOperation(request.operation, copy)} · {request.entityType === "expense" ? copy.expense : copy.event}</span></div><h3>{title}</h3></header>
      {display.kind === "itinerary" ? <ApprovalEventSummary event={display.event} locale={locale} timeZone={timeZone} copy={copy} messages={messages} pending={request.status !== "approved"} />
        : display.kind === "expense" ? <ApprovalExpenseSummary expense={display.expense} locale={locale} timeZone={timeZone} copy={copy} messages={messages} pending={request.status !== "approved"} />
          : <p className="approval-review-warning">{copy.unavailable}</p>}
      {blocked ? <p className="approval-review-warning">{copy.memberRemoved}</p> : null}
      <div className="approval-review-meta"><p>{request.requestedByName} · {copy.source}: {source}</p>
        <p>{copy.submitted}: <time dateTime={request.createdAt}>{dateTime(request.createdAt, locale, timeZone, copy.untimed)}</time></p>
        <p>{copy.proposalVersion}: {proposalRevision ?? "—"}{request.baseRevision !== null ? ` · ${copy.baseRevision}: ${request.baseRevision}` : ""}</p>
        {request.reviewedAt ? <p>{formatMessage(messages.requestReviewedAt, { date: dateTime(request.reviewedAt, locale, timeZone, copy.untimed) })}</p> : null}
        {request.reason ? <p><strong>{copy.reason}:</strong> {request.reason}</p> : null}
        {request.reviewNote ? <p><strong>{copy.reviewNote}:</strong> {request.reviewNote}</p> : null}
        <p className="approval-muted">{copy.historical}</p></div>
      {!readOnly && (canApprove || canReject) ? <div className="dialog-actions">
        {canApprove ? <button data-feedback-action={request.entityType === "expense" ? "expense_approve" : "event_approve"} type="button" className="primary-button fit-button" disabled={busy} onClick={() => reviewRendered("approve")}><Check size={15} aria-hidden="true" />{request.status === "rejected" ? messages.reapproveRejectedRequest : messages.approveRequest}</button> : null}
        {canReject ? <button data-feedback-action={request.entityType === "expense" ? "expense_reject" : "event_reject"} type="button" className="ghost-button danger-button" disabled={busy} onClick={() => reviewRendered("reject")}><X size={15} aria-hidden="true" />{messages.rejectRequest}</button> : null}
      </div> : null}
    </article>;
  })}</div>;
}
