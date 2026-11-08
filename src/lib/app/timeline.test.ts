import { describe, expect, it } from "vitest";

import {
  nextUpcomingTimelinePoint,
  projectTimelinePoints,
  type TimelineSource,
} from "./timeline";

const tripDays = [
  { id: "day-6", date: "2026-09-06" },
  { id: "day-7", date: "2026-09-07" },
] as const;

const options = { tripDays, timeZone: "Asia/Tokyo" } as const;

function item(overrides: Partial<TimelineSource> = {}): TimelineSource {
  return {
    id: "event-1",
    tripDayId: "day-6",
    itemType: "activity",
    startsAt: "2026-09-06T01:00:00.000Z",
    endsAt: "2026-09-06T02:00:00.000Z",
    status: "planned",
    locationName: "Akihabara",
    mapUrl: "https://www.google.com/maps/place/Akihabara",
    departureLocationName: null,
    departureMapUrl: null,
    destinationLocationName: null,
    destinationMapUrl: null,
    weather: null,
    ...overrides,
  };
}

describe("projectTimelinePoints", () => {
  it("projects a non-transport item as one action-owning event point", () => {
    const source = item({
      startsAt: "2026-09-06T15:30:00.000Z",
      weather: { summary: "sunny" },
    });

    const points = projectTimelinePoints([source], options);

    expect(points).toEqual([{
      key: "event-1:event",
      kind: "event",
      at: "2026-09-06T15:30:00.000Z",
      timeZone: "Asia/Tokyo",
      timeZoneKnown: true,
      isFlight: false,
      tripDayId: "day-7",
      locationName: "Akihabara",
      mapUrl: "https://www.google.com/maps/place/Akihabara",
      ownsActions: true,
      weather: { summary: "sunny" },
      item: source,
    }]);
  });

  it("splits a transport into independently timed endpoints with one action owner", () => {
    const source = item({
      id: "train",
      itemType: "transport",
      startsAt: "2026-09-06T14:30:00.000Z",
      endsAt: "2026-09-06T16:00:00.000Z",
      locationName: null,
      mapUrl: null,
      departureLocationName: "Tokyo Station",
      departureMapUrl: "https://www.google.com/maps/place/Tokyo+Station",
      destinationLocationName: "Kyoto Station",
      destinationMapUrl: "https://www.google.com/maps/place/Kyoto+Station",
      weather: { summary: "scalar arrival fallback" },
    });

    const points = projectTimelinePoints([source], options);

    expect(points.map((point) => ({
      key: point.key,
      kind: point.kind,
      at: point.at,
      tripDayId: point.tripDayId,
      locationName: point.locationName,
      ownsActions: point.ownsActions,
      weather: point.weather,
    }))).toEqual([
      {
        key: "train:departure",
        kind: "departure",
        at: "2026-09-06T14:30:00.000Z",
        tripDayId: "day-6",
        locationName: "Tokyo Station",
        ownsActions: true,
        weather: null,
      },
      {
        key: "train:arrival",
        kind: "arrival",
        at: "2026-09-06T16:00:00.000Z",
        tripDayId: "day-7",
        locationName: "Kyoto Station",
        ownsActions: false,
        weather: { summary: "scalar arrival fallback" },
      },
    ]);
  });

  it("uses role-aware forecasts for their matching points before scalar fallback", () => {
    const source = {
      ...item({
        id: "weather-train",
        itemType: "transport",
        departureLocationName: "Tokyo Station",
        destinationLocationName: "Kyoto Station",
        locationName: null,
        mapUrl: null,
      }),
      weather: { summary: "legacy primary" },
      weatherForecasts: [
        { targetRole: "destination" as const, summary: "arrival rain" },
        { targetRole: "departure" as const, summary: "departure sun" },
      ],
    };

    const points = projectTimelinePoints([source], options);

    expect(points.map((point) => point.weather)).toEqual([
      { targetRole: "departure", summary: "departure sun" },
      { targetRole: "destination", summary: "arrival rain" },
    ]);
  });

  it("does not repeat a partial departure forecast on the arrival point", () => {
    const departureWeather = {
      targetRole: "departure" as const,
      summary: "departure rain",
    };
    const source = {
      ...item({
        id: "partial-weather-train",
        itemType: "transport",
        departureLocationName: "Tokyo Station",
        destinationLocationName: "Kyoto Station",
        locationName: null,
        mapUrl: null,
      }),
      weather: departureWeather,
      weatherForecasts: [departureWeather],
    };

    expect(projectTimelinePoints([source], options).map((point) => point.weather)).toEqual([
      departureWeather,
      null,
    ]);
  });

  it("maps role-aware location weather to an ordinary event", () => {
    const source = {
      ...item({ weather: { summary: "legacy primary" } }),
      weatherForecasts: [
        { targetRole: "departure" as const, summary: "irrelevant" },
        { targetRole: "location" as const, summary: "event cloud" },
      ],
    };

    expect(projectTimelinePoints([source], options)[0]?.weather).toEqual({
      targetRole: "location",
      summary: "event cloud",
    });
  });

  it("omits missing transport endpoints and transfers action and scalar-weather ownership", () => {
    const departureOnly = item({
      id: "departure-only",
      itemType: "transport",
      locationName: null,
      mapUrl: null,
      departureLocationName: "Tokyo Station",
      destinationLocationName: null,
      weather: { summary: "departure weather" },
    });
    const arrivalOnly = item({
      id: "arrival-only",
      itemType: "transport",
      locationName: null,
      mapUrl: null,
      departureLocationName: "   ",
      destinationLocationName: "Kyoto Station",
      weather: { summary: "arrival weather" },
    });

    const departurePoints = projectTimelinePoints([departureOnly], options);
    const arrivalPoints = projectTimelinePoints([arrivalOnly], options);

    expect(departurePoints).toHaveLength(1);
    expect(departurePoints[0]).toMatchObject({
      kind: "departure",
      ownsActions: true,
      weather: { summary: "departure weather" },
    });
    expect(arrivalPoints).toHaveLength(1);
    expect(arrivalPoints[0]).toMatchObject({
      kind: "arrival",
      ownsActions: true,
      weather: { summary: "arrival weather" },
    });
  });

  it("returns no point for an invalid transport shape with no named endpoint", () => {
    expect(projectTimelinePoints([item({
      itemType: "transport",
      departureLocationName: null,
      destinationLocationName: "  ",
    })], options)).toEqual([]);
  });

  it("falls back to the assigned day when a point is untimed or outside known trip dates", () => {
    const points = projectTimelinePoints([
      item({ id: "untimed", startsAt: null, tripDayId: "day-6" }),
      item({ id: "outside", startsAt: "2026-09-10T00:00:00.000Z", tripDayId: "day-7" }),
    ], options);

    expect(points.map((point) => [point.item.id, point.tripDayId])).toEqual([
      ["outside", "day-7"],
      ["untimed", "day-6"],
    ]);
  });

  it("sorts endpoint points among ordinary events and preserves deterministic ties", () => {
    const firstTie = item({ id: "first-tie", startsAt: "2026-09-06T10:00:00.000Z" });
    const train = item({
      id: "train",
      itemType: "transport",
      startsAt: "2026-09-06T09:00:00.000Z",
      endsAt: "2026-09-06T11:00:00.000Z",
      locationName: null,
      mapUrl: null,
      departureLocationName: "Ueno",
      destinationLocationName: "Yokohama",
    });
    const secondTie = item({ id: "second-tie", startsAt: "2026-09-06T10:00:00.000Z" });
    const untimed = item({ id: "untimed", startsAt: null });

    const points = projectTimelinePoints([firstTie, train, secondTie, untimed], options);

    expect(points.map((point) => point.key)).toEqual([
      "train:departure",
      "first-tie:event",
      "second-tie:event",
      "train:arrival",
      "untimed:event",
    ]);
  });

  it("orders same-time endpoints from one source as departure then arrival", () => {
    const source = item({
      id: "instant-transfer",
      itemType: "transport",
      startsAt: "2026-09-06T10:00:00.000Z",
      endsAt: "2026-09-06T10:00:00.000Z",
      departureLocationName: "Platform 1",
      destinationLocationName: "Platform 2",
    });

    expect(projectTimelinePoints([source], options).map((point) => point.kind))
      .toEqual(["departure", "arrival"]);
  });

  it("accepts the offline structural shape and does not mutate frozen input", () => {
    const offlineItem = Object.freeze({
      id: "offline-event",
      tripDayId: "day-6",
      itemType: "meal",
      startsAt: "2026-09-06T03:00:00.000Z",
      endsAt: null,
      status: "planned",
      locationName: "Tsukiji",
      mapUrl: null,
      departureLocationName: null,
      departureMapUrl: null,
      destinationLocationName: null,
      destinationMapUrl: null,
    });
    const input = Object.freeze([offlineItem]);

    const points = projectTimelinePoints(input, options);

    expect(points[0]).toMatchObject({ item: offlineItem, weather: null });
    expect(input).toEqual([offlineItem]);
  });
});

