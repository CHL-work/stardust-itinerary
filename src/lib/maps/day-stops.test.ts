import { describe, expect, it } from "vitest";
import { projectDayMapStops, type MapSource, type PendingMapSource } from "./day-stops";

const days = [
  { id: "day-1", date: "2026-09-27" },
  { id: "day-2", date: "2026-09-28" },
  { id: "day-3", date: "2026-09-29" },
];
const options = { days, timeZone: "Asia/Tokyo", tripDayId: "day-1" };

function item(patch: Partial<MapSource> = {}): MapSource {
  return {
    id: "museum", tripDayId: "day-1", title: "Synthetic museum", itemType: "activity",
    startsAt: "2026-09-27T02:00:00Z", endsAt: "2026-09-27T03:00:00Z",
    status: "planned", visibility: "trip", locationName: "Synthetic museum, Test City",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic+museum",
    ...patch,
  };
}

function proposal(patch: Partial<PendingMapSource> = {}): PendingMapSource {
  return {
    ...item(), requestId: "proposal", status: "pending", operation: "create", targetItemId: null,
    ...patch,
  };
}

function project(itinerary: MapSource[], pendingItinerary: PendingMapSource[] = [], tripDayId = "day-1", includePrivate?: boolean) {
  return projectDayMapStops({ ...options, itinerary, pendingItinerary, tripDayId, includePrivate });
}

