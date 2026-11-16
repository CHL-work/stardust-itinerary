import { describe, expect, it } from "vitest";

import { createTripSchema, destinationsOutsideTrip, tripSettingsSchema } from "@/lib/app/validation";

const trip = { name: "Synthetic trip", destinationName: "Tokyo", timeZone: "Asia/Tokyo", defaultLocale: "en", defaultCurrency: "JPY",
  startsOn: "2031-05-01", endsOn: "2031-05-07", maxMembers: 4 };
const tokyo = { name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: "2031-05-01", endsOn: "2031-05-04" };
const newYork = { name: "New York", timeZone: "America/New_York", startsOn: "2031-05-04", endsOn: "2031-05-07" };

describe("destination validation (JOB-098, D-110)", () => {
  it("accepts an ordered list whose first destination is the trip's, with optional dates", () => {
    const parsed = createTripSchema.parse({ ...trip, destinations: [tokyo, { name: "Osaka", timeZone: "Asia/Tokyo" }, newYork] });
    expect(parsed.destinations).toEqual([tokyo, { name: "Osaka", timeZone: "Asia/Tokyo", startsOn: null, endsOn: null }, newYork]);
    expect(createTripSchema.parse(trip).destinations).toBeUndefined();
  });

  it("refuses a first destination that is not the trip's, dates outside the trip, half a range, or a bad zone", () => {
    expect(createTripSchema.safeParse({ ...trip, destinations: [newYork, tokyo] }).success).toBe(false);
    expect(createTripSchema.safeParse({ ...trip, destinations: [{ ...tokyo, startsOn: "2031-04-30" }] }).success).toBe(false);
    expect(createTripSchema.safeParse({ ...trip, destinations: [tokyo, { ...newYork, endsOn: null }] }).success).toBe(false);
    expect(createTripSchema.safeParse({ ...trip, destinations: [tokyo, { ...newYork, endsOn: "2031-05-03" }] }).success).toBe(false);
    expect(createTripSchema.safeParse({ ...trip, destinations: [tokyo, { ...newYork, timeZone: "GMT+9" }] }).success).toBe(false);
    expect(createTripSchema.safeParse({ ...trip, destinations: Array.from({ length: 13 }, () => ({ name: "Tokyo", timeZone: "Asia/Tokyo" })) }).success)
      .toBe(false);
  });

  it("lets settings replace the list, alone or with a matching name and zone", () => {
    expect(tripSettingsSchema.parse({ destinations: [tokyo, newYork] }).destinations).toHaveLength(2);
    expect(tripSettingsSchema.safeParse({ destinationName: "Tokyo", timeZone: "Asia/Tokyo", destinations: [tokyo, newYork] }).success).toBe(true);
    expect(tripSettingsSchema.safeParse({ destinationName: "Kyoto", destinations: [tokyo, newYork] }).success).toBe(false);
    expect(tripSettingsSchema.safeParse({ destinations: [] }).success).toBe(false);
  });

  it("finds destinations outside the trip's dates", () => {
    expect(destinationsOutsideTrip([tokyo, newYork, { startsOn: null, endsOn: null }], "2031-05-02", "2031-05-07")).toEqual([0]);
  });
});
