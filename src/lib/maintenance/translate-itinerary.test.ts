import { describe, expect, it } from "vitest";

import {
  assertLocalPostgresUrl,
  assertLoopbackServerAddress,
  assertSelectedTripsComplete,
  parseItineraryTranslationPlan,
  prepareTripTranslations,
  type CurrentItineraryItem,
} from "./translate-itinerary";

function planInput() {
  const tripNames = ["Synthetic Coast Trip", "Synthetic Mountain Trip"];
  const mapping = (index: number) => ({
    dayDate: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
    source: {
      title: `Source title ${index}`,
      locationName: `Source location ${index}`,
      notes: index % 2 ? null : `Source note ${index}`,
    },
    cantonese: {
      title: `廣東話活動 ${index}`,
      locationName: `廣東話地點 ${index}`,
      notes: index % 2 ? null : `廣東話備註 ${index}`,
    },
  });
  return {
    version: 1,
    exactTripNames: tripNames,
    expectedItemCount: 4,
    trips: [{
      name: tripNames[0],
      items: Array.from({ length: 3 }, (_, index) => mapping(index + 1)),
    }, {
      name: tripNames[1],
      items: [mapping(4)],
    }],
  };
}

function currentItem(overrides: Partial<CurrentItineraryItem> = {}): CurrentItineraryItem {
  return {
    id: "31000000-0000-4000-8000-000000000001",
    dayDate: "2026-09-02",
    currentRevision: 2,
    title: "Source title 1",
    locationName: "Source location 1",
    notes: null,
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Example%20Hotel",
    visibleToOwner: true,
    ...overrides,
  };
}

describe("local itinerary translation maintenance", () => {
  it("accepts only dedicated PostgreSQL URLs on a loopback host", () => {
    expect(assertLocalPostgresUrl("postgresql://user:pass@127.0.0.1:54329/stardust").hostname)
      .toBe("127.0.0.1");
    expect(() => assertLocalPostgresUrl("postgresql://user:pass@db.example.com/stardust"))
      .toThrow(/local-only/);
    expect(() => assertLocalPostgresUrl("postgresql://user:pass@localhost/postgres"))
      .toThrow(/dedicated local application database/);
    expect(() => assertLocalPostgresUrl("postgresql://user:pass@localhost/stardust?host=db.example.com"))
      .toThrow(/cannot override/);
  });

  it("also requires PostgreSQL itself to report a loopback server address", () => {
    expect(() => assertLoopbackServerAddress("::1")).not.toThrow();
    expect(() => assertLoopbackServerAddress("::ffff:127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackServerAddress("127.0.0.1/32")).not.toThrow();
    expect(() => assertLoopbackServerAddress("::1/128")).not.toThrow();
    expect(() => assertLoopbackServerAddress(null, "127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackServerAddress(null, "localhost, ::1")).not.toThrow();
    expect(() => assertLoopbackServerAddress("10.0.0.8")).toThrow(/did not report a loopback/);
    expect(() => assertLoopbackServerAddress(null)).toThrow(/did not report a loopback/);
    expect(() => assertLoopbackServerAddress(null, "*")).toThrow(/did not report a loopback/);
    expect(() => assertLoopbackServerAddress(null, "0.0.0.0")).toThrow(/did not report a loopback/);
  });

  it("requires an exact trip allowlist and the declared number of unique mappings", () => {
    const plan = parseItineraryTranslationPlan(planInput());
    expect(plan.expectedItemCount).toBe(4);
    expect(() => assertSelectedTripsComplete(plan, [
      { name: "Synthetic Coast Trip" },
      { name: "Synthetic Mountain Trip" },
    ])).not.toThrow();
    expect(() => assertSelectedTripsComplete(plan, [{ name: "Synthetic Coast Trip" }]))
      .toThrow(/every allowed local trip/);

    const invalid = planInput();
    invalid.trips[0].items[1].dayDate = invalid.trips[0].items[0].dayDate;
    invalid.trips[0].items[1].source.title = invalid.trips[0].items[0].cantonese.title;
    expect(() => parseItineraryTranslationPlan(invalid)).toThrow(/exactly one event/);
  });

  it("builds an audited content update while retaining the exact map URL only in memory", () => {
    const trip = parseItineraryTranslationPlan(planInput()).trips[0];
    const singleTrip = { ...trip, items: [trip.items[0]] };
    const prepared = prepareTripTranslations(singleTrip, [currentItem()]);
    expect(prepared[0]).toMatchObject({
      baseRevision: 2,
      after: {
        title: "廣東話活動 1",
        locationName: "廣東話地點 1",
        notes: null,
      },
      originalMapUrl: "https://www.google.com/maps/search/?api=1&query=Example%20Hotel",
      changed: true,
    });
    expect(prepared[0].after).not.toHaveProperty("mapUrl");
  });

  it("fails before mutation when coverage, source content, or privacy is stale", () => {
    const trip = parseItineraryTranslationPlan(planInput()).trips[0];
    const singleTrip = { ...trip, items: [trip.items[0]] };
    expect(() => prepareTripTranslations(singleTrip, [])).toThrow(/cover every itinerary item/);
    expect(() => prepareTripTranslations(singleTrip, [currentItem({ locationName: "Changed" })]))
      .toThrow(/neither the audited source nor Cantonese target/);
    expect(() => prepareTripTranslations(singleTrip, [currentItem({ visibleToOwner: false })]))
      .toThrow(/private/);
  });

  it("is idempotent when the audited Cantonese content is already current", () => {
    const trip = parseItineraryTranslationPlan(planInput()).trips[0];
    const singleTrip = { ...trip, items: [trip.items[0]] };
    const prepared = prepareTripTranslations(singleTrip, [currentItem({
      currentRevision: 3,
      title: "廣東話活動 1",
      locationName: "廣東話地點 1",
    })]);
    expect(prepared[0]).toMatchObject({ changed: false, baseRevision: 3 });
  });
});
