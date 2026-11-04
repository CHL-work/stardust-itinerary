import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { assertTrip } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import {
  decideWeatherRefresh,
  eventWeatherTargets,
  isWithinWeatherForecastWindow,
  normalizeWeatherLocationKey,
  type EventWeatherTargetRole,
  WEATHER_FRESHNESS_MS,
} from "@/lib/weather/domain";
import {
  OpenMeteoProviderError,
  OpenMeteoWeatherProvider,
  type OpenMeteoForecast,
  type OpenMeteoForecastResult,
} from "@/lib/weather/open-meteo";

const MAX_WEATHER_REFRESHES_PER_RUN = 80;
const WEATHER_PROVIDER_CONCURRENCY = 8;
const DEFAULT_WEATHER_RUN_BUDGET_MS = 25_000;
const MAX_WEATHER_RUN_BUDGET_MS = 30_000;
const WEATHER_LEASE_MS = 60_000;

type WeatherProvider = {
  forecastAtCoordinates: (
    input: Parameters<OpenMeteoWeatherProvider["forecastAtCoordinates"]>[0],
  ) => Promise<OpenMeteoForecastResult>;
  forecastAtLocation: (
    input: Parameters<OpenMeteoWeatherProvider["forecastAtLocation"]>[0],
  ) => Promise<OpenMeteoForecastResult>;
};

type WeatherCandidateRow = {
  id: string;
  current_revision: number;
  item_type: string;
  starts_at: Date | null;
  ends_at: Date | null;
  day_start_at: Date;
  day_noon_at: Date;
  day_end_at: Date;
  location_name: string | null;
  departure_location_name: string | null;
  destination_location_name: string | null;
  lookup_precision: "event" | "trip_destination";
  destination_name: string;
};

type WeatherCacheRow = {
  itinerary_item_id: string;
  target_role: EventWeatherTargetRole;
  cached_item_revision: number | null;
  cached_forecast_at: Date | null;
  cached_location_key: string | null;
  cached_location_label: string | null;
  cached_location_precision: "event" | "trip_destination" | null;
  cached_latitude: number | null;
  cached_longitude: number | null;
  cached_fetched_at: Date | null;
};

type WeatherCandidate = {
  id: string;
  target_role: EventWeatherTargetRole;
  current_revision: number;
  forecast_at: Date;
  location_label: string;
  lookup_precision: "event" | "trip_destination";
  destination_name: string;
  location_key: string;
  forecast_time_may_advance: boolean;
  cached_item_revision: number | null;
  cached_forecast_at: Date | null;
  cached_location_key: string | null;
  cached_location_label: string | null;
  cached_location_precision: "event" | "trip_destination" | null;
  cached_latitude: number | null;
  cached_longitude: number | null;
  cached_fetched_at: Date | null;
};

class WeatherRunDeadlineError extends Error {
  constructor() {
    super("The bounded weather refresh window elapsed.");
    this.name = "WeatherRunDeadlineError";
  }
}

export type WeatherRefreshResult = {
  status: "completed" | "already_running";
  candidateCount: number;
  cacheHitCount: number;
  refreshedCount: number;
  destinationFallbackCount: number;
  failedCount: number;
};

export function weatherLocationKey(location: string, tripDestination: string): string {
  const identity = JSON.stringify({
    location: normalizeWeatherLocationKey(location),
    tripDestination: normalizeWeatherLocationKey(tripDestination),
  });
  return createHash("sha256").update(identity).digest("hex");
}

export function weatherLocationForItem(input: {
  itemType: string;
  locationName: string | null;
  departureLocationName: string | null;
  destinationLocationName: string | null;
}): string | null {
  if (input.itemType === "transport") {
    return input.destinationLocationName?.trim()
      || input.departureLocationName?.trim()
      || null;
  }
  return input.locationName?.trim() || null;
}

