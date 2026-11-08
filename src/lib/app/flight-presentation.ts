import { airportCodeFromLocation, airportTimeZone } from "@/lib/app/airport-time-zones";
import { isFlightNumber, normalizeFlightNumber, readFlightDetails } from "@/lib/app/flight";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

export { flightTimeZoneOptions } from "@/lib/app/airport-time-zones";
export type FlightZoneSource = "explicit" | "airport" | "trip";
export type SafeFlightPresentation = {
  isFlight: boolean;
  departureTimeZone?: string | null;
  arrivalTimeZone?: string | null;
};
export type FlightPresentationInput = {
  itemType: string;
  title?: string | null;
  departureLocationName?: string | null;
  destinationLocationName?: string | null;
  flight?: unknown;
  /** Trusted, privacy-reduced projection for offline and approval display; never a write input. */
  flightPresentation?: SafeFlightPresentation;
};
export type FlightPresentation = {
  isFlight: boolean;
  departureTimeZone: string;
  arrivalTimeZone: string;
  departureZoneKnown: boolean;
  arrivalZoneKnown: boolean;
  departureZoneSource: FlightZoneSource;
  arrivalZoneSource: FlightZoneSource;
};

function titleRoute(title: string): [string, string] | null {
  // Lookahead also sees overlapping legs (DFW → SLC → HND); never select only the first.
  const pairs = [...title.matchAll(/(?=(?:^|[^\p{L}\p{N}])([A-Z]{3})\s*(?:→|⇒|->|\bto\b|至|往)\s*([A-Z]{3})(?=$|[^\p{L}\p{N}]))/gu)]
    .filter((match) => airportTimeZone(match[1]) && airportTimeZone(match[2]) && match[1] !== match[2]);
  return pairs.length === 1 ? [pairs[0][1], pairs[0][2]] : null;
}

function explicitLegacyFlight(title: string, route: [string, string] | null): boolean {
  if (!route || /\b(?:bus|train|shuttle|coach|taxi|subway|rail|transfer)\b|巴士|接駁|接驳|火車|火车|列車|列车|バス|シャトル/iu.test(title)) return false;
  if (!/\b(?:flight|airlines?|airways)\b|航空|航班|飛機|飞机|フライト|飛行機/iu.test(title)) return false;
  return [...title.matchAll(/(?:^|[^\p{L}\p{N}])((?:[A-Z][A-Z0-9]|[0-9][A-Z])[A-Z]?[ -]?\d{1,4}[A-Z]?)(?=$|[^\p{L}\p{N}])/gu)]
    .some((match) => isFlightNumber(normalizeFlightNumber(match[1])));
}

/** Display only: never changes event type, instants, database state or status-check eligibility. */
export function resolveFlightPresentation(item: FlightPresentationInput, fallbackZone: string): FlightPresentation {
  const fallback = canonicalTripTimeZone(fallbackZone) ?? "UTC";
  const generic: FlightPresentation = { isFlight: false, departureTimeZone: fallback, arrivalTimeZone: fallback,
    departureZoneKnown: false, arrivalZoneKnown: false, departureZoneSource: "trip", arrivalZoneSource: "trip" };
  if (item.itemType !== "transport") return generic;
  const flight = readFlightDetails(item.flight);
  const safe = item.flightPresentation?.isFlight === true ? item.flightPresentation : null;
  const title = (item.title ?? "").slice(0, 500).normalize("NFKC");
  const route = titleRoute(title);
  if (!flight && !safe && !explicitLegacyFlight(title, route)) return generic;
  const resolve = (explicit: unknown, location: string | null | undefined, routeCode: string | undefined) => {
    const zone = typeof explicit === "string" && explicit.length <= 80 ? canonicalTripTimeZone(explicit) : null;
    if (zone) return { zone, known: true, source: "explicit" as const };
    const endpointCode = airportCodeFromLocation(location);
    // Conflicting structured endpoint and legacy title evidence must stay unknown.
    const code = endpointCode && routeCode && endpointCode !== routeCode ? null : endpointCode ?? routeCode;
    const airportZone = airportTimeZone(code);
    return airportZone ? { zone: airportZone, known: true, source: "airport" as const }
      : { zone: fallback, known: false, source: "trip" as const };
  };
  const departure = resolve(flight?.departureTimeZone ?? safe?.departureTimeZone, item.departureLocationName, route?.[0]);
  const arrival = resolve(flight?.arrivalTimeZone ?? safe?.arrivalTimeZone, item.destinationLocationName, route?.[1]);
  return { isFlight: true, departureTimeZone: departure.zone, arrivalTimeZone: arrival.zone,
    departureZoneKnown: departure.known, arrivalZoneKnown: arrival.known,
    departureZoneSource: departure.source, arrivalZoneSource: arrival.source };
}
