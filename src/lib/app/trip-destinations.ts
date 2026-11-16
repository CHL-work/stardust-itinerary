import { pickCurrentTripDay, tripLocalDateKey } from "@/lib/app/day-view";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

/**
 * A trip's destinations (JOB-098, D-110): where the travellers go, in order, each with its own clock and,
 * optionally, the dates they are there. The first destination is the trip's own name and time zone.
 * Shared by the server, the browser and the AI; no I/O.
 */
export const MAX_TRIP_DESTINATIONS = 12;

export type TripDestination = {
  name: string;
  timeZone: string;
  /** The first and last day there (inclusive), both or neither. */
  startsOn: string | null;
  endsOn: string | null;
};

/** The destination the travellers are in on a calendar date; on a travel day, the one they arrive at. */
export function destinationOnDate<T extends TripDestination>(destinations: readonly T[] | null | undefined, date: string): T | null {
  let found: T | null = null;
  for (const destination of destinations ?? []) {
    if (!destination.startsOn || !destination.endsOn || date < destination.startsOn || date > destination.endsOn) continue;
    if (!found || destination.startsOn >= found.startsOn!) found = destination;
  }
  return found;
}

/** Each trip day's clock, by day id and by date, when not every day uses the trip's own zone. */
export type TripDayZones = { byDayId: ReadonlyMap<string, string>; byDate: ReadonlyMap<string, string> };

/**
 * Each day takes the zone of the destination the travellers are in that day, else the trip's zone. Null when
 * every day uses the trip's zone, so single-zone trips keep their exact behaviour.
 */
