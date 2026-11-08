import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import { isoToWallTime, wallTimeToIso, ZonedEventTimeError } from "@/lib/app/zoned-event-time";

type FlightSource = Parameters<typeof resolveEventTimeZones>[0];
export type EventTimeInputs = {
  startsAt: string;
  endsAt: string;
  preferredStartsAt?: string | null;
  preferredEndsAt?: string | null;
};

/** Changing a location/display zone changes clock labels, never the scheduled instants. */
export function rebaseFlightTimeInputs(
  input: EventTimeInputs, before: FlightSource, after: FlightSource, tripZone: string, clearInvalidTimes = false,
): EventTimeInputs {
  const oldZones = resolveEventTimeZones(before, tripZone);
  const newZones = resolveEventTimeZones(after, tripZone);
  const result: EventTimeInputs = { startsAt: input.startsAt, endsAt: input.endsAt,
    preferredStartsAt: input.preferredStartsAt, preferredEndsAt: input.preferredEndsAt };
  if (input.startsAt && oldZones.departureTimeZone !== newZones.departureTimeZone) {
    try {
      result.preferredStartsAt = wallTimeToIso(input.startsAt, oldZones.departureTimeZone, input.preferredStartsAt);
      result.startsAt = isoToWallTime(result.preferredStartsAt, newZones.departureTimeZone);
    } catch (error) {
      if (!clearInvalidTimes || !(error instanceof ZonedEventTimeError)) throw error;
      // An explicit zone correction must remain possible, but cannot invent an instant.
      result.startsAt = ""; result.preferredStartsAt = null;
    }
  }
  if (input.endsAt && oldZones.arrivalTimeZone !== newZones.arrivalTimeZone) {
    try {
      result.preferredEndsAt = wallTimeToIso(input.endsAt, oldZones.arrivalTimeZone, input.preferredEndsAt);
      result.endsAt = isoToWallTime(result.preferredEndsAt, newZones.arrivalTimeZone);
    } catch (error) {
      if (!clearInvalidTimes || !(error instanceof ZonedEventTimeError)) throw error;
      result.endsAt = ""; result.preferredEndsAt = null;
    }
  }
  return result;
}

/** Keep a minute-resolution form from rewriting the seconds or DST fold of an unchanged record. */
export function eventTimeInputsFromInstants(
  item: FlightSource & { startsAt: string | null; endsAt: string | null }, tripZone: string,
): EventTimeInputs {
  const zones = resolveEventTimeZones(item, tripZone);
  return {
    startsAt: isoToWallTime(item.startsAt, zones.departureTimeZone),
    endsAt: isoToWallTime(item.endsAt, zones.arrivalTimeZone),
    preferredStartsAt: item.startsAt,
    preferredEndsAt: item.endsAt,
  };
}

/** Linked bill dates stay in the trip zone even when event inputs use location-local clocks. */
export function eventExpenseTimeFromStart(input: EventTimeInputs, source: FlightSource, tripZone: string): string {
  if (!input.startsAt) return "";
  try {
    const zone = resolveEventTimeZones(source, tripZone).departureTimeZone;
    return isoToWallTime(wallTimeToIso(input.startsAt, zone, input.preferredStartsAt), tripZone);
  } catch (error) {
    if (error instanceof ZonedEventTimeError) return "";
    throw error;
  }
}