describe("projectDayMapStops", () => {
  it("matches merged timeline ordering: all-day first, time, key, then untimed", () => {
    const result = project([
      item({ id: "z-unknown", startsAt: null }),
      item({ id: "b-timed" }),
      item({ id: "a-timed" }),
      item({ id: "a-unknown", startsAt: "invalid" }),
      item({ id: "all-day", startsAt: "2026-09-26T15:00:00Z", endsAt: "2026-09-27T15:00:00Z",
        sourceCalendar: { allDay: true, startDate: "2026-09-27", endDateExclusive: "2026-09-28" } }),
    ], [proposal({ requestId: "aa-pending" })]);
    expect(result.map((stop) => stop.key)).toEqual([
      "all-day:event:2026-09-27", "a-timed:event", "pending:aa-pending:event", "b-timed:event",
      "a-unknown:event", "z-unknown:event",
    ]);
    expect(result.map((stop) => stop.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result[0]!.allDay).toBe(true);
    expect(result.at(-2)!.at).toBeNull();
  });

  it("uses chronological transport endpoints on their actual trip-local dates", () => {
    const transport = item({ id: "train", itemType: "transport", startsAt: "2026-09-27T14:00:00Z",
      endsAt: "2026-09-27T15:45:00Z", locationName: "Ignored generic place",
      departureLocationName: "Synthetic station A", departureMapUrl: "https://maps.google.com/?q=Station+A",
      destinationLocationName: "Synthetic station B", destinationMapUrl: "https://maps.google.com/?q=Station+B" });
    expect(project([transport])[0]).toMatchObject({ key: "train:departure", number: 1,
      kind: "departure", locationName: "Synthetic station A", at: transport.startsAt });
    expect(project([transport], [], "day-2")[0]).toMatchObject({ key: "train:arrival", number: 1,
      kind: "arrival", locationName: "Synthetic station B", at: transport.endsAt });
    expect(project([transport], [], "day-3")).toEqual([]);
  });

  it("sorts equal-time endpoints using the same stable key order as TripTimeline", () => {
    const result = project([item({ id: "transfer", itemType: "transport", endsAt: "2026-09-27T02:00:00Z",
      departureLocationName: "Platform A", destinationLocationName: "Platform B" })]);
    expect(result.map((stop) => stop.kind)).toEqual(["arrival", "departure"]);
  });

  it("retains trip-date map grouping while preserving airport-local endpoint presentation", () => {
    const flight = item({ id: "flight", itemType: "transport", startsAt: "2026-09-27T14:00:00Z", endsAt: "2026-09-27T23:00:00Z",
      flight: { flightNumber: "ZZ123" }, departureLocationName: "HND", destinationLocationName: "LAX" });
    expect(project([flight])).toMatchObject([{ key: "flight:departure", timeZone: "Asia/Tokyo", timeZoneKnown: true, isFlight: true }]);
    expect(project([flight], [], "day-2")).toMatchObject([{ key: "flight:arrival", at: flight.endsAt, timeZone: "America/Los_Angeles", timeZoneKnown: true, isFlight: true }]);
    const pending = proposal({ ...flight, requestId: "pending-flight", status: "pending" });
    expect(project([], [pending], "day-2")).toMatchObject([{ key: "pending:pending-flight:arrival", timeZone: "America/Los_Angeles", pending: true }]);
  });

  it("does not borrow the other transport endpoint's place or timestamp", () => {
    const result = project([item({ id: "untimed-arrival", itemType: "transport", endsAt: null,
      departureLocationName: "Station A", destinationLocationName: "Station B" })]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: "arrival", at: null, locationName: "Station B", mapUrl: null });
    expect(project([item({ itemType: "transport", departureLocationName: "Station A", destinationLocationName: null })]))
      .toHaveLength(1);
  });

  it("omits out-of-trip timed points instead of moving them to their assigned date", () => {
    const result = project([
      item({ id: "before", startsAt: "2026-09-25T00:00:00Z" }),
      item({ id: "after", startsAt: "2026-10-02T00:00:00Z" }),
      item({ id: "untimed", startsAt: null }),
      item({ id: "train", itemType: "transport", startsAt: "2026-09-26T14:00:00Z",
        endsAt: "2026-09-26T16:00:00Z", departureLocationName: "Outside-day station", destinationLocationName: "In-day station" }),
    ]);
    expect(result.map((stop) => stop.key)).toEqual(["train:arrival", "untimed:event"]);
  });

  it("assigns valid times by actual local date rather than their old assigned day", () => {
    const changed = item({ tripDayId: "day-1", startsAt: "2026-09-27T18:00:00Z" });
    expect(project([changed])).toEqual([]);
    expect(project([changed], [], "day-2")).toHaveLength(1);
  });

  it("keeps offset-aware instants ordered through a repeated daylight-saving hour", () => {
    const result = projectDayMapStops({
      itinerary: [item({ id: "later", startsAt: "2026-11-01T01:30:00-06:00" }),
        item({ id: "earlier", startsAt: "2026-11-01T01:30:00-05:00" })],
      pendingItinerary: [], days: [{ id: "day-1", date: "2026-11-01" }],
      timeZone: "America/Chicago", tripDayId: "day-1",
    });
    expect(result.map((stop) => stop.key)).toEqual(["earlier:event", "later:event"]);
  });

  it("retains Calendar continuation rows and excludes the exclusive last date", () => {
    const allDay = item({ id: "all-day", startsAt: "2026-09-26T15:00:00Z", endsAt: "2026-09-28T15:00:00Z",
      sourceCalendar: { allDay: true, startDate: "2026-09-27", endDateExclusive: "2026-09-29" } });
    expect(project([allDay])).toHaveLength(1);
    expect(project([allDay], [], "day-2")[0]).toMatchObject({ allDay: true, at: allDay.startsAt });
    expect(project([allDay], [], "day-3")).toEqual([]);
    const timed = item({ id: "overnight", startsAt: "2026-09-27T14:00:00Z", endsAt: "2026-09-28T01:00:00Z",
      sourceCalendar: { allDay: false, startDate: null, endDateExclusive: null } });
    expect(project([timed], [], "day-2")).toHaveLength(1);
    expect(project([{ ...timed, endsAt: "2026-09-27T15:00:00Z" }], [], "day-2")).toEqual([]);
  });

  it("does not use invalid Calendar metadata to admit an out-of-trip timestamp", () => {
    expect(project([item({ startsAt: "2026-09-25T00:00:00Z", sourceCalendar: {
      allDay: true, startDate: "invalid", endDateExclusive: "2026-09-29",
    } })])).toEqual([]);
  });

  it("does not turn an ordinary multi-day lodging stay into invented daily visits", () => {
    const lodging = item({ itemType: "lodging", endsAt: "2026-09-29T02:00:00Z" });
    expect(project([lodging])).toHaveLength(1);
    expect(project([lodging], [], "day-2")).toEqual([]);
  });

  it("replaces canonical targets with labelled create/update/restore proposals", () => {
    const result = project([
      item({ id: "updated" }), item({ id: "restored", status: "cancelled" }), item({ id: "cancelled" }),
      item({ id: "already-cancelled", status: "cancelled" }),
    ], [
      proposal({ requestId: "new", operation: "create" }),
      proposal({ requestId: "update", operation: "update", targetItemId: "updated" }),
      proposal({ requestId: "restore", operation: "restore", targetItemId: "restored" }),
      proposal({ requestId: "cancel", operation: "cancel", targetItemId: "cancelled" }),
    ]);
    expect(result.map((stop) => stop.key)).toEqual(["pending:new:event", "pending:restore:event", "pending:update:event"]);
    expect(result.every((stop) => stop.pending)).toBe(true);
    expect(project([item({ status: "completed" })])[0]!.pending).toBe(false);
  });

  it("suppresses an old target even when the private replacement is not included", () => {
    const canonical = item({ id: "old-public", locationName: "Old public location" });
    const privateUpdate = proposal({ targetItemId: canonical.id, operation: "update", visibility: "private" });
    expect(project([canonical], [privateUpdate])).toEqual([]);
    expect(project([canonical], [privateUpdate], "day-1", true)[0]).toMatchObject({ pending: true, visibility: "private" });
    expect(project([canonical], [{ ...privateUpdate, operation: "cancel" }], "day-1", true)).toEqual([]);
  });

  it("does not resurrect an old-day target when a proposal moves to a different date", () => {
    const canonical = item({ id: "moved" });
    const moved = proposal({ operation: "update", targetItemId: canonical.id, startsAt: "2026-09-28T02:00:00Z" });
    expect(project([canonical], [moved])).toEqual([]);
    expect(project([canonical], [moved], "day-2")).toHaveLength(1);
  });

  it("defaults to trip-visible stops, renumbers only the consented scope, and preserves repeated visits", () => {
    const items = [item({ id: "a" }), item({ id: "b", visibility: "private" }), item({ id: "c" })];
    expect(project(items).map((stop) => [stop.number, stop.key])).toEqual([[1, "a:event"], [2, "c:event"]]);
    expect(project(items, [], "day-1", true).map((stop) => [stop.number, stop.key]))
      .toEqual([[1, "a:event"], [2, "b:event"], [3, "c:event"]]);
    expect(project(items).map((stop) => stop.locationName)).toEqual([items[0]!.locationName, items[0]!.locationName]);
  });

  it("retains missing locations without using the title as provider input", () => {
    const result = project([item({ id: "a", title: "Private-looking title, not a place", locationName: "   ", mapUrl: null }), item({ id: "b" })]);
    expect(result[0]).toMatchObject({ number: 1, title: "Private-looking title, not a place", locationName: null, mapUrl: null });
    expect(result[1]!.number).toBe(2);
  });

  it.each([
    "javascript:alert(1)", "http://www.google.com/maps/place/Test", "https://www.google.com.evil.test/maps/place/Test",
    "https://evil.test/maps/place/Test", "https://secret@www.google.com/maps/place/Test",
    "https://user:secret@maps.app.goo.gl/test", "https://www.google.com:8443/maps/place/Test",
    "https://www.google.com/maps/place/Test?key=secret", "https://maps.google.com/?access_token=secret",
    "https://www.google.com/maps/place/Test?x-goog-api-key=secret",
    "https://www.google.com/maps/place/Test#token=secret", "https://www.google.com/maps/place/\nTest",
  ])("rejects unsafe Maps links: %s", (mapUrl) => {
    expect(project([item({ mapUrl })])[0]!.mapUrl).toBeNull();
  });

  it.each([
    "https://www.google.com/maps/search/?api=1&query=Synthetic+museum", "https://maps.app.goo.gl/synthetic",
    "https://goo.gl/maps/synthetic", "https://www.google.co.jp/maps/place/Test", "https://maps.google.com/?q=35,139",
  ])("keeps trusted credential-free links: %s", (mapUrl) => {
    expect(project([item({ mapUrl })])[0]!.mapUrl).toBe(mapUrl);
  });

  it("ignores non-pending records and raw Calendar rows, and returns no unknown day", () => {
    const terminal = { ...proposal(), status: "rejected" } as unknown as PendingMapSource;
    const rawCalendar = { id: "calendar", title: "Personal", startsAt: "2026-09-27T02:00:00Z", location: "Private" } as unknown as MapSource;
    expect(project([rawCalendar], [terminal])).toEqual([]);
    expect(project([item()], [], "missing-day")).toEqual([]);
  });

  it("does not mutate source records or arrays", () => {
    const input = { ...options, itinerary: [item()], pendingItinerary: [proposal()] };
    const before = structuredClone(input);
    projectDayMapStops(input);
    expect(input).toEqual(before);
  });

  it("projects only the display allowlist, not arbitrary fields on authorized sources", () => {
    const enriched = { ...item(), notes: "Not for the map", weather: { latitude: 0, longitude: 0 }, viewerMemberIds: ["viewer"] };
    const [stop] = project([enriched]);
    expect(Object.keys(stop!).sort()).toEqual([
      "allDay", "at", "isFlight", "key", "kind", "locationName", "mapUrl", "number", "pending", "timeZone", "timeZoneKnown", "title", "visibility",
    ]);
  });
});
