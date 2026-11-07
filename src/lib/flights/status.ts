import { z } from "zod";

import { normalizeFlightNumber, type FlightDetails } from "@/lib/app/flight";
import { containsPrivateIdentifier, sanitizePublicSourceUrl, sanitizePublicText } from "@/lib/disruptions/privacy";

/** A departure that moves by at least this much is a time change (D-095); smaller drift is ignored. */
export const FLIGHT_TIME_CHANGE_MINUTES = 15;
/** A reported departure further than this from the planned one is treated as a different flight. */
export const FLIGHT_MAX_SHIFT_MINUTES = 36 * 60;
/** A reported arrival is used only when it lands within this long after the departure. */
const MAX_FLIGHT_MINUTES = 20 * 60;

export const flightStatuses = ["scheduled", "delayed", "cancelled", "departed", "landed", "diverted", "unknown"] as const;

/** The status lookup's answer, as the provider must return it (every field required, nulls allowed). */
export const flightStatusOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    flightNumber: { type: "string", minLength: 1, maxLength: 12 },
    flightDate: { type: ["string", "null"], maxLength: 10 },
    status: { type: "string", enum: [...flightStatuses] },
    scheduledDeparture: { type: ["string", "null"], maxLength: 40 },
    estimatedDeparture: { type: ["string", "null"], maxLength: 40 },
    scheduledArrival: { type: ["string", "null"], maxLength: 40 },
    estimatedArrival: { type: ["string", "null"], maxLength: 40 },
    departureTerminal: { type: ["string", "null"], maxLength: 40 },
    departureGate: { type: ["string", "null"], maxLength: 20 },
    arrivalTerminal: { type: ["string", "null"], maxLength: 40 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    sources: { type: "array", maxItems: 5, items: { type: "string", maxLength: 2_000 } },
    summary: { type: "string", maxLength: 300 },
  },
  required: [
    "flightNumber", "flightDate", "status", "scheduledDeparture", "estimatedDeparture", "scheduledArrival", "estimatedArrival",
    "departureTerminal", "departureGate", "arrivalTerminal", "confidence", "sources", "summary",
  ],
} as const;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const instant = z.string().max(40).refine((value) => ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value))).nullable();

const resultSchema = z.object({
  flightNumber: z.string().min(1).max(12),
  flightDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  status: z.enum(flightStatuses),
  scheduledDeparture: instant,
  estimatedDeparture: instant,
  scheduledArrival: instant,
  estimatedArrival: instant,
  departureTerminal: z.string().max(40).nullable(),
  departureGate: z.string().max(20).nullable(),
  arrivalTerminal: z.string().max(40).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(z.string().max(2_000)).max(5),
  summary: z.string().max(300),
}).strict();

export type FlightStatusResult = z.infer<typeof resultSchema>;

/** Parses the provider's JSON; anything else is not a usable answer. */
export function parseFlightStatusOutput(raw: string): FlightStatusResult | null {
  try {
    const parsed = resultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The event as the check found it. */
export type FlightEventState = {
  startsAt: string;
  endsAt: string | null;
  /** The departure's local date in the trip's time zone. */
  localDate: string;
  flight: FlightDetails;
};

export type FlightStatusDecision =
  | { outcome: "unverified"; reason: "wrong_flight" | "wrong_date" | "no_source" | "low_confidence" }
  | { outcome: "unchanged" }
  | {
    outcome: "details" | "schedule" | "cancelled";
    startsAt: string;
    endsAt: string | null;
    status: "planned" | "cancelled";
    flight: FlightDetails;
    sources: string[];
  };

const timeOf = (value: string | null) => (value === null ? null : Date.parse(value));

function dayDifference(left: string, right: string): number {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

/** A terminal or gate as published: short, single-line text without links or identifiers. */
function detailValue(value: string | null, max: number): string | null {
  if (value === null || /https?:|www\./iu.test(value) || containsPrivateIdentifier(value)) return null;
  return sanitizePublicText(value, max) || null;
}

const sameText = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? "").normalize("NFKC").toLocaleLowerCase() === (right ?? "").normalize("NFKC").toLocaleLowerCase();

/**
 * What a status answer changes (D-095): a cancellation marks the event cancelled; a departure moved by
 * at least 15 minutes updates the times; a new terminal or gate updates the flight details quietly.
 * Times and cancellations need high confidence, details at least medium, and every change needs a
 * public https source for this exact flight and date. Unknown details never clear known ones.
 */
export function decideFlightStatusUpdate(state: FlightEventState, result: FlightStatusResult): FlightStatusDecision {
  if (normalizeFlightNumber(result.flightNumber) !== state.flight.flightNumber) return { outcome: "unverified", reason: "wrong_flight" };
  if (result.flightDate && dayDifference(result.flightDate, state.localDate) > 1) return { outcome: "unverified", reason: "wrong_date" };
  const plannedStart = Date.parse(state.startsAt);
  const scheduled = timeOf(result.scheduledDeparture);
  if (scheduled !== null && Math.abs(scheduled - plannedStart) > FLIGHT_MAX_SHIFT_MINUTES * 60_000) {
    return { outcome: "unverified", reason: "wrong_date" };
  }

  const sources = result.sources.map(sanitizePublicSourceUrl).filter((url): url is string => Boolean(url));
  const confident = result.confidence === "high";
  const detailsConfident = confident || result.confidence === "medium";

  const flight: FlightDetails = { ...state.flight };
  let detailsChanged = false;
  if (detailsConfident) {
    for (const [key, max] of [["departureTerminal", 40], ["departureGate", 20], ["arrivalTerminal", 40]] as const) {
      const value = detailValue(result[key], max);
      if (value && !sameText(value, state.flight[key])) {
        flight[key] = value;
        detailsChanged = true;
      }
    }
  }

  const cancelled = confident && result.status === "cancelled";
  let startsAt = state.startsAt;
  let endsAt = state.endsAt;
  let timeChanged = false;
  const reportedDeparture = timeOf(result.estimatedDeparture) ?? scheduled;
  if (!cancelled && confident && !["departed", "landed", "unknown"].includes(result.status) && reportedDeparture !== null) {
    const shift = reportedDeparture - plannedStart;
    if (Math.abs(shift) >= FLIGHT_TIME_CHANGE_MINUTES * 60_000 && Math.abs(shift) <= FLIGHT_MAX_SHIFT_MINUTES * 60_000) {
      timeChanged = true;
      startsAt = new Date(reportedDeparture).toISOString();
      const arrival = timeOf(result.estimatedArrival) ?? timeOf(result.scheduledArrival);
      endsAt = arrival !== null && arrival > reportedDeparture && arrival - reportedDeparture <= MAX_FLIGHT_MINUTES * 60_000
        ? new Date(arrival).toISOString()
        : state.endsAt ? new Date(Date.parse(state.endsAt) + shift).toISOString() : null;
    }
  }

  if (!cancelled && !timeChanged && !detailsChanged) {
    if (!detailsConfident && (result.status === "cancelled" || result.status === "delayed")) {
      return { outcome: "unverified", reason: "low_confidence" };
    }
    return { outcome: "unchanged" };
  }
  if (sources.length === 0) return { outcome: "unverified", reason: "no_source" };
  return {
    outcome: cancelled ? "cancelled" : timeChanged ? "schedule" : "details",
    startsAt,
    endsAt,
    status: cancelled ? "cancelled" : "planned",
    flight,
    sources,
  };
}
