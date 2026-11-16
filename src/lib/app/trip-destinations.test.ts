import { describe, expect, it } from "vitest";

import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import { projectTimelinePoints, type TimelineSource } from "@/lib/app/timeline";
import { formatTimelinePointTime } from "@/lib/app/timeline-time";
import {
  currentTripDate, destinationClockAt, destinationOnDate, destinationsLabel, moneyTimeZone, pickTripToday, tripDayIdForInstant, tripDayZones,
  type TripDestination,
} from "@/lib/app/trip-destinations";

// A synthetic Tokyo → New York trip: Tokyo 8–11 November, New York 11–14 November (the 11th is the travel day).
const days = ["08", "09", "10", "11", "12", "13", "14"].map((day) => ({ id: `day-${day}`, date: `2026-11-${day}` }));
const destinations: TripDestination[] = [
  { name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: "2026-11-08", endsOn: "2026-11-11" },
  { name: "New York", timeZone: "America/New_York", startsOn: "2026-11-11", endsOn: "2026-11-14" },
];
const dayIdByDate = new Map(days.map((day) => [day.date, day.id]));

describe("trip destinations (JOB-098, D-110)", () => {
  it("finds where the travellers are on a date, the arriving destination on a travel day", () => {
    expect(destinationOnDate(destinations, "2026-11-09")?.name).toBe("Tokyo");
    expect(destinationOnDate(destinations, "2026-11-11")?.name).toBe("New York");
    expect(destinationOnDate(destinations, "2026-11-20")).toBeNull();
    expect(destinationOnDate([{ ...destinations[0]!, startsOn: null, endsOn: null }], "2026-11-09")).toBeNull();
  });

  it("gives days their own zones only when they differ from the trip's", () => {
    const zones = tripDayZones(destinations, "Asia/Tokyo", days)!;
    expect(zones.byDate.get("2026-11-10")).toBe("Asia/Tokyo");
    expect(zones.byDate.get("2026-11-12")).toBe("America/New_York");
    expect(zones.byDayId.get("day-11")).toBe("America/New_York");
    expect(tripDayZones([{ name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: null, endsOn: null }], "Asia/Tokyo", days)).toBeNull();
    // Osaka shares Tokyo's zone: dates alone never make a trip multi-zone.
    expect(tripDayZones([destinations[0]!, { name: "Osaka", timeZone: "Asia/Tokyo", startsOn: "2026-11-11", endsOn: "2026-11-14" }],
      "Asia/Tokyo", days)).toBeNull();
    expect(tripDayZones(undefined, "Asia/Tokyo", days)).toBeNull();
  });

  it("puts a New York evening on its New York date, not Tokyo's next day", () => {
    const zones = tripDayZones(destinations, "Asia/Tokyo", days);
    // 19:00 on the 12th in New York is 09:00 on the 13th in Tokyo.
    const dinner = "2026-11-13T00:00:00Z";
    expect(tripDayIdForInstant(dinner, { tripZone: "Asia/Tokyo", dayIdByDate, dayZones: zones, eventZone: "America/New_York" })).toBe("day-12");
    expect(tripDayIdForInstant(dinner, { tripZone: "Asia/Tokyo", dayIdByDate, dayZones: null })).toBe("day-13");
    // A Tokyo breakfast on the travel day sits between the two clocks: it goes to its own local date.
    expect(tripDayIdForInstant("2026-11-11T00:00:00Z", { tripZone: "Asia/Tokyo", dayIdByDate, dayZones: zones, eventZone: "Asia/Tokyo" }))
      .toBe("day-11");
    // Outside the trip, the assigned day is kept.
    expect(tripDayIdForInstant("2026-12-01T00:00:00Z", { tripZone: "Asia/Tokyo", dayIdByDate, dayZones: zones, assignedDayId: "day-14" }))
      .toBe("day-14");
  });

  it("reads today on the clock of where the travellers are", () => {
    const zones = tripDayZones(destinations, "Asia/Tokyo", days);
    const newYorkEvening = new Date("2026-11-13T01:00:00Z"); // 20:00 on the 12th in New York, the 13th in Tokyo.
    expect(currentTripDate(newYorkEvening, "Asia/Tokyo", zones)).toBe("2026-11-12");
    expect(currentTripDate(newYorkEvening, "Asia/Tokyo", null)).toBe("2026-11-13");
    expect(pickTripToday(days, { timeZone: "Asia/Tokyo", destinations }, newYorkEvening)?.id).toBe("day-12");
    expect(pickTripToday(days, { timeZone: "Asia/Tokyo" }, newYorkEvening)?.id).toBe("day-13");
  });

  it("clocks an event without a place by its day's destination, and only then", () => {
    const dinner = { itemType: "meal", locationName: "Synthetic pizza place" };
    const zones = resolveEventTimeZones(dinner, "Asia/Tokyo", "America/New_York");
    expect([zones.departureTimeZone, zones.departureZoneSource, zones.departureZoneKnown]).toEqual(["America/New_York", "destination", true]);
    expect(resolveEventTimeZones(dinner, "Asia/Tokyo", "Asia/Tokyo").departureZoneSource).toBe("trip");
    expect(resolveEventTimeZones(dinner, "Asia/Tokyo").departureTimeZone).toBe("Asia/Tokyo");
    // Place evidence still wins over the day's destination.
    expect(resolveEventTimeZones({ itemType: "meal", locationName: "Synthetic cafe, Salt Lake City, Utah" }, "Asia/Tokyo", "America/New_York")
      .departureTimeZone).toBe("America/Denver");
  });

  it("groups and labels the timeline on each day's own clock", () => {
    const dinner: TimelineSource = { id: "dinner", tripDayId: "day-12", itemType: "meal", title: "Synthetic dinner",
      locationName: "Synthetic pizza place", startsAt: "2026-11-13T00:00:00Z", endsAt: null, status: "planned" };
    const [point] = projectTimelinePoints([dinner], { tripDays: days, timeZone: "Asia/Tokyo", destinations });
    expect([point!.tripDayId, point!.timeZone, point!.dayDate]).toEqual(["day-12", "America/New_York", "2026-11-12"]);
    expect(formatTimelinePointTime(point!, "en", "Asia/Tokyo")).toBe("07:00 PM");
    const [single] = projectTimelinePoints([dinner], { tripDays: days, timeZone: "Asia/Tokyo" });
    expect([single!.tripDayId, single!.timeZone, single!.dayDate]).toEqual(["day-13", "Asia/Tokyo", undefined]);
  });

  it("dates a bill or repayment on its day's own clock, and types it there", () => {
    // 20:00 on the 13th in New York is 10:00 on the 14th in Tokyo.
    expect(destinationClockAt("2026-11-14T01:00:00Z", "Asia/Tokyo", destinations)).toEqual({ date: "2026-11-13", timeZone: "America/New_York" });
    expect(destinationClockAt("2026-11-09T03:00:00Z", "Asia/Tokyo", destinations)).toEqual({ date: "2026-11-09", timeZone: "Asia/Tokyo" });
    // After the trip, the trip's clock.
    expect(destinationClockAt("2026-11-16T03:00:00Z", "Asia/Tokyo", destinations)).toEqual({ date: "2026-11-16", timeZone: "Asia/Tokyo" });
    const trip = { timeZone: "Asia/Tokyo", destinations };
    expect(moneyTimeZone(trip, "2026-11-14T01:00:00Z")).toBe("America/New_York");
    expect(moneyTimeZone(trip, null, "2026-11-12T19:30")).toBe("America/New_York");
    expect(moneyTimeZone(trip, null, "2026-11-09T19:30")).toBe("Asia/Tokyo");
    expect(moneyTimeZone(trip)).toBe("Asia/Tokyo");
  });

  it("keeps bills on the trip's clock when every dated destination shares it", () => {
    const osaka: TripDestination[] = [destinations[0]!, { name: "Osaka", timeZone: "Asia/Tokyo", startsOn: "2026-11-12", endsOn: "2026-11-14" }];
    expect(destinationClockAt("2026-11-14T01:00:00Z", "Asia/Tokyo", osaka)).toEqual({ date: "2026-11-14", timeZone: "Asia/Tokyo" });
    expect(moneyTimeZone({ timeZone: "Asia/Tokyo", destinations: osaka }, null, "2026-11-13T19:30")).toBe("Asia/Tokyo");
    expect(moneyTimeZone({ timeZone: "Asia/Tokyo" }, "2026-11-14T01:00:00Z")).toBe("Asia/Tokyo");
  });

  it("labels the route in order", () => {
    expect(destinationsLabel(destinations, "Tokyo")).toBe("Tokyo → New York");
    expect(destinationsLabel(undefined, "Tokyo")).toBe("Tokyo");
  });
});
