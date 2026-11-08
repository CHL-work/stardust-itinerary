import { placeTimeZoneGroups } from "@/lib/app/place-time-zones.generated";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

type PlaceZone = { zone: string; country: string; state: string };
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\p{M}/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const byName = new Map<string, PlaceZone[]>();
const countryNames = new Map<string, string>();
const countryDisplay = new Intl.DisplayNames(["en"], { type: "region" });
for (const [zone, country, state, names] of placeTimeZoneGroups) {
  countryNames.set(normalize(countryDisplay.of(country) ?? country), country);
  countryNames.set(country.toLowerCase(), country);
  for (const name of names.split("|")) {
    const entries = byName.get(name) ?? [];
    if (!entries.some(entry => entry.zone === zone && entry.country === country && entry.state === state)) {
      entries.push({ zone, country, state }); byName.set(name, entries);
    }
  }
}
for (const [name, country] of Object.entries({ usa: "US", "united states of america": "US", uk: "GB", "united kingdom": "GB",
  日本: "JP", 日本国: "JP", 香港: "HK", 臺灣: "TW", 台湾: "TW", 中国: "CN", 中國: "CN" })) countryNames.set(name, country);
const usStates: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const stateCodes = new Set(Object.values(usStates));

/** Local address evidence only. A city named in notes/title is never consulted or sent externally. */
export function placeTimeZone(location: string | null | undefined): string | null {
  if (!location || location.length > 500) return null;
  const rawParts = location.normalize("NFKC").split(/[,，、\n]/u).map(value => value.trim()).filter(Boolean);
  const parts = rawParts.map(normalize);
  // Country abbreviations count only as separate address components, not words inside a venue.
  const country = countryNames.get(parts.at(-1) ?? "");
  const lastCode = rawParts.at(-1)?.toUpperCase() ?? "";
  const countryOrState = country && stateCodes.has(lastCode) ? lastCode : undefined;
  let state: string | undefined;
  const stateParts = rawParts.slice(rawParts.length > 1 ? 1 : 0, country ? -1 : undefined);
  for (const part of stateParts) {
    const code = /(?:^|\s)([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/u.exec(part)?.[1];
    if (code && stateCodes.has(code)) state = code;
    const named = usStates[normalize(part.replace(/\s+\d{5}(?:-\d{4})?$/u, ""))];
    if (named) state = named;
  }
  const hits: PlaceZone[][] = [];
  const searchable = parts.length > 1 && !byName.has(parts[0]) ? parts.slice(1) : parts;
  for (const part of searchable) {
    const exact = byName.get(part);
    if (exact) { hits.push(exact); continue; }
    if (countryNames.has(part) || stateCodes.has(part.toUpperCase()) || usStates[part]) continue;
    const tokens = part.split(" ");
    for (let start = 0; start < tokens.length; start++) {
      for (let length = Math.min(8, tokens.length - start); length >= 1; length--) {
        const name = tokens.slice(start, start + length).join(" ");
        const matches = byName.get(name);
        if (!matches) continue;
        const rest = tokens.slice(start + length).join(" ");
        // An address locality is at its end, optionally followed by a state/postcode/country.
        // "Tokyo Sushi Bar" is not evidence for Tokyo. Namesakes in different zones stay unknown.
        if (!rest || /^(?:[a-z]{2} )?\d{4,7}$/u.test(rest) || stateCodes.has(rest.toUpperCase()) || usStates[rest] || countryNames.has(rest)) {
          hits.push(matches); break;
        }
      }
    }
    // Native Japanese addresses commonly have no word separator after their locality.
    for (let length = Math.min(20, part.length); length >= 2; length--) {
      const name = part.slice(0, length);
      if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(name)) continue;
      if (!/^[都道府県縣市区區郡]/u.test(part.slice(length))) continue;
      const matches = byName.get(name);
      if (matches) { hits.push(matches); break; }
    }
  }
  if (!hits.length) return null;
  const zones = new Set<string>();
  for (const candidates of hits) {
    const eligible = candidates.filter(entry => (!country || entry.country === country
      || Boolean(countryOrState && entry.country === "US" && entry.state === countryOrState))
      && (!state || country && country !== "US" || entry.country === "US" && entry.state === state));
    if (!eligible.length) return null;
    const unique = new Set(eligible.map(entry => canonicalTripTimeZone(entry.zone)).filter((zone): zone is string => Boolean(zone)));
    if (unique.size !== 1) return null;
    zones.add([...unique][0]);
  }
  return zones.size === 1 ? [...zones][0] : null;
}
