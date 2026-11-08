import type { ItineraryPatch } from "@/lib/app/types";
import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import { resolveEventTimeZonesPatch, resolveLegacyFlightTimeZonesPatch } from "@/lib/app/event-time-zone-contract";
import { instantDateInTimeZone } from "@/lib/ai/relative-date";

/** Relative itinerary dates refer to the venue clock; trip-day and financial guards remain separate. */
export function itineraryProposalLocalDate(patch: ItineraryPatch, current: ItineraryPatch | undefined, tripTimeZone: string) {
  const startsAt = patch.startsAt !== undefined ? patch.startsAt : current?.startsAt;
  const effective = { ...current, ...patch, itemType: patch.itemType ?? current?.itemType ?? "activity",
    timeZones: resolveEventTimeZonesPatch(patch, current), flight: resolveLegacyFlightTimeZonesPatch(patch, current) };
  const timeZone = resolveEventTimeZones(effective, tripTimeZone).departureTimeZone;
  return { date: startsAt ? instantDateInTimeZone(startsAt, timeZone) : null, timeZone };
}