describe("flight endpoint presentation", () => {
  it.each([
    ["2026-01-15", "2026-01-15T18:00:00Z", "2026-01-15T20:00:00Z", "12:00", "13:00"],
    ["2026-07-15", "2026-07-15T18:00:00Z", "2026-07-15T20:00:00Z", "13:00", "14:00"],
  ])("uses each airport's DST-aware zone on %s without changing instants", (date, startsAt, endsAt, departureTime, arrivalTime) => {
    const source = item({ itemType: "transport", startsAt, endsAt, flight: { flightNumber: "ZZ123" },
      departureLocationName: "DFW", destinationLocationName: "SLC" });
    const points = projectTimelinePoints([source], { timeZone: "America/Chicago", tripDays: [{ id: "day", date }] });
    const localTime = (at: string | null, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at!));
    expect(points.map((point) => [point.at, point.timeZone, point.isFlight, point.timeZoneKnown, localTime(point.at, point.timeZone)]))
      .toEqual([[startsAt, "America/Chicago", true, true, departureTime], [endsAt, "America/Denver", true, true, arrivalTime]]);
    expect(source.startsAt).toBe(startsAt);
    expect(Date.parse(points[1]!.at!) - Date.parse(points[0]!.at!)).toBe(2 * 3_600_000);
  });

  it("keeps trip-day grouping and UTC ordering when endpoint-local dates differ", () => {
    const source = item({ itemType: "transport", startsAt: "2026-09-06T14:00:00Z", endsAt: "2026-09-06T23:00:00Z",
      flight: { flightNumber: "ZZ123" }, departureLocationName: "HND", destinationLocationName: "LAX" });
    const points = projectTimelinePoints([source], options);
    expect(points.map((point) => [point.kind, point.tripDayId, point.timeZone])).toEqual([
      ["departure", "day-6", "Asia/Tokyo"], ["arrival", "day-7", "America/Los_Angeles"],
    ]);
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: points[1]!.timeZone }).format(new Date(points[1]!.at!))).toBe("2026-09-06");
  });

  it("labels unknown flight and generic endpoint zones as trip fallback", () => {
    const [unknown, train] = [true, false].map((isFlight) => projectTimelinePoints([item({ itemType: "transport",
      flight: isFlight ? { flightNumber: "ZZ123" } : null, departureLocationName: "Synthetic terminal" })], options)[0]!);
    expect(unknown).toMatchObject({ timeZone: "Asia/Tokyo", isFlight: true, timeZoneKnown: false });
    expect(train).toMatchObject({ timeZone: "Asia/Tokyo", isFlight: false, timeZoneKnown: false });
  });
});