export function tripDayZones(destinations: readonly TripDestination[] | null | undefined, tripZone: string,
  days: readonly { id: string; date: string }[]): TripDayZones | null {
  if (!destinations?.length) return null;
  const base = canonicalTripTimeZone(tripZone) ?? "UTC";
  const byDayId = new Map<string, string>();
  const byDate = new Map<string, string>();
  let differs = false;
  for (const day of days) {
    const zone = canonicalTripTimeZone(destinationOnDate(destinations, day.date)?.timeZone ?? "") ?? base;
    if (zone !== base) differs = true;
    byDayId.set(day.id, zone);
    byDate.set(day.date, zone);
  }
  return differs ? { byDayId, byDate } : null;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Trip dates whose own clock reads that date at this instant; at most three can, since offsets span a day. */
function datesOnOwnClock(at: Date, zones: TripDayZones): string[] {
  const utc = at.toISOString().slice(0, 10);
  return [shiftDate(utc, -1), utc, shiftDate(utc, 1)].filter((date) => {
    const zone = zones.byDate.get(date);
    return zone !== undefined && tripLocalDateKey(at, zone) === date;
  });
}

/**
 * The trip day an instant belongs to. Single-zone trips use the trip zone's date, as before. With per-day
 * zones, a day holds the instants of its own local date; at a zone change the day on the event's own clock
 * wins, then the assigned day, and an instant between two days' clocks goes to its own local date.
 */
export function tripDayIdForInstant(at: string | Date, input: {
  tripZone: string;
  dayIdByDate: ReadonlyMap<string, string>;
  dayZones: TripDayZones | null;
  eventZone?: string | null;
  assignedDayId?: string | null;
}): string | null {
  const instant = typeof at === "string" ? new Date(at) : at;
  if (!Number.isFinite(instant.getTime())) return input.assignedDayId ?? null;
  if (!input.dayZones) return input.dayIdByDate.get(tripLocalDateKey(instant, input.tripZone)) ?? input.assignedDayId ?? null;
  const zones = input.dayZones;
  const candidates = datesOnOwnClock(instant, zones);
  const eventZone = input.eventZone ? canonicalTripTimeZone(input.eventZone) : null;
  if (candidates.length > 1) {
    const own = eventZone ? candidates.find((date) => zones.byDate.get(date) === eventZone) : undefined;
    const assigned = candidates.find((date) => input.dayIdByDate.get(date) === input.assignedDayId);
    return input.dayIdByDate.get(own ?? assigned ?? candidates[0]!) ?? input.assignedDayId ?? null;
  }
  if (candidates.length === 1) return input.dayIdByDate.get(candidates[0]!) ?? input.assignedDayId ?? null;
  const local = tripLocalDateKey(instant, eventZone ?? input.tripZone);
  return input.dayIdByDate.get(local) ?? input.assignedDayId ?? null;
}

/**
 * The trip's date now. With per-day zones it is the day whose own clock reads that date; at a zone change the
 * later one, so the trip moves forward; between two days' clocks, the trip zone's date.
 */
export function currentTripDate(now: Date, tripZone: string, zones: TripDayZones | null): string {
  if (!zones) return tripLocalDateKey(now, tripZone);
  const candidates = datesOnOwnClock(now, zones);
  return candidates.length ? candidates[candidates.length - 1]! : tripLocalDateKey(now, tripZone);
}

/** True when some dated destination has a clock other than the trip's, so days can differ. */
function hasOtherDatedClock(destinations: readonly TripDestination[] | null | undefined, tripZone: string): boolean {
  const base = canonicalTripTimeZone(tripZone) ?? tripZone;
  return (destinations ?? []).some((destination) => destination.startsOn && destination.endsOn
    && (canonicalTripTimeZone(destination.timeZone) ?? destination.timeZone) !== base);
}

/**
 * The date and clock for a time with no place of its own, such as a bill or a repayment: the trip date whose
 * own clock reads its date (the earlier one at a zone change), else the trip zone's date and clock. Trips
 * whose dated destinations all share the trip's zone get the trip zone, exactly as before (JOB-098).
 */
export function destinationClockAt(at: string | Date, tripZone: string,
  destinations: readonly TripDestination[] | null | undefined): { date: string; timeZone: string } {
  const instant = typeof at === "string" ? new Date(at) : at;
  if (!hasOtherDatedClock(destinations, tripZone) || !Number.isFinite(instant.getTime())) {
    return { date: tripLocalDateKey(at, tripZone), timeZone: tripZone };
  }
  const utc = instant.toISOString().slice(0, 10);
  for (const date of [shiftDate(utc, -1), utc, shiftDate(utc, 1)]) {
    const zone = canonicalTripTimeZone(destinationOnDate(destinations, date)?.timeZone ?? "") ?? tripZone;
    if (tripLocalDateKey(instant, zone) === date) return { date, timeZone: zone };
  }
  return { date: tripLocalDateKey(instant, tripZone), timeZone: tripZone };
}

/**
 * The clock in which a bill's or repayment's time is shown and typed (JOB-098): for a typed local time, that
 * of the destination on its date; for a saved instant, `destinationClockAt`'s; otherwise the trip's.
 */
export function moneyTimeZone(trip: { timeZone: string; destinations?: readonly TripDestination[] | null },
  at?: string | null, wallTime?: string | null): string {
  if (!hasOtherDatedClock(trip.destinations, trip.timeZone)) return trip.timeZone;
  if (wallTime && /^\d{4}-\d{2}-\d{2}/u.test(wallTime)) {
    return canonicalTripTimeZone(destinationOnDate(trip.destinations, wallTime.slice(0, 10))?.timeZone ?? "") ?? trip.timeZone;
  }
  return at ? destinationClockAt(at, trip.timeZone, trip.destinations).timeZone : trip.timeZone;
}

/** The trip day to show as today: `pickCurrentTripDay` with each day's own clock (JOB-098). */
export function pickTripToday<T extends { id: string; date: string }>(days: T[],
  trip: { timeZone: string; destinations?: readonly TripDestination[] | null }, now: Date = new Date()): T | null {
  return pickCurrentTripDay(days, trip.timeZone, now, currentTripDate(now, trip.timeZone, tripDayZones(trip.destinations, trip.timeZone, days)));
}

/** "Tokyo → Osaka → New York": the trip's destinations in order, for headings. */
export function destinationsLabel(destinations: readonly Pick<TripDestination, "name">[] | null | undefined, fallback: string): string {
  const names = (destinations ?? []).map((destination) => destination.name.trim()).filter(Boolean);
  return names.length ? names.join(" → ") : fallback;
}

/** The trip's single destination when it has no stored list (older trips, older schemas). */
export function singleDestination(name: string, timeZone: string): TripDestination[] {
  return [{ name, timeZone, startsOn: null, endsOn: null }];
}
