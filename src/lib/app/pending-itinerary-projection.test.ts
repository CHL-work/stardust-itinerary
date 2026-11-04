import { describe, expect, it } from "vitest";

import { projectPendingItinerary } from "@/lib/app/repository";

const requestId = "10000000-0000-4000-8000-000000000001";
const requesterId = "20000000-0000-4000-8000-000000000001";
const tripDayId = "30000000-0000-4000-8000-000000000001";

function row(proposedPatch: Record<string, unknown>) {
  return {
    id: requestId,
    requested_by_member_id: requesterId,
    requested_by_name: "Member",
    proposed_patch: proposedPatch,
    created_at: new Date("2026-09-01T12:34:56.000Z"),
  };
}

describe("pending itinerary projection", () => {
  it("returns only display-safe fields with the same defaults used by approval", () => {
    const projection = projectPendingItinerary(row({
      tripDayId,
      title: "AI dinner proposal",
      linkedExpense: {
        description: "Private payment detail",
        amountMinor: 5000,
        currency: "JPY",
        payerMemberId: requesterId,
        occurredAt: "2026-09-02T10:00:00.000Z",
        splitMemberIds: [requesterId],
      },
      untrustedExtra: "must not escape",
    }));

    expect(projection).toEqual({
      requestId,
      status: "pending",
      operation: "create",
      targetItemId: null,
      createdByMemberId: requesterId,
      requestedByMemberId: requesterId,
      requestedByName: "Member",
      createdAt: "2026-09-01T12:34:56.000Z",
      updatedAt: "2026-09-01T12:34:56.000Z",
      proposalRevision: 1,
      tripDayId,
      title: "AI dinner proposal",
      itemType: "activity",
      startsAt: null,
      endsAt: null,
      locationName: null,
      mapUrl: null,
      departureLocationName: null,
      departureMapUrl: null,
      destinationLocationName: null,
      destinationMapUrl: null,
      notes: null,
      visibility: "trip",
      viewerMemberIds: [],
    });
    expect(JSON.stringify(projection)).not.toContain("linkedExpense");
    expect(JSON.stringify(projection)).not.toContain("untrustedExtra");
    expect(JSON.stringify(projection)).not.toContain("Private payment detail");
  });

  it("projects both endpoints of a pending transport event", () => {
    const projection = projectPendingItinerary(row({
      tripDayId,
      title: "Airport transfer",
      itemType: "transport",
      startsAt: "2026-09-02T01:00:00.000Z",
      endsAt: "2026-09-02T02:00:00.000Z",
      departureLocationName: "Haneda Airport",
      departureMapUrl: "https://www.google.com/maps/place/Haneda+Airport",
      destinationLocationName: "Tokyo Station",
      destinationMapUrl: "https://www.google.com/maps/place/Tokyo+Station",
    }));

    expect(projection).toMatchObject({
      itemType: "transport",
      departureLocationName: "Haneda Airport",
      destinationLocationName: "Tokyo Station",
    });
  });

  it("drops a pending transport create without either endpoint", () => {
    expect(projectPendingItinerary(row({
      tripDayId,
      title: "Mystery transfer",
      itemType: "transport",
    }))).toBeNull();
  });

  it("normalizes a private audience without granting access to extra members", () => {
    const viewerId = "20000000-0000-4000-8000-000000000002";
    const projection = projectPendingItinerary(row({
      tripDayId,
      title: "Private activity",
      itemType: "meal",
      startsAt: "2026-09-02T10:00:00.000Z",
      endsAt: "2026-09-02T11:30:00.000Z",
      locationName: "Venue",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=Venue",
      notes: "Visible to the selected audience",
      visibility: "private",
      viewerMemberIds: [requesterId, viewerId, viewerId],
    }));

    expect(projection).toMatchObject({
      status: "pending",
      itemType: "meal",
      visibility: "private",
      viewerMemberIds: [viewerId],
      startsAt: "2026-09-02T10:00:00.000Z",
      endsAt: "2026-09-02T11:30:00.000Z",
    });
  });

  it("identifies a pending update without exposing the canonical event body", () => {
    const targetItemId = "40000000-0000-4000-8000-000000000001";
    const projection = projectPendingItinerary({
      ...row({
        tripDayId,
        title: "Updated dinner time",
        startsAt: "2026-09-02T11:00:00.000Z",
      }),
      operation: "update",
      entity_id: targetItemId,
    });

    expect(projection).toMatchObject({
      operation: "update",
      targetItemId,
      title: "Updated dinner time",
    });
  });

  it("merges a partial update over its immutable base revision snapshot", () => {
    const targetItemId = "40000000-0000-4000-8000-000000000002";
    const projection = projectPendingItinerary({
      ...row({ title: "Retimed dinner" }),
      operation: "update",
      entity_id: targetItemId,
      base_patch: {
        tripDayId,
        title: "Original dinner",
        itemType: "meal",
        startsAt: "2026-09-02T10:00:00.000Z",
        endsAt: "2026-09-02T11:00:00.000Z",
        locationName: "Tokyo Station",
        visibility: "trip",
        viewerMemberIds: [],
        status: "planned",
        isLocked: false,
      },
    });

    expect(projection).toMatchObject({
      operation: "update",
      targetItemId,
      title: "Retimed dinner",
      tripDayId,
      itemType: "meal",
      locationName: "Tokyo Station",
    });
  });

  it("preserves a private creator and selected requester when an editor proposes an update", () => {
    const creatorId = "20000000-0000-4000-8000-000000000009";
    const projection = projectPendingItinerary({
      ...row({ title: "Selected editor update" }),
      operation: "update",
      entity_id: "40000000-0000-4000-8000-000000000003",
      base_patch: {
        tripDayId,
        title: "Private dinner",
        itemType: "meal",
        visibility: "private",
        createdByMemberId: creatorId,
        viewerMemberIds: [requesterId],
      },
    });

    expect(projection).toMatchObject({
      createdByMemberId: creatorId,
      requestedByMemberId: requesterId,
      visibility: "private",
      viewerMemberIds: [requesterId],
    });
  });

  it.each(["cancel", "restore"] as const)(
    "projects a pending %s request from its immutable event snapshot",
    (operation) => {
      const creatorId = "20000000-0000-4000-8000-000000000009";
      const targetItemId = "40000000-0000-4000-8000-000000000004";
      const projection = projectPendingItinerary({
        ...row({}),
        operation,
        entity_id: targetItemId,
        base_patch: {
          tripDayId,
          title: "Private booking",
          itemType: "activity",
          startsAt: "2026-09-02T12:00:00.000Z",
          endsAt: "2026-09-02T13:00:00.000Z",
          visibility: "private",
          createdByMemberId: creatorId,
          viewerMemberIds: [requesterId],
          status: operation === "cancel" ? "planned" : "cancelled",
          isLocked: false,
        },
      });

      expect(projection).toMatchObject({
        operation,
        targetItemId,
        createdByMemberId: creatorId,
        requestedByMemberId: requesterId,
        title: "Private booking",
        visibility: "private",
        viewerMemberIds: [requesterId],
      });
    },
  );

  it("drops malformed legacy create patches instead of exposing raw data", () => {
    expect(projectPendingItinerary(row({ title: "Missing day" }))).toBeNull();
    expect(projectPendingItinerary(row({ tripDayId, title: "", secret: "hidden" }))).toBeNull();
    expect(projectPendingItinerary(row({
      tripDayId,
      title: "Invalid URL",
      mapUrl: "not a URL",
    }))).toBeNull();
  });
});
