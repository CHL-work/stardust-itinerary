import type { TimelinePoint, TimelineSource } from "@/lib/app/timeline";
import { tripLocalDateKey } from "@/lib/app/day-view";
import { resolveFlightPresentation } from "@/lib/app/flight-presentation";
import { flightMessages } from "@/lib/app/flight-i18n";
import type { Locale } from "@/lib/i18n";

/** Endpoint-local clocks; the trip's dated groups and UTC ordering remain unchanged. */
export function formatTimelinePointTime(
  point: TimelinePoint<TimelineSource>, locale: Locale, tripZone: string, includeDate = false,
): string {
  if (!point.at) return "";
  const flight = resolveFlightPresentation(point.item, tripZone);
  const isFlight = point.isFlight ?? flight.isFlight;
  const zone = point.timeZone ?? (point.kind === "arrival" ? flight.arrivalTimeZone : flight.departureTimeZone);
  const known = point.timeZoneKnown ?? (point.kind === "arrival" ? flight.arrivalZoneKnown : flight.departureZoneKnown);
  const localDateDiffers = tripLocalDateKey(point.at, zone) !== tripLocalDateKey(point.at, tripZone);
  const formatted = new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, {
    timeZone: zone, hour: "2-digit", minute: "2-digit",
    ...(includeDate || localDateDiffers ? { month: "short" as const, day: "numeric" as const } : {}),
    ...(isFlight ? { timeZoneName: "short" as const } : {}),
  }).format(new Date(point.at));
  return isFlight && !known ? `${formatted} · ${flightMessages(locale).tripTimeFallback}` : formatted;
}
