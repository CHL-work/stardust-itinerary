import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

export type ZonedEventTimeErrorCode = "invalidTimeZone" | "invalidLocalTime" | "ambiguousTime";

/** Public codes map to localized editor copy; no machine-local Date parsing or silent DST repair. */
export class ZonedEventTimeError extends Error {
  constructor(readonly code: ZonedEventTimeErrorCode) {
    super(code);
    this.name = "ZonedEventTimeError";
  }
}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const formatters = new Map<string, Intl.DateTimeFormat>();
const minutePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;
const instantPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::([0-5]\d)(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

function invalid(): never { throw new ZonedEventTimeError("invalidLocalTime"); }

function utcMilliseconds(parts: WallParts): number {
  // Date.UTC maps years 0–99 to 1900–1999. setUTCFullYear preserves the actual calendar year.
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function parseWall(value: string): WallParts {
  const match = minutePattern.exec(value);
  if (!match) invalid();
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const parts = { year, month, day, hour, minute, second: 0 };
  const date = new Date(utcMilliseconds(parts));
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59
    || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) invalid();
  return parts;
}

function parseInstant(value: string): number {
  const match = instantPattern.exec(value);
  if (!match) invalid();
  parseWall(match[1]);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) invalid();
  return time;
}

function formatter(zone: string): Intl.DateTimeFormat {
  const canonical = canonicalTripTimeZone(zone);
  if (!canonical) throw new ZonedEventTimeError("invalidTimeZone");
  const existing = formatters.get(canonical);
  if (existing) return existing;
  const value = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    timeZone: canonical, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", era: "short",
  });
  if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
  formatters.set(canonical, value);
  return value;
}

function partsAt(time: number, display: Intl.DateTimeFormat): WallParts {
  const fields = Object.fromEntries(display.formatToParts(new Date(time)).map(({ type, value }) => [type, value]));
  return { year: fields.era === "BC" ? 1 - Number(fields.year) : Number(fields.year), month: Number(fields.month), day: Number(fields.day),
    hour: Number(fields.hour), minute: Number(fields.minute), second: Number(fields.second) };
}

function wallAt(time: number, display: Intl.DateTimeFormat): string {
  const parts = partsAt(time, display);
  if (parts.year < 1 || parts.year > 9999) invalid();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function isoToWallTime(value: string | null | undefined, zone: string): string {
  const display = formatter(zone);
  return value ? wallAt(parseInstant(value), display) : "";
}

/**
 * Resolve an entered local minute to one instant. A stored instant whose displayed minute is
 * unchanged wins, preserving seconds/milliseconds and the chosen occurrence during a DST fold.
 * Otherwise a nonexistent minute or more than one matching instant is refused, never shifted.
 */
export function wallTimeToIso(value: string, zone: string, preferredExistingInstant?: string | null): string {
  const display = formatter(zone);
  const local = utcMilliseconds(parseWall(value));
  if (preferredExistingInstant) {
    try {
      const existing = parseInstant(preferredExistingInstant);
      if (wallAt(existing, display) === value) return new Date(existing).toISOString();
    } catch { /* An unusable prior value is not authority to choose a UTC instant. */ }
  }

  // Collect offsets on both sides of any nearby transition, including half-hour DST and skipped
  // calendar dates. Compare every candidate back through Intl rather than trusting an offset guess.
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour += 6) {
    const sample = local + hour * 3_600_000;
    offsets.add(utcMilliseconds(partsAt(sample, display)) - sample);
  }
  const matches = [...offsets].map(offset => local - offset)
    .filter(time => wallAt(time, display) === value);
  if (!matches.length) invalid();
  if (matches.length > 1) throw new ZonedEventTimeError("ambiguousTime");
  return new Date(matches[0]).toISOString();
}

export function minutesBetweenZonedTimes(
  startWall: string, startZone: string, endWall: string, endZone: string,
  preferred: { startsAt?: string | null; endsAt?: string | null } = {},
): number | null {
  if (!startWall || !endWall) return null;
  const start = Date.parse(wallTimeToIso(startWall, startZone, preferred.startsAt));
  const end = Date.parse(wallTimeToIso(endWall, endZone, preferred.endsAt));
  const minutes = Math.round((end - start) / 60_000);
  return minutes > 0 ? minutes : null;
}

/** Add elapsed minutes, not wall-clock minutes; the returned minute uses the destination's zone. */
export function addMinutesZoned(
  startWall: string, startZone: string, durationMinutes: number, endZone: string,
  preferredExistingStart?: string | null,
): string {
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) invalid();
  const end = new Date(Date.parse(wallTimeToIso(startWall, startZone, preferredExistingStart)) + durationMinutes * 60_000);
  if (!Number.isFinite(end.getTime()) || end.getUTCFullYear() < 1 || end.getUTCFullYear() > 9999) invalid();
  return isoToWallTime(end.toISOString(), endZone);
}
