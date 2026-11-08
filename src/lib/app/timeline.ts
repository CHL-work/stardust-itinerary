import { tripLocalDateKey } from "./day-view";
import { resolveFlightPresentation } from "./flight-presentation";

export type TimelineWeatherTargetRole = "location" | "departure" | "destination";

export type TimelineRoleWeather<TWeather = unknown> = TWeather & {
  targetRole: TimelineWeatherTargetRole;
};

/**
 * The minimum itinerary shape needed to build a timeline. Both the live and
 * privacy-reduced offline item contracts structurally satisfy this type.
 */
export type TimelineSource<TWeather = unknown> = {
  id: string;
  tripDayId: string;
  itemType: string;
  title?: string;
  flight?: unknown;
  flightPresentation?: { isFlight: boolean; departureTimeZone?: string | null; arrivalTimeZone?: string | null };
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  locationName?: string | null;
  mapUrl?: string | null;
  departureLocationName?: string | null;
  departureMapUrl?: string | null;
  destinationLocationName?: string | null;
  destinationMapUrl?: string | null;
  weather?: TWeather | null;
  weatherForecasts?: readonly TimelineRoleWeather<TWeather>[];
};

export type TimelineTripDay = {
  id: string;
  date: string;
};

export type TimelinePointKind = "event" | "departure" | "arrival";

type WeatherValue<TItem extends TimelineSource> =
  | ("weather" extends keyof TItem ? Exclude<TItem["weather"], undefined | null> : never)
  | ("weatherForecasts" extends keyof TItem
    ? Exclude<TItem["weatherForecasts"], undefined> extends readonly (infer TForecast)[]
      ? TForecast
      : never
    : never);

export type TimelinePoint<TItem extends TimelineSource> = Readonly<{
  key: string;
  kind: TimelinePointKind;
  at: string | null;
  /** Display only: day assignment and ordering still use the trip zone / UTC. */
  timeZone: string;
  timeZoneKnown: boolean;
  isFlight: boolean;
  tripDayId: string;
  locationName: string | null;
  mapUrl: string | null;
  ownsActions: boolean;
  weather: WeatherValue<TItem> | null;
  item: TItem;
}>;

export type TimelineProjectionOptions = Readonly<{
  tripDays: readonly TimelineTripDay[];
  timeZone: string;
}>;

type IndexedTimelinePoint<TItem extends TimelineSource> = {
  point: TimelinePoint<TItem>;
  sourceIndex: number;
  pointIndex: number;
  timestampMs: number | null;
};

