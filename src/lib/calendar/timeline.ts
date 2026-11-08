import { tripLocalDateKey } from "@/lib/app/day-view";
import { projectTimelinePoints, type TimelinePoint, type TimelineSource, type TimelineProjectionOptions } from "@/lib/app/timeline";

export type CalendarDateMetadata = { allDay: boolean; startDate: string | null; endDateExclusive: string | null };
export type PersonalCalendarEvent = {
  id: string; title: string; startsAt: string | null; endsAt: string | null; location: string | null; htmlLink: string | null;
  linkedItineraryItemId: string | null; allDay?: boolean; startDate?: string | null; endDateExclusive?: string | null;
  invalidTime?: boolean; importState?: { status: string; requestId?: string | null; itemId?: string | null } | null;
  timeZones?: { start?: string | null; end?: string | null } | null;
};
export type PersonalCalendarPoint = {
  key: string; event: PersonalCalendarEvent; date: string; at: string | null; allDay: boolean; continued: boolean; ownsActions: boolean;
};

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function calendarEventCanImport(event: PersonalCalendarEvent): boolean {
  return !event.linkedItineraryItemId && !event.importState && !event.invalidTime;
}

/** Proven active links are represented by normal app cards, never by another addable row. */
export function calendarEventIsRepresented(event: PersonalCalendarEvent): boolean {
  return Boolean(event.linkedItineraryItemId) || Boolean(event.importState && ["pending", "approved", "cancelled", "removed"].includes(event.importState.status));
}

/** Personal Calendar dates are half-open. Date-only values never pass through an instant/time-zone conversion. */
export function projectPersonalCalendarEvents(events: readonly PersonalCalendarEvent[], dates: readonly string[], timeZone: string): PersonalCalendarPoint[] {
  const days = [...new Set(dates.filter(validDate))].sort();
  const points: PersonalCalendarPoint[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id) || event.invalidTime || calendarEventIsRepresented(event)) continue;
    seen.add(event.id);
    let firstDate: string; let lastDate: string;
    if (event.allDay) {
      if (!validDate(event.startDate) || !validDate(event.endDateExclusive) || event.endDateExclusive <= event.startDate) continue;
      firstDate = event.startDate;
      lastDate = new Date(Date.parse(`${event.endDateExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    } else {
      const start = event.startsAt ? Date.parse(event.startsAt) : NaN;
      const end = event.endsAt ? Date.parse(event.endsAt) : null;
      if (!Number.isFinite(start) || (end !== null && (!Number.isFinite(end) || end <= start))) continue;
      firstDate = tripLocalDateKey(new Date(start), timeZone);
      lastDate = tripLocalDateKey(new Date(end === null ? start : end - 1), timeZone);
    }
    let ownsActions = true;
    for (const date of days) if (date >= firstDate && date <= lastDate) {
      points.push({ key: `calendar:${event.id}:${date}`, event, date, at: event.allDay ? null : event.startsAt,
        allDay: Boolean(event.allDay), continued: date > firstDate, ownsActions });
      ownsActions = false;
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay)
    || (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0) || a.key.localeCompare(b.key));
}

/** Imported Calendar events retain their half-open date span without inventing an appointment time. */
export function projectCalendarAwareTimelinePoints<T extends TimelineSource & { sourceCalendar?: CalendarDateMetadata | null }>(
  items: readonly T[], options: TimelineProjectionOptions,
): TimelinePoint<T>[] {
  const ordinary = projectTimelinePoints(items, options);
  return ordinary.flatMap((point) => {
    const dates = point.item.sourceCalendar;
    if (!dates || point.kind !== "event") return [point];
    let first: string; let last: string;
    if (dates.allDay) {
      if (!validDate(dates.startDate) || !validDate(dates.endDateExclusive) || dates.endDateExclusive <= dates.startDate) return [point];
      first = dates.startDate;
      last = new Date(Date.parse(`${dates.endDateExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    } else {
      const start = Date.parse(point.item.startsAt ?? ""); const end = Date.parse(point.item.endsAt ?? "");
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [point];
      first = tripLocalDateKey(new Date(start), options.timeZone); last = tripLocalDateKey(new Date(end - 1), options.timeZone);
    }
    const matching = options.tripDays.filter((day) => day.date >= first && day.date <= last);
    return matching.map((day, index) => ({ ...point, key: `${point.key}:${day.date}`, tripDayId: day.id, ownsActions: index === 0 }));
  });
}
