import { airportTimeZoneGroups } from "@/lib/app/airport-time-zones.generated";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

// A compact, pinned, offline catalog: no public lookup of a private itinerary.
const zonesByCode = new Map<string, string>();
const supportedZones = new Map<string, string | null>();
for (const [zone, codes] of Object.entries(airportTimeZoneGroups)) {
  for (const code of codes.split(" ")) zonesByCode.set(code, zone);
}

/** Stable source-derived options, rather than different server/browser Intl lists. */
export const flightTimeZoneOptions: readonly string[] = Object.freeze(["UTC", ...Object.keys(airportTimeZoneGroups).sort()]);

export function airportTimeZone(code: string | null | undefined): string | null {
  if (!code || !/^[A-Z]{3}$/u.test(code)) return null;
  const zone = zonesByCode.get(code);
  if (!zone) return null;
  // Cache only the finite catalog's zone IDs, never arbitrary user strings.
  if (!supportedZones.has(zone)) supportedZones.set(zone, canonicalTripTimeZone(zone));
  return supportedZones.get(zone) ?? null;
}

/** Exact code tokens only. City names, unknown/ambiguous codes and substrings are not airports. */
export function airportCodeFromLocation(value: string | null | undefined): string | null {
  if (!value || value.length > 500) return null;
  const text = value.normalize("NFKC").trim();
  const candidates = new Set<string>();
  const add = (code: string | undefined, explicitIata = false) => {
    // USA is also Concord's IATA code, but commonly appears as an address country.
    // Only an exact-code endpoint or an explicit IATA label disambiguates it.
    if (code && (code !== "USA" || explicitIata) && airportTimeZone(code)) candidates.add(code);
  };
  for (const match of text.matchAll(/(?:^|[^\p{L}\p{N}])\(([A-Z]{3})\)(?=$|[^\p{L}\p{N}])/gu)) add(match[1]);
  add(/^([A-Z]{3})$/u.exec(text)?.[1], true);
  add(/\bIATA\s*[:=]\s*([A-Z]{3})\b/u.exec(text)?.[1], true);
  add(/^([A-Z]{3})(?:\s*[-–—:]\s*|\s+(?:[Aa]irport|[Ii]nternational|[Tt]erminal|[Gg]ate|\([Tt]erminal|機場|空港))/u.exec(text)?.[1]);
  // An unqualified trailing token can be a country/address abbreviation, not an airport.
  // Do not silently pick one airport from an endpoint containing a whole route.
  const route = /(?:^|[^\p{L}\p{N}])([A-Z]{3})\s*(?:→|⇒|->|\/|\bto\b|至|往)\s*([A-Z]{3})(?=$|[^\p{L}\p{N}])/u.exec(text);
  if (route && airportTimeZone(route[1]) && airportTimeZone(route[2])) return null;
  return candidates.size === 1 ? [...candidates][0] : null;
}
