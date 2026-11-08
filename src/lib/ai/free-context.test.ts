import { describe, expect, it } from "vitest";
import { safeFreePlanningContext } from "@/lib/ai/free-context";

function fixture() {
  return {
    trip: { id: "trip", name: "Private group nickname", destinationName: "Tokyo, Japan", currency: "JPY",
      timeZone: "Asia/Tokyo", startsOn: "2026-11-08", endsOn: "2026-11-10", secret: "trip-secret" },
    actor: { memberId: "member-1", role: "owner", email: "synthetic@example.invalid" },
    currentTime: { nowUtc: "2026-11-08T01:00:00Z", timeZone: "Asia/Tokyo", tripLocalDate: "2026-11-08",
      tomorrowLocalDate: "2026-11-09", tripLocalTime: "10:00:00", planningReferenceDate: "2026-11-08", extra: "time-secret" },
    days: [{ id: "day-1", date: "2026-11-08", label: "A personal anniversary" }],
    audienceDirectory: [
      { id: "member-1", displayName: "Alex", role: "owner", status: "active", email: "synthetic@example.invalid" },
      { id: "member-2", displayName: "Morgan", role: "editor", status: "invited", userId: "user-secret" },
      { id: "member-3", displayName: "Ann", role: "editor", status: "active" },
    ],
    itinerary: [
      { id: "item-1", revision: 4, tripDayId: "day-1", title: "Lunch", itemType: "meal", visibility: "trip",
        startsAt: "2026-11-08T03:00:00Z", endsAt: null, locationName: "Tokyo Station", status: "planned", isLocked: false,
        notes: "Booking PIN 654321", mapUrl: "https://example.invalid/private?key=secret",
        linkedExpense: { amountMinor: 1234 }, extra: "event-secret" },
      { id: "item-private", title: "Private appointment", visibility: "private", locationName: "Private address" },
      { id: "item-legacy", title: "Unknown audience" },
    ],
    pendingItinerary: [
      { requestId: "pending-1", proposalRevision: 3, operation: "create", targetItemId: null,
        createdByMemberId: "member-1", hasLinkedExpense: true, secret: "pending-secret",
        patch: { title: "Dinner", visibility: "trip", tripDayId: "day-1", itemType: "meal", startsAt: "2026-11-08T10:00:00Z",
          notes: "private payment note", viewerMemberIds: ["member-secret"], linkedExpense: { amountMinor: 9876 } } },
      { requestId: "pending-private", operation: "create", targetItemId: null, patch: { title: "Hidden dinner", visibility: "private" } },
      { requestId: "pending-widening", operation: "update", targetItemId: "item-private", patch: { title: "Private base details", visibility: "trip" } },
      { requestId: "pending-update", operation: "update", targetItemId: "item-1", proposalRevision: 5,
        patch: { title: "Later lunch", visibility: "trip", notes: "private revision note" } },
    ],
    pendingItineraryTruncated: true,
    currentRequest: { imageCount: 2, secret: "request-secret" },
    expenses: [{ description: "Private ledger", amountMinor: 99999 }],
    manualInstructions: "Private personal instructions",
    conversation: [{ prompt: "Paid chat must not leak" }],
  };
}

