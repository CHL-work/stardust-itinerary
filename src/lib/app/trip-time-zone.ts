/** Shared browser/server syntax guard: reject city names, abbreviations and offsets. */
const namedTimeZone = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+\-]+){1,2})$/u;
const supportedTimeZones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);

export function canonicalTripTimeZone(value: string): string | null {
  if (!namedTimeZone.test(value)) return null;
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    return supportedTimeZones.has(canonical) ? canonical : null;
  } catch {
    return null;
  }
}

export function isTripTimeZone(value: string): boolean {
  return canonicalTripTimeZone(value) !== null;
}
