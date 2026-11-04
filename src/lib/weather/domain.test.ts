import { describe, expect, it } from "vitest";

import {
  WEATHER_FORECAST_HORIZON_MS,
  WEATHER_FRESHNESS_MS,
  closestHourlySampleIndex,
  decideWeatherRefresh,
  decodeWmoWeatherCode,
  eventWeatherTargets,
  isWeatherFresh,
  isWithinWeatherForecastWindow,
  normalizeWeatherLocationKey,
  primaryEventWeatherTarget,
} from "./domain";

describe("weather forecast eligibility and freshness", () => {
  const now = new Date("2026-09-03T00:00:00.000Z");

  it("includes now and the exact seven-day boundary", () => {
    expect(isWithinWeatherForecastWindow(new Date(now), now)).toBe(true);
    expect(
      isWithinWeatherForecastWindow(
        new Date(now.getTime() + WEATHER_FORECAST_HORIZON_MS),
        now,
      ),
    ).toBe(true);
  });

  it("excludes past, beyond-horizon, and invalid instants", () => {
    expect(isWithinWeatherForecastWindow(new Date(now.getTime() - 1), now)).toBe(false);
    expect(
      isWithinWeatherForecastWindow(
        new Date(now.getTime() + WEATHER_FORECAST_HORIZON_MS + 1),
        now,
      ),
    ).toBe(false);
    expect(isWithinWeatherForecastWindow(new Date("invalid"), now)).toBe(false);
  });

  it("uses a strict 30-minute cache lifetime", () => {
    expect(isWeatherFresh(new Date(now.getTime() - WEATHER_FRESHNESS_MS + 1), now)).toBe(true);
    expect(isWeatherFresh(new Date(now.getTime() - WEATHER_FRESHNESS_MS), now)).toBe(false);
    expect(isWeatherFresh(new Date(now.getTime() + 1), now)).toBe(false);
  });

  it("refreshes when forecast identity changes and reuses only matching fresh data", () => {
    const forecastAt = new Date("2026-09-03T12:00:00.000Z");
    const cached = {
      checkedAt: new Date("2026-09-02T23:45:00.000Z"),
      forecastAt,
      locationKey: "  東京   都 ",
    };
    expect(decideWeatherRefresh({ forecastAt, locationKey: "東京 都", now, cached })).toBe("use_cached");
    expect(
      decideWeatherRefresh({ forecastAt, locationKey: "大阪", now, cached }),
    ).toBe("refresh_input_changed");
    expect(
      decideWeatherRefresh({
        forecastAt: new Date(forecastAt.getTime() + 1),
        locationKey: "東京 都",
        now,
        cached,
      }),
    ).toBe("refresh_input_changed");
    expect(
      decideWeatherRefresh({
        forecastAt,
        locationKey: "東京 都",
        now,
        cached: { ...cached, checkedAt: new Date(now.getTime() - WEATHER_FRESHNESS_MS) },
      }),
    ).toBe("refresh_stale");

    expect(decideWeatherRefresh({
      forecastAt: new Date("2026-09-03T00:10:00.000Z"),
      locationKey: "東京 都",
      now,
      cached,
      forecastTimeMayAdvance: true,
    })).toBe("use_cached");
  });

  it("normalizes equivalent location text for stable cache keys", () => {
    expect(normalizeWeatherLocationKey("  ＴＯＫＹＯ\tStation  ")).toBe("tokyo station");
  });
});

