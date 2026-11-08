import { describe, expect, it } from "vitest";
import {
  addMinutesZoned, isoToWallTime, minutesBetweenZonedTimes, wallTimeToIso, ZonedEventTimeError,
} from "./zoned-event-time";

function errorCode(run: () => unknown, code: ZonedEventTimeError["code"]) {
  try { run(); throw new Error("Expected a zoned-time refusal."); }
  catch (error) { expect(error).toBeInstanceOf(ZonedEventTimeError); expect((error as ZonedEventTimeError).code).toBe(code); }
}

describe("airport-local datetime fields", () => {
  it.each([
    ["2026-09-11T16:00", "Asia/Tokyo", "2026-09-11T07:00:00.000Z"],
    ["2026-09-11T14:00", "America/Chicago", "2026-09-11T19:00:00.000Z"],
    ["2026-01-11T14:00", "America/Chicago", "2026-01-11T20:00:00.000Z"],
    ["2026-09-11T14:00", "Asia/Kathmandu", "2026-09-11T08:15:00.000Z"],
    ["2026-11-11T14:00", "Pacific/Chatham", "2026-11-11T00:15:00.000Z"],
    ["2026-09-11T14:00", "UTC", "2026-09-11T14:00:00.000Z"],
    ["0099-09-11T14:00", "UTC", "0099-09-11T14:00:00.000Z"],
    ["0001-01-01T00:00", "UTC", "0001-01-01T00:00:00.000Z"],
  ])("round-trips %s in %s", (wall, zone, iso) => {
    expect(wallTimeToIso(wall, zone)).toBe(iso);
    expect(isoToWallTime(iso, zone)).toBe(wall);
  });

  it("uses elapsed time across the date line, not the apparent order of local times", () => {
    expect(minutesBetweenZonedTimes("2026-09-11T16:00", "Asia/Tokyo", "2026-09-11T14:00", "America/Chicago")).toBe(720);
    expect(addMinutesZoned("2026-09-11T16:00", "Asia/Tokyo", 720, "America/Chicago")).toBe("2026-09-11T14:00");
    expect(minutesBetweenZonedTimes("2026-09-11T23:30", "Pacific/Honolulu", "2026-09-13T08:30", "Asia/Tokyo")).toBe(840);
  });

  it.each([
    ["2026-03-08T02:30", "America/New_York"],
    ["2026-03-29T02:30", "Europe/Berlin"],
    ["2026-10-04T02:15", "Australia/Lord_Howe"],
    ["2011-12-30T12:00", "Pacific/Apia"],
  ])("refuses nonexistent %s in %s rather than shifting it", (wall, zone) => {
    errorCode(() => wallTimeToIso(wall, zone), "invalidLocalTime");
  });

  it.each([
    ["2026-11-01T01:30", "America/New_York"],
    ["2026-10-25T02:30", "Europe/Berlin"],
    ["2026-04-05T01:45", "Australia/Lord_Howe"],
  ])("requires an explicit occurrence for repeated %s in %s", (wall, zone) => {
    errorCode(() => wallTimeToIso(wall, zone), "ambiguousTime");
  });

  it.each(["2026-11-01T05:30:17.123Z", "2026-11-01T06:30:54.987Z"])("preserves the existing DST occurrence and precision of %s", iso => {
    expect(wallTimeToIso("2026-11-01T01:30", "America/New_York", iso)).toBe(iso);
  });
  it("does not use an unrelated or invalid prior instant to choose a DST occurrence", () => {
    errorCode(() => wallTimeToIso("2026-11-01T01:30", "America/New_York", "2026-11-01T05:45:00Z"), "ambiguousTime");
    errorCode(() => wallTimeToIso("2026-11-01T01:30", "America/New_York", "not-an-instant"), "ambiguousTime");
  });
  it("preserves unchanged ordinary seconds and milliseconds, including explicit offsets", () => {
    expect(wallTimeToIso("2026-09-11T16:00", "Asia/Tokyo", "2026-09-11T16:00:27.123+09:00")).toBe("2026-09-11T07:00:27.123Z");
    expect(wallTimeToIso("2026-09-11T16:01", "Asia/Tokyo", "2026-09-11T07:00:27.123Z")).toBe("2026-09-11T07:01:00.000Z");
  });
  it("calculates elapsed duration through DST and preserves selected fold occurrences", () => {
    expect(addMinutesZoned("2026-03-08T01:30", "America/New_York", 120, "America/New_York")).toBe("2026-03-08T04:30");
    expect(minutesBetweenZonedTimes("2026-03-08T01:30", "America/New_York", "2026-03-08T04:30", "America/New_York")).toBe(120);
    expect(minutesBetweenZonedTimes("2026-11-01T01:30", "America/New_York", "2026-11-01T01:30", "America/New_York",
      {startsAt:"2026-11-01T05:30:00Z",endsAt:"2026-11-01T06:30:00Z"})).toBe(60);
  });
  it.each(["Dallas", "JST", "+09:00", "", "Mars/Olympus"])("refuses the non-IANA zone %s", zone => {
    errorCode(() => wallTimeToIso("2026-09-11T16:00", zone), "invalidTimeZone");
    errorCode(() => isoToWallTime("2026-09-11T07:00:00Z", zone), "invalidTimeZone");
  });
  it.each(["2026-02-30T16:00", "2026-13-01T16:00", "2026-00-01T16:00", "2026-01-00T16:00", "0000-01-01T00:00", "2026-01-01T24:00", "2026-01-01T12:60", "2026-01-01", "not-a-date"])("refuses malformed local input %s", value => {
    errorCode(() => wallTimeToIso(value, "UTC"), "invalidLocalTime");
  });
  it("does not parse instants in the machine's local zone or normalize invalid calendar dates", () => {
    errorCode(() => isoToWallTime("2026-09-11T16:00", "UTC"), "invalidLocalTime");
    errorCode(() => isoToWallTime("2026-02-30T16:00:00Z", "UTC"), "invalidLocalTime");
    expect(isoToWallTime(null, "UTC")).toBe("");
    expect(isoToWallTime("", "UTC")).toBe("");
  });
  it("keeps optional ends unknown and refuses nonpositive elapsed durations", () => {
    expect(minutesBetweenZonedTimes("2026-09-11T14:00", "UTC", "", "Asia/Tokyo")).toBeNull();
    expect(minutesBetweenZonedTimes("2026-09-11T14:00", "UTC", "2026-09-11T13:00", "UTC")).toBeNull();
    for (const value of [0,-1,1.2,Infinity,Number.MAX_SAFE_INTEGER]) errorCode(() => addMinutesZoned("2026-09-11T14:00", "UTC", value, "UTC"), "invalidLocalTime");
  });
});
