import { describe, expect, it } from "vitest";
import { approvalPresentationMemberIds, projectApprovalDisplay, type ApprovalPresentationSource } from "@/lib/app/approval-presentation";

const one = "10000000-0000-4000-8000-000000000001";
const two = "10000000-0000-4000-8000-000000000002";
const day = "20000000-0000-4000-8000-000000000001";
const members = new Map([[one, "Synthetic requester"], [two, "Former traveler"]]);
const baseEvent = { tripDayId: day, title: "Saved dinner", itemType: "meal", startsAt: "2030-04-01T10:00:00Z", endsAt: "2030-04-01T11:00:00Z", locationName: "Saved restaurant", notes: "Saved notes", visibility: "private", viewerMemberIds: [two], createdByMemberId: one };
const expense = { description: "Dinner bill", amountMinor: 101, currency: "JPY", payerMemberId: one, splitMemberIds: [one, two], occurredAt: "2030-04-01T11:00:00Z" };
const source: ApprovalPresentationSource = { entity_type: "itinerary_item", operation: "create", requested_by_member_id: one, proposed_patch: baseEvent, day_date: "2030-04-01" };

describe("immutable approval presentation", () => {
  it("projects an event's date, venue, private audience and linked expense as safe named fields", () => {
    const display = projectApprovalDisplay({ ...source, proposed_patch: { ...baseEvent, linkedExpense: expense } }, members);
    expect(display).toMatchObject({ kind: "itinerary", event: { title: "Saved dinner", dayDate: "2030-04-01", visibility: "private", audienceNames: ["Synthetic requester", "Former traveler"], linkedExpense: { amountMinor: 101, payerName: "Synthetic requester", splits: [{ memberName: "Synthetic requester", shareMinor: 51 }, { memberName: "Former traveler", shareMinor: 50 }] } } });
    expect(JSON.stringify(display)).not.toContain(one);
    expect(JSON.stringify(display)).not.toContain(day);
  });
  it("renders exact historical base plus patch, never later canonical private changes", () => {
    const row = { ...source, operation: "update", base_patch: baseEvent, proposed_patch: { startsAt: "2030-04-01T12:00:00Z" }, current_patch: { title: "Later private booking", notes: "Later confidential details", visibility: "trip" } };
    const display = projectApprovalDisplay(row, members);
    expect(display).toMatchObject({ kind: "itinerary", event: { title: "Saved dinner", startsAt: "2030-04-01T12:00:00Z", notes: "Saved notes", visibility: "private" } });
    expect(JSON.stringify(display)).not.toContain("Later");
  });
  it.each(["update", "cancel", "restore", "void"])("does not invent a historical %s snapshot when the base is missing", (operation) => {
    expect(projectApprovalDisplay({ ...source, operation, base_patch: null }, members)).toEqual({ kind: "unavailable" });
  });
  it.each([["cancel", "cancelled"], ["restore", "planned"]])("shows %s without changing the immutable snapshot", (operation, status) => {
    expect(projectApprovalDisplay({ ...source, operation, base_patch: baseEvent, proposed_patch: {} }, members)).toMatchObject({ kind: "itinerary", event: { status } });
    expect(baseEvent).not.toHaveProperty("status");
  });
  it("never infers members or displays raw IDs when a historical name is unavailable", () => {
    expect(projectApprovalDisplay(source, new Map())).toMatchObject({ kind: "itinerary", event: { audienceNames: [null, null] } });
  });
  it("does not keep an old venue map when a partial update moves the event", () => {
    expect(projectApprovalDisplay({ ...source, operation: "update", base_patch: { ...baseEvent, mapUrl: "https://www.google.com/maps/search/?api=1&query=old" }, proposed_patch: { locationName: "New restaurant" } }, members))
      .toMatchObject({ kind: "itinerary", event: { locationName: "New restaurant", mapUrl: null } });
  });
  it("strips credential-bearing maps and internal audience metadata from the display", () => {
    const display = projectApprovalDisplay({ ...source, proposed_patch: { ...baseEvent, mapUrl: "https://private:secret@www.google.com/maps", itineraryAudienceSnapshot: { secret: "internal" } } }, members);
    expect(display).toMatchObject({ kind: "itinerary", event: { mapUrl: null } });
    expect(JSON.stringify(display)).not.toContain("secret");
    expect(JSON.stringify(display)).not.toContain("itineraryAudienceSnapshot");
  });
  it("shows each transport endpoint with its own timestamp and no borrowed venue", () => {
    const display = projectApprovalDisplay({ ...source, proposed_patch: { ...baseEvent, itemType: "transport", departureLocationName: "Station A", destinationLocationName: "Station B" } }, members);
    expect(display).toMatchObject({ kind: "itinerary", event: { departureLocationName: "Station A", destinationLocationName: "Station B", locationName: null, startsAt: baseEvent.startsAt, endsAt: baseEvent.endsAt } });
  });
  it("projects only safe flight display facts, not raw flight metadata or a vague title", () => {
    const patch = { ...baseEvent, title: "Synthetic flight", itemType: "transport", departureLocationName: "Airport Alpha", destinationLocationName: "Airport Beta" };
    expect(projectApprovalDisplay({ ...source, proposed_patch: patch }, members)).toMatchObject({ kind: "itinerary", event: { isFlight: false } });
    const flight = { flightNumber: "JL123", airline: "Synthetic airline" };
    const display = projectApprovalDisplay({ ...source, proposed_patch: { ...patch, flight } }, members);
    expect(display).toMatchObject({ kind: "itinerary", event: { isFlight: true } });
    expect(JSON.stringify(display)).not.toContain("JL123");
    expect(JSON.stringify(display)).not.toContain("Synthetic airline");
    expect(projectApprovalDisplay({ ...source, operation: "update", base_patch: { ...patch, flight }, proposed_patch: { flight: null } }, members))
      .toMatchObject({ kind: "itinerary", event: { isFlight: false } });
  });
  it("projects endpoint zones and the narrow legacy flight display without booking facts", () => {
    const patch = { ...baseEvent, title: "Example Airlines AA123 DFW → SLC", itemType: "transport", departureLocationName: "DFW", destinationLocationName: "SLC" };
    const display = projectApprovalDisplay({ ...source, proposed_patch: patch }, members);
    expect(display).toMatchObject({ kind: "itinerary", event: { isFlight: true,
      flightPresentation: { isFlight: true, departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" } } });
    expect(display).not.toHaveProperty("event.flight");
    const explicit = projectApprovalDisplay({ ...source, proposed_patch: { ...patch,
      flight: { flightNumber: "AA123", departureTimeZone: "UTC", arrivalTimeZone: "America/Denver" } } }, members);
    expect(explicit).toMatchObject({ kind: "itinerary", event: { flightPresentation: { departureTimeZone: "UTC" } } });
  });
  it("supports removed linked expense metadata without resurrecting an old expense", () => {
    expect(projectApprovalDisplay({ ...source, proposed_patch: { ...baseEvent, linkedExpense: null } }, members)).toMatchObject({ kind: "itinerary", event: { linkedExpense: null } });
  });
  it.each([
    { title: "Only an incomplete title" },
    { ...baseEvent, startsAt: "invalid" },
    { ...baseEvent, mapUrl: "javascript:alert(1)" },
    { ...baseEvent, linkedExpense: { ...expense, amountMinor: -5 } },
  ])("fails closed on incomplete or unsafe historical data", (patch) => {
    expect(projectApprovalDisplay({ ...source, proposed_patch: patch }, members)).toEqual({ kind: "unavailable" });
  });
});

describe("historical expense arithmetic", () => {
  const base = { ...expense, splitMemberIds: undefined, splits: [{ memberId: two, shareMinor: 70 }, { memberId: one, shareMinor: 31 }] };
  const row = { entity_type: "expense", operation: "create", proposed_patch: expense };
  it("calculates whole-yen remainder exactly once", () => {
    expect(projectApprovalDisplay(row, members)).toMatchObject({ kind: "expense", expense: { amountMinor: 101, splits: [{ memberName: "Synthetic requester", shareMinor: 51 }, { memberName: "Former traveler", shareMinor: 50 }] } });
  });
  it("preserves stored shares when a nonfinancial update does not change allocations", () => {
    expect(projectApprovalDisplay({ ...row, operation: "update", base_patch: base, proposed_patch: { description: "Corrected description" } }, members)).toMatchObject({ kind: "expense", expense: { description: "Corrected description", splits: [{ memberName: "Former traveler", shareMinor: 70 }, { memberName: "Synthetic requester", shareMinor: 31 }] } });
  });
  it("matches canonical sorted participant order when only an equal-split amount changes", () => {
    const equalBase = { ...base, splits: [{ memberId: two, shareMinor: 51 }, { memberId: one, shareMinor: 50 }] };
    expect(projectApprovalDisplay({ ...row, operation: "update", base_patch: equalBase, proposed_patch: { amountMinor: 103 } }, members)).toMatchObject({ kind: "expense", expense: { splits: [{ memberName: "Synthetic requester", shareMinor: 52 }, { memberName: "Former traveler", shareMinor: 51 }] } });
  });
  it("does not present an unreconciled unequal amount-only change as equal shares", () => {
    expect(projectApprovalDisplay({ ...row, operation: "update", base_patch: base, proposed_patch: { amountMinor: 103 } }, members)).toEqual({ kind: "unavailable" });
  });
  it("uses the exact recorded approved revision instead of applying new rules to old requests", () => {
    const applied = { ...base, amountMinor: 103, splits: [{ memberId: one, shareMinor: 52 }, { memberId: two, shareMinor: 51 }] };
    const historical = { ...row, status: "approved", operation: "update", base_patch: base,
      proposed_patch: { amountMinor: 103 }, applied_patch: applied };
    expect(projectApprovalDisplay(historical, members)).toMatchObject({ kind: "expense", expense: { amountMinor: 103,
      splits: [{ memberName: "Synthetic requester", shareMinor: 52 }, { memberName: "Former traveler", shareMinor: 51 }] } });
    expect(projectApprovalDisplay({ ...historical, applied_patch: { ...applied, splits: base.splits } }, members)).toEqual({ kind: "unavailable" });
    for (const status of ["pending", "rejected"]) {
      expect(projectApprovalDisplay({ ...historical, status }, members)).toEqual({ kind: "unavailable" });
    }
  });
  it("retains the originally applied custom amounts even after unrelated canonical changes", () => {
    const applied = { ...base, splits: [{ memberId: one, shareMinor: 0 }, { memberId: two, shareMinor: 101 }] };
    const historical = { ...row, status: "approved", applied_patch: applied, current_patch: { ...applied, amountMinor: 999 } };
    expect(projectApprovalDisplay(historical, members)).toMatchObject({ kind: "expense", expense: { amountMinor: 101,
      splits: [{ memberName: "Synthetic requester", shareMinor: 0 }, { memberName: "Former traveler", shareMinor: 101 }] } });
    expect(approvalPresentationMemberIds([{ ...historical, proposed_patch: {} }]).sort()).toEqual([one, two]);
  });
  it("projects exact custom allocations for create, sparse update and event-linked review", () => {
    const splitAmounts = [{ memberId: one, amountMinor: 0 }, { memberId: two, amountMinor: 101 }];
    const expected = [{ memberName: "Synthetic requester", shareMinor: 0 }, { memberName: "Former traveler", shareMinor: 101 }];
    expect(projectApprovalDisplay({ ...row, proposed_patch: { ...expense, splitAmounts } }, members)).toMatchObject({ kind: "expense", expense: { splits: expected } });
    expect(projectApprovalDisplay({ ...row, operation: "update", base_patch: base, proposed_patch: { splitAmounts } }, members)).toMatchObject({ kind: "expense", expense: { splits: expected } });
    expect(projectApprovalDisplay({ ...source, proposed_patch: { ...baseEvent, linkedExpense: { ...expense, splitAmounts } } }, members)).toMatchObject({ kind: "itinerary", event: { linkedExpense: { splits: expected } } });
  });
  it("fails closed on an invalid custom map instead of rendering equal financial claims", () => {
    expect(projectApprovalDisplay({ ...row, proposed_patch: { ...expense, splitAmounts: [{ memberId: one, amountMinor: 1 }] } }, members)).toEqual({ kind: "unavailable" });
  });
  it("uses explicit new participant order when splits change", () => {
    expect(projectApprovalDisplay({ ...row, operation: "update", base_patch: base, proposed_patch: { splitMemberIds: [two, one] } }, members)).toMatchObject({ kind: "expense", expense: { splits: [{ memberName: "Former traveler", shareMinor: 51 }, { memberName: "Synthetic requester", shareMinor: 50 }] } });
  });
  it("retains voided expense amounts as history without claiming a new payment", () => {
    expect(projectApprovalDisplay({ ...row, operation: "void", base_patch: base, proposed_patch: {} }, members)).toMatchObject({ kind: "expense", expense: { status: "void", amountMinor: 101 } });
  });
  it("refuses snapshots with invalid or duplicated stored splits", () => {
    for (const splits of [[{ memberId: one, shareMinor: 1 }], [{ memberId: one, shareMinor: 50 }, { memberId: one, shareMinor: 51 }]]) {
      expect(projectApprovalDisplay({ ...row, operation: "update", base_patch: { ...base, splits }, proposed_patch: {} }, members)).toEqual({ kind: "unavailable" });
    }
  });
  it("does not fetch or expose a linked private event's current title", () => {
    const display = projectApprovalDisplay({ ...row, proposed_patch: { ...expense, itineraryItemId: day } }, members);
    expect(display).toMatchObject({ kind: "expense", expense: { hasLinkedEvent: true } });
    expect(JSON.stringify(display)).not.toContain(day);
    expect(display).not.toHaveProperty("expense.itineraryItemTitle");
  });
  it("collects only bounded valid referenced identities for one scoped historical lookup", () => {
    expect(approvalPresentationMemberIds([{ ...source, proposed_patch: { ...baseEvent, linkedExpense: { ...expense, payerMemberId: "not-a-uuid" } } }]).sort()).toEqual([one, two]);
  });
});
