import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import { calendarImportMessages } from "@/lib/calendar/import-i18n";
import type { CalendarImportInput, CalendarImportPreview, CalendarImportResult } from "@/lib/calendar/import-contracts";
import type { CalendarLocationSearchResult } from "@/lib/calendar/location-search-types";
import type { Locale } from "@/lib/i18n";
import styles from "./calendar-import.module.css";

export type CalendarImportDraft = { visibility: "private" | "trip"; viewerMemberIds: string[];
  itemType: "activity" | "meal" | "lodging" | "note"; locationName: string; mapUrl: string; aiReceiptToken?: string };
type Member = { id: string; displayName: string; status: string };
type LocationSuggestion = CalendarLocationSearchResult;
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function calendarImportFailure(failure: unknown, fallback: "preview" | "save" | "stale"): string {
  const code = failure && typeof failure === "object" && "code" in failure && typeof failure.code === "string" ? failure.code : failure instanceof Error ? failure.message : null;
  return code === "CALENDAR_IMPORT_RECONNECT" ? "reconnect" : code === "CALENDAR_IMPORT_STALE" ? "stale" : fallback;
}

export function calendarImportPayload(preview: CalendarImportPreview, draft: CalendarImportDraft): CalendarImportInput {
  return { previewToken: preview.previewToken, visibility: draft.visibility, viewerMemberIds: draft.visibility === "private" ? [...draft.viewerMemberIds] : [],
    itemType: draft.itemType, locationName: draft.locationName.trim() || null, mapUrl: draft.mapUrl.trim() || null,
    ...(draft.aiReceiptToken ? { aiReceiptToken: draft.aiReceiptToken } : {}) };
}

