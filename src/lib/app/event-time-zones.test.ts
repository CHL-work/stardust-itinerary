import { describe, expect, it } from "vitest";
import { eventLocationEvidence, resolveEventTimeZones } from "./event-time-zones";
import { placeTimeZone } from "./place-time-zones";

describe("all-event location-local clocks", () => {
  it.each(["meal", "lodging", "activity", "note"])("resolves a %s in Salt Lake City independently of a Dallas trip", itemType => {
    const result = resolveEventTimeZones({ itemType, locationName: "Example venue, Salt Lake City, UT 84101, USA" }, "America/Chicago");
    expect(result).toMatchObject({ isFlight: false, departureTimeZone: "America/Denver", arrivalTimeZone: "America/Denver",
      departureZoneKnown: true, arrivalZoneKnown: true, departureZoneSource: "place" });
  });
  it.each(["Example Hotel, Salt Lake City", "Example Hotel Salt Lake City", "Salt Lake City", "SLC"])("recognizes unambiguous location %s", locationName => {
    expect(resolveEventTimeZones({ itemType: "lodging", locationName }, "America/Chicago").departureTimeZone).toBe("America/Denver");
  });
  it("uses independent locations for non-flight transport without a flight icon", () => {
    expect(resolveEventTimeZones({ itemType: "transport", departureLocationName: "Bus terminal, Dallas, TX, USA",
      destinationLocationName: "Bus terminal, Salt Lake City, UT, USA" }, "Asia/Tokyo")).toMatchObject({
      isFlight: false, departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver",
    });
  });
  it("does not use an event title or a venue's borrowed city name as geography", () => {
    expect(resolveEventTimeZones({ itemType: "meal", title: "Dinner in Salt Lake City", locationName: "Mystery Cafe" }, "America/Chicago"))
      .toMatchObject({ departureTimeZone: "America/Chicago", departureZoneKnown: false });
    expect(placeTimeZone("Tokyo Sushi Bar, Salt Lake City, UT, USA")).toBe("America/Denver");
    expect(placeTimeZone("Tokyo Sushi Bar")).toBeNull();
  });
  it("keeps namesakes and conflicting address hints unknown instead of preferring trip geography", () => {
    expect(placeTimeZone("Portland")).toBeNull();
    expect(placeTimeZone("Cafe, Portland, OR, USA")).toBe("America/Los_Angeles");
    expect(placeTimeZone("Cafe, Portland, ME, USA")).toBe("America/New_York");
    expect(placeTimeZone("Cafe, Salt Lake City, TX, USA")).toBeNull();
    expect(placeTimeZone("Cafe, Dallas, Salt Lake City")).toBeNull();
  });
  it("uses explicit saved zones before automatic evidence and ignores a nontransport end override", () => {
    const item = { itemType: "lodging", locationName: "Salt Lake City", timeZones: { start: "Asia/Tokyo", end: "Europe/London" } };
    expect(resolveEventTimeZones(item, "America/Chicago")).toMatchObject({ departureTimeZone: "Asia/Tokyo", arrivalTimeZone: "Asia/Tokyo",
      departureZoneSource: "explicit" });
  });
  it("retains airport-local flight support and permits generic per-endpoint correction", () => {
    const item = { itemType: "transport", flight: { flightNumber: "AA1456" }, departureLocationName: "DFW", destinationLocationName: "SLC" };
    expect(resolveEventTimeZones(item, "Asia/Tokyo")).toMatchObject({ isFlight: true, departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" });
    expect(resolveEventTimeZones({ ...item, timeZones: { start: "UTC" } }, "Asia/Tokyo").departureTimeZone).toBe("UTC");
  });
  it.each([
    ["40.7608,-111.8910", "America/Denver"], ["32.7767,-96.7970", "America/Chicago"],
    ["35.6812,139.7671", "Asia/Tokyo"], ["51.5074,-0.1278", "Europe/London"],
    ["33.4484,-112.0740", "America/Phoenix"], ["-33.8688,151.2093", "Australia/Sydney"],
  ])("resolves saved venue coordinate %s locally", (coordinate, zone) => {
    expect(resolveEventTimeZones({ itemType: "meal", mapUrl: `https://www.google.com/maps/search/?api=1&query=${coordinate}` }, "UTC"))
      .toMatchObject({ departureTimeZone: zone, departureZoneSource: "coordinates" });
  });
  it("ignores camera centers, untrusted URLs, malformed/duplicate coordinates and short links", () => {
    for (const mapUrl of ["https://www.google.com/maps/@40.7608,-111.8910,15z", "https://example.com/maps?query=40.7608,-111.8910",
      "https://www.google.com/maps?query=40.7608,-111.8910&query=0,0", "https://maps.app.goo.gl/example", "https://maps.app.goo.gl/example?query=0,0", "https://www.google.com/maps?query=100,200"]) {
      expect(resolveEventTimeZones({ itemType: "meal", mapUrl }, "Asia/Tokyo")).toMatchObject({ departureZoneKnown: false, departureTimeZone: "Asia/Tokyo" });
    }
    expect(eventLocationEvidence(null, "https://www.google.com/maps/place/Example/@0,0,5z/data=!3d40.7608!4d-111.8910").point)
      .toEqual({ lat: 40.7608, lng: -111.8910 });
  });
  it("reads locality from a saved Maps search when the venue name alone has no city", () => {
    expect(resolveEventTimeZones({ itemType: "meal", locationName: "Example Cafe",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=Example+Cafe%2C+Salt+Lake+City%2C+UT%2C+USA" }, "America/Chicago").departureTimeZone).toBe("America/Denver");
  });
  it.each([["New York", "America/New_York"], ["Hotel, New York, NY, USA", "America/New_York"],
    ["Singapore", "Asia/Singapore"], ["Paris, France", "Europe/Paris"], ["Berlin, DE", "Europe/Berlin"],
    ["Vancouver, CA", "America/Vancouver"], ["Toronto, CA", "America/Toronto"], ["Jakarta, ID", "Asia/Jakarta"],
    ["Baku, AZ", "Asia/Baku"], ["San Francisco, CA", "America/Los_Angeles"]])("recognizes city/region namesakes %s", (location, zone) => {
    expect(placeTimeZone(location)).toBe(zone);
  });
  it("keeps contradictory saved venue coordinates/locality unknown", () => {
    expect(resolveEventTimeZones({ itemType: "meal", locationName: "Salt Lake City", mapUrl: "https://www.google.com/maps?query=32.7767,-96.7970" }, "UTC").departureZoneKnown).toBe(false);
  });
  it("retains independent name evidence when a Maps query lacks geography, but refuses conflicts", () => {
    expect(resolveEventTimeZones({ itemType: "lodging", locationName: "Dallas, TX, USA", mapUrl: "https://www.google.com/maps/search/?api=1&query=Hotel" }, "Asia/Tokyo").departureTimeZone).toBe("America/Chicago");
    expect(resolveEventTimeZones({ itemType: "lodging", locationName: "Dallas, TX, USA", mapUrl: "https://www.google.com/maps/search/?api=1&query=Salt+Lake+City" }, "Asia/Tokyo").departureZoneKnown).toBe(false);
  });
  it.each(["Tokyo", "東京都千代田区丸の内1", "名古屋市中区", "Restaurant, Fukuoka, Japan"])("supports native and international locality %s", locationName => {
    expect(resolveEventTimeZones({ itemType: "meal", locationName }, "America/Chicago").departureTimeZone).toBe("Asia/Tokyo");
  });
  it("uses the date-specific DST offset rather than a fixed UTC offset", () => {
    const zone = resolveEventTimeZones({ itemType: "meal", locationName: "Salt Lake City" }, "America/Chicago").departureTimeZone;
    const hour = (instant: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
    expect(hour("2026-01-01T19:00:00Z")).toBe("12:00");
    expect(hour("2026-07-01T18:00:00Z")).toBe("12:00");
  });
});
