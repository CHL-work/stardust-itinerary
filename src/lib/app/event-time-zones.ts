import tzLookup from "@photostructure/tz-lookup";
import { airportCodeFromLocation, airportTimeZone } from "@/lib/app/airport-time-zones";
import { resolveFlightPresentation, type FlightPresentationInput } from "@/lib/app/flight-presentation";
import { readEventTimeZones, type EventTimeZones } from "@/lib/app/event-time-zone-contract";
import { placeTimeZone } from "@/lib/app/place-time-zones";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";

export type EventZoneSource = "explicit" | "airport" | "coordinates" | "place" | "trip";
export type EventTimeZoneInput = FlightPresentationInput & {
  timeZones?: EventTimeZones | null;
  locationName?: string | null;
  mapUrl?: string | null;
  departureMapUrl?: string | null;
  destinationMapUrl?: string | null;
};
export type EventTimeZonePresentation = {
  isFlight: boolean;
  departureTimeZone: string;
  arrivalTimeZone: string;
  departureZoneKnown: boolean;
  arrivalZoneKnown: boolean;
  departureZoneSource: EventZoneSource;
  arrivalZoneSource: EventZoneSource;
};
type Zone = { zone: string; source: EventZoneSource };
type Point = { lat: number; lng: number };

function coordinate(value: string | null | undefined): Point | null {
  const match = /^\s*(-?\d{1,3}(?:\.\d{1,12})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,12})?)\s*$/u.exec(value ?? "");
  if (!match) return null;
  const [lat, lng] = match.slice(1).map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Read saved venue coordinates/search text, never a map camera center, redirect or URL fetch. */
export function eventLocationEvidence(name: string | null | undefined, mapUrl: string | null | undefined): {
  point: Point | null; text: string | null;
} {
  const fallback = { point: coordinate(name), text: name?.slice(0, 500) ?? null };
  if (!mapUrl || mapUrl.length > 2048 || !isTrustedGoogleMapsUrl(mapUrl)) return fallback;
  try {
    const url = new URL(mapUrl);
    if (url.username || url.password || url.port) return fallback;
    if (url.hostname === "maps.app.goo.gl" || url.hostname === "goo.gl") return fallback;
    if (url.searchParams.getAll("query").length > 1 || url.searchParams.getAll("q").length > 1
      || url.searchParams.has("query") && url.searchParams.has("q")) return fallback;
    const query = url.searchParams.get("query") ?? url.searchParams.get("q");
    const queryPoint = coordinate(query);
    if (queryPoint) return { point: queryPoint, text: fallback.text };
    if (url.pathname.startsWith("/maps/place/")) {
      const matches = [...decodeURIComponent(url.pathname).matchAll(/!3d(-?\d{1,3}(?:\.\d{1,12})?)!4d(-?\d{1,3}(?:\.\d{1,12})?)(?=!|\/|$)/gu)];
      if (matches.length === 1) {
        const point = coordinate(`${matches[0][1]},${matches[0][2]}`);
        if (point) return { point, text: fallback.text };
      }
    }
    return { point: fallback.point, text: query && query.length <= 500 ? query : fallback.text };
  } catch { return fallback; }
}

function locationZone(name: string | null | undefined, mapUrl: string | null | undefined): Zone | null {
  const evidence = eventLocationEvidence(name, mapUrl);
  const namePlace = placeTimeZone(name);
  const queryPlace = placeTimeZone(evidence.text);
  if (namePlace && queryPlace && namePlace !== queryPlace) return null;
  const place = queryPlace ?? namePlace;
  if (evidence.point) {
    try {
      const zone = canonicalTripTimeZone(tzLookup(evidence.point.lat, evidence.point.lng));
      // The compact coordinate grid is approximate. A contradictory explicit locality must not
      // silently override it or vice versa; let the user choose an explicit zone instead.
      if (zone && place && zone !== place) return null;
      if (zone) return { zone, source: "coordinates" };
    } catch { /* Unsupported or invalid geography remains an explicit fallback. */ }
  }
  const airport = airportTimeZone(airportCodeFromLocation(name));
  if (airport) return { zone: airport, source: "airport" };
  return place ? { zone: place, source: "place" } : null;
}

/** Same instant, local clock. Shared by forms, views, Calendar and AI; no I/O or model calls. */
export function resolveEventTimeZones(item: EventTimeZoneInput, tripZone: string): EventTimeZonePresentation {
  const fallback = canonicalTripTimeZone(tripZone) ?? "UTC";
  const flight = resolveFlightPresentation(item, fallback);
  const explicit = readEventTimeZones(item.timeZones);
  const transport = item.itemType === "transport";
  const resolve = (end: boolean): Zone => {
    const saved = end && transport ? explicit?.end : explicit?.start;
    const zone = saved ? canonicalTripTimeZone(saved) : null;
    if (zone) return { zone, source: "explicit" };
    const knownFlight = end ? flight.arrivalZoneKnown : flight.departureZoneKnown;
    if (flight.isFlight && knownFlight) return { zone: end ? flight.arrivalTimeZone : flight.departureTimeZone,
      source: end ? flight.arrivalZoneSource : flight.departureZoneSource };
    const found = locationZone(transport ? end ? item.destinationLocationName : item.departureLocationName : item.locationName,
      transport ? end ? item.destinationMapUrl : item.departureMapUrl : item.mapUrl);
    return found ?? { zone: fallback, source: "trip" };
  };
  const start = resolve(false);
  const end = transport ? resolve(true) : start;
  return { isFlight: flight.isFlight, departureTimeZone: start.zone, arrivalTimeZone: end.zone,
    departureZoneKnown: start.source !== "trip", arrivalZoneKnown: end.source !== "trip",
    departureZoneSource: start.source, arrivalZoneSource: end.source };
}
