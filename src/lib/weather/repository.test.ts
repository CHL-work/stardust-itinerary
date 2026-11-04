import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "@/lib/auth/repository";
import { OPEN_METEO_WEATHER_ATTRIBUTION } from "@/lib/weather/open-meteo";
import {
  refreshTripWeather,
  weatherLocationForItem,
  weatherLocationKey,
} from "@/lib/weather/repository";

const session: AuthenticatedSession = {
  sessionId: "session-1",
  tripId: "trip-1",
  memberId: "member-1",
  userId: "user-1",
  role: "owner",
  expiresAt: new Date("2026-09-04T00:00:00.000Z"),
  absoluteExpiresAt: new Date("2026-09-11T00:00:00.000Z"),
  displayName: "Owner",
  issuer: "https://accounts.google.com",
  subject: "subject-1",
  generation: 1,
};

const now = new Date("2026-09-03T00:00:00.000Z");

function candidateRow(input: {
  id: string;
  cached?: boolean;
  cachedPrecision?: "event" | "trip_destination";
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  const startsAt = input.startsAt === undefined
    ? new Date("2026-09-04T03:00:00.000Z")
    : input.startsAt;
  const locationKey = weatherLocationKey("Tokyo", "Japan");
  return {
    id: input.id,
    current_revision: 1,
    item_type: "activity" as string,
    starts_at: startsAt,
    ends_at: input.endsAt ?? null,
    day_start_at: new Date("2026-09-03T15:00:00.000Z"),
    day_noon_at: new Date("2026-09-04T03:00:00.000Z"),
    day_end_at: new Date("2026-09-04T15:00:00.000Z"),
    location_name: "Tokyo" as string | null,
    departure_location_name: null as string | null,
    destination_location_name: null as string | null,
    lookup_precision: "event" as "event" | "trip_destination",
    destination_name: "Japan",
    cached_item_revision: input.cached ? 1 : null,
    cached_forecast_at: input.cached ? startsAt : null,
    cached_location_key: input.cached ? locationKey : null,
    cached_location_label: input.cached ? "Tokyo" : null,
    cached_location_precision: input.cached ? input.cachedPrecision ?? "event" as const : null,
    cached_latitude: input.cached ? 35.68 : null,
    cached_longitude: input.cached ? 139.76 : null,
    cached_fetched_at: input.cached ? new Date("2026-09-02T23:45:00.000Z") : null,
  };
}

function cacheRow(
  row: ReturnType<typeof candidateRow>,
  targetRole: "location" | "departure" | "destination" = "location",
) {
  if (row.cached_item_revision === null) return null;
  return {
    itinerary_item_id: row.id,
    target_role: targetRole,
    cached_item_revision: row.cached_item_revision,
    cached_forecast_at: row.cached_forecast_at,
    cached_location_key: row.cached_location_key,
    cached_location_label: row.cached_location_label,
    cached_location_precision: row.cached_location_precision,
    cached_latitude: row.cached_latitude,
    cached_longitude: row.cached_longitude,
    cached_fetched_at: row.cached_fetched_at,
  };
}

function forecast(forecastAt: Date) {
  return {
    status: "ok" as const,
    location: {
      providerLocationId: 1,
      name: "Tokyo",
      latitude: 35.68,
      longitude: 139.76,
      countryCode: "JP",
      country: "Japan",
      admin1: "Tokyo",
      timezone: "Asia/Tokyo",
    },
    forecast: {
      provider: "open-meteo" as const,
      forecastAt: forecastAt.toISOString(),
      sampledAt: forecastAt.toISOString(),
      fetchedAt: now.toISOString(),
      coordinates: { latitude: 35.68, longitude: 139.76 },
      providerGridCoordinates: { latitude: 35.68, longitude: 139.76 },
      providerTimezone: "GMT",
      weatherCode: 0,
      isDay: true,
      decoded: { condition: "clear" as const, icon: "sunny" as const, displaySeverity: 0 as const },
      temperatureCelsius: 25,
      apparentTemperatureCelsius: 26,
      precipitationProbabilityPercent: 0,
      attribution: OPEN_METEO_WEATHER_ATTRIBUTION,
    },
  };
}

function fakePool(
  rows: ReturnType<typeof candidateRow>[],
  leaseAvailable = true,
  cacheRows = rows.flatMap((row) => {
    const cached = cacheRow(row);
    return cached ? [cached] : [];
  }),
) {
  const runParameters: unknown[][] = [];
  const forecastParameters: unknown[][] = [];
  const query = vi.fn(async (text: string, parameters?: unknown[]) => {
    if (text.includes("INSERT INTO weather_refresh_leases")) {
      return { rows: leaseAvailable ? [{ lease_token: parameters?.[2] }] : [], rowCount: leaseAvailable ? 1 : 0 };
    }
    if (text.includes("INSERT INTO event_weather_forecasts")) {
      forecastParameters.push(parameters ?? []);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("FROM itinerary_items i")) return { rows, rowCount: rows.length };
    if (text.includes("FROM event_weather_forecasts")) {
      return { rows: cacheRows, rowCount: cacheRows.length };
    }
    if (text.includes("INSERT INTO weather_refresh_runs")) {
      runParameters.push(parameters ?? []);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("DELETE FROM weather_refresh_leases")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected weather test query: ${text}`);
  });
  return { pool: { query } as unknown as Pool, query, runParameters, forecastParameters };
}

describe("weatherLocationForItem", () => {
  it("uses a normal event location and does not invent one", () => {
    expect(weatherLocationForItem({
      itemType: "meal",
      locationName: "  東京駅  ",
      departureLocationName: null,
      destinationLocationName: null,
    })).toBe("東京駅");
    expect(weatherLocationForItem({
      itemType: "activity",
      locationName: null,
      departureLocationName: "ignored",
      destinationLocationName: "ignored",
    })).toBeNull();
  });

  it("uses a transport destination first and departure as fallback", () => {
    expect(weatherLocationForItem({
      itemType: "transport",
      locationName: null,
      departureLocationName: "池袋駅",
      destinationLocationName: "東京駅",
    })).toBe("東京駅");
    expect(weatherLocationForItem({
      itemType: "transport",
      locationName: null,
      departureLocationName: "池袋駅",
      destinationLocationName: null,
    })).toBe("池袋駅");
  });
});

describe("weatherLocationKey", () => {
  it("uses a fixed-length identity even for maximum-length location inputs", () => {
    const key = weatherLocationKey("場".repeat(300), "Destination ".repeat(14));
    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect(weatherLocationKey(" Tokyo  Station ", " Tokyo ")).toBe(
      weatherLocationKey("tokyo station", "tokyo"),
    );
  });
});

describe("refreshTripWeather", () => {
  it("does not let fresh cached rows consume the bounded refresh batch", async () => {
    const rows = [
      ...Array.from({ length: 80 }, (_, index) => candidateRow({
        id: `cached-${index}`,
        cached: true,
      })),
      candidateRow({ id: "missing" }),
    ];
    const database = fakePool(rows);
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date; query: string }) => forecast(input.forecastAt)),
    };

    const result = await refreshTripWeather(database.pool, session, session.tripId, {
      provider,
      now,
    });

    expect(result).toMatchObject({
      candidateCount: 81,
      cacheHitCount: 80,
      refreshedCount: 1,
      failedCount: 0,
    });
    expect(provider.forecastAtLocation).toHaveBeenCalledOnce();
    expect(database.query.mock.calls.some(([sql]) => String(sql).includes("pg_try_advisory_lock"))).toBe(false);
  });

  it("uses current weather for an active long event without breaking the fresh cache rule", async () => {
    const active = candidateRow({
      id: "active",
      startsAt: new Date("2026-09-02T18:00:00.000Z"),
      endsAt: new Date("2026-09-03T06:00:00.000Z"),
    });
    const database = fakePool([active]);
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
    };

    await refreshTripWeather(database.pool, session, session.tripId, { provider, now });

    expect(provider.forecastAtLocation).toHaveBeenCalledWith(expect.objectContaining({
      forecastAt: now,
    }));
  });

  it("fetches and persists transport departure and destination as independent targets", async () => {
    const transport = {
      ...candidateRow({
        id: "transport",
        startsAt: new Date("2026-09-04T01:00:00.000Z"),
        endsAt: new Date("2026-09-04T04:00:00.000Z"),
      }),
      item_type: "transport",
      location_name: null,
      departure_location_name: "Tokyo Station",
      destination_location_name: "Osaka Station",
    };
    const database = fakePool([transport]);
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
    };

    const result = await refreshTripWeather(database.pool, session, session.tripId, {
      provider,
      now,
    });

    expect(result).toMatchObject({
      candidateCount: 2,
      cacheHitCount: 0,
      refreshedCount: 2,
      failedCount: 0,
    });
    expect(provider.forecastAtLocation).toHaveBeenCalledTimes(2);
    expect(provider.forecastAtLocation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      query: "Tokyo Station, Japan",
      forecastAt: new Date("2026-09-04T01:00:00.000Z"),
    }));
    expect(provider.forecastAtLocation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      query: "Osaka Station, Japan",
      forecastAt: new Date("2026-09-04T04:00:00.000Z"),
    }));
    expect(database.forecastParameters.map((parameters) => parameters[4])).toEqual([
      "departure",
      "destination",
    ]);
  });

  it("reuses each transport endpoint cache independently", async () => {
    const transport = {
      ...candidateRow({
        id: "partly-cached-transport",
        startsAt: new Date("2026-09-04T01:00:00.000Z"),
        endsAt: new Date("2026-09-04T04:00:00.000Z"),
      }),
      item_type: "transport",
      location_name: null,
      departure_location_name: "Tokyo Station",
      destination_location_name: "Osaka Station",
    };
    const database = fakePool([transport], true, [{
      itinerary_item_id: transport.id,
      target_role: "departure" as const,
      cached_item_revision: 1,
      cached_forecast_at: transport.starts_at,
      cached_location_key: weatherLocationKey("Tokyo Station", "Japan"),
      cached_location_label: "Tokyo Station",
      cached_location_precision: "event" as const,
      cached_latitude: 35.68,
      cached_longitude: 139.76,
      cached_fetched_at: new Date("2026-09-02T23:45:00.000Z"),
    }]);
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
    };

    const result = await refreshTripWeather(database.pool, session, session.tripId, {
      provider,
      now,
    });

    expect(result).toMatchObject({
      candidateCount: 2,
      cacheHitCount: 1,
      refreshedCount: 1,
      failedCount: 0,
    });
    expect(provider.forecastAtLocation).toHaveBeenCalledOnce();
    expect(provider.forecastAtLocation).toHaveBeenCalledWith(expect.objectContaining({
      query: "Osaka Station, Japan",
    }));
    expect(database.forecastParameters[0]?.[4]).toBe("destination");
  });

  it("never sends either private transport endpoint to the provider", async () => {
    const privateTransport = {
      ...candidateRow({
        id: "private-transport",
        startsAt: new Date("2026-09-04T01:00:00.000Z"),
        endsAt: new Date("2026-09-04T04:00:00.000Z"),
      }),
      item_type: "transport",
      location_name: null,
      departure_location_name: "Private departure",
      destination_location_name: "Private destination",
      lookup_precision: "trip_destination" as const,
    };
    const database = fakePool([privateTransport]);
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date; query: string }) => forecast(input.forecastAt)),
    };

    const result = await refreshTripWeather(database.pool, session, session.tripId, {
      provider,
      now,
    });

    expect(result).toMatchObject({
      candidateCount: 2,
      destinationFallbackCount: 2,
      refreshedCount: 2,
    });
    expect(provider.forecastAtLocation).toHaveBeenCalledTimes(2);
    for (const [input] of provider.forecastAtLocation.mock.calls) {
      expect(input.query).toBe("Japan");
    }
    expect(database.forecastParameters.map((parameters) => parameters[4])).toEqual([
      "departure",
      "destination",
    ]);
  });

  it("retries an exact public location after an earlier trip-area fallback", async () => {
    const staleFallback = candidateRow({
      id: "retry-exact",
      cached: true,
      cachedPrecision: "trip_destination",
    });
    staleFallback.cached_fetched_at = new Date("2026-09-02T23:00:00.000Z");
    const database = fakePool([staleFallback]);
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
    };

    await refreshTripWeather(database.pool, session, session.tripId, { provider, now });

    expect(provider.forecastAtCoordinates).not.toHaveBeenCalled();
    expect(provider.forecastAtLocation).toHaveBeenCalledOnce();
  });

  it("records a bounded failure when the run deadline expires", async () => {
    const database = fakePool([candidateRow({ id: "slow" })]);
    const provider = {
      forecastAtCoordinates: vi.fn(async () => new Promise<never>(() => undefined)),
      forecastAtLocation: vi.fn(async () => new Promise<never>(() => undefined)),
    };

    const result = await refreshTripWeather(database.pool, session, session.tripId, {
      provider,
      now,
      runBudgetMs: 5,
    });

    expect(result).toMatchObject({ candidateCount: 1, refreshedCount: 0, failedCount: 1 });
    expect(database.runParameters).toHaveLength(1);
    expect(database.runParameters[0]?.[3]).toBe("failed");
    expect(database.runParameters[0]?.[9]).toBe("weather_refresh_deadline");
  });

  it("caps provider work and records deferred candidates instead of hiding them", async () => {
    const database = fakePool(Array.from({ length: 81 }, (_, index) => candidateRow({
      id: `missing-${index}`,
    })));
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
    };

    const result = await refreshTripWeather(database.pool, session, session.tripId, {
      provider,
      now,
    });

    expect(result).toMatchObject({
      candidateCount: 81,
      refreshedCount: 80,
      failedCount: 1,
    });
    expect(provider.forecastAtLocation).toHaveBeenCalledTimes(80);
    expect(database.runParameters[0]?.[3]).toBe("partial");
    expect(database.runParameters[0]?.[9]).toBe("weather_refresh_batch_deferred");
  });

  it("returns immediately when another process owns the expiring database lease", async () => {
    const database = fakePool([candidateRow({ id: "ignored" })], false);
    const provider = {
      forecastAtCoordinates: vi.fn(),
      forecastAtLocation: vi.fn(),
    };

    await expect(refreshTripWeather(database.pool, session, session.tripId, {
      provider,
      now,
    })).resolves.toMatchObject({ status: "already_running", candidateCount: 0 });
    expect(provider.forecastAtLocation).not.toHaveBeenCalled();
    expect(database.runParameters).toHaveLength(0);
  });

  it("lets two members refresh their own private-visible candidates concurrently", async () => {
    const secondSession: AuthenticatedSession = {
      ...session,
      sessionId: "session-2",
      memberId: "member-2",
      userId: "user-2",
      role: "editor",
      displayName: "Second member",
    };
    const rowsByMember = new Map([
      [session.memberId, [{
        ...candidateRow({ id: "private-owner" }),
        location_name: "Japan",
        lookup_precision: "trip_destination" as const,
      }]],
      [secondSession.memberId, [{
        ...candidateRow({ id: "private-second" }),
        location_name: "Japan",
        lookup_precision: "trip_destination" as const,
      }]],
    ]);
    const activeLeases = new Set<string>();
    const persistedIds: string[] = [];
    const query = vi.fn(async (text: string, parameters?: unknown[]) => {
      if (text.includes("INSERT INTO weather_refresh_leases")) {
        expect(text).toContain("ON CONFLICT (trip_id, member_id)");
        const key = `${parameters?.[0]}:${parameters?.[1]}`;
        if (activeLeases.has(key)) return { rows: [], rowCount: 0 };
        activeLeases.add(key);
        return { rows: [{ lease_token: parameters?.[2] }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO event_weather_forecasts")) {
        persistedIds.push(String(parameters?.[1]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("FROM itinerary_items i")) {
        const rows = rowsByMember.get(String(parameters?.[1])) ?? [];
        return { rows, rowCount: rows.length };
      }
      if (text.includes("FROM event_weather_forecasts")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO weather_refresh_runs")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("DELETE FROM weather_refresh_leases")) {
        activeLeases.delete(`${parameters?.[0]}:${parameters?.[1]}`);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected concurrent weather test query: ${text}`);
    });
    const pool = { query } as unknown as Pool;
    const provider = {
      forecastAtCoordinates: vi.fn(async (input: { forecastAt: Date }) => forecast(input.forecastAt)),
      forecastAtLocation: vi.fn(async (input: { forecastAt: Date }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return forecast(input.forecastAt);
      }),
    };

    const [first, second] = await Promise.all([
      refreshTripWeather(pool, session, session.tripId, { provider, now }),
      refreshTripWeather(pool, secondSession, secondSession.tripId, { provider, now }),
    ]);

    expect(first).toMatchObject({ status: "completed", refreshedCount: 1 });
    expect(second).toMatchObject({ status: "completed", refreshedCount: 1 });
    expect(provider.forecastAtLocation).toHaveBeenCalledTimes(2);
    expect(persistedIds.sort()).toEqual(["private-owner", "private-second"]);
  });
});
