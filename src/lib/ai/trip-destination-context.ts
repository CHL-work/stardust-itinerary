import {
  currentTripDate, destinationOnDate, tripDayZones, type TripDayZones, type TripDestination,
} from "@/lib/app/trip-destinations";

type DayContext = { id: string; date: string; label?: string | null };
type CurrentTime = {
  nowUtc?: string; timeZone?: string; tripLocalDate?: string; tomorrowLocalDate?: string; tripLocalTime?: string;
  tripLocalWeekday?: string; planningReferenceDate?: string;
};

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function clock(now: Date, timeZone: string): { time: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    weekday: "long" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { time: `${get("hour")}:${get("minute")}:${get("second")}`, weekday: get("weekday") };
}

/**
 * The AI's view of a trip's destinations (JOB-098, D-110): the list in order, each day's destination and,
 * when days have their own zones, each day's zone, with "now" read on today's own clock. A single-destination
 * trip without dates is left exactly as before.
 */
export function withTripDestinations<T extends { trip?: { timeZone?: string }; days?: DayContext[]; currentTime?: CurrentTime }>(
  context: T, destinations: readonly TripDestination[], now: Date,
): { context: T; dayZones: TripDayZones | null } {
  const tripZone = context.trip?.timeZone ?? "UTC";
  const meaningful = destinations.length > 1 || destinations.some((destination) => destination.startsOn);
  if (!meaningful) return { context, dayZones: null };
  const days = context.days ?? [];
  const dayZones = tripDayZones(destinations, tripZone, days);
  const decoratedDays = days.map((day) => {
    const destination = destinationOnDate(destinations, day.date);
    const zone = dayZones?.byDate.get(day.date);
    return { ...day, ...(destination ? { destination: destination.name } : {}), ...(zone ? { timeZone: zone } : {}) };
  });
  let currentTime = context.currentTime;
  if (dayZones && currentTime) {
    const today = currentTripDate(now, tripZone, dayZones);
    const zone = dayZones.byDate.get(today) ?? tripZone;
    const local = clock(now, zone);
    currentTime = { ...currentTime, timeZone: zone, tripLocalDate: today, tomorrowLocalDate: shiftDate(today, 1),
      tripLocalTime: local.time, tripLocalWeekday: local.weekday, planningReferenceDate: today };
  }
  return {
    context: { ...context, trip: { ...context.trip, destinations }, days: decoratedDays, ...(currentTime ? { currentTime } : {}) },
    dayZones,
  };
}
