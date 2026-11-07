/**
 * Minutes before departure at which a flight's status is checked (JOB-083, D-095): 24 and 12 hours
 * before, then every hour from 6 hours to 1 hour before. The times follow the event's current
 * departure, so a changed departure moves every later check with it.
 */
export const FLIGHT_CHECK_OFFSETS_MINUTES = [1440, 720, 360, 300, 240, 180, 120, 60] as const;
export type FlightCheckSlot = (typeof FLIGHT_CHECK_OFFSETS_MINUTES)[number];

/**
 * The check due now for a departure: the latest slot whose time has passed. Null more than 24 hours
 * before departure and from departure on. A slot missed while the worker was down is not replayed:
 * only the latest due one runs.
 */
export function dueFlightCheckSlot(departureAt: Date, now: Date): FlightCheckSlot | null {
  const minutesLeft = (departureAt.getTime() - now.getTime()) / 60_000;
  if (!Number.isFinite(minutesLeft) || minutesLeft <= 0 || minutesLeft > FLIGHT_CHECK_OFFSETS_MINUTES[0]) return null;
  let due: FlightCheckSlot | null = null;
  for (const offset of FLIGHT_CHECK_OFFSETS_MINUTES) if (offset >= minutesLeft) due = offset;
  return due;
}

/** When each check runs for a departure, earliest first. */
export function flightCheckTimes(departureAt: Date): Date[] {
  return FLIGHT_CHECK_OFFSETS_MINUTES.map((offset) => new Date(departureAt.getTime() - offset * 60_000));
}
