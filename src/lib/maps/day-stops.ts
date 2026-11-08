import { tripLocalDateKey } from "@/lib/app/day-view";
import type { TimelinePoint, TimelinePointKind, TimelineSource, TimelineTripDay } from "@/lib/app/timeline";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import { projectCalendarAwareTimelinePoints, type CalendarDateMetadata } from "@/lib/calendar/timeline";

/** Only already audience-authorized itinerary records belong in this input. */
export type MapSource = TimelineSource & {
  title: string;
  visibility: "trip" | "private";
  sourceCalendar?: CalendarDateMetadata | null;
};

export type PendingMapSource = Omit<MapSource, "id" | "status"> & {
  requestId: string;
  status: "pending";
  operation: "create" | "update" | "cancel" | "restore";
  targetItemId: string | null;
};

export type DayMapStop = Readonly<{
  key: string;
  number: number;
  title: string;
  at: string | null;
  timeZone?: string;
  timeZoneKnown?: boolean;
  isFlight?: boolean;
  kind: TimelinePointKind;
  locationName: string | null;
  mapUrl: string | null;
  visibility: "trip" | "private";
  pending: boolean;
  allDay: boolean;
}>;

type MapTimelineSource = MapSource & { pending: boolean };

function usableTime(at: string | null): number | null {
  if (!at) return null;
  const timestamp = Date.parse(at);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeMapUrl(raw: string | null): string | null {
  if (!raw || raw.length > 2_000 || /[\u0000-\u001f\u007f]/u.test(raw)) return null;
  const value = raw.trim();
  if (!isTrustedGoogleMapsUrl(value)) return null;
  const url = new URL(value);
  if (url.username || url.password || (url.port && url.port !== "443")) return null;
  const credentialParameter = /(?:^|_)(?:key|api_?key|token|access_?token|auth|authorization|password|secret|session|credential|signature|client)(?:$|_)/iu;
  if ([...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()]
    .some((name) => credentialParameter.test(name.replace(/[-.]/gu, "_")))) return null;
  return value;
}

/** Matches the all-day/time/key ordering of the merged TripTimeline renderer. */
function compareMapPoints(left: TimelinePoint<MapTimelineSource>, right: TimelinePoint<MapTimelineSource>): number {
  const allDayDifference = Number(Boolean(right.item.sourceCalendar?.allDay))
    - Number(Boolean(left.item.sourceCalendar?.allDay));
  if (allDayDifference) return allDayDifference;
  return (usableTime(left.at) ?? Number.MAX_SAFE_INTEGER)
    - (usableTime(right.at) ?? Number.MAX_SAFE_INTEGER)
    || left.key.localeCompare(right.key);
}

/**
 * Projects a selected day's displayed itinerary, not raw personal Calendar rows.
 * Pending target replacement happens before optional private-location inclusion:
 * declining private sharing must never reveal an obsolete public target instead.
 * Missing locations stay numbered so provider failures cannot renumber visits.
 */
export function projectDayMapStops(input: {
  itinerary: readonly MapSource[];
  pendingItinerary: readonly PendingMapSource[];
  days: readonly TimelineTripDay[];
  timeZone: string;
  tripDayId: string;
  includePrivate?: boolean;
}): DayMapStop[] {
  const day = input.days.find((candidate) => candidate.id === input.tripDayId);
  if (!day) return [];
  const pending = input.pendingItinerary.filter((request) => request.status === "pending");
  const replacedTargets = new Set(pending.flatMap((request) => (
    request.operation !== "create" && request.targetItemId ? [request.targetItemId] : []
  )));
  const sources: MapTimelineSource[] = [
    ...input.itinerary
      .filter((item) => item.status !== "cancelled" && !replacedTargets.has(item.id))
      .map((item) => ({ ...item, pending: false })),
    ...pending.filter((request) => ["create", "update", "restore"].includes(request.operation))
      .map((request) => ({ ...request, id: request.requestId, pending: true })),
  ];
  const points = projectCalendarAwareTimelinePoints(
    sources.filter((item) => item.visibility === "trip" || (input.includePrivate === true && item.visibility === "private")),
    { tripDays: input.days, timeZone: input.timeZone },
  ).filter((point) => {
    if (point.tripDayId !== day.id) return false;
    if (usableTime(point.at) === null) return true;
    // A valid Calendar date-span projection intentionally retains the original
    // start instant on continuation rows. Its date-suffixed key proves that the
    // shared projector expanded the span; invalid metadata has no such key.
    if (point.kind === "event" && point.item.sourceCalendar
      && point.key === `${point.item.id}:event:${day.date}`) return true;
    // The ordinary timeline falls back to the assigned day for out-of-trip
    // instants. A map must not imply a visit happened on that fallback date.
    return tripLocalDateKey(point.at!, input.timeZone) === day.date;
  }).sort(compareMapPoints);

  return points.map((point, index) => ({
    key: point.item.pending ? `pending:${point.key}` : point.key,
    number: index + 1,
    title: point.item.title,
    at: usableTime(point.at) === null ? null : point.at,
    timeZone: point.timeZone,
    timeZoneKnown: point.timeZoneKnown,
    isFlight: point.isFlight,
    kind: point.kind,
    locationName: point.locationName?.trim() || null,
    mapUrl: safeMapUrl(point.mapUrl),
    visibility: point.item.visibility,
    pending: point.item.pending,
    allDay: Boolean(point.item.sourceCalendar?.allDay),
  }));
}
