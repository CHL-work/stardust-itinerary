import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { calendarSourceSchema, type CalendarSource, type CalendarSourceMetadata } from "./import-contracts";
import type { GoogleEvent } from "./repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { calendarFallbackTimeZones } from "./event-time-zones";

const previewSchema = z.object({
  version: z.literal(1), tripId: z.uuid(), memberId: z.uuid(), userId: z.uuid(),
  accountSubject: z.string().min(1).max(255), generation: z.uuid(), timeZone: z.string().min(1).max(100),
  etag: z.string().max(1000).nullable(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  source: calendarSourceSchema, expiresAt: z.number().int().positive(),
}).strict();
export type CalendarPreviewClaims = z.infer<typeof previewSchema>;

/** Convert an actual local midnight, rejecting skipped/nonexistent dates rather than inventing a time. */
export function calendarDateMidnight(date: string, timeZone: string): string {
  z.iso.date().parse(date);
  const desired = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = (instant: number) => Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  let instant = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const value = parts(instant);
    const wall = Date.parse(`${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}Z`);
    if (wall === desired) return new Date(instant).toISOString();
    instant += desired - wall;
  }
  throw new Error("Calendar date has no representable local midnight.");
}

export function normalizeCalendarImportSource(event: GoogleEvent, eventId: string, timeZone: string): CalendarSource {
  if (event.id !== eventId || event.status === "cancelled") throw new Error("Calendar source unavailable.");
  const allDay = typeof event.start?.date === "string" && typeof event.end?.date === "string"
    && event.start.dateTime === undefined && event.end.dateTime === undefined;
  let startsAt: string;
  let endsAt: string;
  if (allDay) {
    startsAt = calendarDateMidnight(event.start!.date!, timeZone);
    endsAt = calendarDateMidnight(event.end!.date!, timeZone);
  } else {
    if (event.start?.date !== undefined || event.end?.date !== undefined) throw new Error("Mixed Calendar time modes.");
    const dateTime = z.iso.datetime({ offset: true });
    startsAt = new Date(dateTime.parse(event.start?.dateTime)).toISOString();
    endsAt = new Date(dateTime.parse(event.end?.dateTime)).toISOString();
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("Calendar source has no positive duration.");
  const timeZones = !allDay && (event.start?.timeZone || event.end?.timeZone)
    ? calendarFallbackTimeZones(event.location, { start: event.start?.timeZone ?? null, end: event.end?.timeZone ?? null }) : null;
  return calendarSourceSchema.parse({ eventId, title: event.summary?.trim() || "Calendar event",
    location: event.location?.trim() || null, startsAt, endsAt, allDay,
    ...(timeZones ? { timeZones } : {}),
    startDate: allDay ? event.start!.date! : null, endDateExclusive: allDay ? event.end!.date! : null });
}

export function calendarSourceDigest(source: CalendarSource, etag: string | null): string {
  return createHash("sha256").update(JSON.stringify({ source, etag })).digest("hex");
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`stardust-calendar-import-v1\0${payload}`).digest();
}
export function createCalendarImportToken(secret: string, claims: CalendarPreviewClaims): string {
  const payload = Buffer.from(JSON.stringify(previewSchema.parse(claims))).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}
export function verifyCalendarImportToken(secret: string, session: AuthenticatedSession, token: string): CalendarPreviewClaims {
  if (token.length > 16000) throw new Error("Invalid Calendar preview.");
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra || !/^[\w-]+$/u.test(payload) || !/^[\w-]+$/u.test(supplied)) throw new Error("Invalid Calendar preview.");
  const actual = Buffer.from(supplied, "base64url");
  const expected = signature(payload, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid Calendar preview.");
  const claims = previewSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (claims.tripId !== session.tripId || claims.memberId !== session.memberId || claims.userId !== session.userId
      || claims.expiresAt <= Date.now() || claims.expiresAt > Date.now() + 10 * 60_000 + 5000) throw new Error("Expired or foreign Calendar preview.");
  return claims;
}

export function calendarSourceMetadata(snapshot: unknown, startsAt: string | null | undefined, endsAt: string | null | undefined): CalendarSourceMetadata | undefined {
  const source = calendarSourceSchema.safeParse(snapshot);
  if (!source.success || !startsAt || !endsAt || Date.parse(startsAt) !== Date.parse(source.data.startsAt)
      || Date.parse(endsAt) !== Date.parse(source.data.endsAt)) return undefined;
  return { allDay: source.data.allDay, startDate: source.data.startDate, endDateExclusive: source.data.endDateExclusive,
    sourceStartsAt: source.data.startsAt, sourceEndsAt: source.data.endsAt };
}
