import type { ItineraryPatch } from "@/lib/app/types";
import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import { resolveEventTimeZonesPatch, resolveLegacyFlightTimeZonesPatch } from "@/lib/app/event-time-zone-contract";
import { instantDateInTimeZone } from "@/lib/ai/relative-date";

/**
 * Relative itinerary dates refer to the venue clock; trip-day and financial guards remain separate. On a
 * multi-zone trip, `dayTimeZone` is the zone of the destination for the proposal's day (JOB-098), the clock
 * of an event with no other place evidence.
 */
export function itineraryProposalLocalDate(patch: ItineraryPatch, current: ItineraryPatch | undefined, tripTimeZone: string,
  dayTimeZone?: string | null) {
  const startsAt = patch.startsAt !== undefined ? patch.startsAt : current?.startsAt;
  const effective = { ...current, ...patch, itemType: patch.itemType ?? current?.itemType ?? "activity",
    timeZones: resolveEventTimeZonesPatch(patch, current), flight: resolveLegacyFlightTimeZonesPatch(patch, current) };
  const timeZone = resolveEventTimeZones(effective, tripTimeZone, dayTimeZone).departureTimeZone;
  return { date: startsAt ? instantDateInTimeZone(startsAt, timeZone) : null, timeZone };
}
