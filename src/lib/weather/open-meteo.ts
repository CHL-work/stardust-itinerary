import {
  closestHourlySampleIndex,
  decodeWmoWeatherCode,
  isWithinWeatherForecastWindow,
  type DecodedWeatherCode,
} from "./domain";

const OPEN_METEO_GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const FORECAST_HOURS = 169;
const DEFAULT_TIMEOUT_MS = 8_000;

export const OPEN_METEO_WEATHER_ATTRIBUTION = {
  text: "Weather data by Open-Meteo.com (derived)",
  url: "https://open-meteo.com/",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  modified: true,
} as const;

export const OPEN_METEO_GEOCODING_ATTRIBUTION = {
  text: "Location data by GeoNames via Open-Meteo",
  url: "https://open-meteo.com/en/docs/geocoding-api",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
} as const;

export type WeatherCoordinates = {
  latitude: number;
  longitude: number;
};

export type OpenMeteoLocation = WeatherCoordinates & {
  providerLocationId: number;
  name: string;
  countryCode: string | null;
  country: string | null;
  admin1: string | null;
  timezone: string | null;
};

export type OpenMeteoForecast = {
  provider: "open-meteo";
  forecastAt: string;
  sampledAt: string;
  fetchedAt: string;
  coordinates: WeatherCoordinates;
  providerGridCoordinates: WeatherCoordinates;
  providerTimezone: string;
  weatherCode: number;
  isDay: boolean;
  decoded: DecodedWeatherCode;
  temperatureCelsius: number | null;
  apparentTemperatureCelsius: number | null;
  precipitationProbabilityPercent: number | null;
  attribution: typeof OPEN_METEO_WEATHER_ATTRIBUTION;
};

export type OpenMeteoForecastResult =
  | { status: "outside_forecast_window" }
  | { status: "location_not_found" }
  | {
      status: "ok";
      location: OpenMeteoLocation | null;
      forecast: OpenMeteoForecast;
    };

export type OpenMeteoProviderErrorCode =
  | "invalid_request"
  | "request_failed"
  | "http_error"
  | "invalid_response";

export class OpenMeteoProviderError extends Error {
  constructor(
    readonly code: OpenMeteoProviderErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OpenMeteoProviderError";
  }
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ProviderOptions = {
  fetchFn?: FetchLike;
  now?: () => Date;
  requestTimeoutMs?: number;
};

type ForecastResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  times: number[];
  weatherCodes: Array<number | null>;
  isDay: Array<number | null>;
  temperatures: Array<number | null>;
  apparentTemperatures: Array<number | null>;
  precipitationProbabilities: Array<number | null>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireCoordinates(coordinates: WeatherCoordinates): void {
  if (
    !Number.isFinite(coordinates.latitude)
    || coordinates.latitude < -90
    || coordinates.latitude > 90
    || !Number.isFinite(coordinates.longitude)
    || coordinates.longitude < -180
    || coordinates.longitude > 180
  ) {
    throw new OpenMeteoProviderError(
      "invalid_request",
      "Weather coordinates must be valid WGS84 latitude and longitude values.",
    );
  }
}

function boundedProviderReason(value: unknown): string | null {
  const body = record(value);
  const reason = optionalString(body?.reason);
  return reason ? reason.slice(0, 240) : null;
}

function numericArray(
  value: unknown,
  expectedLength: number,
  field: string,
  required: boolean,
): Array<number | null> {
  if (value === undefined && !required) return Array.from({ length: expectedLength }, () => null);
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new OpenMeteoProviderError("invalid_response", `Open-Meteo returned invalid ${field} data.`);
  }
  return value.map((item) => {
    if (item === null) return null;
    const parsed = finiteNumber(item);
    if (parsed === null) {
      throw new OpenMeteoProviderError("invalid_response", `Open-Meteo returned invalid ${field} data.`);
    }
    return parsed;
  });
}

