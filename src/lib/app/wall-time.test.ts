import { describe, expect, it } from "vitest";

import { addMinutesToWallTime, minutesBetweenWallTimes } from "@/lib/app/wall-time";

describe("plan-item wall time", () => {
  it("calculates the end from start and duration, including crossing midnight", () => {
    expect(addMinutesToWallTime("2030-04-10T23:30", 90)).toBe("2030-04-11T01:00");
  });

  it("calculates duration from the entered start and end", () => {
    expect(minutesBetweenWallTimes("2030-04-10T09:15", "2030-04-10T11:00")).toBe(105);
  });

  it("rejects invalid and non-positive ranges", () => {
    expect(minutesBetweenWallTimes("2030-04-10T11:00", "2030-04-10T09:15")).toBeNull();
    expect(addMinutesToWallTime("not-a-date", 60)).toBe("");
  });

  it("does not crash the editor when an entered duration overflows supported dates", () => {
    expect(addMinutesToWallTime("2030-04-10T09:15", Number.MAX_SAFE_INTEGER)).toBe("");
    expect(addMinutesToWallTime("2030-04-10T09:15", 9_000_000_000)).toBe("");
  });
});