describe("event weather targets", () => {
  it("uses the ordinary event location at its start", () => {
    expect(eventWeatherTargets({
      itemType: "meal",
      startsAt: "2026-09-04T10:00:00.000Z",
      locationName: "  Tokyo   Station ",
    })).toEqual([{
      role: "location",
      locationName: "Tokyo Station",
      locationKey: "tokyo station",
      forecastAt: new Date("2026-09-04T10:00:00.000Z"),
      forecastTimeKind: "scheduled",
    }]);
  });

  it("uses departure/start and destination/end for transport", () => {
    const input = {
      itemType: "transport",
      startsAt: "2026-09-04T01:00:00.000Z",
      endsAt: "2026-09-04T04:00:00.000Z",
      locationName: "ignored generic location",
      departureLocationName: "Tokyo",
      destinationLocationName: "Osaka",
    };
    expect(eventWeatherTargets(input)).toEqual([
      {
        role: "departure",
        locationName: "Tokyo",
        locationKey: "tokyo",
        forecastAt: new Date("2026-09-04T01:00:00.000Z"),
        forecastTimeKind: "scheduled",
      },
      {
        role: "destination",
        locationName: "Osaka",
        locationKey: "osaka",
        forecastAt: new Date("2026-09-04T04:00:00.000Z"),
        forecastTimeKind: "scheduled",
      },
    ]);
    expect(primaryEventWeatherTarget(input)?.role).toBe("destination");
  });

  it("supports one transport endpoint and a caller-supplied all-day instant", () => {
    const input = {
      itemType: "transport",
      startsAt: null,
      endsAt: null,
      departureLocationName: "",
      destinationLocationName: "Kyoto",
      fallbackForecastAt: "2026-09-05T03:00:00.000Z",
    };
    expect(eventWeatherTargets(input)).toEqual([{
      role: "destination",
      locationName: "Kyoto",
      locationKey: "kyoto",
      forecastAt: new Date("2026-09-05T03:00:00.000Z"),
      forecastTimeKind: "scheduled",
    }]);
    expect(primaryEventWeatherTarget(input)?.locationName).toBe("Kyoto");
  });

  it("does not invent a destination forecast time from departure, or vice versa", () => {
    expect(eventWeatherTargets({
      itemType: "transport",
      startsAt: "2026-09-04T01:00:00.000Z",
      endsAt: null,
      departureLocationName: "Tokyo",
      destinationLocationName: "Osaka",
      fallbackForecastAt: "2026-09-04T03:00:00.000Z",
    }).map((target) => target.role)).toEqual(["departure"]);

    expect(eventWeatherTargets({
      itemType: "transport",
      startsAt: null,
      endsAt: "2026-09-04T04:00:00.000Z",
      departureLocationName: "Tokyo",
      destinationLocationName: "Osaka",
      fallbackForecastAt: "2026-09-04T03:00:00.000Z",
    }).map((target) => target.role)).toEqual(["destination"]);
  });

  it("does not produce a target without both a usable location and instant", () => {
    expect(eventWeatherTargets({ itemType: "activity", locationName: "Tokyo" })).toEqual([]);
    expect(eventWeatherTargets({
      itemType: "activity",
      startsAt: "not-a-date",
      locationName: "Tokyo",
    })).toEqual([]);
  });

  it("uses current weather for an active timed event but keeps transport arrival weather", () => {
    const activeInput = {
      itemType: "activity",
      startsAt: "2026-09-03T09:00:00.000Z",
      endsAt: "2026-09-03T15:00:00.000Z",
      locationName: "Tokyo Big Sight",
      now: "2026-09-03T12:00:00.000Z",
    };
    expect(eventWeatherTargets(activeInput)).toEqual([expect.objectContaining({
      role: "location",
      forecastAt: new Date("2026-09-03T12:00:00.000Z"),
      forecastTimeKind: "active",
    })]);

    expect(eventWeatherTargets({
      ...activeInput,
      itemType: "transport",
      locationName: null,
      departureLocationName: "Tokyo",
      destinationLocationName: "Osaka",
    })).toEqual([
      expect.objectContaining({
        role: "departure",
        forecastAt: new Date("2026-09-03T09:00:00.000Z"),
        forecastTimeKind: "scheduled",
      }),
      expect.objectContaining({
        role: "destination",
        forecastAt: new Date("2026-09-03T15:00:00.000Z"),
        forecastTimeKind: "scheduled",
      }),
    ]);
  });

  it("uses current weather throughout the current trip-local untimed day", () => {
    expect(primaryEventWeatherTarget({
      itemType: "meal",
      startsAt: null,
      endsAt: null,
      locationName: "Ikebukuro",
      fallbackForecastAt: "2026-09-03T03:00:00.000Z",
      fallbackStartsAt: "2026-09-02T15:00:00.000Z",
      fallbackEndsAt: "2026-09-03T15:00:00.000Z",
      now: "2026-09-03T13:30:00.000Z",
    })).toMatchObject({
      forecastAt: new Date("2026-09-03T13:30:00.000Z"),
      forecastTimeKind: "active",
    });
  });

  it("uses an explicit end for an end-only event instead of an unrelated noon", () => {
    expect(primaryEventWeatherTarget({
      itemType: "activity",
      startsAt: null,
      endsAt: "2026-09-04T06:00:00.000Z",
      locationName: "Ueno",
      fallbackForecastAt: "2026-09-04T03:00:00.000Z",
    })?.forecastAt).toEqual(new Date("2026-09-04T06:00:00.000Z"));
  });
});

describe("WMO weather-code decoding", () => {
  it.each([
    [0, true, "clear", "sunny", 0],
    [0, false, "clear", "clear-night", 0],
    [2, false, "partly_cloudy", "partly-cloudy-night", 0],
    [3, true, "overcast", "cloudy", 1],
    [45, true, "fog", "fog", 2],
    [53, true, "drizzle", "drizzle", 1],
    [57, true, "freezing_drizzle", "freezing-rain", 3],
    [65, true, "rain", "rain", 3],
    [67, true, "freezing_rain", "freezing-rain", 4],
    [75, true, "snow", "snow", 4],
    [77, true, "snow_grains", "snow", 3],
    [82, true, "rain_showers", "showers", 4],
    [86, true, "snow_showers", "snow", 4],
    [99, true, "thunderstorm", "thunderstorm", 4],
    [42, true, "unknown", "unknown", 1],
  ] as const)("maps WMO code %s deterministically", (code, isDay, condition, icon, severity) => {
    expect(decodeWmoWeatherCode(code, isDay)).toEqual({
      condition,
      icon,
      displaySeverity: severity,
    });
  });
});

describe("closestHourlySampleIndex", () => {
  const hour0 = Date.parse("2026-09-03T00:00:00.000Z") / 1_000;

  it("selects the closest hour and resolves a tie to the earlier one", () => {
    expect(
      closestHourlySampleIndex(
        [hour0, hour0 + 3_600, hour0 + 7_200],
        new Date("2026-09-03T00:30:00.000Z"),
      ),
    ).toBe(0);
    expect(
      closestHourlySampleIndex(
        [hour0, hour0 + 3_600, hour0 + 7_200],
        new Date("2026-09-03T01:40:00.000Z"),
      ),
    ).toBe(2);
  });

  it("ignores malformed samples and rejects an invalid target", () => {
    expect(closestHourlySampleIndex([Number.NaN, hour0], new Date(hour0 * 1_000))).toBe(1);
    expect(closestHourlySampleIndex([hour0], new Date("invalid"))).toBeNull();
  });
});