function errorCode(error: unknown): string {
  if (error instanceof WeatherRunDeadlineError) return "weather_refresh_deadline";
  if (error instanceof OpenMeteoProviderError) return `open_meteo_${error.code}`;
  return "weather_refresh_failed";
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  signal: AbortSignal,
  work: (value: Input) => Promise<Output>,
): Promise<{ results: Output[]; unstartedCount: number }> {
  const results: Output[] = [];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (!signal.aborted && nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results.push(await work(values[index]!));
      }
    },
  );
  await Promise.all(workers);
  return { results, unstartedCount: values.length - results.length };
}

async function loadCandidates(
  pool: Pool,
  session: AuthenticatedSession,
  now: Date,
): Promise<WeatherCandidate[]> {
  const result = await pool.query<WeatherCandidateRow>(
    `SELECT i.id, i.current_revision, i.item_type, i.starts_at, i.ends_at,
            td.day_date::timestamp AT TIME ZONE t.time_zone AS day_start_at,
            (td.day_date::timestamp + time '12:00') AT TIME ZONE t.time_zone AS day_noon_at,
            (td.day_date::timestamp + interval '1 day') AT TIME ZONE t.time_zone AS day_end_at,
            CASE WHEN i.visibility = 'private' THEN t.destination_name
                 ELSE NULLIF(btrim(i.location_name), '') END AS location_name,
            CASE WHEN i.visibility = 'private'
                       AND NULLIF(btrim(i.departure_location_name), '') IS NOT NULL
                   THEN t.destination_name
                 ELSE NULLIF(btrim(i.departure_location_name), '') END AS departure_location_name,
            CASE WHEN i.visibility = 'private'
                       AND NULLIF(btrim(i.destination_location_name), '') IS NOT NULL
                   THEN t.destination_name
                 ELSE NULLIF(btrim(i.destination_location_name), '') END AS destination_location_name,
            CASE WHEN i.visibility = 'private'
                 THEN 'trip_destination' ELSE 'event' END AS lookup_precision,
            t.destination_name
       FROM itinerary_items i
       JOIN trip_days td ON td.trip_id = i.trip_id AND td.id = i.trip_day_id
       JOIN trips t ON t.id = i.trip_id
      WHERE i.trip_id = $1
        AND i.status NOT IN ('cancelled', 'completed')
        AND to_jsonb(i)->>'removed_at' IS NULL
        AND app_member_can_view_itinerary_item(i.trip_id, i.id, $2)
        AND (
          (i.starts_at IS NULL AND i.ends_at IS NULL
            AND (td.day_date::timestamp + interval '1 day') AT TIME ZONE t.time_zone > $3
            AND td.day_date::timestamp AT TIME ZONE t.time_zone <= $3 + interval '7 days')
          OR
          ((i.starts_at IS NOT NULL OR i.ends_at IS NOT NULL)
            AND COALESCE(i.ends_at, i.starts_at) >= $3
            AND COALESCE(
                  i.starts_at,
                  td.day_date::timestamp AT TIME ZONE t.time_zone
                ) <= $3 + interval '7 days')
        )
      ORDER BY COALESCE(
                 i.starts_at,
                 td.day_date::timestamp AT TIME ZONE t.time_zone
               ), i.id`,
    [session.tripId, session.memberId, now],
  );

  const targets = result.rows.flatMap((row) => {
    const rowTargets = eventWeatherTargets({
      itemType: row.item_type,
      startsAt: row.starts_at?.toISOString() ?? null,
      endsAt: row.ends_at?.toISOString() ?? null,
      locationName: row.location_name,
      departureLocationName: row.departure_location_name,
      destinationLocationName: row.destination_location_name,
      fallbackForecastAt: row.day_noon_at.toISOString(),
      fallbackStartsAt: row.day_start_at.toISOString(),
      fallbackEndsAt: row.day_end_at.toISOString(),
      now: now.toISOString(),
    });
    return rowTargets
      .filter((target) => isWithinWeatherForecastWindow(target.forecastAt, now))
      .map((target) => ({
        id: row.id,
        target_role: target.role,
        current_revision: row.current_revision,
        forecast_at: target.forecastAt,
        location_label: target.locationName,
        lookup_precision: row.lookup_precision,
        destination_name: row.destination_name,
        location_key: weatherLocationKey(target.locationName, row.destination_name),
        forecast_time_may_advance: target.forecastTimeKind === "active",
      }));
  });
  if (targets.length === 0) return [];

  const itemIds = [...new Set(targets.map((target) => target.id))];
  const cacheResult = await pool.query<WeatherCacheRow>(
    `SELECT itinerary_item_id, target_role,
            item_revision AS cached_item_revision,
            forecast_at AS cached_forecast_at,
            location_key AS cached_location_key,
            location_label AS cached_location_label,
            location_precision AS cached_location_precision,
            latitude AS cached_latitude,
            longitude AS cached_longitude,
            fetched_at AS cached_fetched_at
       FROM event_weather_forecasts
      WHERE trip_id = $1 AND itinerary_item_id = ANY($2::uuid[])`,
    [session.tripId, itemIds],
  );
  const cacheByTarget = new Map(
    cacheResult.rows.map((row) => [`${row.itinerary_item_id}:${row.target_role}`, row]),
  );
  return targets.map((target) => {
    const cached = cacheByTarget.get(`${target.id}:${target.target_role}`);
    return {
      ...target,
      cached_item_revision: cached?.cached_item_revision ?? null,
      cached_forecast_at: cached?.cached_forecast_at ?? null,
      cached_location_key: cached?.cached_location_key ?? null,
      cached_location_label: cached?.cached_location_label ?? null,
      cached_location_precision: cached?.cached_location_precision ?? null,
      cached_latitude: cached?.cached_latitude ?? null,
      cached_longitude: cached?.cached_longitude ?? null,
      cached_fetched_at: cached?.cached_fetched_at ?? null,
    };
  });
}

