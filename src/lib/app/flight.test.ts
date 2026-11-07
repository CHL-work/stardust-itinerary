import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  flightArrivalDetail, flightDepartureDetail, FLIGHT_NUMBER_PATTERN, isFlightNumber, normalizeFlightNumber, readFlightDetails,
} from "@/lib/app/flight";
import { flightMessages, flightPointLocation } from "@/lib/app/flight-i18n";
import { itineraryPatchSchema } from "@/lib/app/validation";
import { locales } from "@/lib/i18n";

describe("flight details (JOB-082)", () => {
  it("normalizes and recognizes flight numbers", () => {
    expect(normalizeFlightNumber(" jl 123 ")).toBe("JL123");
    expect(normalizeFlightNumber("ＣＸ-５２１")).toBe("CX521");
    for (const number of ["JL123", "9C8913", "CPA521", "NH1A", "U21234"]) expect(isFlightNumber(number)).toBe(true);
    for (const number of ["12345", "JL", "JL12345", "J", "JL-123", "jl123", ""]) expect(isFlightNumber(number)).toBe(false);
  });

  it("keeps the database check and the application pattern the same", () => {
    const migration = readFileSync("database/migrations/0061_flight_details.sql", "utf8");
    expect(migration).toContain(`~ '${FLIGHT_NUMBER_PATTERN.source}'`);
    expect(migration).toContain("item_type = 'transport'");
  });

  it("shows the gate with its terminal, else the terminal, else the airline (D-094)", () => {
    const base = { flightNumber: "JL123", airline: "Japan Airlines" };
    expect(flightDepartureDetail({ ...base, departureTerminal: "Terminal 1", departureGate: "8" }))
      .toEqual({ kind: "gate", terminal: "Terminal 1", gate: "8" });
    expect(flightDepartureDetail({ ...base, departureGate: "8" })).toEqual({ kind: "gate", terminal: null, gate: "8" });
    expect(flightDepartureDetail({ ...base, departureTerminal: "Terminal 1" })).toEqual({ kind: "terminal", terminal: "Terminal 1" });
    expect(flightDepartureDetail(base)).toEqual({ kind: "airline", airline: "Japan Airlines" });
    expect(flightDepartureDetail({ flightNumber: "JL123" })).toBeNull();
    expect(flightArrivalDetail({ flightNumber: "JL123", arrivalTerminal: " South Terminal " })).toBe("South Terminal");
  });

  it("reads stored details defensively", () => {
    expect(readFlightDetails({ flightNumber: "JL123", departureGate: "8" }))
      .toEqual({ flightNumber: "JL123", airline: null, departureTerminal: null, departureGate: "8", arrivalTerminal: null });
    for (const value of [null, "JL123", { flightNumber: "bad" }, { flightNumber: "JL123", extra: true }]) {
      expect(readFlightDetails(value)).toBeNull();
    }
  });

  it("validates flight details in event patches", () => {
    expect(itineraryPatchSchema.parse({ flight: { flightNumber: "JL123", departureTerminal: "Terminal 1" } }).flight)
      .toEqual({ flightNumber: "JL123", departureTerminal: "Terminal 1" });
    expect(itineraryPatchSchema.parse({ flight: null }).flight).toBeNull();
    for (const flight of [{ flightNumber: "jl123" }, { flightNumber: "JL123", departureGate: "x".repeat(21) },
      { flightNumber: "JL123", seat: "12A" }, { airline: "Japan Airlines" }]) {
      expect(itineraryPatchSchema.safeParse({ flight }).success).toBe(false);
    }
  });

  it.each(locales)("labels flight endpoints on cards in %s", (locale) => {
    const copy = flightMessages(locale);
    const flight = { flightNumber: "JL123", airline: "Japan Airlines", departureTerminal: "Terminal 1", departureGate: "8", arrivalTerminal: "South Terminal" };
    const gate = copy.gateValue.replace("{gate}", "8");
    expect(flightPointLocation("departure", "Haneda Airport", flight, locale)).toBe(`Haneda Airport · Terminal 1 · ${gate}`);
    expect(flightPointLocation("departure", "Haneda Airport", { ...flight, departureGate: null }, locale)).toBe("Haneda Airport · Terminal 1");
    expect(flightPointLocation("departure", "Haneda Airport", { flightNumber: "JL123", airline: "Japan Airlines" }, locale))
      .toBe("Haneda Airport · Japan Airlines");
    expect(flightPointLocation("arrival", "Itami Airport", flight, locale)).toBe("Itami Airport · South Terminal");
    expect(flightPointLocation("departure", "Haneda Airport Terminal 1", flight, locale)).toBe(`Haneda Airport Terminal 1 · ${gate}`);
    expect(flightPointLocation("departure", "Haneda Airport terminal 1", { ...flight, departureGate: null }, locale)).toBe("Haneda Airport terminal 1");
    expect(flightPointLocation("arrival", "Itami Airport South Terminal", flight, locale)).toBe("Itami Airport South Terminal");
    expect(flightPointLocation("departure", "Haneda Airport", null, locale)).toBe("Haneda Airport");
    expect(flightPointLocation("event", "Somewhere", flight, locale)).toBe("Somewhere");
    for (const value of Object.values(copy)) expect(value.trim()).not.toBe("");
  });

  it("keeps both Cantonese modes neutral", () => {
    expect(flightMessages("zh-HK-lihkg")).toEqual(flightMessages("zh-HK"));
    expect(Object.keys(flightMessages("ja-JP"))).toEqual(Object.keys(flightMessages("en")));
  });
});