function usableLocation(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function timestampMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveTripDayId(
  at: string | null,
  assignedTripDayId: string,
  tripDayIdByDate: ReadonlyMap<string, string>,
  timeZone: string,
): string {
  const parsed = timestampMs(at);
  if (parsed === null) return assignedTripDayId;
  const actualDate = tripLocalDateKey(new Date(parsed), timeZone);
  return tripDayIdByDate.get(actualDate) ?? assignedTripDayId;
}

function roleWeather<TItem extends TimelineSource>(
  item: TItem,
  role: TimelineWeatherTargetRole,
): WeatherValue<TItem> | null {
  const forecasts = item.weatherForecasts as readonly (TimelineRoleWeather & WeatherValue<TItem>)[] | undefined;
  return forecasts?.find((forecast) => forecast.targetRole === role) ?? null;
}

function scalarWeather<TItem extends TimelineSource>(item: TItem): WeatherValue<TItem> | null {
  return (item.weather ?? null) as WeatherValue<TItem> | null;
}

function scalarWeatherForRole<TItem extends TimelineSource>(
  item: TItem,
  role: TimelineWeatherTargetRole,
): WeatherValue<TItem> | null {
  const weather = scalarWeather(item);
  if (!weather) return null;

  if (typeof weather === "object" && "targetRole" in weather) {
    return weather.targetRole === role ? weather : null;
  }

  // Payloads created before endpoint-aware forecasts had only one unlabelled
  // scalar value. Retain that compatibility path only when no role-aware
  // collection exists; a partial modern collection must never paint one
  // endpoint's weather onto another endpoint.
  return item.weatherForecasts === undefined ? weather : null;
}

function point<TItem extends TimelineSource>(input: {
  item: TItem;
  kind: TimelinePointKind;
  at: string | null;
  tripDayIdByDate: ReadonlyMap<string, string>;
  timeZone: string;
  locationName: string | null | undefined;
  mapUrl: string | null | undefined;
  ownsActions: boolean;
  weather: WeatherValue<TItem> | null;
}): TimelinePoint<TItem> {
  const flight = resolveFlightPresentation(input.item, input.timeZone);
  const arrival = input.kind === "arrival";
  return {
    key: `${input.item.id}:${input.kind}`,
    kind: input.kind,
    at: input.at,
    timeZone: arrival ? flight.arrivalTimeZone : flight.departureTimeZone,
    timeZoneKnown: !flight.isFlight || (arrival ? flight.arrivalZoneKnown : flight.departureZoneKnown),
    isFlight: flight.isFlight,
    tripDayId: resolveTripDayId(
      input.at,
      input.item.tripDayId,
      input.tripDayIdByDate,
      input.timeZone,
    ),
    locationName: input.locationName ?? null,
    mapUrl: input.mapUrl ?? null,
    ownsActions: input.ownsActions,
    weather: input.weather,
    item: input.item,
  };
}

/**
 * Expands itinerary items into independently sortable timeline points. A
 * transport contributes only its named endpoints; all other items contribute
 * one start-time point.
 */
export function projectTimelinePoints<TItem extends TimelineSource>(
  items: readonly TItem[],
  options: TimelineProjectionOptions,
): TimelinePoint<TItem>[] {
  const tripDayIdByDate = new Map<string, string>();
  for (const day of options.tripDays) {
    if (!tripDayIdByDate.has(day.date)) tripDayIdByDate.set(day.date, day.id);
  }

  const indexedPoints: IndexedTimelinePoint<TItem>[] = [];
  items.forEach((item, sourceIndex) => {
    if (item.itemType !== "transport") {
      const projected = point({
        item,
        kind: "event",
        at: item.startsAt,
        tripDayIdByDate,
        timeZone: options.timeZone,
        locationName: item.locationName,
        mapUrl: item.mapUrl,
        ownsActions: true,
        weather: roleWeather(item, "location") ?? scalarWeatherForRole(item, "location"),
      });
      indexedPoints.push({
        point: projected,
        sourceIndex,
        pointIndex: 0,
        timestampMs: timestampMs(projected.at),
      });
      return;
    }

    const hasDeparture = usableLocation(item.departureLocationName);
    const hasDestination = usableLocation(item.destinationLocationName);
    let pointIndex = 0;

    if (hasDeparture) {
      const projected = point({
        item,
        kind: "departure",
        at: item.startsAt,
        tripDayIdByDate,
        timeZone: options.timeZone,
        locationName: item.departureLocationName,
        mapUrl: item.departureMapUrl,
        ownsActions: true,
        weather: roleWeather(item, "departure")
          ?? (hasDestination ? null : scalarWeatherForRole(item, "departure")),
      });
      indexedPoints.push({
        point: projected,
        sourceIndex,
        pointIndex,
        timestampMs: timestampMs(projected.at),
      });
      pointIndex += 1;
    }

    if (hasDestination) {
      const projected = point({
        item,
        kind: "arrival",
        at: item.endsAt,
        tripDayIdByDate,
        timeZone: options.timeZone,
        locationName: item.destinationLocationName,
        mapUrl: item.destinationMapUrl,
        ownsActions: !hasDeparture,
        weather: roleWeather(item, "destination")
          ?? scalarWeatherForRole(item, "destination"),
      });
      indexedPoints.push({
        point: projected,
        sourceIndex,
        pointIndex,
        timestampMs: timestampMs(projected.at),
      });
    }
  });

  indexedPoints.sort((left, right) => {
    if (left.timestampMs !== null && right.timestampMs !== null) {
      const timestampDifference = left.timestampMs - right.timestampMs;
      if (timestampDifference !== 0) return timestampDifference;
    } else if (left.timestampMs !== null) {
      return -1;
    } else if (right.timestampMs !== null) {
      return 1;
    }
    return left.sourceIndex - right.sourceIndex || left.pointIndex - right.pointIndex;
  });

  return indexedPoints.map(({ point: projected }) => projected);
}

/** Returns the nearest strictly-future point, regardless of input ordering. */
export function nextUpcomingTimelinePoint<TItem extends TimelineSource>(
  points: readonly TimelinePoint<TItem>[],
  nowMs: number,
): TimelinePoint<TItem> | null {
  if (!Number.isFinite(nowMs)) return null;
  let nextPoint: TimelinePoint<TItem> | null = null;
  let nextTimestampMs = Number.POSITIVE_INFINITY;

  for (const candidate of points) {
    if (candidate.item.status === "cancelled") continue;
    const candidateTimestampMs = timestampMs(candidate.at);
    if (candidateTimestampMs === null || candidateTimestampMs <= nowMs) continue;
    if (candidateTimestampMs < nextTimestampMs) {
      nextPoint = candidate;
      nextTimestampMs = candidateTimestampMs;
    }
  }

  return nextPoint;
}
