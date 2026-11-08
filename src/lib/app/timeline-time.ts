import type { TimelinePoint, TimelineSource } from "@/lib/app/timeline";
import { tripLocalDateKey } from "@/lib/app/day-view";
import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import type { Locale } from "@/lib/i18n";

/**
 * A time on the clock of the place it happens, with no zone name such as "GMT+9" (JOB-097, D-109): the airport
 * or place shown beside it says where. A local date that differs from the trip date is shown with it.
 */
function formatZonedTime(at: string | null, locale: Locale, tripZone: string, zone: string, includeDate: boolean): string {
  if (!at) return "";
  const localDateDiffers = tripLocalDateKey(at, zone) !== tripLocalDateKey(at, tripZone);
  return new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, {
    timeZone: zone, hour: "2-digit", minute: "2-digit",
    ...(includeDate || localDateDiffers ? { month: "short" as const, day: "numeric" as const } : {}),
  }).format(new Date(at));
}

/** Endpoint-local clocks; the trip's dated groups and UTC ordering remain unchanged. */
export function formatTimelinePointTime(
  point: TimelinePoint<TimelineSource>, locale: Locale, tripZone: string, includeDate = false,
): string {
  const zones = resolveEventTimeZones(point.item, tripZone);
  const zone = point.timeZone ?? (point.kind === "arrival" ? zones.arrivalTimeZone : zones.departureTimeZone);
  return formatZonedTime(point.at, locale, tripZone, zone, includeDate);
}

/** Use for check-in/out, linked-event selectors and other views without a timeline point. */
export function formatEventLocalTime(
  item: Parameters<typeof resolveEventTimeZones>[0], at: string | null, locale: Locale, tripZone: string,
  endpoint: "start" | "end" = "start", includeDate = false,
): string {
  const zones = resolveEventTimeZones(item, tripZone);
  return formatZonedTime(at, locale, tripZone, endpoint === "end" ? zones.arrivalTimeZone : zones.departureTimeZone, includeDate);
}
