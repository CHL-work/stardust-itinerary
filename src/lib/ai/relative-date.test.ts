import { describe, expect, it } from "vitest";

import { instantDateInTimeZone, requestedRelativeDate } from "@/lib/ai/relative-date";

describe("AI relative-date validation", () => {
  const currentTime = { tripLocalDate: "2026-08-29", tomorrowLocalDate: "2026-08-30" };

  it("resolves English and Cantonese tomorrow from authoritative current time", () => {
    expect(requestedRelativeDate("Dinner tomorrow", currentTime)).toBe("2026-08-30");
    expect(requestedRelativeDate("聽日食壽司", currentTime)).toBe("2026-08-30");
  });

  it("resolves today without substituting a trip start", () => {
    expect(requestedRelativeDate("今日加個活動", currentTime)).toBe("2026-08-29");
  });

  it("converts UTC timestamps to the trip local calendar date", () => {
    expect(instantDateInTimeZone("2026-08-29T16:00:00Z", "Asia/Tokyo")).toBe("2026-08-30");
  });
});