describe("safeFreePlanningContext", () => {
  it("keeps trip-wide planning facts, exact IDs, times and revisions, but not private records", () => {
    const input = fixture();
    const output = safeFreePlanningContext(input, "add dinner tomorrow");
    expect(output.trip).toEqual({ id: "trip", destinationName: "Tokyo, Japan", currency: "JPY", timeZone: "Asia/Tokyo",
      startsOn: "2026-11-08", endsOn: "2026-11-10" });
    expect(output.actor).toEqual({ memberId: "member-1", role: "owner" });
    expect(output.days).toEqual([{ id: "day-1", date: "2026-11-08" }]);
    expect(output.currentTime).toMatchObject({ tripLocalDate: "2026-11-08", tomorrowLocalDate: "2026-11-09" });
    expect(output.itinerary).toEqual([{ id: "item-1", revision: 4, tripDayId: "day-1", title: "Lunch", itemType: "meal", visibility: "trip",
      startsAt: "2026-11-08T03:00:00Z", endsAt: null, locationName: "Tokyo Station", status: "planned", isLocked: false }]);
    expect(output.pendingItinerary).toEqual([
      { requestId: "pending-1", proposalRevision: 3, operation: "create", targetItemId: null,
        createdByMemberId: "member-1", hasLinkedExpense: true,
        patch: { title: "Dinner", visibility: "trip", tripDayId: "day-1", itemType: "meal", startsAt: "2026-11-08T10:00:00Z" } },
      { requestId: "pending-update", operation: "update", targetItemId: "item-1", proposalRevision: 5,
        patch: { title: "Later lunch", visibility: "trip" } },
    ]);
    expect(output.pendingItineraryTruncated).toBe(true);
    expect(output.currentRequest).toEqual({ imageCount: 0 });
    const serialized = JSON.stringify(output);
    for (const absent of ["secret", "@", "https://", "654321", "9876", "99999", "appointment", "anniversary", "nickname", "Paid chat"]) {
      expect(serialized).not.toContain(absent);
    }
    expect(input).toEqual(fixture());
  });

  it("keeps every eligible member ID for default equal shares without automatically exposing their names", () => {
    expect(safeFreePlanningContext(fixture(), "split dinner for everyone").audienceDirectory).toEqual([
      { id: "member-1", displayName: "Member 1", role: "owner", status: "active" },
      { id: "member-2", displayName: "Member 2", role: "editor", status: "invited" },
      { id: "member-3", displayName: "Member 3", role: "editor", status: "active" },
    ]);
  });

  it("resolves a human payer name supplied in the current request without exposing others", () => {
    expect(safeFreePlanningContext(fixture(), "alex paid 2800 split with morgan pls").audienceDirectory).toEqual([
      { id: "member-1", displayName: "Alex", role: "owner", status: "active" },
      { id: "member-2", displayName: "Morgan", role: "editor", status: "invited" },
      { id: "member-3", displayName: "Member 3", role: "editor", status: "active" },
    ]);
  });

  it("does not mistake part of a word for a member's name", () => {
    expect(JSON.stringify(safeFreePlanningContext(fixture(), "planning an anniversary"))).not.toContain('"Ann"');
  });

  it("supports Unicode names touching CJK text and normalized names", () => {
    const input = fixture();
    input.audienceDirectory[0]!.displayName = "小林";
    input.audienceDirectory[1]!.displayName = "Ａｌｅｘ";
    const output = safeFreePlanningContext(input, "由小林付款，alex 分一半");
    expect(output.audienceDirectory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "member-1", displayName: "小林" }),
      expect.objectContaining({ id: "member-2", displayName: "Ａｌｅｘ" }),
    ]));
  });

  it("keeps public flight routing facts but drops nested booking data and map URLs", () => {
    const input = { itinerary: [{ id: "flight", visibility: "trip", itemType: "transport", departureLocationName: "Haneda Airport",
      destinationLocationName: "Fukuoka Airport", startsAt: "2026-11-08T03:00:00Z", endsAt: "2026-11-08T05:00:00Z",
      departureMapUrl: "https://example.invalid/private", flight: { flightNumber: "JL123", airline: "Example Air",
        departureTerminal: "Terminal 1", departureGate: "8", arrivalTerminal: null, departureTimeZone: "Asia/Tokyo", arrivalTimeZone: "Asia/Tokyo", bookingReference: "PRIVATE-REF" } }] };
    expect(safeFreePlanningContext(input, "plan after my flight").itinerary).toEqual([
      { id: "flight", visibility: "trip", itemType: "transport", departureLocationName: "Haneda Airport",
        destinationLocationName: "Fukuoka Airport", startsAt: "2026-11-08T03:00:00Z", endsAt: "2026-11-08T05:00:00Z",
        flight: { flightNumber: "JL123", airline: "Example Air", departureTerminal: "Terminal 1", departureGate: "8", arrivalTerminal: null, departureTimeZone: "Asia/Tokyo", arrivalTimeZone: "Asia/Tokyo" } },
    ]);
  });

  it("fails closed for malformed nested values and unknown fields", () => {
    const output = safeFreePlanningContext({ trip: { id: { secret: true } }, actor: null,
      currentTime: [], days: [null, { id: "day", date: { secret: true } }],
      itinerary: [null, [], { visibility: "trip", title: { secret: true }, revision: Infinity, flight: ["secret"] }],
      pendingItinerary: [{ patch: { visibility: "trip" }, operation: "update", targetItemId: "hidden" }],
      audienceDirectory: [{ id: "removed", status: "removed", displayName: "Removed" }, null],
      expenses: "secret", instructions: "secret" }, "help");
    expect(output.actor).toBeNull();
    expect(output.trip).toEqual({});
    expect(output.audienceDirectory).toEqual([]);
    expect(output.pendingItinerary).toEqual([]);
    expect(output.itinerary).toEqual([{ visibility: "trip" }]);
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(safeFreePlanningContext(null, "help").itinerary).toEqual([]);
  });
});
it("allows only the two time-zone scalars in free public context, never private events or nested baggage", () => {
  const result = safeFreePlanningContext({ itinerary: [
    { id: "public", visibility: "trip", timeZones: { start: "America/Denver", end: null, secret: "not exported" } },
    { id: "private", visibility: "private", timeZones: { start: "America/Chicago" } },
  ] }, "what time");
  expect(result.itinerary).toEqual([{ id: "public", visibility: "trip", timeZones: { start: "America/Denver", end: null } }]);
});