export function CalendarImportForm({ preview, draft, members, memberId, locale, timeZone, busy, locked, error, change, submit, close, search, refreshPreview }: {
  preview: CalendarImportPreview; draft: CalendarImportDraft; members: readonly Member[]; memberId: string; locale: Locale; timeZone: string;
  busy: boolean; locked: boolean; error: string | null; change: (draft: CalendarImportDraft) => void; submit: (event: FormEvent) => void; close: () => void;
  search?: ReactNode;
  refreshPreview?: () => void;
}) {
  const copy = calendarImportMessages(locale);
  const source = preview.source;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: source.allDay ? "UTC" : timeZone,
    dateStyle: "medium", ...(source.allDay ? {} : { timeStyle: "short" as const }) }).format(new Date(source.allDay ? `${value}T00:00:00Z` : value));
  const lastDate = source.endDateExclusive ? new Date(Date.parse(`${source.endDateExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : null;
  return <form className={styles.form} onSubmit={submit}>
    <div className={styles.source}><h3>{source.title}</h3><p>{source.allDay && source.startDate && lastDate
      ? `${copy.allDay} · ${date(source.startDate)} — ${date(lastDate)}` : `${date(source.startsAt)} — ${date(source.endsAt)}`}</p><p className={styles.hint}>{copy.source}</p></div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <fieldset disabled={busy || locked}>
      <label>{copy.type}<select value={draft.itemType} onChange={(event) => change({ ...draft, itemType: event.target.value as CalendarImportDraft["itemType"] })}>{(["activity", "meal", "lodging", "note"] as const).map((type) => <option key={type} value={type}>{copy[type]}</option>)}</select></label>
      <label>{copy.location}<input maxLength={300} value={draft.locationName} onChange={(event) => change({ ...draft, locationName: event.target.value })} /></label>
      <label>{copy.map}<input type="url" maxLength={2000} value={draft.mapUrl} onChange={(event) => change({ ...draft, mapUrl: event.target.value })} /></label>
      <label className={styles.check}><input type="checkbox" checked={draft.visibility === "private"} onChange={(event) => change({ ...draft, visibility: event.target.checked ? "private" : "trip", viewerMemberIds: [] })} /><span>{copy.private}</span></label>
      <p className={styles.hint}>{copy.privateHint}</p>
      {draft.visibility === "private" ? <fieldset><legend>{copy.viewers}</legend>{members.filter((member) => member.id !== memberId && ["active", "invited"].includes(member.status)).map((member) => <label className={styles.check} key={member.id}>
        <input type="checkbox" checked={draft.viewerMemberIds.includes(member.id)} onChange={(event) => change({ ...draft, viewerMemberIds: event.target.checked ? [...draft.viewerMemberIds, member.id] : draft.viewerMemberIds.filter((id) => id !== member.id) })} /><span>{member.displayName}</span>
      </label>)}</fieldset> : null}
    </fieldset>
    {!locked ? search : null}
    {draft.aiReceiptToken ? <p className={styles.hint}>{copy.aiReview}</p> : null}
    <div className={styles.actions}>{refreshPreview ? <button type="button" className="primary-button fit-button" disabled={busy} onClick={refreshPreview}>{busy ? copy.loading : copy.refreshPreview}</button>
      : <button type="submit" className="primary-button fit-button" disabled={busy}>{busy ? copy.saving : locked ? copy.retry : copy.save}</button>}<button type="button" className="ghost-button" disabled={busy} onClick={close}>{copy.cancel}</button></div>
  </form>;
}

export function CalendarImportDialog({ tripId, eventId, memberId, members, locale, timeZone, request, complete, close, onBusyChange }: {
  tripId: string; eventId: string; memberId: string; members: readonly Member[]; locale: Locale; timeZone: string;
  request: Request; complete: (result: CalendarImportResult) => void; close: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const copy = calendarImportMessages(locale);
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [draft, setDraft] = useState<CalendarImportDraft>({ visibility: "private", viewerMemberIds: [], itemType: "activity", locationName: "", mapUrl: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [locked, setLocked] = useState(false);
  const saveInFlight = useRef(false); const attempt = useRef<CalendarImportInput | null>(null);
  const active = useRef(true); const searchGeneration = useRef(0);
  const [subject, setSubject] = useState(""); const [consent, setConsent] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false); const [searchFailed, setSearchFailed] = useState(false);
  const [suggestion, setSuggestion] = useState<LocationSuggestion | null>(null);
  const searchAttempt = useRef<{ subject: string; requestId: string } | null>(null);
  useEffect(() => {
    active.current = true; let current = true;
    void request<CalendarImportPreview>(`/api/trips/${tripId}/calendar/import/preview`, { method: "POST", body: JSON.stringify({ eventId }) })
      .then((value) => { if (current) { setPreview(value); setDraft((old) => ({ ...old, locationName: value.source.location ?? "" })); } })
      .catch((failure) => { if (current) setError(calendarImportFailure(failure, "preview")); });
    return () => { current = false; active.current = false; searchGeneration.current += 1; };
  }, [tripId, eventId, request]);
  const errorMessage = error === "reconnect" ? copy.reconnect : error === "stale" ? copy.stale : error === "preview" ? copy.failed : error === "map" ? copy.invalidMap : error ? copy.saveFailed : null;

  const refreshPreview = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true; setBusy(true); onBusyChange?.(true);
    try {
      const value = await request<CalendarImportPreview>(`/api/trips/${tripId}/calendar/import/preview`, { method: "POST", body: JSON.stringify({ eventId }) });
      if (active.current) { setPreview(value); attempt.current = null; setLocked(false); setError(null); }
    } catch (failure) { if (active.current) setError(calendarImportFailure(failure, "stale")); }
    finally { saveInFlight.current = false; if (active.current) { setBusy(false); onBusyChange?.(false); } }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || preview.existing || saveInFlight.current || error === "stale") return;
    if (draft.mapUrl.trim() && !isTrustedGoogleMapsUrl(draft.mapUrl.trim())) { setError("map"); return; }
    attempt.current ??= calendarImportPayload(preview, draft);
    searchGeneration.current += 1;
    saveInFlight.current = true; setBusy(true); onBusyChange?.(true); setLocked(true); setError(null);
    try {
      const result = await request<CalendarImportResult>(`/api/trips/${tripId}/calendar/import`, { method: "POST", body: JSON.stringify(attempt.current) });
      if (active.current) complete(result);
    } catch (failure) { if (active.current) setError(calendarImportFailure(failure, "save")); }
    finally { saveInFlight.current = false; if (active.current) { setBusy(false); onBusyChange?.(false); } }
  };

  const findPlace = async () => {
    const approvedSubject = subject.trim();
    if (approvedSubject.length < 2 || !consent || searchBusy || busy || locked) return;
    const generation = ++searchGeneration.current;
    if (searchAttempt.current?.subject !== approvedSubject) searchAttempt.current = { subject: approvedSubject, requestId: crypto.randomUUID() };
    setSearchBusy(true); setSearchFailed(false); setSuggestion(null);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 100_000);
    try {
      const requestId = searchAttempt.current.requestId;
      let result = await request<LocationSuggestion>(`/api/trips/${tripId}/calendar/location-search`, {
        method: "POST", signal: controller.signal, body: JSON.stringify({ subject: approvedSubject, consent: true, locale, requestId }),
      });
      while (result.status === "running" && active.current && searchGeneration.current === generation && !controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (!active.current || searchGeneration.current !== generation || controller.signal.aborted) break;
        result = await request<LocationSuggestion>(`/api/trips/${tripId}/calendar/location-search?requestId=${encodeURIComponent(requestId)}`, { signal: controller.signal });
      }
      if (active.current && searchGeneration.current === generation) {
        const valid = result.requestId === requestId && result.status === "found" && result.locationName && result.mapUrl && isTrustedGoogleMapsUrl(result.mapUrl) && result.aiReceiptToken;
        setSuggestion(valid ? result : null); setSearchFailed(!valid);
      }
    } catch { if (active.current && searchGeneration.current === generation) setSearchFailed(true); }
    finally { clearTimeout(timer); if (active.current && searchGeneration.current === generation) setSearchBusy(false); }
  };

  if (!preview) return <div>{errorMessage ? <p className={styles.error} role="alert">{errorMessage}</p> : <p role="status">{copy.loading}</p>}<button type="button" className="ghost-button" onClick={close}>{copy.cancel}</button></div>;
  if (preview.existing) return <div><p>{preview.existing.status === "rejected" ? copy.rejected : preview.existing.status === "pending" ? copy.pending : preview.existing.status === "approved" ? copy.approved : copy.invalidated}</p><p className={styles.hint}>{copy.existing}</p><button type="button" className="ghost-button" onClick={close}>{copy.cancel}</button></div>;
  const search = <details><summary>{copy.find}</summary><p className={styles.hint}>{copy.searchHelp}</p>
    <label>{copy.publicSubject}<input value={subject} maxLength={140} disabled={busy} onChange={(event) => {
      searchGeneration.current += 1; setSubject(event.target.value); setConsent(false); setSuggestion(null); setSearchFailed(false); setSearchBusy(false);
    }} /></label>
    <label className={styles.check}><input type="checkbox" disabled={busy} checked={consent} onChange={(event) => { setConsent(event.target.checked); if (!event.target.checked) { searchGeneration.current += 1; setSuggestion(null); setSearchBusy(false); } }} /><span>{copy.consent}</span></label>
    <button type="button" className="mini-button" disabled={subject.trim().length < 2 || !consent || searchBusy || busy} onClick={() => void findPlace()}>{searchBusy ? copy.finding : copy.find}</button>
    {searchBusy ? <p className={styles.hint} role="status">{copy.finding}</p> : null}
    {searchFailed ? <p className={styles.hint} role="status">{copy.unavailable}</p> : null}
    {suggestion ? <div className={styles.suggestion}><strong>{suggestion.locationName}</strong><p><a href={suggestion.mapUrl!} target="_blank" rel="noreferrer">{copy.map}</a></p><ul>{suggestion.sources.filter((source) => /^https:\/\//u.test(source.url)).map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul><button type="button" className="mini-button" disabled={busy} onClick={() => setDraft((old) => ({ ...old, locationName: suggestion.locationName!, mapUrl: suggestion.mapUrl!, aiReceiptToken: suggestion.aiReceiptToken! }))}>{copy.use}</button></div> : null}
  </details>;
  return <CalendarImportForm preview={preview} draft={draft} members={members} memberId={memberId} locale={locale} timeZone={timeZone}
    busy={busy} locked={locked} error={errorMessage} change={(value) => { if (!saveInFlight.current && !locked) setDraft(value); }} submit={submit}
    close={() => { if (!saveInFlight.current) close(); }} search={search} refreshPreview={error === "stale" ? () => void refreshPreview() : undefined} />;
}
