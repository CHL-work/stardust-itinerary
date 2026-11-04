"use client";

import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { matchesTripName, type TripDeletionPreview } from "@/lib/app/trip-deletion-contract";
import { tripDeletionMessages } from "@/lib/app/trip-deletion-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";
import "./member-management-controls.css";

export function TripDeletionCard({ locale, busy, open }: { locale: Locale; busy: boolean; open: () => void }) {
  const copy = tripDeletionMessages(locale);
  return <article className="settings-card trip-deletion-card">
    <h2>{copy.cardTitle}</h2><p>{copy.cardDescription}</p>
    <button type="button" data-feedback-action="dialog_open" className="ghost-button fit-button danger-button" disabled={busy} onClick={open}><Trash2 size={16} aria-hidden="true" /> {copy.cardAction}</button>
  </article>;
}

const othersText = (count: number, copy: ReturnType<typeof tripDeletionMessages>) => count === 0
  ? copy.othersNone : count === 1 ? copy.othersOne : formatMessage(copy.othersMany, { count });

export function TripDeletionReview({ preview, locale, busy, submit, cancel, createTrip }: {
  preview: TripDeletionPreview; locale: Locale; busy: boolean;
  submit: (confirmationName: string) => void; cancel: () => void; createTrip: () => void;
}) {
  const copy = tripDeletionMessages(locale);
  const [typed, setTyped] = useState("");
  const counts = ([["members", preview.counts.otherMembers], ["events", preview.counts.events], ["expenses", preview.counts.expenses],
    ["repayments", preview.counts.repayments], ["pendingRequests", preview.counts.pendingRequests]] as const);
  if (preview.blockedReason === "last_trip") {
    return <div className="member-removal-review">
      <p className="member-removal-warning" role="alert">{copy.lastTrip}</p>
      <div className="dialog-actions">
        <button type="button" data-feedback-action="dialog_close" className="ghost-button" autoFocus onClick={cancel}>{copy.close}</button>
        <button type="button" className="primary-button fit-button" onClick={createTrip}>{copy.createTrip}</button>
      </div>
    </div>;
  }
  const matches = matchesTripName(typed, preview.trip.name);
  return <form data-feedback-action="settings_save" className="member-removal-review trip-deletion-review" onSubmit={(event: FormEvent) => { event.preventDefault(); if (matches && !busy) submit(typed); }}>
    <p className="member-removal-warning">{formatMessage(copy.everyone, { name: preview.trip.name })} {othersText(preview.counts.otherMembers, copy)}</p>
    <dl className="member-removal-counts">{counts.map(([key, count]) => <div key={key}><dt>{copy[key]}</dt><dd>{count}</dd></div>)}</dl>
    <p>{copy.money}</p>
    <p>{copy.limits}</p>
    {preview.nextTripName ? <p>{formatMessage(copy.nextTrip, { name: preview.nextTripName })}</p> : null}
    <label className="trip-deletion-confirm">{formatMessage(copy.confirmLabel, { name: preview.trip.name })}
      <input type="text" value={typed} disabled={busy} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} onChange={(event) => setTyped(event.target.value)} />
    </label>
    <div className="dialog-actions">
      <button type="button" data-feedback-action="dialog_close" className="ghost-button" autoFocus disabled={busy} onClick={cancel}>{copy.close}</button>
      <button type="submit" className="primary-button fit-button danger-button" disabled={busy || !matches}>{busy ? copy.deleting : copy.confirmAction}</button>
    </div>
  </form>;
}
