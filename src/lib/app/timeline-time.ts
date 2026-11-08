import type { TimelinePoint, TimelineSource } from "@/lib/app/timeline";
import { tripLocalDateKey } from "@/lib/app/day-view";
import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import { flightMessages } from "@/lib/app/flight-i18n";
import type { Locale } from "@/lib/i18n";

function formatZonedTime(at: string | null, locale: Locale, tripZone: string, zone: string, known: boolean, includeDate: boolean): string {
  if (!at) return "";
  const localDateDiffers = tripLocalDateKey(at, zone) !== tripLocalDateKey(at, tripZone);
  const formatted = new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, {
    timeZone: zone, hour: "2-digit", minute: "2-digit",
    ...(includeDate || localDateDiffers ? { month: "short" as const, day: "numeric" as const } : {}),
    timeZoneName: "short",
  }).format(new Date(at));
  return !known ? `${formatted} · ${flightMessages(locale).tripTimeFallback}` : formatted;
}

/** Endpoint-local clocks; the trip's dated groups and UTC ordering remain unchanged. */
export function formatTimelinePointTime(
  point: TimelinePoint<TimelineSource>, locale: Locale, tripZone: string, includeDate = false,
): string {
  const zones = resolveEventTimeZones(point.item, tripZone);
  const zone = point.timeZone ?? (point.kind === "arrival" ? zones.arrivalTimeZone : zones.departureTimeZone);
  const known = point.timeZoneKnown ?? (point.kind === "arrival" ? zones.arrivalZoneKnown : zones.departureZoneKnown);
  return formatZonedTime(point.at, locale, tripZone, zone, known, includeDate);
}

/** Use for check-in/out, linked-event selectors and other views without a timeline point. */
export function formatEventLocalTime(
  item: Parameters<typeof resolveEventTimeZones>[0], at: string | null, locale: Locale, tripZone: string,
  endpoint: "start" | "end" = "start", includeDate = false,
): string {
  const zones = resolveEventTimeZones(item, tripZone);
  return formatZonedTime(at, locale, tripZone,
    endpoint === "end" ? zones.arrivalTimeZone : zones.departureTimeZone,
    endpoint === "end" ? zones.arrivalZoneKnown : zones.departureZoneKnown, includeDate);
}
