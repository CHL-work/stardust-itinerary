import { describe, expect, it } from "vitest";

import { withTripDestinations } from "@/lib/ai/trip-destination-context";
import type { TripDestination } from "@/lib/app/trip-destinations";

const days = ["10", "11", "12"].map((day) => ({ id: `day-${day}`, date: `2026-11-${day}`, label: null }));
const context = {
  trip: { destinationName: "Tokyo", timeZone: "Asia/Tokyo", startsOn: "2026-11-10", endsOn: "2026-11-12" },
  days,
  currentTime: { nowUtc: "2026-11-12T01:00:00Z", timeZone: "Asia/Tokyo", tripLocalDate: "2026-11-12", tomorrowLocalDate: "2026-11-13",
    tripLocalTime: "10:00:00", tripLocalWeekday: "Thursday", planningReferenceDate: "2026-11-12" },
};
const destinations: TripDestination[] = [
  { name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: "2026-11-10", endsOn: "2026-11-11" },
  { name: "New York", timeZone: "America/New_York", startsOn: "2026-11-11", endsOn: "2026-11-12" },
];

describe("the AI's view of a trip's destinations (JOB-098, D-110)", () => {
  it("lists the destinations and gives each day its destination and clock", () => {
    const { context: decorated, dayZones } = withTripDestinations(context, destinations, new Date("2026-11-12T01:00:00Z"));
    expect((decorated.trip as { destinations?: unknown }).destinations).toEqual(destinations);
    expect(decorated.days).toEqual([
      { ...days[0], destination: "Tokyo", timeZone: "Asia/Tokyo" },
      { ...days[1], destination: "New York", timeZone: "America/New_York" },
      { ...days[2], destination: "New York", timeZone: "America/New_York" },
    ]);
    expect(dayZones?.byDayId.get("day-12")).toBe("America/New_York");
  });

  it("reads now on today's own clock", () => {
    // 01:00 UTC on the 12th is 20:00 on the 11th in New York.
    const { context: decorated } = withTripDestinations(context, destinations, new Date("2026-11-12T01:00:00Z"));
    expect(decorated.currentTime).toMatchObject({ timeZone: "America/New_York", tripLocalDate: "2026-11-11",
      tomorrowLocalDate: "2026-11-12", tripLocalTime: "20:00:00", tripLocalWeekday: "Wednesday", planningReferenceDate: "2026-11-11" });
  });

  it("names the day's destination without a zone when every destination shares the trip's clock", () => {
    const osaka: TripDestination[] = [destinations[0]!, { name: "Osaka", timeZone: "Asia/Tokyo", startsOn: "2026-11-12", endsOn: "2026-11-12" }];
    const { context: decorated, dayZones } = withTripDestinations(context, osaka, new Date("2026-11-12T01:00:00Z"));
    expect(dayZones).toBeNull();
    expect(decorated.days?.[2]).toEqual({ ...days[2], destination: "Osaka" });
    expect(decorated.currentTime).toEqual(context.currentTime);
  });

  it("leaves a single undated destination exactly as before", () => {
    const result = withTripDestinations(context, [{ name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: null, endsOn: null }], new Date());
    expect(result.context).toBe(context);
    expect(result.dayZones).toBeNull();
  });
});
