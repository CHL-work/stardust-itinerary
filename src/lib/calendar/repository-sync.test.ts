import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import {
  syncGoogleCalendarEvent,
  syncItineraryItemToCalendar,
} from "@/lib/calendar/repository";
import { encryptCalendarToken } from "@/lib/calendar/tokens";

const eventBody = {
  summary: "Dinner",
  description: "Stardust itinerary event",
  location: "Tokyo",
  start: { dateTime: "2026-09-01T10:00:00.000Z", timeZone: "Asia/Tokyo" },
  end: { dateTime: "2026-09-01T11:00:00.000Z", timeZone: "Asia/Tokyo" },
  extendedProperties: { private: { stardustTripId: "trip-1", stardustItemId: "item-1" } },
};

function successorId(eventId: string): string {
  return createHash("sha256")
    .update(`stardust-calendar-recovery\0${eventId}`)
    .digest("hex")
    .slice(0, 48);
}

type MockResponse = { status: number; body?: Record<string, unknown> };

function mockGoogleResponses(responses: MockResponse[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void input;
    void init;
    const response = responses.shift();
    if (!response) throw new Error("Unexpected Google Calendar request.");
    return new Response(response.body ? JSON.stringify(response.body) : null, {
      status: response.status,
      headers: response.body ? { "content-type": "application/json" } : undefined,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestMethod(call: [string | URL | Request, RequestInit?]): string {
  return (call[1]?.method ?? "GET").toUpperCase();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Calendar deleted-event recovery", () => {
  it("recreates a linked event when events.get returns a cancelled tombstone", async () => {
    const replacementId = successorId("deleted-event");
    const fetchMock = mockGoogleResponses([
      { status: 200, body: { id: "deleted-event", status: "cancelled" } },
      { status: 404 },
      {
        status: 200,
        body: {
          id: replacementId,
          status: "confirmed",
          htmlLink: "https://calendar.google.com/replacement",
          etag: "replacement-etag",
        },
      },
    ]);

    const result = await syncGoogleCalendarEvent(
      "access-token",
      "original-deterministic-id",
      "deleted-event",
      eventBody,
    );

    expect(result).toEqual({
      action: "recreated",
      remote: expect.objectContaining({
        id: replacementId,
        htmlLink: "https://calendar.google.com/replacement",
      }),
    });
    const postCall = fetchMock.mock.calls.find((call) => requestMethod(call) === "POST");
    expect(postCall).toBeDefined();
    const posted = JSON.parse(postCall?.[1]?.body as string) as { id: string };
    expect(posted.id).not.toBe("deleted-event");
    expect(posted.id).toMatch(/^[0-9a-f]{48}$/);
  });

  it("converges on the same replacement when a concurrent insert wins with 409", async () => {
    const replacementId = successorId("deleted-event");
    const fetchMock = mockGoogleResponses([
      { status: 200, body: { id: "deleted-event", status: "cancelled" } },
      { status: 404 },
      { status: 409 },
      { status: 200, body: { id: replacementId, status: "confirmed" } },
      {
        status: 200,
        body: {
          id: replacementId,
          status: "confirmed",
          htmlLink: "https://calendar.google.com/concurrent-replacement",
        },
      },
    ]);

    const result = await syncGoogleCalendarEvent(
      "access-token",
      "original-deterministic-id",
      "deleted-event",
      eventBody,
    );

    expect(result.action).toBe("recreated");
    expect(result.remote.htmlLink).toBe("https://calendar.google.com/concurrent-replacement");
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call) === "POST")).toHaveLength(1);
    const replacementGets = fetchMock.mock.calls
      .filter((call) => requestMethod(call) === "GET")
      .slice(1)
      .map((call) => call[0]);
    expect(replacementGets).toHaveLength(2);
    expect(replacementGets[0]).toBe(replacementGets[1]);
  });

  it("advances past a tombstoned 409 conflict instead of trying to patch the deleted event", async () => {
    const firstSuccessorId = successorId("deleted-event");
    const secondSuccessorId = successorId(firstSuccessorId);
    const fetchMock = mockGoogleResponses([
      { status: 200, body: { id: "deleted-event", status: "cancelled" } },
      { status: 404 },
      { status: 409 },
      { status: 200, body: { id: firstSuccessorId, status: "cancelled" } },
      { status: 404 },
      { status: 200, body: { id: secondSuccessorId, status: "confirmed" } },
    ]);

    const result = await syncGoogleCalendarEvent(
      "access-token",
      "original-deterministic-id",
      "deleted-event",
      eventBody,
    );

    expect(result).toEqual({
      action: "recreated",
      remote: { id: secondSuccessorId, status: "confirmed" },
    });
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call) === "POST")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call) === "PATCH")).toHaveLength(0);
  });

  it("moves to the next deterministic successor when a prior replacement is also tombstoned", async () => {
    const firstSuccessorId = successorId("deleted-event");
    const secondSuccessorId = successorId(firstSuccessorId);
    const fetchMock = mockGoogleResponses([
      { status: 200, body: { id: "deleted-event", status: "cancelled" } },
      { status: 200, body: { id: firstSuccessorId, status: "cancelled" } },
      { status: 404 },
      { status: 200, body: { id: secondSuccessorId, status: "confirmed" } },
    ]);

    const result = await syncGoogleCalendarEvent(
      "access-token",
      "original-deterministic-id",
      "deleted-event",
      eventBody,
    );

    expect(result).toEqual({
      action: "recreated",
      remote: { id: secondSuccessorId, status: "confirmed" },
    });
    const getUrls = fetchMock.mock.calls
      .filter((call) => requestMethod(call) === "GET")
      .map((call) => String(call[0]));
    expect(new Set(getUrls).size).toBe(3);
  });

  it("updates a persisted replacement ID without falling back to the original ID or inserting", async () => {
    const fetchMock = mockGoogleResponses([
      { status: 200, body: { id: "persisted-replacement", status: "confirmed" } },
      {
        status: 200,
        body: {
          id: "persisted-replacement",
          status: "confirmed",
          htmlLink: "https://calendar.google.com/persisted-replacement",
        },
      },
    ]);

    const result = await syncGoogleCalendarEvent(
      "access-token",
      "original-deterministic-id",
      "persisted-replacement",
      eventBody,
    );

    expect(result.action).toBe("updated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => String(call[0]).includes("persisted-replacement"))).toBe(true);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call) === "POST")).toHaveLength(0);
  });

  it("recreates with a new ID when a persisted provider event has aged out to 404", async () => {
    const replacementId = successorId("missing-linked-event");
    const fetchMock = mockGoogleResponses([
      { status: 404 },
      { status: 404 },
      { status: 200, body: { id: replacementId, status: "confirmed" } },
    ]);

    const result = await syncGoogleCalendarEvent(
      "access-token",
      "original-deterministic-id",
      "missing-linked-event",
      eventBody,
    );

    expect(result.action).toBe("recreated");
    expect(result.remote.id).toBe(replacementId);
    const posted = JSON.parse(
      fetchMock.mock.calls.find((call) => requestMethod(call) === "POST")?.[1]?.body as string,
    ) as { id: string };
    expect(posted.id).toBe(replacementId);
  });

  it("persists the recreated provider ID, link, revision, and audit action", async () => {
    const authSecret = "calendar-repository-test-secret-that-is-long-enough";
    const deletedEventId = "deleted-provider-event";
    const replacementId = successorId(deletedEventId);
    const fetchMock = mockGoogleResponses([
      { status: 200, body: { id: deletedEventId, status: "cancelled" } },
      { status: 404 },
      {
        status: 200,
        body: {
          id: replacementId,
          status: "confirmed",
          htmlLink: "https://calendar.google.com/recreated-event",
          etag: "recreated-etag",
        },
      },
    ]);
    let calendarItem = {
      id: "item-1",
      title: "Train to Kyoto",
      item_type: "transport",
      starts_at: new Date("2026-09-01T10:00:00.000Z"),
      ends_at: new Date("2026-09-01T11:00:00.000Z"),
      location_name: "Legacy transport location",
      departure_location_name: "Tokyo Station" as string | null,
      destination_location_name: "Kyoto Station" as string | null,
      notes: "Reserved seats" as string | null,
      status: "planned",
      current_revision: 7,
      time_zone: "Asia/Tokyo",
      flight: null as unknown,
    };
    let linkedProviderEventId: string | null = deletedEventId;
    const databaseQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.includes("FROM trip_members tm")) {
        return { rows: [{ role: "owner" }], rowCount: 1 };
      }
      if (sql.includes("FROM itinerary_items i")) {
        return { rows: [calendarItem], rowCount: 1 };
      }
      if (sql.includes("FROM calendar_connections")) {
        return {
          rows: [{
            access_token_encrypted: encryptCalendarToken(authSecret, "access-token"),
            refresh_token_encrypted: null,
            token_expires_at: new Date(Date.now() + 10 * 60_000),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM calendar_event_links")) {
        return linkedProviderEventId
          ? { rows: [{ provider_event_id: linkedProviderEventId }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT role FROM trip_members")) return { rows: [{ role: "owner" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: vi.fn(async () => ({ query: databaseQuery, release })),
    } as unknown as Pool;
    const config: AuthConfig = {
      appBaseUrl: new URL("http://localhost:3100"),
      allowedOrigins: new Set(["http://localhost:3100"]),
      authSecret,
      databaseUrl: "postgresql://unused",
      googleClientId: "client-id",
      googleClientSecret: "client-secret",
      tripGraceDays: 2,
    };
    const session: AuthenticatedSession = {
      sessionId: "session-1",
      tripId: "trip-1",
      memberId: "member-1",
      userId: "user-1",
      role: "owner",
      expiresAt: new Date(Date.now() + 60_000),
      absoluteExpiresAt: new Date(Date.now() + 120_000),
      displayName: "Owner",
      issuer: "https://accounts.google.com",
      subject: "subject-1",
      generation: 0,
    };

    const result = await syncItineraryItemToCalendar(
      pool,
      config,
      session,
      "trip-1",
      "item-1",
    );

    expect(result).toEqual({
      itemId: "item-1",
      eventId: replacementId,
      htmlLink: "https://calendar.google.com/recreated-event",
      action: "recreated",
    });
    const linkWrite = databaseQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO calendar_event_links"));
    expect(linkWrite?.[1]).toEqual([
      "trip-1",
      "item-1",
      "member-1",
      replacementId,
      "recreated-etag",
      "https://calendar.google.com/recreated-event",
      7,
    ]);
    const auditWrite = databaseQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO audit_events"));
    expect(auditWrite?.[1]?.[5]).toBe("calendar_recreated");
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call) === "POST")).toHaveLength(1);
    const recreatedBody = JSON.parse(
      fetchMock.mock.calls.find((call) => requestMethod(call) === "POST")?.[1]?.body as string,
    ) as { description: string; location: string };
    expect(recreatedBody.location).toBe("Kyoto Station");
    expect(recreatedBody.description).toContain("Transport route: Tokyo Station → Kyoto Station");
    expect(recreatedBody.description).toContain("Reserved seats");
    expect(recreatedBody.description).not.toContain("Legacy transport location");

    calendarItem = {
      ...calendarItem,
      departure_location_name: "Tokyo Station",
      destination_location_name: null,
      notes: null,
    };
    linkedProviderEventId = null;
    const departureFallbackFetch = mockGoogleResponses([
      { status: 404 },
      { status: 200, body: { id: "new-transport-event", status: "confirmed" } },
    ]);

    await syncItineraryItemToCalendar(pool, config, session, "trip-1", "item-1");

    const fallbackBody = JSON.parse(
      departureFallbackFetch.mock.calls.find((call) => requestMethod(call) === "POST")?.[1]?.body as string,
    ) as { description: string; location: string };
    expect(fallbackBody.location).toBe("Tokyo Station");
    expect(fallbackBody.description).toContain("Transport departure: Tokyo Station");
    expect(databaseQuery.mock.calls.filter(([sql]) => String(sql).includes("pg_advisory_lock"))).toHaveLength(2);
    expect(databaseQuery.mock.calls.filter(([sql]) => String(sql).includes("pg_advisory_unlock"))).toHaveLength(2);
    expect(release).toHaveBeenCalledTimes(2);

    calendarItem = { ...calendarItem, title: "Synthetic cross-zone flight", departure_location_name: "DFW", destination_location_name: "SLC",
      starts_at: new Date("2026-09-01T18:00:00Z"), ends_at: new Date("2026-09-01T20:00:00Z"),
      flight: { flightNumber: "ZZ123" } };
    const flightFetch = mockGoogleResponses([{ status: 404 }, { status: 200, body: { id: "synthetic-flight-event", status: "confirmed" } }]);
    await syncItineraryItemToCalendar(pool, config, session, "trip-1", "item-1");
    const flightBody = JSON.parse(flightFetch.mock.calls.find((call) => requestMethod(call) === "POST")?.[1]?.body as string);
    expect(flightBody.start).toEqual({ dateTime: "2026-09-01T18:00:00.000Z", timeZone: "America/Chicago" });
    expect(flightBody.end).toEqual({ dateTime: "2026-09-01T20:00:00.000Z", timeZone: "America/Denver" });
    expect(flightBody.description).not.toContain("ZZ123");
  });

  it("does not mark an event synced when it was removed during the Google request", async () => {
    const authSecret = "synthetic-calendar-removal-race-secret-long-enough";
    mockGoogleResponses([
      { status: 404 },
      { status: 200, body: { id: "remote-created", status: "confirmed" } },
    ]);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FOR SHARE OF i")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM itinerary_items i")) return { rows: [{ id: "item-1", title: "Visit",
        item_type: "activity", starts_at: new Date("2026-09-07T10:00:00Z"),
        ends_at: new Date("2026-09-07T11:00:00Z"), location_name: "Tokyo", notes: null,
        status: "planned", current_revision: 2, time_zone: "Asia/Tokyo" }], rowCount: 1 };
      if (sql.includes("FROM calendar_connections")) return { rows: [{
        access_token_encrypted: encryptCalendarToken(authSecret, "synthetic-token"), refresh_token_encrypted: null,
        token_expires_at: new Date(Date.now() + 10 * 60_000),
      }], rowCount: 1 };
      if (sql.includes("FROM calendar_event_links")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM trip_members")) return { rows: [{ role: "owner" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const pool = { connect: async () => ({ query, release }), query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Pool;
    const config = { authSecret, appBaseUrl: new URL("http://localhost:3100") } as AuthConfig;
    const session = { tripId: "trip-1", memberId: "member-1", userId: "user-1", role: "owner" } as AuthenticatedSession;
    await expect(syncItineraryItemToCalendar(pool, config, session, "trip-1", "item-1"))
      .rejects.toThrow("The event changed during Calendar sync.");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO calendar_event_links"))).toBe(false);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
