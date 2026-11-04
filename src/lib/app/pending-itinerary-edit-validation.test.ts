import { describe, expect, it } from "vitest";

import { pendingItineraryEditSchema } from "@/lib/app/validation";

const tripDayId = "30000000-0000-4000-8000-000000000002";
const requesterId = "20000000-0000-4000-8000-000000000002";
const viewerId = "20000000-0000-4000-8000-000000000003";

describe("pending itinerary edit validation", () => {
  it("accepts every editable event field without losing private audience or linked-expense data", () => {
    const input = {
      proposalRevision: 7,
      reason: "Correct the pending proposal before review",
      patch: {
        tripDayId,
        title: "Airport transfer",
        itemType: "transport",
        startsAt: "2026-09-06T01:00:00.000Z",
        endsAt: "2026-09-06T02:30:00.000Z",
        locationName: null,
        mapUrl: null,
        departureLocationName: "Haneda Airport",
        departureMapUrl: "https://www.google.com/maps/place/Haneda+Airport",
        destinationLocationName: "Tokyo Station",
        destinationMapUrl: "https://www.google.com/maps/place/Tokyo+Station",
        notes: "Use the airport limousine bus",
        visibility: "private",
        viewerMemberIds: [viewerId],
        status: "planned",
        isLocked: false,
        linkedExpense: {
          description: "Airport bus",
          amountMinor: 3200,
          currency: "JPY",
          payerMemberId: requesterId,
          occurredAt: "2026-09-06T01:00:00.000Z",
          status: "posted",
          splitMemberIds: [requesterId, viewerId],
        },
      },
    };

    expect(pendingItineraryEditSchema.parse(input)).toEqual(input);
  });

  it("distinguishes explicit linked-expense removal from an omitted unchanged expense", () => {
    expect(pendingItineraryEditSchema.parse({
      proposalRevision: 2,
      patch: { title: "Keep the existing expense" },
    }).patch).not.toHaveProperty("linkedExpense");

    expect(pendingItineraryEditSchema.parse({
      proposalRevision: 2,
      patch: { linkedExpense: null },
    }).patch).toHaveProperty("linkedExpense", null);
  });

  it("rejects an empty edit, a non-positive concurrency token, and an untrusted map URL", () => {
    expect(pendingItineraryEditSchema.safeParse({
      proposalRevision: 1,
      patch: {},
    }).success).toBe(false);
    expect(pendingItineraryEditSchema.safeParse({
      proposalRevision: 0,
      patch: { title: "Stale overwrite" },
    }).success).toBe(false);
    expect(pendingItineraryEditSchema.safeParse({
      proposalRevision: 1,
      patch: { mapUrl: "https://attacker.example/private-location" },
    }).success).toBe(false);
  });
});