function parseForecastResponse(value: unknown): ForecastResponse {
  const body = record(value);
  const hourly = record(body?.hourly);
  const latitude = finiteNumber(body?.latitude);
  const longitude = finiteNumber(body?.longitude);
  const timezone = optionalString(body?.timezone);
  if (!body || !hourly || latitude === null || longitude === null || !timezone) {
    throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned an invalid forecast response.");
  }
  if (!Array.isArray(hourly.time) || hourly.time.length === 0) {
    throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned invalid hourly timestamps.");
  }
  const times = hourly.time.map((item) => {
    const parsed = finiteNumber(item);
    if (parsed === null) {
      throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned invalid hourly timestamps.");
    }
    return parsed;
  });
  return {
    latitude,
    longitude,
    timezone,
    times,
    weatherCodes: numericArray(hourly.weather_code, times.length, "weather-code", true),
    isDay: numericArray(hourly.is_day, times.length, "day/night", true),
    temperatures: numericArray(hourly.temperature_2m, times.length, "temperature", false),
    apparentTemperatures: numericArray(
      hourly.apparent_temperature,
      times.length,
      "apparent-temperature",
      false,
    ),
    precipitationProbabilities: numericArray(
      hourly.precipitation_probability,
      times.length,
      "precipitation-probability",
      false,
    ),
  };
}

function parseGeocodingResponse(value: unknown): OpenMeteoLocation | null {
  const body = record(value);
  if (!body) {
    throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned an invalid geocoding response.");
  }
  // The documented service currently omits `results` entirely when no match is
  // found, while an empty array is also a valid no-match representation.
  if (body.results === undefined) return null;
  if (!Array.isArray(body.results)) {
    throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned an invalid geocoding response.");
  }
  const candidate = body.results[0];
  if (candidate === undefined) return null;
  const result = record(candidate);
  const providerLocationId = finiteNumber(result?.id);
  const latitude = finiteNumber(result?.latitude);
  const longitude = finiteNumber(result?.longitude);
  const name = optionalString(result?.name);
  if (
    !result
    || providerLocationId === null
    || !Number.isInteger(providerLocationId)
    || latitude === null
    || longitude === null
    || !name
  ) {
    throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned an invalid geocoding result.");
  }
  const location = {
    providerLocationId,
    name,
    latitude,
    longitude,
    countryCode: optionalString(result.country_code),
    country: optionalString(result.country),
    admin1: optionalString(result.admin1),
    timezone: optionalString(result.timezone),
  };
  requireCoordinates(location);
  return location;
}

export function buildOpenMeteoGeocodingUrl(input: {
  query: string;
  language?: string;
  countryCode?: string;
}): URL {
  const query = input.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (query.length < 2 || query.length > 300) {
    throw new OpenMeteoProviderError(
      "invalid_request",
      "A weather location query must contain between 2 and 300 characters.",
    );
  }
  const language = (input.language ?? "en").trim().toLocaleLowerCase("en-US");
  if (!/^[a-z]{2,3}$/u.test(language)) {
    throw new OpenMeteoProviderError("invalid_request", "Weather geocoding requires a language code.");
  }
  const countryCode = input.countryCode?.trim().toLocaleUpperCase("en-US");
  if (countryCode && !/^[A-Z]{2}$/u.test(countryCode)) {
    throw new OpenMeteoProviderError("invalid_request", "Weather geocoding requires an ISO country code.");
  }

  const url = new URL(OPEN_METEO_GEOCODING_ENDPOINT);
  url.search = new URLSearchParams({
    name: query,
    count: "1",
    language,
    format: "json",
    ...(countryCode ? { countryCode } : {}),
  }).toString();
  return url;
}

export function buildOpenMeteoForecastUrl(coordinates: WeatherCoordinates): URL {
  requireCoordinates(coordinates);
  const url = new URL(OPEN_METEO_FORECAST_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "weather_code",
      "is_day",
    ].join(","),
    // 169 samples retain the nearest hourly point at the inclusive seven-day boundary.
    forecast_hours: String(FORECAST_HOURS),
    timeformat: "unixtime",
    timezone: "GMT",
    cell_selection: "land",
  }).toString();
  return url;
}

export class OpenMeteoWeatherProvider {
  private readonly fetchFn: FetchLike;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;
  /** One provider instance is scoped to one refresh run, so identical provider URLs share one response. */
  private readonly requestCache = new Map<string, Promise<unknown>>();