async function fetchForecast(
  provider: WeatherProvider,
  candidate: WeatherCandidate,
  now: Date,
  signal: AbortSignal,
): Promise<{
  result: Extract<OpenMeteoForecastResult, { status: "ok" }>;
  precision: "event" | "trip_destination";
  label: string;
}> {
  const abortable = async <Value>(operation: () => Promise<Value>): Promise<Value> => {
    if (signal.aborted) throw new WeatherRunDeadlineError();
    return new Promise<Value>((resolve, reject) => {
      const handleAbort = () => reject(new WeatherRunDeadlineError());
      signal.addEventListener("abort", handleAbort, { once: true });
      let pending: Promise<Value>;
      try {
        pending = operation();
      } catch (error) {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
        return;
      }
      pending.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", handleAbort);
      });
    });
  };

  if (
    candidate.cached_location_key === candidate.location_key
    && candidate.cached_latitude !== null
    && candidate.cached_longitude !== null
    && candidate.cached_location_precision === candidate.lookup_precision
    && candidate.cached_location_label
  ) {
    const cachedLatitude = candidate.cached_latitude;
    const cachedLongitude = candidate.cached_longitude;
    const result = await abortable(() => provider.forecastAtCoordinates({
      coordinates: {
        latitude: cachedLatitude,
        longitude: cachedLongitude,
      },
      forecastAt: candidate.forecast_at,
      now,
      signal,
    }));
    if (result.status === "ok") {
      return {
        result,
        precision: candidate.cached_location_precision,
        label: candidate.cached_location_label,
      };
    }
  }

  if (candidate.lookup_precision === "trip_destination") {
    const destinationResult = await abortable(() => provider.forecastAtLocation({
      query: candidate.destination_name,
      forecastAt: candidate.forecast_at,
      now,
      signal,
    }));
    if (destinationResult.status !== "ok") {
      throw new OpenMeteoProviderError(
        "invalid_response",
        "No weather location could be resolved for this trip area.",
      );
    }
    return {
      result: destinationResult,
      precision: "trip_destination",
      label: destinationResult.location?.name ?? candidate.destination_name,
    };
  }

  const normalizedLocation = candidate.location_label.normalize("NFKC").trim();
  const normalizedDestination = candidate.destination_name.normalize("NFKC").trim();
  const eventQuery = normalizedLocation.toLocaleLowerCase("en-US")
    .includes(normalizedDestination.toLocaleLowerCase("en-US"))
    ? normalizedLocation.slice(0, 300)
    : `${normalizedLocation.slice(0, 210)}, ${normalizedDestination.slice(0, 80)}`.slice(0, 300);
  const eventResult = await abortable(() => provider.forecastAtLocation({
    // Open-Meteo's geocoder is a locality/place search rather than a POI
    // resolver. Constraining the venue text with the trip destination avoids
    // silently selecting a same-named place in another country.
    query: eventQuery,
    forecastAt: candidate.forecast_at,
    now,
    signal,
  }));
  if (eventResult.status === "ok") {
    return {
      result: eventResult,
      precision: "event",
      label: eventResult.location?.name ?? candidate.location_label,
    };
  }

  const destinationResult = await abortable(() => provider.forecastAtLocation({
    query: candidate.destination_name,
    forecastAt: candidate.forecast_at,
    now,
    signal,
  }));
  if (destinationResult.status !== "ok") {
    throw new OpenMeteoProviderError(
      "invalid_response",
      "No weather location could be resolved for this event.",
    );
  }
  return {
    result: destinationResult,
    precision: "trip_destination",
    label: destinationResult.location?.name ?? candidate.destination_name,
  };
}

