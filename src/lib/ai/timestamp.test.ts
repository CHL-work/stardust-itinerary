import { describe, expect, it } from "vitest";
import { z } from "zod";

import { normalizeAiIsoDateTime } from "@/lib/ai/timestamp";

describe("AI ISO date-time normalization", () => {
  it.each([
    ["2026-09-06T06:00:00Z", "2026-09-06T06:00:00Z"],
    ["2026-09-06T15:00:00+09:00", "2026-09-06T06:00:00.000Z"],
    ["2026-09-06T15:00+09:00", "2026-09-06T06:00:00.000Z"],
    ["2026-09-06T00:30:00-05:30", "2026-09-06T06:00:00.000Z"],
    ["2024-02-29T15:00:00.123000+09:00", "2024-02-29T06:00:00.123Z"],
  ])("converts a valid explicit-zone instant to canonical UTC: %s", (input, expected) => {
    const normalized = normalizeAiIsoDateTime(input);

    expect(normalized).toBe(expected);
    expect(z.iso.datetime().safeParse(normalized).success).toBe(true);
  });

  it("preserves valid high-precision UTC and rejects lossy offset conversion", () => {
    const utc = "2024-02-29T06:00:00.123456Z";
    const offset = "2024-02-29T15:00:00.123456+09:00";

    expect(normalizeAiIsoDateTime(utc)).toBe(utc);
    expect(normalizeAiIsoDateTime(offset)).toBe(offset);
    expect(z.iso.datetime().safeParse(normalizeAiIsoDateTime(offset)).success).toBe(false);
  });

  it.each([
    "2026-09-06T15:00:00",
    "2026-09-06",
    "2026-09-06 15:00:00+09:00",
    "2026-02-29T15:00:00+09:00",
    "2026-02-31T15:00:00+09:00",
    "2026-13-06T15:00:00+09:00",
    "2026-09-06T24:00:00+09:00",
    "2026-09-06T15:60:00+09:00",
    "2026-09-06T15:00:60+09:00",
    "2026-09-06T15:00:00+24:00",
  ])("does not guess or repair an invalid instant: %s", (input) => {
    expect(normalizeAiIsoDateTime(input)).toBe(input);
  });

  it("preserves null, undefined, and non-string values", () => {
    const objectValue = { timestamp: "2026-09-06T06:00:00Z" };

    expect(normalizeAiIsoDateTime(null)).toBeNull();
    expect(normalizeAiIsoDateTime(undefined)).toBeUndefined();
    expect(normalizeAiIsoDateTime(123)).toBe(123);
    expect(normalizeAiIsoDateTime(objectValue)).toBe(objectValue);
  });
});
