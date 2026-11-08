import { describe, expect, it } from "vitest";
import { itineraryProposalLocalDate } from "./itinerary-local-date";
import { instantDateInTimeZone } from "./relative-date";

describe("AI venue-local relative date guard", () => {
  it("accepts the intended late-night venue date while retaining the next trip-calendar grouping", () => {
    const startsAt = "2031-04-03T05:30:00Z";
    const result = itineraryProposalLocalDate({ itemType: "meal", locationName: "Synthetic cafe, Salt Lake City", startsAt }, undefined, "America/Chicago");
    expect(result).toEqual({ date: "2031-04-02", timeZone: "America/Denver" });
    expect(instantDateInTimeZone(startsAt, "America/Chicago")).toBe("2031-04-03");
  });
  it("uses date-specific DST rather than a fixed venue offset", () => {
    for (const [startsAt, date] of [["2031-01-15T06:30:00Z", "2031-01-14"], ["2031-07-15T06:30:00Z", "2031-07-15"]]) {
      expect(itineraryProposalLocalDate({ itemType: "meal", locationName: "Salt Lake City", startsAt }, undefined, "America/Chicago").date).toBe(date);
    }
  });
  it("uses current and pending base facts but clears a moved venue's stale override", () => {
    const current = { itemType: "meal" as const, locationName: "Synthetic cafe, Dallas", timeZones: { start: "America/Chicago" }, startsAt: "2031-04-03T05:30:00Z" };
    expect(itineraryProposalLocalDate({ locationName: "Synthetic cafe, Salt Lake City" }, current, "America/Chicago"))
      .toEqual({ date: "2031-04-02", timeZone: "America/Denver" });
    expect(itineraryProposalLocalDate({ notes: "Only notes changed" }, current, "America/Chicago"))
      .toEqual({ date: "2031-04-03", timeZone: "America/Chicago" });
  });
  it("clears legacy flight endpoint overrides and uses the new airport date", () => {
    const current = { itemType: "transport" as const, departureLocationName: "DFW", destinationLocationName: "LAX",
      flight: { flightNumber: "ZZ123", departureTimeZone: "America/Chicago" }, startsAt: "2031-04-03T05:30:00Z" };
    expect(itineraryProposalLocalDate({ departureLocationName: "SLC" }, current, "America/Chicago"))
      .toEqual({ date: "2031-04-02", timeZone: "America/Denver" });
  });
  it("does not invent a date without an instant and keeps unknown geography on the trip fallback", () => {
    expect(itineraryProposalLocalDate({ itemType: "note" }, undefined, "America/Chicago"))
      .toEqual({ date: null, timeZone: "America/Chicago" });
    expect(itineraryProposalLocalDate({ startsAt: "2031-04-03T05:30:00Z" }, undefined, "America/Chicago").date).toBe("2031-04-03");
  });
});