async function persistForecast(
  pool: Pool,
  session: AuthenticatedSession,
  candidate: WeatherCandidate,
  forecast: OpenMeteoForecast,
  precision: "event" | "trip_destination",
  locationLabel: string,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO event_weather_forecasts (
       trip_id, itinerary_item_id, item_revision, target_role, forecast_at,
       location_key, location_label, location_precision,
       latitude, longitude, provider_location_id, provider_location_name,
       provider, weather_code, condition_key, icon_key, is_day,
       temperature_celsius, apparent_temperature_celsius,
       precipitation_probability_percent, sampled_at, fetched_at, stale_after
     )
      SELECT i.trip_id, i.id, i.current_revision, $5, $6,
             $7, $8, $9, $10, $11, $12, $13,
             'open-meteo', $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23
       FROM itinerary_items i
      WHERE i.trip_id = $1 AND i.id = $2 AND i.current_revision = $3
        AND to_jsonb(i)->>'removed_at' IS NULL
        AND app_member_can_view_itinerary_item(i.trip_id, i.id, $4)
      ON CONFLICT (trip_id, itinerary_item_id, target_role) DO UPDATE SET
       item_revision = EXCLUDED.item_revision,
       forecast_at = EXCLUDED.forecast_at,
       location_key = EXCLUDED.location_key,
       location_label = EXCLUDED.location_label,
       location_precision = EXCLUDED.location_precision,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       provider_location_id = EXCLUDED.provider_location_id,
       provider_location_name = EXCLUDED.provider_location_name,
       provider = EXCLUDED.provider,
       weather_code = EXCLUDED.weather_code,
       condition_key = EXCLUDED.condition_key,
       icon_key = EXCLUDED.icon_key,
       is_day = EXCLUDED.is_day,
       temperature_celsius = EXCLUDED.temperature_celsius,
       apparent_temperature_celsius = EXCLUDED.apparent_temperature_celsius,
       precipitation_probability_percent = EXCLUDED.precipitation_probability_percent,
       sampled_at = EXCLUDED.sampled_at,
       fetched_at = EXCLUDED.fetched_at,
       stale_after = EXCLUDED.stale_after`,
    [
      session.tripId,
      candidate.id,
      candidate.current_revision,
      session.memberId,
      candidate.target_role,
      candidate.forecast_at,
      candidate.location_key,
      locationLabel,
      precision,
      forecast.coordinates.latitude,
      forecast.coordinates.longitude,
      null,
      locationLabel,
      forecast.weatherCode,
      forecast.decoded.condition,
      forecast.decoded.icon,
      forecast.isDay,
      forecast.temperatureCelsius,
      forecast.apparentTemperatureCelsius,
      forecast.precipitationProbabilityPercent,
      forecast.sampledAt,
      forecast.fetchedAt,
      new Date(new Date(forecast.fetchedAt).getTime() + WEATHER_FRESHNESS_MS),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

async function acquireWeatherLease(
  pool: Pool,
  tripId: string,
  memberId: string,
  leaseToken: string,
): Promise<boolean> {
  const result = await pool.query<{ lease_token: string }>(
    `INSERT INTO weather_refresh_leases AS existing (
       trip_id, member_id, lease_token, acquired_at, leased_until
     ) VALUES (
       $1, $2, $3, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP + ($4::integer * interval '1 millisecond')
     )
     ON CONFLICT (trip_id, member_id) DO UPDATE SET
       lease_token = EXCLUDED.lease_token,
       acquired_at = EXCLUDED.acquired_at,
       leased_until = EXCLUDED.leased_until
     WHERE existing.leased_until <= CURRENT_TIMESTAMP
     RETURNING lease_token`,
    [tripId, memberId, leaseToken, WEATHER_LEASE_MS],
  );
  return result.rows[0]?.lease_token === leaseToken;
}

async function releaseWeatherLease(
  pool: Pool,
  tripId: string,
  memberId: string,
  leaseToken: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM weather_refresh_leases
      WHERE trip_id = $1 AND member_id = $2 AND lease_token = $3`,
    [tripId, memberId, leaseToken],
  );
}

