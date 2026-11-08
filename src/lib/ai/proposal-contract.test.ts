import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  aiExpensePatchSchema,
  aiItineraryPatchSchema,
  aiPendingItineraryPatchSchema,
  plannerPatchContract,
} from "@/lib/ai/proposal-contract";

const DAY_ID = "11111111-1111-4111-8111-111111111111";
const PAYER_ID = "22222222-2222-4222-8222-222222222222";
const VIEWER_ID = "33333333-3333-4333-8333-333333333333";

const linkedExpense = {
  description: "Hotel stay",
  amountMinor: 50_000,
  currency: "JPY",
  payerMemberId: PAYER_ID,
  occurredAt: "2026-09-06T06:00:00Z",
  status: "posted" as const,
  splitMemberIds: [PAYER_ID, VIEWER_ID],
};

describe("AI proposal patch contract", () => {
  it("allows location-local zones in new and pending events without weakening nested validation", () => {
    const patch = { timeZones: { start: "America/Denver", end: null } };
    expect(aiItineraryPatchSchema.parse(patch)).toEqual(patch);
    expect(aiPendingItineraryPatchSchema.parse(patch)).toEqual(patch);
    expect(plannerPatchContract.itinerary_item.properties).toHaveProperty("timeZones");
    for (const timeZones of [{ start: "MST" }, { end: "not/a-zone" }, { start: "America/Denver", extra: "secret" }]) {
      expect(aiItineraryPatchSchema.safeParse({ timeZones }).success).toBe(false);
      expect(aiPendingItineraryPatchSchema.safeParse({ timeZones }).success).toBe(false);
    }
  });
  it("parses one strict itinerary patch with a linked expense", () => {
    const patch = {
      tripDayId: DAY_ID,
      title: "Hotel stay",
      itemType: "lodging" as const,
      startsAt: "2026-09-06T06:00:00Z",
      endsAt: "2026-09-09T16:00:00Z",
      locationName: "Hotel",
      visibility: "private" as const,
      viewerMemberIds: [VIEWER_ID],
      status: "planned" as const,
      linkedExpense,
    };

    expect(aiItineraryPatchSchema.parse(patch)).toEqual(patch);
  });

  it.each([
    ["locking control", { isLocked: true }],
    ["estimated cost", { estimatedCostMinor: 50_000 }],
    ["arbitrary top-level field", { bookingPin: "1234" }],
  ])("rejects an untrusted itinerary %s", (_label, untrustedField) => {
    expect(aiItineraryPatchSchema.safeParse({ title: "Hotel stay", ...untrustedField }).success).toBe(false);
  });

  it("rejects untrusted fields nested inside linkedExpense", () => {
    expect(aiItineraryPatchSchema.safeParse({
      title: "Hotel stay",
      linkedExpense: { ...linkedExpense, managementUrl: "https://example.test/manage" },
    }).success).toBe(false);
  });

  it("keeps the standalone expense contract strict and separate from audience fields", () => {
    const expense = {
      description: "Dinner",
      amountMinor: 8_000,
      currency: "JPY",
      payerMemberId: PAYER_ID,
      occurredAt: "2026-09-07T11:00:00Z",
      status: "posted" as const,
      splitMemberIds: [PAYER_ID, VIEWER_ID],
    };

    expect(aiExpensePatchSchema.parse(expense)).toEqual(expense);
    expect(aiExpensePatchSchema.safeParse({ ...expense, visibility: "private" }).success).toBe(false);
    expect(aiExpensePatchSchema.safeParse({ ...expense, linkedExpense }).success).toBe(false);
  });
  it("preserves optional exact minor-unit shares in standalone and linked contracts", () => {
    const custom = { ...linkedExpense, splitAmounts: [{ memberId: PAYER_ID, amountMinor: 0 }, { memberId: VIEWER_ID, amountMinor: 50_000 }] };
    expect(aiExpensePatchSchema.parse(custom)).toEqual(custom);
    expect(aiItineraryPatchSchema.parse({ linkedExpense: custom })).toEqual({ linkedExpense: custom });
    expect(plannerPatchContract.expense.properties).toHaveProperty("splitAmounts");
    expect(JSON.stringify(plannerPatchContract.itinerary_item.properties?.linkedExpense)).toContain('"splitAmounts"');
    expect(aiExpensePatchSchema.safeParse({ ...custom, splitMode: "custom" }).success).toBe(false);
  });

  it("accepts a partial pending edit without reconstructing expense, audience or timing fields", () => {
    expect(aiPendingItineraryPatchSchema.parse({ title: "Updated synthetic dinner" })).toEqual({ title: "Updated synthetic dinner" });
    expect(aiPendingItineraryPatchSchema.parse({ startsAt: "2030-04-02T10:00:00Z" })).toEqual({ startsAt: "2030-04-02T10:00:00Z" });
    expect(aiPendingItineraryPatchSchema.parse({ destinationLocationName: "Synthetic station" })).toEqual({ destinationLocationName: "Synthetic station" });
    expect(aiPendingItineraryPatchSchema.parse({ notes: null })).toEqual({ notes: null });
  });

  it.each([
    ["existing linked expense replacement", { linkedExpense }],
    ["linked expense removal", { linkedExpense: null }],
    ["lock change", { isLocked: false }],
    ["expense amount", { amountMinor: 5000 }],
    ["payer", { payerMemberId: PAYER_ID }],
    ["splits", { splitMemberIds: [VIEWER_ID] }],
    ["exact expense shares", { splitAmounts: [{ memberId: VIEWER_ID, amountMinor: 5000 }] }],
    ["wrong patch-level proposal identity", { requestId: DAY_ID, proposalRevision: 4 }],
    ["unknown field", { anyOtherField: true }],
  ])("rejects a pending event %s instead of silently stripping it", (_label, forbidden) => {
    expect(aiPendingItineraryPatchSchema.safeParse({ title: "Synthetic edit", ...forbidden }).success).toBe(false);
  });

  it("rejects an empty pending edit and malformed date without adding defaults", () => {
    expect(aiPendingItineraryPatchSchema.safeParse({}).success).toBe(false);
    expect(aiPendingItineraryPatchSchema.safeParse({ startsAt: "19:00" }).success).toBe(false);
  });

  it("generates the provider-visible JSON contract from the final parsers", () => {
    expect(plannerPatchContract).toEqual({
      version: 2,
      itinerary_item: z.toJSONSchema(aiItineraryPatchSchema),
      pending_itinerary_item: z.toJSONSchema(aiPendingItineraryPatchSchema),
      expense: z.toJSONSchema(aiExpensePatchSchema),
    });
    expect(plannerPatchContract.itinerary_item).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        linkedExpense: expect.any(Object),
      },
    });
    expect(plannerPatchContract.expense).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(plannerPatchContract.pending_itinerary_item).toMatchObject({
      type: "object", additionalProperties: false,
    });
    const pendingProperties = plannerPatchContract.pending_itinerary_item.properties;
    expect(pendingProperties).toHaveProperty("startsAt");
    expect(pendingProperties).not.toHaveProperty("linkedExpense");
    expect(pendingProperties).not.toHaveProperty("isLocked");
  });
});
