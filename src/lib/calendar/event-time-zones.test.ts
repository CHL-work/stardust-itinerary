import { describe, expect, it } from "vitest";
import { resolveEventTimeZones } from "@/lib/app/event-time-zones";
import { calendarFallbackTimeZones } from "./event-time-zones";

describe("Calendar author-zone fallback", () => {
  const chicago = { start: "America/Chicago", end: "America/Chicago" };
  it("prefers known venue geography over a source calendar's display zone", () => {
    const timeZones = calendarFallbackTimeZones("Synthetic hotel, Salt Lake City", chicago);
    expect(timeZones).toBeNull();
    expect(resolveEventTimeZones({ itemType: "lodging", locationName: "Synthetic hotel, Salt Lake City", timeZones }, "America/Chicago")
      .departureTimeZone).toBe("America/Denver");
  });
  it("drops the fallback when a researched map fills in previously missing venue geography", () => {
    expect(calendarFallbackTimeZones(null, chicago, "https://www.google.com/maps/search/?api=1&query=40.7608%2C-111.8910")).toBeNull();
    expect(calendarFallbackTimeZones("Synthetic venue", chicago)).toEqual(chicago);
  });
  it("validates source fallbacks and never mistakes them for a manual override of known geography", () => {
    expect(calendarFallbackTimeZones(null, { start: "MST" })).toBeNull();
    expect(calendarFallbackTimeZones(null, { start: null, end: null })).toBeNull();
    expect(calendarFallbackTimeZones(null, null)).toBeNull();
    expect(calendarFallbackTimeZones(null, chicago)).toEqual(chicago);
    expect(calendarFallbackTimeZones("Salt Lake City", { start: "America/Phoenix" })).toBeNull();
  });
});