  constructor(options: ProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.requestTimeoutMs)
      || this.requestTimeoutMs < 500
      || this.requestTimeoutMs > 30_000
    ) {
      throw new OpenMeteoProviderError(
        "invalid_request",
        "The Open-Meteo request timeout must be between 500 and 30000 milliseconds.",
      );
    }
  }

  private requestJson(url: URL, externalSignal?: AbortSignal): Promise<unknown> {
    const cacheKey = url.toString();
    const existing = this.requestCache.get(cacheKey);
    if (existing) return existing;

    const request = this.requestJsonUncached(url, externalSignal);
    this.requestCache.set(cacheKey, request);
    return request;
  }

  private async requestJsonUncached(url: URL, externalSignal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
      response = await this.fetchFn(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: externalSignal
          ? AbortSignal.any([externalSignal, timeoutSignal])
          : timeoutSignal,
      });
    } catch {
      throw new OpenMeteoProviderError("request_failed", "Open-Meteo could not be reached.");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OpenMeteoProviderError(
        "invalid_response",
        "Open-Meteo returned a response that was not JSON.",
        response.status,
      );
    }
    if (!response.ok) {
      const reason = boundedProviderReason(body);
      throw new OpenMeteoProviderError(
        "http_error",
        reason ? `Open-Meteo rejected the request: ${reason}` : "Open-Meteo rejected the request.",
        response.status,
      );
    }
    return body;
  }

  async geocode(input: {
    query: string;
    language?: string;
    countryCode?: string;
    signal?: AbortSignal;
  }): Promise<OpenMeteoLocation | null> {
    const body = await this.requestJson(buildOpenMeteoGeocodingUrl(input), input.signal);
    return parseGeocodingResponse(body);
  }

  async forecastAtCoordinates(input: {
    coordinates: WeatherCoordinates;
    forecastAt: Date;
    now?: Date;
    signal?: AbortSignal;
  }): Promise<OpenMeteoForecastResult> {
    const fetchedAt = input.now ?? this.now();
    if (!isWithinWeatherForecastWindow(input.forecastAt, fetchedAt)) {
      return { status: "outside_forecast_window" };
    }
    requireCoordinates(input.coordinates);
    const body = await this.requestJson(buildOpenMeteoForecastUrl(input.coordinates), input.signal);
    const parsed = parseForecastResponse(body);
    const sampleIndex = closestHourlySampleIndex(parsed.times, input.forecastAt);
    if (sampleIndex === null) {
      throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned no usable forecast hour.");
    }
    const weatherCode = parsed.weatherCodes[sampleIndex];
    if (weatherCode === null || !Number.isInteger(weatherCode)) {
      throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned no weather code for the event.");
    }
    const sampledUnixSeconds = parsed.times[sampleIndex]!;
    const isDayCode = parsed.isDay[sampleIndex];
    if (isDayCode !== 0 && isDayCode !== 1) {
      throw new OpenMeteoProviderError("invalid_response", "Open-Meteo returned no day/night value for the event.");
    }
    const isDay = isDayCode === 1;
    return {
      status: "ok",
      location: null,
      forecast: {
        provider: "open-meteo",
        forecastAt: input.forecastAt.toISOString(),
        sampledAt: new Date(sampledUnixSeconds * 1_000).toISOString(),
        fetchedAt: fetchedAt.toISOString(),
        coordinates: {
          latitude: input.coordinates.latitude,
          longitude: input.coordinates.longitude,
        },
        providerGridCoordinates: {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
        },
        providerTimezone: parsed.timezone,
        weatherCode,
        isDay,
        decoded: decodeWmoWeatherCode(weatherCode, isDay),
        temperatureCelsius: parsed.temperatures[sampleIndex] ?? null,
        apparentTemperatureCelsius: parsed.apparentTemperatures[sampleIndex] ?? null,
        precipitationProbabilityPercent: parsed.precipitationProbabilities[sampleIndex] ?? null,
        attribution: OPEN_METEO_WEATHER_ATTRIBUTION,
      },
    };
  }

  async forecastAtLocation(input: {
    query: string;
    forecastAt: Date;
    language?: string;
    countryCode?: string;
    now?: Date;
    signal?: AbortSignal;
  }): Promise<OpenMeteoForecastResult> {
    const fetchedAt = input.now ?? this.now();
    if (!isWithinWeatherForecastWindow(input.forecastAt, fetchedAt)) {
      return { status: "outside_forecast_window" };
    }
    const location = await this.geocode(input);
    if (!location) return { status: "location_not_found" };
    const result = await this.forecastAtCoordinates({
      coordinates: location,
      forecastAt: input.forecastAt,
      now: fetchedAt,
      signal: input.signal,
    });
    if (result.status !== "ok") return result;
    return { ...result, location };
  }
}
