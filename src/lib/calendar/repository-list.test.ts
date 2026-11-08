import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { listCalendarState, type GoogleEvent } from "@/lib/calendar/repository";
import { encryptCalendarToken } from "@/lib/calendar/tokens";
import type { CalendarConflict } from "@/lib/domain/calendar-conflicts";

const config: AuthConfig = {
  appBaseUrl: new URL("http://localhost:3100"),
  allowedOrigins: new Set(["http://localhost:3100"]),
  authSecret: "calendar-list-test-secret-that-is-long-enough",
  databaseUrl: "postgresql://unused",
  googleClientId: "client-id",
  googleClientSecret: "client-secret",
  tripGraceDays: 2,
};

const session: AuthenticatedSession = {
  sessionId: "session-1", tripId: "trip-1", memberId: "member-1", userId: "user-1",
  role: "editor", displayName: "Member", issuer: "https://accounts.google.com",
  subject: "subject-1", generation: 0,
  expiresAt: new Date(Date.now() + 60_000),
  absoluteExpiresAt: new Date(Date.now() + 120_000),
};

type ItemRow = {
  id: string; title: string; item_type: string; location_name: string | null;
  starts_at: Date; ends_at: Date;
};
type LinkRow = { itinerary_item_id: string; provider_event_id: string };
type EventRow = Record<string, unknown> & { id: string };

function item(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "museum", title: "Museum visit", item_type: "activity", location_name: "Example Museum",
    starts_at: new Date("2030-04-01T10:00:00Z"), ends_at: new Date("2030-04-01T12:00:00Z"),
    ...overrides,
  };
}

function event(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "appointment", summary: "Dental appointment", status: "confirmed",
    start: { dateTime: "2030-04-01T11:00:00Z" },
    end: { dateTime: "2030-04-01T12:30:00Z" },
    ...overrides,
  };
}

