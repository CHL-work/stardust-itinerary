import { describe, expect, it, vi, afterEach } from "vitest";
import { calendarDateMidnight, calendarSourceDigest, calendarSourceMetadata, createCalendarImportToken,
  normalizeCalendarImportSource, verifyCalendarImportToken, type CalendarPreviewClaims } from "./import-source";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { calendarImportInputSchema } from "./import-contracts";

const session = { tripId: "10000000-0000-4000-8000-000000000001", memberId: "10000000-0000-4000-8000-000000000002",
  userId: "10000000-0000-4000-8000-000000000003" } as AuthenticatedSession;
const source = normalizeCalendarImportSource({ id: "source123", summary: "Museum visit", location: "Example Museum",
  start: { dateTime: "2030-04-01T10:00:00+09:00" }, end: { dateTime: "2030-04-01T12:00:00+09:00" } }, "source123", "Asia/Tokyo");
function claims(): CalendarPreviewClaims { return { version: 1, ...session, accountSubject: "calendar-not-app-account",
  generation: "10000000-0000-4000-8000-000000000004", timeZone: "Asia/Tokyo", etag: "source-version", source,
  digest: calendarSourceDigest(source, "source-version"), expiresAt: Date.now() + 600_000 }; }
afterEach(() => vi.useRealTimers());

describe("Calendar import source times", () => {
  it("normalizes exact source timestamps without copying description, attendees or booking data", () => {
    expect(source.startsAt).toBe("2030-04-01T01:00:00.000Z");
    expect(Object.keys(source).sort()).toEqual(["allDay", "endDateExclusive", "endsAt", "eventId", "location", "startDate", "startsAt", "title"]);
  });
  it("keeps date-only exclusive all-day semantics at trip-local midnights", () => {
    const value = normalizeCalendarImportSource({ id: "source123", start: { date: "2030-04-01" }, end: { date: "2030-04-03" } }, "source123", "Asia/Tokyo");
    expect(value).toMatchObject({ allDay: true, startDate: "2030-04-01", endDateExclusive: "2030-04-03",
      startsAt: "2030-03-31T15:00:00.000Z", endsAt: "2030-04-02T15:00:00.000Z" });
  });
  it("handles a 23-hour DST day without a fabricated fixed duration", () => {
    const start = calendarDateMidnight("2030-03-10", "America/New_York");
    const end = calendarDateMidnight("2030-03-11", "America/New_York");
    expect(Date.parse(end) - Date.parse(start)).toBe(23 * 3_600_000);
  });
  it("rejects a skipped local date", () => expect(() => calendarDateMidnight("2011-12-30", "Pacific/Apia")).toThrow());
  it.each([
    { id: "foreign-event" }, { id: "source123", status: "cancelled" },
    { id: "source123", start: { date: "2030-04-01" }, end: { dateTime: "2030-04-02T00:00:00Z" } },
    { id: "source123", start: { dateTime: "2030-04-01T10:00:00" }, end: { dateTime: "2030-04-01T11:00:00Z" } },
    { id: "source123", start: { date: "2030-02-30" }, end: { date: "2030-03-01" } },
    { id: "source123", start: { date: "2030-04-01" }, end: { date: "2030-04-01" } },
  ])("rejects malformed, foreign and nonpositive source #%#", (event) => expect(() => normalizeCalendarImportSource(event, "source123", "Asia/Tokyo")).toThrow());
  it("omits all-day metadata after canonical/pending times are edited", () => {
    expect(calendarSourceMetadata(source, source.startsAt, source.endsAt)).toMatchObject({ sourceStartsAt: source.startsAt });
    expect(calendarSourceMetadata(source, "2030-04-01T00:00:00.000Z", source.endsAt)).toBeUndefined();
    expect(calendarSourceMetadata(source, source.startsAt, null)).toBeUndefined();
    expect(calendarSourceMetadata({ description: "not a source" }, source.startsAt, source.endsAt)).toBeUndefined();
  });
});

describe("signed private Calendar import preview", () => {
  it("binds immutable actor, exact account/source/generation and date semantics", () => {
    const expected = claims();
    const token = createCalendarImportToken("synthetic-test-secret", expected);
    expect(verifyCalendarImportToken("synthetic-test-secret", session, token)).toEqual(expected);
    expect(() => verifyCalendarImportToken("wrong-secret", session, token)).toThrow();
    expect(() => verifyCalendarImportToken("synthetic-test-secret", { ...session, userId: "10000000-0000-4000-8000-000000000009" }, token)).toThrow();
  });
  it("rejects expiration and excessive future lifetimes", () => {
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
    const token = createCalendarImportToken("secret", claims());
    vi.spyOn(Date, "now").mockReturnValue(now + 600_001);
    expect(() => verifyCalendarImportToken("secret", session, token)).toThrow();
    expect(() => verifyCalendarImportToken("secret", session, createCalendarImportToken("secret", { ...claims(), expiresAt: now + 10_000_000 }))).toThrow();
    vi.restoreAllMocks();
  });
  it("detects source edits even if etag is absent", () => {
    expect(calendarSourceDigest(source, null)).not.toBe(calendarSourceDigest({ ...source, title: "Changed source" }, null));
  });
  it("does not accept browser changes to source title, times or unsigned AI authority", () => {
    for (const extra of [{ title: "Changed" }, { startsAt: source.startsAt }, { aiAssisted: true }, { allDay: true }]) {
      expect(calendarImportInputSchema.safeParse({ previewToken: "test", ...extra }).success).toBe(false);
    }
  });
});
