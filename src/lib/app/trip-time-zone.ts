/** Shared browser/server syntax guard: reject city names, abbreviations and offsets. */
const namedTimeZone = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+\-]+){1,2})$/u;
const supportedTimeZones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);
// Cards resolve the same few zones repeatedly. Cache accepted bounded IDs, never arbitrary
// failed user strings, to avoid constructing hundreds of Intl formatters for a large itinerary.
const canonicalZones = new Map<string, string>();

export function canonicalTripTimeZone(value: string): string | null {
  if (!namedTimeZone.test(value)) return null;
  const cached = canonicalZones.get(value);
  if (cached) return cached;
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    if (!supportedTimeZones.has(canonical)) return null;
    if (canonicalZones.size < 1024) canonicalZones.set(value, canonical);
    return canonical;
  } catch {
    return null;
  }
}

export function isTripTimeZone(value: string): boolean {
  return canonicalTripTimeZone(value) !== null;
}
