import { describe, expect, it } from "vitest";
import { validTripDate, validTripDateRange } from "./trip-date-range";

describe("trip date ranges", () => {
  it("accepts real dates and the inclusive 366-date ceiling", () => {
    expect(validTripDateRange("2024-02-29", "2025-02-28")).toBe(true);
    expect(validTripDateRange("2024-02-29", "2025-03-01")).toBe(false);
    expect(validTripDateRange("2030-04-01", "2030-04-01")).toBe(true);
    expect(validTripDateRange("2030-04-02", "2030-04-01")).toBe(false);
    for (const value of ["2030-02-29", "2030-04-31", "0000-01-01", "bad", "2030-4-01"]) {
      expect(validTripDate(value)).toBe(false);
    }
  });
});
