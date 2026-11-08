import { describe, expect, it } from "vitest";
import { eventTimeZonesSchema, readEventTimeZones, resolveEventTimeZonesPatch, resolveLegacyFlightTimeZonesPatch } from "./event-time-zone-contract";
import { itineraryPatchSchema } from "./validation";

describe("event time-zone contract", () => {
  const hotel = { itemType: "lodging", locationName: "Synthetic hotel, Salt Lake City",
    mapUrl: null, timeZones: { start: "America/Denver", end: "America/Denver" } };
  it("supports every event type with only named IANA zones", () => {
    for (const itemType of ["activity", "meal", "lodging", "transport", "note"]) {
      expect(itineraryPatchSchema.safeParse({ itemType, timeZones: { start: "America/Denver" } }).success).toBe(true);
    }
    expect(readEventTimeZones({ start: "US/Mountain", end: null })).toEqual({ start: "America/Denver", end: null });
    for (const timeZones of [{ start: "MST" }, { start: "-07:00" }, { start: "Not/AZone" }, { start: 42 },
      { start: "America/Denver", arbitrary: "booking data" }, [], "America/Denver"]) {
      expect(eventTimeZonesSchema.safeParse(timeZones).success).toBe(false);
      expect(readEventTimeZones(timeZones)).toBeNull();
      expect(() => resolveEventTimeZonesPatch({ timeZones } as never)).toThrow();
    }
  });
  it("preserves a location zone during unrelated edits, but clears stale moved-location corrections", () => {
    expect(resolveEventTimeZonesPatch({}, hotel)).toEqual({ start: "America/Denver" });
    expect(resolveEventTimeZonesPatch({ locationName: hotel.locationName }, hotel)).toEqual({ start: "America/Denver" });
    expect(resolveEventTimeZonesPatch({ locationName: "Synthetic hotel, Dallas" }, hotel)).toBeNull();
    expect(resolveEventTimeZonesPatch({ mapUrl: "https://maps.google.com/?q=32.7,-96.8" }, hotel)).toBeNull();
    expect(resolveEventTimeZonesPatch({ locationName: "Synthetic hotel, Dallas", timeZones: { start: "America/Chicago" } }, hotel))
      .toEqual({ start: "America/Chicago" });
    expect(resolveEventTimeZonesPatch({ timeZones: null }, hotel)).toBeNull();
    expect(resolveEventTimeZonesPatch({ timeZones: { start: null, end: null } }, hotel)).toEqual({ start: null });
  });
  it("clears only the changed transport endpoint and incompatible category transitions", () => {
    const route = { itemType: "transport", departureLocationName: "Dallas", destinationLocationName: "Salt Lake City",
      timeZones: { start: "America/Chicago", end: "America/Denver" } };
    expect(resolveEventTimeZonesPatch({ departureLocationName: "New York" }, route)).toEqual({ start: null, end: "America/Denver" });
    expect(resolveEventTimeZonesPatch({ destinationMapUrl: "https://maps.google.com/?q=34,-118" }, route))
      .toEqual({ start: "America/Chicago", end: null });
    expect(resolveEventTimeZonesPatch({ itemType: "activity" }, route)).toBeNull();
    expect(resolveEventTimeZonesPatch({ itemType: "transport" }, hotel)).toBeNull();
    expect(resolveEventTimeZonesPatch({ itemType: "meal" }, hotel)).toEqual({ start: "America/Denver" });
  });
  it("clears stale legacy flight zones and preserves explicit new endpoint overrides", () => {
    const route = { itemType: "transport", departureLocationName: "DFW", destinationLocationName: "SLC",
      flight: { flightNumber: "ZZ123", departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" } };
    expect(resolveLegacyFlightTimeZonesPatch({}, route)).toEqual(route.flight);
    expect(resolveLegacyFlightTimeZonesPatch({ departureLocationName: "JFK" }, route))
      .toEqual({ ...route.flight, departureTimeZone: null });
    expect(resolveLegacyFlightTimeZonesPatch({ destinationMapUrl: "https://maps.google.com/?q=34,-118" }, route))
      .toEqual({ ...route.flight, arrivalTimeZone: null });
    expect(resolveLegacyFlightTimeZonesPatch({ timeZones: { start: null } }, route))
      .toEqual({ ...route.flight, departureTimeZone: null });
    expect(resolveLegacyFlightTimeZonesPatch({ timeZones: null }, route))
      .toEqual({ ...route.flight, departureTimeZone: null, arrivalTimeZone: null });
    expect(resolveLegacyFlightTimeZonesPatch({ departureLocationName: "JFK", flight: { ...route.flight, departureTimeZone: "America/New_York" } }, route))
      .toEqual({ ...route.flight, departureTimeZone: "America/New_York" });
    expect(resolveLegacyFlightTimeZonesPatch({ itemType: "meal" }, route)).toBeNull();
  });
});
