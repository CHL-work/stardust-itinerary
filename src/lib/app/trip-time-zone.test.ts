import { describe, expect, it } from "vitest";
import { canonicalTripTimeZone, isTripTimeZone } from "./trip-time-zone";

describe("strict trip time zones", () => {
  it.each(["EST", "+09:00", "GMT+9", "Dallas", "", " Asia/Tokyo", "Etc/GMT+9", "not/a/zone"])("rejects %s", (zone) => {
    expect(canonicalTripTimeZone(zone)).toBeNull();
    expect(isTripTimeZone(zone)).toBe(false);
  });
  it.each([["Asia/Tokyo", "Asia/Tokyo"], ["US/Central", "America/Chicago"], ["Etc/UTC", "UTC"], ["UTC", "UTC"],
    ["Asia/Kolkata", "Asia/Calcutta"], ["Europe/Kyiv", "Europe/Kiev"]])("canonicalizes %s", (input, output) => {
    expect(canonicalTripTimeZone(input)).toBe(output);
    expect(isTripTimeZone(input)).toBe(true);
  });
});
