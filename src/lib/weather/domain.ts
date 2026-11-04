const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const WEATHER_FORECAST_HORIZON_MS = 7 * DAY_MS;
export const WEATHER_FRESHNESS_MS = 30 * MINUTE_MS;

export type WeatherCondition =
  | "clear"
  | "mainly_clear"
  | "partly_cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "freezing_drizzle"
  | "rain"
  | "freezing_rain"
  | "snow"
  | "snow_grains"
  | "rain_showers"
  | "snow_showers"
  | "thunderstorm"
  | "unknown";

export type WeatherIconKey =
  | "sunny"
  | "clear-night"
  | "partly-cloudy-day"
  | "partly-cloudy-night"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing-rain"
  | "snow"
  | "showers"
  | "thunderstorm"
  | "unknown";

export type DecodedWeatherCode = {
  condition: WeatherCondition;
  icon: WeatherIconKey;
  /** A deterministic display-order signal, not a safety classification. */
  displaySeverity: 0 | 1 | 2 | 3 | 4;
};

export type WeatherCacheIdentity = {
  checkedAt: Date;
  forecastAt: Date;
  locationKey: string;
};

export type WeatherRefreshDecision =
  | "outside_forecast_window"
  | "refresh_missing"
  | "refresh_input_changed"
  | "refresh_stale"
  | "use_cached";

export type EventWeatherTargetRole = "location" | "departure" | "destination";

/** A deliberately small structural input so this module does not own itinerary types. */
export type EventWeatherTargetInput = {
  itemType: string;
  startsAt?: string | null;
  endsAt?: string | null;
  locationName?: string | null;
  departureLocationName?: string | null;
  destinationLocationName?: string | null;
  /** The caller may supply trip-local noon for an all-day/untimed item. */
  fallbackForecastAt?: string | null;
  /** Trip-local bounds let a current all-day item use current weather. */
  fallbackStartsAt?: string | null;
  fallbackEndsAt?: string | null;
  now?: string | null;
};

export type EventWeatherTarget = {
  role: EventWeatherTargetRole;
  locationName: string;
  locationKey: string;
  forecastAt: Date;
  forecastTimeKind: "scheduled" | "active";
};

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

/**
 * The live forecast window is intentionally based on elapsed time rather than
 * calendar dates. This prevents an event just over seven days away in another
 * time zone from being fetched early.
 */
export function isWithinWeatherForecastWindow(
  forecastAt: Date,
  now: Date,
  horizonMs = WEATHER_FORECAST_HORIZON_MS,
): boolean {
  if (!validDate(forecastAt) || !validDate(now) || !Number.isFinite(horizonMs) || horizonMs < 0) {
    return false;
  }
  const leadTimeMs = forecastAt.getTime() - now.getTime();
  return leadTimeMs >= 0 && leadTimeMs <= horizonMs;
}

/** At exactly 30 minutes the cached value is stale and may be refreshed. */
export function isWeatherFresh(
  checkedAt: Date,
  now: Date,
  freshnessMs = WEATHER_FRESHNESS_MS,
): boolean {
  if (!validDate(checkedAt) || !validDate(now) || !Number.isFinite(freshnessMs) || freshnessMs < 0) {
    return false;
  }
  const ageMs = now.getTime() - checkedAt.getTime();
  return ageMs >= 0 && ageMs < freshnessMs;
}

export function normalizeWeatherLocationKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function parsedDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return validDate(parsed) ? parsed : null;
}

function target(
  role: EventWeatherTargetRole,
  locationName: string | null | undefined,
  forecastAt: Date | null,
): EventWeatherTarget | null {
  const normalizedName = locationName?.normalize("NFKC").trim().replace(/\s+/gu, " ") ?? "";
  const locationKey = normalizeWeatherLocationKey(normalizedName);
  if (!normalizedName || !locationKey || !forecastAt) return null;
  return {
    role,
    locationName: normalizedName,
    locationKey,
    forecastAt,
    forecastTimeKind: "scheduled",
  };
}

function containsInstant(start: Date | null, end: Date | null, instant: Date | null): boolean {
  return Boolean(
    start
    && end
    && instant
    && start.getTime() <= instant.getTime()
    && instant.getTime() < end.getTime(),
  );
}

/**
 * Produces deterministic weather lookup targets without sending titles, notes,
 * member names, or any other itinerary content to the provider. Transport may
 * yield two targets because departure and arrival weather can differ.
 */
export function eventWeatherTargets(input: EventWeatherTargetInput): EventWeatherTarget[] {
  const fallbackAt = parsedDate(input.fallbackForecastAt);
  const explicitStartsAt = parsedDate(input.startsAt);
  const explicitEndsAt = parsedDate(input.endsAt);
  const isUntimed = explicitStartsAt === null && explicitEndsAt === null;
  const departureAt = isUntimed ? fallbackAt : explicitStartsAt;
  const destinationAt = isUntimed ? fallbackAt : explicitEndsAt;
  let scheduledTargets: EventWeatherTarget[];
  if (input.itemType !== "transport") {
    const genericTarget = target(
      "location",
      input.locationName,
      explicitStartsAt ?? explicitEndsAt ?? fallbackAt,
    );
    scheduledTargets = genericTarget ? [genericTarget] : [];
  } else {
    scheduledTargets = [
      target("departure", input.departureLocationName, departureAt),
      target("destination", input.destinationLocationName, destinationAt),
    ].filter((item): item is EventWeatherTarget => item !== null);
  }

  const now = parsedDate(input.now);
  if (!now || scheduledTargets.length === 0) return scheduledTargets;

  const allDayIsActive = isUntimed && containsInstant(
    parsedDate(input.fallbackStartsAt),
    parsedDate(input.fallbackEndsAt),
    now,
  );
  const singleNonArrivalTargetIsActive = !isUntimed
    && scheduledTargets.length === 1
    && scheduledTargets[0]?.role !== "destination"
    && containsInstant(
      explicitStartsAt ?? parsedDate(input.fallbackStartsAt),
      explicitEndsAt,
      now,
    );

  if (!allDayIsActive && !singleNonArrivalTargetIsActive) return scheduledTargets;
  return scheduledTargets.map((item) => ({
    ...item,
    forecastAt: now,
    forecastTimeKind: "active" as const,
  }));
}