function mockList(items: ItemRow[], pages: GoogleEvent[][], links: LinkRow[] = [], removedItemIds: string[] = []) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    void params;
    if (sql.includes("FROM trip_members tm")) {
      return { rows: [{ role: "editor", can_sync_calendar: true }], rowCount: 1 };
    }
    if (sql.includes("FROM calendar_connections")) {
      return {
        rows: [{
          access_token_encrypted: encryptCalendarToken(config.authSecret, "synthetic-access-token"),
          refresh_token_encrypted: null,
          token_expires_at: new Date(Date.now() + 3_600_000),
        }], rowCount: 1,
      };
    }
    if (sql.includes("FROM trips WHERE")) {
      return { rows: [{ starts_on: "2030-04-01", ends_on: "2030-04-05" }], rowCount: 1 };
    }
    if (sql.includes("FROM itinerary_items removed_item")) return {
      rows: removedItemIds.map((id) => ({ id })), rowCount: removedItemIds.length,
    };
    if (sql.includes("FROM itinerary_items")) return { rows: items, rowCount: items.length };
    if (sql.includes("FROM calendar_event_links")) return { rows: links, rowCount: links.length };
    throw new Error("Unexpected database query in read-only Calendar fixture.");
  });
  let page = 0;
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method ?? "GET").toBe("GET");
    const rows = pages[page++];
    if (!rows) throw new Error("Unexpected Calendar request.");
    return new Response(JSON.stringify({
      items: rows,
      ...(page < pages.length ? { nextPageToken: `page-${page + 1}` } : {}),
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { pool: { query } as unknown as Pool, query, fetchMock };
}

function rows(state: Record<string, unknown>): EventRow[] {
  return state.events as EventRow[];
}

afterEach(() => vi.unstubAllGlobals());

describe("Google Calendar conflict projection", () => {
  it("uses author time zones only for unresolved venues and never changes the provider instant", async () => {
    const times = { start: { dateTime: "2030-04-01T16:00:00-05:00", timeZone: "America/Chicago" },
      end: { dateTime: "2030-04-01T18:00:00-05:00", timeZone: "America/Chicago" } };
    const fixture = mockList([], [[
      event({ id: "slc", location: "Synthetic hotel, Salt Lake City", ...times }),
      event({ id: "unknown", location: "Synthetic unrecognized venue", ...times }),
    ]]);
    const result = rows(await listCalendarState(fixture.pool, config, session));
    expect(result.find(row => row.id === "slc")).toMatchObject({ startsAt: "2030-04-01T21:00:00.000Z", timeZones: null });
    expect(result.find(row => row.id === "unknown")).toMatchObject({ startsAt: "2030-04-01T21:00:00.000Z",
      timeZones: { start: "America/Chicago", end: "America/Chicago" } });
  });
  it("hides proven removed-event copies without deleting remote or unrelated Calendar entries", async () => {
    const fixture = mockList([item()], [[
      event({ id: "stored-removed-copy" }),
      event({ id: "property-removed-copy", extendedProperties: { private: {
        stardustTripId: "trip-1", stardustItemId: "removed-item",
      } } }),
      event({ id: "foreign-trip", extendedProperties: { private: {
        stardustTripId: "another-trip", stardustItemId: "removed-item",
      } } }),
      event({ id: "unrelated" }),
    ]], [{ itinerary_item_id: "removed-item", provider_event_id: "stored-removed-copy" }], ["removed-item"]);
    const state = await listCalendarState(fixture.pool, config, session);
    expect(rows(state).map((row) => row.id)).toEqual(["foreign-trip", "unrelated"]);
    expect(JSON.stringify(state)).not.toContain("removed-item");
    expect(fixture.query.mock.calls.every(([sql]) => sql.trimStart().startsWith("SELECT"))).toBe(true);
    expect(fixture.fetchMock.mock.calls.every((call) => (call[1]?.method ?? "GET") === "GET")).toBe(true);
    const removedQuery = fixture.query.mock.calls.find(([sql]) => sql.includes("FROM itinerary_items removed_item"));
    expect(removedQuery?.[0]).toContain("app_member_can_view_itinerary_item(removed_item.trip_id, removed_item.id, $2)");
  });
  it("preserves availability metadata and display rows while excluding nonblocking overlaps", async () => {
    const fixture = mockList([item()], [[
      event(),
      event({ id: "free", summary: "Availability note", transparency: "transparent" }),
      event({ id: "declined", attendees: [{ self: true, responseStatus: "declined" }] }),
      event({ id: "others-declined", summary: "Appointment with pending reply", attendees: [
        { self: false, responseStatus: "declined" }, { self: true, responseStatus: "needsAction" },
      ] }),
      event({ id: "work", eventType: "workingLocation" }),
      event({ id: "birthday", eventType: "birthday", start: { date: "2030-04-01" }, end: { date: "2030-04-02" } }),
      event({ id: "cancelled", status: "cancelled" }),
    ]]);
    const state = await listCalendarState(fixture.pool, config, session);
    expect(rows(state)).toHaveLength(6);
    expect(rows(state).find((row) => row.id === "free")).toMatchObject({ transparency: "transparent" });
    expect(rows(state).find((row) => row.id === "declined")).toMatchObject({ selfDeclined: true });
    expect(rows(state).find((row) => row.id === "others-declined")).toMatchObject({ selfDeclined: false });
    expect(rows(state).find((row) => row.id === "birthday")).toMatchObject({
      eventType: "birthday", allDay: true, startsAt: "2030-04-01T00:00:00.000Z",
    });
    expect((state.conflicts as CalendarConflict[]).map((conflict) => conflict.calendarEventId)).toEqual([
      "appointment", "others-declined",
    ]);
    expect(JSON.stringify(state)).not.toContain("attendees");
  });

  it("passes canonical lodging types to the detector and to multiple validated Calendar copies", async () => {
    const fixture = mockList([
      item(),
      item({ id: "hotel", title: "Example Lodge", item_type: "lodging" }),
    ], [[
      event(),
      event({ id: "hotel-db", summary: "My renamed stay" }),
      event({ id: "hotel-copy", summary: "Another renamed stay", extendedProperties: { private: {
        stardustTripId: "trip-1", stardustItemId: "hotel", privateFixture: "must-not-leak",
      } } }),
      event({ id: "museum-copy", summary: "My renamed museum event", extendedProperties: { private: {
        stardustTripId: "trip-1", stardustItemId: "museum",
      } } }),
    ]], [{ itinerary_item_id: "hotel", provider_event_id: "hotel-db" }]);
    const state = await listCalendarState(fixture.pool, config, session);
    for (const id of ["hotel-db", "hotel-copy"]) {
      expect(rows(state).find((row) => row.id === id)).toMatchObject({
        linkedItineraryItemId: "hotel", itemType: "lodging",
      });
    }
    expect(rows(state)).toHaveLength(4);
    expect(state.conflicts).toEqual([{
      itineraryItemId: "museum", itineraryTitle: "Museum visit",
      calendarEventId: "appointment", calendarTitle: "Dental appointment",
    }]);
    const [sql, params] = fixture.query.mock.calls.find(([sql]) => sql.includes("FROM itinerary_items"))!;
    expect(sql).toContain("item_type");
    expect(sql).toContain("location_name");
    expect(sql).toContain("app_member_can_view_itinerary_item(trip_id, id, $2)");
    expect(params).toEqual([session.tripId, session.memberId]);
    expect(JSON.stringify(state)).not.toContain("must-not-leak");
    expect(JSON.stringify(state)).not.toContain("extendedProperties");
  });

  it("does not resolve hidden, foreign-trip, or stale link IDs into itinerary metadata", async () => {
    const fixture = mockList([item()], [[
      event({ id: "hidden-properties", extendedProperties: { private: {
        stardustTripId: "trip-1", stardustItemId: "hidden-item",
      } } }),
      event({ id: "foreign-properties", extendedProperties: { private: {
        stardustTripId: "another-trip", stardustItemId: "museum",
      } } }),
      event({ id: "hidden-link" }),
    ]], [{ itinerary_item_id: "hidden-item", provider_event_id: "hidden-link" }]);
    const state = await listCalendarState(fixture.pool, config, session);
    for (const row of rows(state)) {
      expect(row.linkedItineraryItemId).toBeNull();
      expect(row.itemType).toBeUndefined();
    }
    expect(state.conflicts).toHaveLength(3);
    expect(JSON.stringify(state)).not.toContain("hidden-item");
    expect(JSON.stringify(state)).not.toContain("another-trip");
  });

  it("keeps unknown opaque all-day appointments and follows Calendar pagination", async () => {
    const fixture = mockList([item()], [
      [event({ id: "conference", summary: "Conference", transparency: "opaque", start: { date: "2030-04-01" }, end: { date: "2030-04-02" } })],
      [event({ id: "second-page" })],
    ]);
    const state = await listCalendarState(fixture.pool, config, session);
    expect(rows(state)).toHaveLength(2);
    expect(state.conflicts).toHaveLength(2);
    expect(fixture.fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fixture.fetchMock.mock.calls[1]![0])).toContain("pageToken=page-2");
    expect(fixture.query.mock.calls.every(([sql]) => sql.trimStart().startsWith("SELECT"))).toBe(true);
  });

  it("does not fail the complete Calendar read for malformed provider timestamps", async () => {
    const fixture = mockList([item()], [[
      event({ id: "bad-time", start: { dateTime: "not-a-date" } }),
      event({ id: "impossible-date", start: { date: "2030-02-30" }, end: { date: "2030-03-01" } }),
      event({ id: "invalid-end", end: { dateTime: "not-a-date" } }),
      event({ id: "valid-offset", start: { dateTime: "2030-04-01T20:00:00+09:00" } }),
      event({ id: "missing-end", end: undefined }),
    ]]);
    const state = await listCalendarState(fixture.pool, config, session);
    expect(rows(state).find((row) => row.id === "bad-time")?.startsAt).toBeNull();
    expect(rows(state).find((row) => row.id === "impossible-date")?.startsAt).toBeNull();
    expect(rows(state).find((row) => row.id === "invalid-end")?.endsAt).toBeNull();
    expect(rows(state).find((row) => row.id === "valid-offset")?.startsAt).toBe("2030-04-01T11:00:00.000Z");
    expect(rows(state)).toHaveLength(5);
    expect(rows(state).find((row) => row.id === "invalid-end")?.invalidTime).toBe(true);
    expect(rows(state).find((row) => row.id === "missing-end")?.invalidTime).toBe(false);
    expect((state.conflicts as CalendarConflict[]).map((conflict) => conflict.calendarEventId)).toEqual([
      "valid-offset", "missing-end",
    ]);
  });
});
