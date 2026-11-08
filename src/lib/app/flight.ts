import { z } from "zod";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

/**
 * A flight designator: a two-character airline code (letters and digits, never two digits) or a
 * three-letter one, then one to four digits and an optional suffix letter, for example JL123,
 * 9C8913 or CPA521. Migration 0061 checks the same pattern.
 */
export const FLIGHT_NUMBER_PATTERN = /^(?:[A-Z][A-Z0-9]|[0-9][A-Z])[A-Z]?[0-9]{1,4}[A-Z]?$/u;

/** Upper case without spaces or hyphens, so "jl 123" and "JL-123" become JL123. */
export function normalizeFlightNumber(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[\s-]+/gu, "");
}

export function isFlightNumber(value: string): boolean {
  return FLIGHT_NUMBER_PATTERN.test(value);
}

const flightText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const flightTimeZone = z.string().trim().min(1).max(80)
  .refine((value) => canonicalTripTimeZone(value) !== null, "Use a named IANA time zone.").nullable().optional();

/** Flight details of a transport event (JOB-082, D-094). Terminals keep the airport's own name, such as "Terminal 3". */
export const flightDetailsSchema = z.object({
  flightNumber: z.string().regex(FLIGHT_NUMBER_PATTERN),
  airline: flightText(80),
  departureTerminal: flightText(40),
  departureGate: flightText(20),
  arrivalTerminal: flightText(40),
  departureTimeZone: flightTimeZone,
  arrivalTimeZone: flightTimeZone,
}).strict();

export type FlightDetails = {
  flightNumber: string;
  airline?: string | null;
  departureTerminal?: string | null;
  departureGate?: string | null;
  arrivalTerminal?: string | null;
  departureTimeZone?: string | null;
  arrivalTimeZone?: string | null;
};

/** A stored value, read defensively: anything that is not a valid object counts as no flight. */
export function readFlightDetails(value: unknown): FlightDetails | null {
  const parsed = flightDetailsSchema.safeParse(value);
  if (!parsed.success) return null;
  const flight = parsed.data;
  return {
    flightNumber: flight.flightNumber,
    airline: flight.airline ?? null,
    departureTerminal: flight.departureTerminal ?? null,
    departureGate: flight.departureGate ?? null,
    arrivalTerminal: flight.arrivalTerminal ?? null,
    ...(flight.departureTimeZone !== undefined ? { departureTimeZone: flight.departureTimeZone } : {}),
    ...(flight.arrivalTimeZone !== undefined ? { arrivalTimeZone: flight.arrivalTimeZone } : {}),
  };
}

export type FlightLocationDetail =
  | { kind: "gate"; terminal: string | null; gate: string }
  | { kind: "terminal"; terminal: string }
  | { kind: "airline"; airline: string };

/**
 * What to show beside the departure airport (D-094): the gate with its terminal, else the terminal,
 * else the airline. Nothing when none is known.
 */
export function flightDepartureDetail(flight: FlightDetails | null | undefined): FlightLocationDetail | null {
  if (!flight) return null;
  const terminal = flight.departureTerminal?.trim() || null;
  const gate = flight.departureGate?.trim() || null;
  const airline = flight.airline?.trim() || null;
  if (gate) return { kind: "gate", terminal, gate };
  if (terminal) return { kind: "terminal", terminal };
  return airline ? { kind: "airline", airline } : null;
}

/** The arrival terminal shown beside the destination airport, when known. */
export function flightArrivalDetail(flight: FlightDetails | null | undefined): string | null {
  return flight?.arrivalTerminal?.trim() || null;
}

/** The latest automatic time change or cancellation an event still reflects (JOB-083, D-095). */
export type FlightChange = {
  kind: "schedule" | "cancelled";
  previousStartsAt: string | null;
  previousEndsAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  checkedAt: string;
};
