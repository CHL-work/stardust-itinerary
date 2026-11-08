import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { airportCodeFromLocation, airportTimeZone, flightTimeZoneOptions } from "@/lib/app/airport-time-zones";
import { airportTimeZoneGroups } from "@/lib/app/airport-time-zones.generated";
import { resolveFlightPresentation } from "@/lib/app/flight-presentation";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

const base = { itemType: "transport", title: "Flight AA123", flight: { flightNumber: "AA123" },
  departureLocationName: "Dallas Fort Worth (DFW)", destinationLocationName: "Salt Lake City (SLC)" };

describe("airport-local flight presentation", () => {
  it("resolves structured flights without a model, network call or changed input", () => {
    const input = structuredClone(base);
    expect(resolveFlightPresentation(input, "Asia/Tokyo")).toEqual({ isFlight: true,
      departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver",
      departureZoneKnown: true, arrivalZoneKnown: true, departureZoneSource: "airport", arrivalZoneSource: "airport" });
    expect(input).toEqual(base);
  });

  it("gives valid explicit endpoint zones precedence, independently", () => {
    expect(resolveFlightPresentation({ ...base, flight: { flightNumber: "AA123", departureTimeZone: "Europe/London" } }, "Asia/Tokyo"))
      .toMatchObject({ isFlight: true, departureTimeZone: "Europe/London", departureZoneSource: "explicit", arrivalTimeZone: "America/Denver" });
  });

  it("handles the old flight title only with an explicit flight marker, flight number and unambiguous airport route", () => {
    for (const title of ["Example Airlines AA 1456 DFW → SLC", "Flight AA-123 DFW to SLC", "航班 AA123 DFW → SLC"]) {
      expect(resolveFlightPresentation({ itemType: "transport", title }, "Asia/Tokyo"))
        .toMatchObject({ isFlight: true, departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" });
    }
  });

  it.each(["Airport shuttle AA123 DFW → SLC", "Flight AA123 DFW → SLC bus transfer", "Train AA123 DFW → SLC",
    "Flight DFW → SLC", "AA123 DFW → SLC", "Flight AA123 UNKNOWN → SLC", "Flight AA123 DFW → SLC and HND → NRT", "Flight AA123 DFW → SLC → HND",
    "Flights are fun, my route DFW → SLC", "Flight AA123 SAN FRANCISCO", "Flight AA123 DFW ↔ SLC"])("does not guess a legacy flight from %s", (title) => {
    expect(resolveFlightPresentation({ itemType: "transport", title }, "Asia/Tokyo").isFlight).toBe(false);
  });

  it("does not promote generic transport just because both endpoints are airports", () => {
    expect(resolveFlightPresentation({ ...base, title: "Airport connection", flight: null }, "Asia/Tokyo"))
      .toMatchObject({ isFlight: false, departureTimeZone: "Asia/Tokyo", departureZoneKnown: false });
    expect(resolveFlightPresentation({ ...base, itemType: "activity" }, "Asia/Tokyo").isFlight).toBe(false);
  });

  it("keeps unknown and conflicting airport zones honestly labeled as a trip-zone fallback", () => {
    expect(resolveFlightPresentation({ ...base, title: "Flight AA123", departureLocationName: "Some airport", destinationLocationName: "SAN FRANCISCO" }, "Asia/Tokyo"))
      .toMatchObject({ isFlight: true, departureTimeZone: "Asia/Tokyo", arrivalTimeZone: "Asia/Tokyo", departureZoneKnown: false, arrivalZoneKnown: false });
    expect(resolveFlightPresentation({ ...base, title: "Flight AA123 HND → SLC" }, "Asia/Tokyo"))
      .toMatchObject({ departureZoneKnown: false, departureZoneSource: "trip", arrivalZoneKnown: true });
  });

  it("never treats a USA country suffix as Concord airport or a known departure zone", () => {
    for (const departureLocationName of ["Dallas Fort Worth Airport, USA", "Salt Lake City International Airport, USA",
      "Dallas Fort Worth Airport (USA)", "Salt Lake City International Airport (United States/USA)"]) {
      expect(resolveFlightPresentation({ ...base, departureLocationName }, "Asia/Tokyo"))
        .toMatchObject({ isFlight: true, departureTimeZone: "Asia/Tokyo", departureZoneKnown: false, departureZoneSource: "trip" });
    }
    expect(resolveFlightPresentation({ ...base, title: "Flight AA123 DFW → SLC",
      departureLocationName: "Dallas Fort Worth Airport, USA", destinationLocationName: "Salt Lake City International Airport, USA" }, "Asia/Tokyo"))
      .toMatchObject({ departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver",
        departureZoneKnown: true, arrivalZoneKnown: true });
  });

  it("accepts privacy-reduced display projections without a flight number", () => {
    expect(resolveFlightPresentation({ itemType: "transport", flightPresentation: { isFlight: true,
      departureTimeZone: "America/Chicago", arrivalTimeZone: null } }, "Asia/Tokyo"))
      .toMatchObject({ isFlight: true, departureTimeZone: "America/Chicago", departureZoneKnown: true, arrivalTimeZone: "Asia/Tokyo", arrivalZoneKnown: false });
    expect(resolveFlightPresentation({ itemType: "transport", flightPresentation: { isFlight: true,
      departureTimeZone: "bad", arrivalTimeZone: "+09:00" } }, "Asia/Tokyo"))
      .toMatchObject({ departureZoneKnown: false, arrivalZoneKnown: false });
  });

  it("uses real time-zone rules for DST and calendar-date crossings, not a saved fixed offset", () => {
    const zones = resolveFlightPresentation(base, "Asia/Tokyo");
    const local = (at: string, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
    expect(local("2030-01-15T16:00:00Z", zones.departureTimeZone)).toContain("10:00");
    expect(local("2030-07-15T16:00:00Z", zones.departureTimeZone)).toContain("11:00");
    expect(local("2030-07-15T16:00:00Z", zones.arrivalTimeZone)).toContain("10:00");
    expect(local("2030-07-15T05:30:00Z", zones.departureTimeZone)).toContain("2030-07-15");
    expect(local("2030-07-15T05:30:00Z", zones.arrivalTimeZone)).toContain("2030-07-14");
  });
});

describe("pinned compact airport catalog", () => {
  it("recognizes exact code placement without matching arbitrary city words or code substrings", () => {
    for (const location of ["DFW", "Dallas Fort Worth (DFW)", "DFW Airport", "DFW Terminal E", "IATA: DFW"]) expect(airportCodeFromLocation(location)).toBe("DFW");
    for (const location of ["SAN FRANCISCO", "LONDON", "XXDFWYY", "DFW → SLC", "DFW/SLC", "Dallas (DFW) and (SLC)", "unknown",
      "Dallas Fort Worth DFW", "Dallas Fort Worth Airport, USA", "Salt Lake City International Airport, USA",
      "Dallas Fort Worth Airport (USA)", "Concord (USA)", "USA Airport", "Airport (United States/USA)"])
      expect(airportCodeFromLocation(location)).toBeNull();
    expect(airportCodeFromLocation("USA")).toBe("USA");
    expect(airportCodeFromLocation("Concord IATA: USA")).toBe("USA");
    expect(airportCodeFromLocation("Dallas Fort Worth (DFW), USA")).toBe("DFW");
    expect(airportTimeZone("DFW")).toBe("America/Chicago");
    expect(airportTimeZone("SLC")).toBe("America/Denver");
    expect(airportTimeZone("INVALID")).toBeNull();
  });

  it("has unambiguous codes and named supported zones, attribution and a small browser payload", () => {
    const seen = new Set<string>();
    for (const [zone, codes] of Object.entries(airportTimeZoneGroups)) {
      expect(canonicalTripTimeZone(zone)).not.toBeNull();
      for (const code of codes.split(" ")) { expect(seen.has(code)).toBe(false); seen.add(code); expect(code).toMatch(/^[A-Z]{3}$/u); }
    }
    expect(seen.size).toBeGreaterThan(7000);
    expect(flightTimeZoneOptions[0]).toBe("UTC");
    const data = readFileSync("src/lib/app/airport-time-zones.generated.ts", "utf8");
    expect(Buffer.byteLength(data)).toBeLessThan(50_000);
    expect(data).toContain("a89e4e0dda9d9878337e2da190ebe1ef1d6af705");
    expect(readFileSync("src/lib/app/airport-time-zones.LICENSE", "utf8")).toContain("Copyright (c) 2014 mwgg");
    // The runtime image includes src, hence the upstream license alongside the compact data.
    expect(readFileSync("Dockerfile", "utf8")).toMatch(/^COPY src \.\/src$/mu);
  });
});