describe("nextUpcomingTimelinePoint", () => {
  it("finds the nearest strictly-future point from unsorted input", () => {
    const points = projectTimelinePoints([
      item({
        id: "active-train",
        itemType: "transport",
        startsAt: "2026-09-06T09:00:00.000Z",
        endsAt: "2026-09-06T11:00:00.000Z",
        departureLocationName: "Ueno",
        destinationLocationName: "Yokohama",
      }),
      item({ id: "later", startsAt: "2026-09-06T12:00:00.000Z" }),
    ], options);

    expect(nextUpcomingTimelinePoint([...points].reverse(), Date.parse("2026-09-06T10:00:00.000Z"))?.key)
      .toBe("active-train:arrival");
  });

  it("ignores cancelled, current, past, and untimed points", () => {
    const points = projectTimelinePoints([
      item({ id: "past", startsAt: "2026-09-06T09:00:00.000Z" }),
      item({ id: "current", startsAt: "2026-09-06T10:00:00.000Z" }),
      item({ id: "cancelled", startsAt: "2026-09-06T10:01:00.000Z", status: "cancelled" }),
      item({ id: "next", startsAt: "2026-09-06T10:02:00.000Z" }),
      item({ id: "untimed", startsAt: null }),
    ], options);

    expect(nextUpcomingTimelinePoint(points, Date.parse("2026-09-06T10:00:00.000Z"))?.key)
      .toBe("next:event");
    expect(nextUpcomingTimelinePoint(points, Number.NaN)).toBeNull();
  });
});