/** Destination/arrival is the primary transport badge; departure is the fallback. */
export function primaryEventWeatherTarget(
  input: EventWeatherTargetInput,
): EventWeatherTarget | null {
  const targets = eventWeatherTargets(input);
  return targets.find((item) => item.role === "destination") ?? targets[0] ?? null;
}

export function decideWeatherRefresh(input: {
  forecastAt: Date;
  locationKey: string;
  now: Date;
  cached: WeatherCacheIdentity | null;
  /** Active targets advance with `now`; a matching fresh cache still wins. */
  forecastTimeMayAdvance?: boolean;
}): WeatherRefreshDecision {
  if (!isWithinWeatherForecastWindow(input.forecastAt, input.now)) {
    return "outside_forecast_window";
  }
  if (!input.cached) return "refresh_missing";

  const requestedLocation = normalizeWeatherLocationKey(input.locationKey);
  const cachedLocation = normalizeWeatherLocationKey(input.cached.locationKey);
  if (
    !requestedLocation
    || requestedLocation !== cachedLocation
    || (
      !input.forecastTimeMayAdvance
      && input.forecastAt.getTime() !== input.cached.forecastAt.getTime()
    )
  ) {
    return "refresh_input_changed";
  }
  return isWeatherFresh(input.cached.checkedAt, input.now)
    ? "use_cached"
    : "refresh_stale";
}

export function decodeWmoWeatherCode(code: number, isDay: boolean): DecodedWeatherCode {
  if (!Number.isInteger(code)) {
    return { condition: "unknown", icon: "unknown", displaySeverity: 1 };
  }
  if (code === 0) {
    return { condition: "clear", icon: isDay ? "sunny" : "clear-night", displaySeverity: 0 };
  }
  if (code === 1) {
    return {
      condition: "mainly_clear",
      icon: isDay ? "partly-cloudy-day" : "partly-cloudy-night",
      displaySeverity: 0,
    };
  }
  if (code === 2) {
    return {
      condition: "partly_cloudy",
      icon: isDay ? "partly-cloudy-day" : "partly-cloudy-night",
      displaySeverity: 0,
    };
  }
  if (code === 3) return { condition: "overcast", icon: "cloudy", displaySeverity: 1 };
  if (code === 45 || code === 48) return { condition: "fog", icon: "fog", displaySeverity: 2 };
  if (code === 51 || code === 53 || code === 55) {
    return { condition: "drizzle", icon: "drizzle", displaySeverity: 1 };
  }
  if (code === 56 || code === 57) {
    return { condition: "freezing_drizzle", icon: "freezing-rain", displaySeverity: 3 };
  }
  if (code === 61 || code === 63 || code === 65) {
    return { condition: "rain", icon: "rain", displaySeverity: code === 65 ? 3 : 2 };
  }
  if (code === 66 || code === 67) {
    return { condition: "freezing_rain", icon: "freezing-rain", displaySeverity: 4 };
  }
  if (code === 71 || code === 73 || code === 75) {
    return { condition: "snow", icon: "snow", displaySeverity: code === 75 ? 4 : 3 };
  }
  if (code === 77) return { condition: "snow_grains", icon: "snow", displaySeverity: 3 };
  if (code === 80 || code === 81 || code === 82) {
    return { condition: "rain_showers", icon: "showers", displaySeverity: code === 82 ? 4 : 2 };
  }
  if (code === 85 || code === 86) {
    return { condition: "snow_showers", icon: "snow", displaySeverity: code === 86 ? 4 : 3 };
  }
  if (code === 95 || code === 96 || code === 99) {
    return { condition: "thunderstorm", icon: "thunderstorm", displaySeverity: code === 95 ? 3 : 4 };
  }
  return { condition: "unknown", icon: "unknown", displaySeverity: 1 };
}

/**
 * Selects the closest provider hour. An exact tie resolves to the earlier hour,
 * making the result stable across engines and preserving already-issued data.
 */
export function closestHourlySampleIndex(
  unixSeconds: readonly number[],
  forecastAt: Date,
): number | null {
  if (!validDate(forecastAt)) return null;
  const targetSeconds = forecastAt.getTime() / 1_000;
  let selectedIndex: number | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < unixSeconds.length; index += 1) {
    const candidate = unixSeconds[index];
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.abs(candidate - targetSeconds);
    if (distance < selectedDistance) {
      selectedIndex = index;
      selectedDistance = distance;
    }
  }
  return selectedIndex;
}
