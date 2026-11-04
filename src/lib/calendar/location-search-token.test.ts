import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { createCalendarLocationToken, verifyCalendarLocationToken } from "./location-search-token";

const session = { tripId: "10000000-0000-4000-8000-000000000001", memberId: "10000000-0000-4000-8000-000000000002",
  userId: "10000000-0000-4000-8000-000000000003" } as AuthenticatedSession;
const secret = "synthetic-secret-for-calendar-test-only";
const location = { requestId: "10000000-0000-4000-8000-000000000004", locationName: "Synthetic Park, Tokyo",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic%20Park" };

describe("Calendar AI provenance receipt", () => {
  it("requires a signed actor-bound result and survives manual refinement to retain owner review", () => {
    const token = createCalendarLocationToken(secret, session, location);
    expect(() => verifyCalendarLocationToken(token, secret, session, location)).not.toThrow();
    expect(() => verifyCalendarLocationToken(token, secret, session, { locationName: "Edited venue", mapUrl: null })).not.toThrow();
  });
  it.each(["tripId", "memberId", "userId"] as const)("rejects another %s", (field) => {
    const token = createCalendarLocationToken(secret, session, location);
    expect(() => verifyCalendarLocationToken(token, secret, { ...session, [field]: location.requestId }, location)).toThrow("CALENDAR_LOCATION_RECEIPT_INVALID");
  });
  it("rejects tampering, malformed tokens, wrong secret and expiry", () => {
    const token = createCalendarLocationToken(secret, session, location);
    for (const value of [token.replace(/^./u, "!"), "true", token + ".extra", "x".repeat(6001)])
      expect(() => verifyCalendarLocationToken(value, secret, session, location)).toThrow("CALENDAR_LOCATION_RECEIPT_INVALID");
    expect(() => verifyCalendarLocationToken(token, "different", session, location)).toThrow();
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(30 * 60_000 + 1);
      expect(() => verifyCalendarLocationToken(token, secret, session, location)).toThrow();
    } finally { vi.useRealTimers(); }
  });
});
