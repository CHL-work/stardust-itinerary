import { readEventTimeZones, type EventTimeZones } from "@/lib/app/event-time-zone-contract";
import { resolveEventTimeZones } from "@/lib/app/event-time-zones";

/** Google event zones may be the author's calendar zone, not the venue's local zone. */
export function calendarFallbackTimeZones(
  locationName: string | null | undefined,
  sourceTimeZones: unknown,
  mapUrl?: string | null,
): EventTimeZones | null {
  const zones = readEventTimeZones(sourceTimeZones);
  if (!zones?.start && !zones?.end) return null;
  const location = resolveEventTimeZones({ itemType: "activity", locationName, mapUrl }, "UTC");
  return location.departureZoneKnown ? null : zones;
}
