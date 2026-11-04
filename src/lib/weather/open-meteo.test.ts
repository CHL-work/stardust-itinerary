import { describe, expect, it, vi } from "vitest";

import {
  OPEN_METEO_WEATHER_ATTRIBUTION,
  OpenMeteoProviderError,
  OpenMeteoWeatherProvider,
  buildOpenMeteoForecastUrl,
  buildOpenMeteoGeocodingUrl,
} from "./open-meteo";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function forecastBody(times: number[]) {
  return {
    latitude: 35.69,
    longitude: 139.69,
    timezone: "GMT",
    hourly: {
      time: times,
      weather_code: [0, 61],
      is_day: [0, 1],
      temperature_2m: [23.1, 25.2],
      apparent_temperature: [23.8, 27.4],
      precipitation_probability: [5, 72],
    },
  };
}

describe("Open-Meteo request construction", () => {
  it("encodes localized geocoding input and an unambiguous country filter", () => {
    const url = buildOpenMeteoGeocodingUrl({
      query: "  東京   Station ",
      language: "JA",
      countryCode: "jp",
    });
    expect(url.origin).toBe("https://geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("東京 Station");
    expect(url.searchParams.get("count")).toBe("1");
    expect(url.searchParams.get("language")).toBe("ja");
    expect(url.searchParams.get("countryCode")).toBe("JP");
  });

  it("requests bounded UTC hourly fields for best-match forecasting", () => {
    const url = buildOpenMeteoForecastUrl({ latitude: 35.6812, longitude: 139.7671 });
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.searchParams.get("forecast_hours")).toBe("169");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(url.searchParams.get("timezone")).toBe("GMT");
    expect(url.searchParams.get("hourly")?.split(",")).toEqual([
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "weather_code",
      "is_day",
    ]);
  });

  it("rejects malformed geocoding and coordinate inputs before a request", () => {
    expect(() => buildOpenMeteoGeocodingUrl({ query: "x" })).toThrow(OpenMeteoProviderError);
    expect(() => buildOpenMeteoForecastUrl({ latitude: 91, longitude: 0 })).toThrow(
      /WGS84/,
    );
  });
});

describe("OpenMeteoWeatherProvider", () => {
  const now = new Date("2026-09-03T00:00:00.000Z");
  const hour0 = now.getTime() / 1_000;

  it("does no network work for events outside the seven-day window", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    const provider = new OpenMeteoWeatherProvider({ fetchFn, now: () => now });
    await expect(
      provider.forecastAtLocation({
        query: "Tokyo",
        forecastAt: new Date("2026-09-10T00:00:00.001Z"),
      }),
    ).resolves.toEqual({ status: "outside_forecast_window" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([{ results: [] }, { generationtime_ms: 0.1 }])(
    "reports an unresolved location without requesting a forecast",
    async (body) => {
      const fetchFn = vi.fn(async () => jsonResponse(body));
      const provider = new OpenMeteoWeatherProvider({ fetchFn, now: () => now });
      await expect(
        provider.forecastAtLocation({
          query: "Unknown locality",
          forecastAt: new Date("2026-09-04T00:00:00.000Z"),
        }),
      ).resolves.toEqual({ status: "location_not_found" });
      expect(fetchFn).toHaveBeenCalledOnce();
    },
  );

  it("geocodes, selects the nearest event hour, and returns a normalized forecast", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === "geocoding-api.open-meteo.com") {
        return jsonResponse({
          results: [{
            id: 1850147,
            name: "Tokyo",
            latitude: 35.6895,
            longitude: 139.6917,
            country_code: "JP",
            country: "Japan",
            admin1: "Tokyo",
            timezone: "Asia/Tokyo",
          }],
        });
      }
      return jsonResponse(forecastBody([hour0, hour0 + 3_600]));
    });
    const provider = new OpenMeteoWeatherProvider({ fetchFn, now: () => now });
    const result = await provider.forecastAtLocation({
      query: "Tokyo",
      countryCode: "JP",
      language: "en",
      forecastAt: new Date("2026-09-03T00:40:00.000Z"),
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected a weather forecast.");
    expect(result.location).toMatchObject({
      providerLocationId: 1850147,
      name: "Tokyo",
      countryCode: "JP",
    });
    expect(result.forecast).toMatchObject({
      provider: "open-meteo",
      sampledAt: "2026-09-03T01:00:00.000Z",
      fetchedAt: now.toISOString(),
      coordinates: { latitude: 35.6895, longitude: 139.6917 },
      providerGridCoordinates: { latitude: 35.69, longitude: 139.69 },
      weatherCode: 61,
      isDay: true,
      decoded: { condition: "rain", icon: "rain", displaySeverity: 2 },
      temperatureCelsius: 25.2,
      apparentTemperatureCelsius: 27.4,
      precipitationProbabilityPercent: 72,
      attribution: OPEN_METEO_WEATHER_ATTRIBUTION,
    });
    expect(Object.keys(result.forecast.coordinates).sort()).toEqual(["latitude", "longitude"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("coalesces identical geocoding and forecast HTTP work within one refresh run", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === "geocoding-api.open-meteo.com") {
        return jsonResponse({
          results: [{
            id: 1850147,
            name: "Tokyo",
            latitude: 35.6895,
            longitude: 139.6917,
          }],
        });
      }
      return jsonResponse(forecastBody([hour0, hour0 + 3_600]));
    });
    const provider = new OpenMeteoWeatherProvider({ fetchFn, now: () => now });

    const [first, second] = await Promise.all([
      provider.forecastAtLocation({
        query: "Tokyo",
        forecastAt: new Date("2026-09-03T00:10:00.000Z"),
      }),
      provider.forecastAtLocation({
        query: "Tokyo",
        forecastAt: new Date("2026-09-03T00:50:00.000Z"),
      }),
    ]);

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects misaligned or missing provider arrays", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      ...forecastBody([hour0, hour0 + 3_600]),
      hourly: {
        ...forecastBody([hour0, hour0 + 3_600]).hourly,
        weather_code: [0],
      },
    }));
    const provider = new OpenMeteoWeatherProvider({ fetchFn, now: () => now });
    await expect(
      provider.forecastAtCoordinates({
        coordinates: { latitude: 35.68, longitude: 139.76 },
        forecastAt: new Date("2026-09-03T00:20:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("surfaces a bounded provider error without exposing the request URL", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ reason: "bad parameter" }, 400));
    const provider = new OpenMeteoWeatherProvider({ fetchFn, now: () => now });
    await expect(
      provider.geocode({ query: "Tokyo" }),
    ).rejects.toMatchObject({
      code: "http_error",
      status: 400,
      message: "Open-Meteo rejected the request: bad parameter",
    });
  });
});