async function recordWeatherRun(
  pool: Pool,
  input: {
    tripId: string;
    runId: string;
    requestedByMemberId: string;
    status: "succeeded" | "partial" | "failed";
    candidateCount: number;
    cacheHitCount: number;
    refreshedCount: number;
    destinationFallbackCount: number;
    failedCount: number;
    errorCode: string | null;
    startedAt: Date;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO weather_refresh_runs (
       trip_id, id, requested_by_member_id, status, candidate_count,
       cache_hit_count, refreshed_count, destination_fallback_count,
       failed_count, error_code, started_at, completed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [input.tripId, input.runId, input.requestedByMemberId, input.status,
      input.candidateCount, input.cacheHitCount, input.refreshedCount,
      input.destinationFallbackCount, input.failedCount, input.errorCode,
      input.startedAt, new Date()],
  );
}

function boundedRefreshBatch(
  candidates: readonly WeatherCandidate[],
  now: Date,
): { selected: WeatherCandidate[]; deferredCount: number } {
  if (candidates.length <= MAX_WEATHER_REFRESHES_PER_RUN) {
    return { selected: [...candidates], deferredCount: 0 };
  }

  // Rotate the bounded slice once per freshness interval. Permanently failing
  // early events therefore cannot starve later missing/stale events forever.
  const bucket = Math.floor(now.getTime() / WEATHER_FRESHNESS_MS);
  const offset = (bucket * MAX_WEATHER_REFRESHES_PER_RUN) % candidates.length;
  const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  return {
    selected: rotated.slice(0, MAX_WEATHER_REFRESHES_PER_RUN),
    deferredCount: candidates.length - MAX_WEATHER_REFRESHES_PER_RUN,
  };
}

export async function refreshTripWeather(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  options: { provider?: WeatherProvider; now?: Date; runBudgetMs?: number } = {},
): Promise<WeatherRefreshResult> {
  assertTrip(session, tripId);
  const provider = options.provider ?? new OpenMeteoWeatherProvider();
  const now = options.now ?? new Date();
  const leaseToken = randomUUID();
  if (!await acquireWeatherLease(pool, tripId, session.memberId, leaseToken)) {
    return {
      status: "already_running",
      candidateCount: 0,
      cacheHitCount: 0,
      refreshedCount: 0,
      destinationFallbackCount: 0,
      failedCount: 0,
    };
  }

  const runId = randomUUID();
  const startedAt = new Date();
  const requestedBudgetMs = options.runBudgetMs ?? DEFAULT_WEATHER_RUN_BUDGET_MS;
  const runBudgetMs = Math.min(
    MAX_WEATHER_RUN_BUDGET_MS,
    Math.max(1, Number.isFinite(requestedBudgetMs) ? Math.floor(requestedBudgetMs) : DEFAULT_WEATHER_RUN_BUDGET_MS),
  );
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), runBudgetMs);
  deadlineTimer.unref();
  let candidates: WeatherCandidate[] = [];
  let cacheHitCount = 0;
  let refreshedCount = 0;
  let destinationFallbackCount = 0;
  let failedCount = 0;
  let firstErrorCode: string | null = null;
  let runRecorded = false;

  try {
    candidates = await loadCandidates(pool, session, now);

    const refreshCandidates: WeatherCandidate[] = [];
    for (const candidate of candidates) {
      const decision = decideWeatherRefresh({
        forecastAt: candidate.forecast_at,
        locationKey: candidate.location_key,
        now,
        cached: candidate.cached_forecast_at && candidate.cached_location_key && candidate.cached_fetched_at
          ? {
              forecastAt: candidate.cached_forecast_at,
              locationKey: candidate.cached_location_key,
              checkedAt: candidate.cached_fetched_at,
            }
          : null,
        forecastTimeMayAdvance: candidate.forecast_time_may_advance,
      });
      if (decision === "use_cached" && candidate.cached_item_revision === candidate.current_revision) {
        cacheHitCount += 1;
        continue;
      }
      refreshCandidates.push(candidate);
    }

    const batch = boundedRefreshBatch(refreshCandidates, now);
    if (batch.deferredCount > 0) {
      failedCount += batch.deferredCount;
      firstErrorCode = "weather_refresh_batch_deferred";
    }

    const fetchedCandidates = await mapWithConcurrency(
      batch.selected,
      WEATHER_PROVIDER_CONCURRENCY,
      deadline.signal,
      async (candidate) => {
        try {
          return {
            candidate,
            fetched: await fetchForecast(provider, candidate, now, deadline.signal),
            error: null,
          };
        } catch (error) {
          return { candidate, fetched: null, error };
        }
      },
    );
    if (fetchedCandidates.unstartedCount > 0) {
      failedCount += fetchedCandidates.unstartedCount;
      firstErrorCode ??= "weather_refresh_deadline";
    }

    for (const { candidate, fetched, error } of fetchedCandidates.results) {
      if (fetched) {
        if (await persistForecast(
          pool,
          session,
          candidate,
          fetched.result.forecast,
          fetched.precision,
          fetched.label,
        )) {
          refreshedCount += 1;
          if (fetched.precision === "trip_destination") destinationFallbackCount += 1;
        } else {
          failedCount += 1;
          firstErrorCode ??= "weather_item_changed";
        }
      } else {
        failedCount += 1;
        firstErrorCode ??= deadline.signal.aborted
          ? "weather_refresh_deadline"
          : errorCode(error);
      }
    }

    const status = failedCount === 0
      ? "succeeded"
      : refreshedCount > 0 || cacheHitCount > 0 ? "partial" : "failed";
    await recordWeatherRun(pool, {
      tripId,
      runId,
      requestedByMemberId: session.memberId,
      status,
      candidateCount: candidates.length,
      cacheHitCount,
      refreshedCount,
      destinationFallbackCount,
      failedCount,
      errorCode: firstErrorCode,
      startedAt,
    });
    runRecorded = true;

    return {
      status: "completed",
      candidateCount: candidates.length,
      cacheHitCount,
      refreshedCount,
      destinationFallbackCount,
      failedCount,
    };
  } catch (error) {
    if (!runRecorded) {
      firstErrorCode ??= deadline.signal.aborted
        ? "weather_refresh_deadline"
        : errorCode(error);
      const accountedCount = cacheHitCount + refreshedCount + failedCount;
      failedCount += Math.max(candidates.length - accountedCount, candidates.length === 0 ? 1 : 0);
      const status = refreshedCount > 0 || cacheHitCount > 0 ? "partial" : "failed";
      await recordWeatherRun(pool, {
        tripId,
        runId,
        requestedByMemberId: session.memberId,
        status,
        candidateCount: candidates.length,
        cacheHitCount,
        refreshedCount,
        destinationFallbackCount,
        failedCount,
        errorCode: firstErrorCode,
        startedAt,
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    await releaseWeatherLease(pool, tripId, session.memberId, leaseToken).catch(() => undefined);
  }
}
