import { CalendarRange, Lock, Plus } from "lucide-react";
import { calendarEventCanImport, type PersonalCalendarPoint } from "@/lib/calendar/timeline";
import { calendarImportMessages } from "@/lib/calendar/import-i18n";
import type { Locale } from "@/lib/i18n";
import styles from "./calendar-import.module.css";

export function safeCalendarUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && ["calendar.google.com", "www.google.com", "google.com"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

export function CalendarTimelineCard({ point, locale, timeZone, canImport, busy, allowActionFallback = false, openImport }: {
  point: PersonalCalendarPoint; locale: Locale; timeZone: string; canImport: boolean; busy: boolean;
  allowActionFallback?: boolean; openImport: (eventId: string) => void;
}) {
  const copy = calendarImportMessages(locale);
  const event = point.event;
  const ownsActions = point.ownsActions || allowActionFallback;
  const url = safeCalendarUrl(event.htmlLink);
  const formatTime = (at: string) => new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  return <article className={`timeline-row ${styles.calendarRow}`} data-calendar-event-id={event.id}>
    <div className="timeline-time"><time>{point.allDay ? copy.allDay : point.continued ? copy.continues : point.at ? new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(point.at)) : "—"}</time></div>
    <div className="timeline-marker"><span><CalendarRange size={13} aria-hidden="true" /></span></div>
    <div className="timeline-content"><span className={styles.personal}><Lock size={12} aria-hidden="true" /> {copy.personal}</span><h3>{event.title}</h3>
      {event.location ? <p>{event.location}</p> : null}
      {!point.allDay && event.startsAt ? <p className={styles.hint}>{formatTime(event.startsAt)}{event.endsAt ? ` — ${formatTime(event.endsAt)}` : ""}</p> : null}
      {event.importState ? <p className={styles.hint}>{event.importState.status === "rejected" ? copy.rejected : event.importState.status === "pending" ? copy.pending : copy.invalidated}</p> : null}
    </div>
    {ownsActions ? <div className="row-actions card-actions">
      {canImport && calendarEventCanImport(event) ? <button type="button" className="mini-button" disabled={busy} onClick={() => openImport(event.id)}><Plus size={14} aria-hidden="true" /> {copy.add}</button> : null}
      {url ? <a className="mini-button" href={url} target="_blank" rel="noreferrer">{copy.open}</a> : null}
    </div> : null}
  </article>;
}
