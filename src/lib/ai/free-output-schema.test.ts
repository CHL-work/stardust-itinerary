import { describe, expect, it } from "vitest";
import { z } from "zod";
import { freePlannerOutputSchema } from "@/lib/ai/free-output-schema";
import { aiExpensePatchSchema, aiItineraryPatchSchema, plannerPatchContract } from "@/lib/ai/proposal-contract";

const day = "10000000-0000-4000-8000-000000000001";
const alex = "20000000-0000-4000-8000-000000000001";
const sam = "20000000-0000-4000-8000-000000000002";
const event = "30000000-0000-4000-8000-000000000001";
const other = "30000000-0000-4000-8000-000000000002";
const pending = "40000000-0000-4000-8000-000000000001";
const base = {
  type: "object", additionalProperties: false,
  properties: {
    message: { type: "string" }, proposals: { type: "array", maxItems: 20,
      items: { type: "object", properties: { reason: { type: "string", minLength: 1, maxLength: 1000 } } } },
    researchRequests: { type: "array", items: { type: "string" }, maxItems: 0 },
    sources: { type: "array", items: { type: "string" }, maxItems: 0 }, memoryCheckpoint: { type: "null" },
  },
  required: ["message", "proposals", "researchRequests", "sources", "memoryCheckpoint"],
};
const context = {
  days: [{ id: day, date: "2030-04-01" }],
  audienceDirectory: [{ id: alex, status: "active" }, { id: sam, status: "invited" }],
  itinerary: [{ id: event, visibility: "trip", revision: 3 }],
  pendingItinerary: [{ requestId: pending, operation: "create", targetItemId: null, proposalRevision: 2, patch: { visibility: "trip" } }],
};
type Schema = Record<string, unknown>;
const object = (value: unknown) => value as Schema;
function variants(schema = freePlannerOutputSchema(base, context)): Schema[] {
  return object(object(object(schema.properties).proposals).items).anyOf as Schema[];
}
function patch(type: string, action = "create", schema?: Schema): Schema {
  const branch = variants(schema).find((value) => {
    const p = object(value.properties);
    return (object(p.entityType).enum as string[]).includes(type) && (object(p.action).enum as string[]).includes(action);
  })!;
  return object(object(branch.properties).patch);
}
function validProposal(value: unknown, schema = freePlannerOutputSchema(base, context)): boolean {
  // Zod's JSON Schema reader exercises the exact provider contract, including nested enums.
  return z.fromJSONSchema(object(object(schema.properties).proposals)).safeParse([value]).success;
}
const envelope = (entityType: string, fields: unknown, action = "create", entityId: string | null = null) => ({
  entityType, action, entityId, baseRevision: entityId ? 2 : null,
  patch: entityType === "itinerary_item" && action === "create"
    ? { tripDayId: day, title: "Synthetic event", visibility: "trip", viewerMemberIds: [], ...object(fields) } : fields,
  reason: "User request",
});
const bill = { description: "Synthetic dinner", amountMinor: 3001, currency: "JPY", payerMemberId: alex,
  occurredAt: "2030-04-01T10:00:00Z", splitMemberIds: [alex, sam] };

describe("free model typed patch schema", () => {
  it("retains root restrictions without mutating the base, context or shared patch contracts", () => {
    const original = structuredClone({ base, context, plannerPatchContract });
    const schema = freePlannerOutputSchema(base, context);
    const properties = object(schema.properties);
    expect(properties.researchRequests).toEqual(base.properties.researchRequests);
    expect(properties.sources).toEqual(base.properties.sources);
    expect(properties.memoryCheckpoint).toEqual({ type: "null" });
    expect({ base, context, plannerPatchContract }).toEqual(original);
    expect(JSON.stringify(schema)).not.toContain('"$schema"');
    expect(JSON.stringify(schema)).not.toContain('"$ref"');
    expect(JSON.stringify(schema)).not.toContain('"default"');
  });

  it("supports an event with one linked equal-share bill without inventing exact shares", () => {
    const fields = { tripDayId: day, title: "Synthetic dinner", itemType: "meal", visibility: "trip", viewerMemberIds: [], linkedExpense: bill };
    expect(validProposal(envelope("itinerary_item", fields))).toBe(true);
    expect(aiItineraryPatchSchema.safeParse(fields).success).toBe(true);
    const linked = object(object(patch("itinerary_item").properties).linkedExpense);
    expect(linked.required).not.toContain("splitAmounts");
    expect(object(object(linked.properties).splitAmounts).description).toContain("Omit for equal sharing");
  });

  it("restricts all nested financial member IDs while allowing explicit unequal shares", () => {
    const fields = { ...bill, splitAmounts: [{ memberId: alex, amountMinor: 1000 }, { memberId: sam, amountMinor: 2001 }] };
    expect(validProposal(envelope("expense", fields))).toBe(true);
    expect(aiExpensePatchSchema.safeParse(fields).success).toBe(true);
    for (const change of [
      { payerMemberId: other }, { splitMemberIds: [alex, other] },
      { splitAmounts: [{ memberId: "Sam", amountMinor: 3001 }] },
      { splitAmounts: [{ memberId: other, amountMinor: 3001 }] },
    ]) {
      expect(validProposal(envelope("expense", { ...bill, ...change }))).toBe(false);
      expect(validProposal(envelope("itinerary_item", { linkedExpense: { ...bill, ...change } }))).toBe(false);
    }
  });

  it("uses only canonical event IDs for bill links, and preserves omitted/null links", () => {
    expect(validProposal(envelope("expense", { ...bill, itineraryItemId: event }))).toBe(true);
    expect(validProposal(envelope("expense", { ...bill, itineraryItemId: null }))).toBe(true);
    expect(validProposal(envelope("expense", { ...bill, itineraryItemId: pending }))).toBe(false);
    expect(validProposal(envelope("expense", { ...bill, itineraryItemId: other }))).toBe(false);
    const withoutEvents = freePlannerOutputSchema(base, { ...context, itinerary: [] });
    expect(validProposal(envelope("expense", { ...bill, itineraryItemId: null }), withoutEvents)).toBe(true);
    expect(validProposal(envelope("expense", { ...bill, itineraryItemId: event }), withoutEvents)).toBe(false);
  });

  it("scopes trip days, viewer IDs and create/edit identities without widening patch fields", () => {
    expect(validProposal(envelope("itinerary_item", { tripDayId: other }))).toBe(false);
    expect(validProposal(envelope("itinerary_item", { visibility: "private", viewerMemberIds: [sam] }))).toBe(true);
    expect(validProposal(envelope("itinerary_item", { viewerMemberIds: [other] }))).toBe(false);
    expect(validProposal(envelope("itinerary_item", { title: "Move dinner" }, "update", event))).toBe(true);
    expect(validProposal(envelope("itinerary_item", { title: "Move dinner" }, "update", pending))).toBe(false);
    expect(validProposal(envelope("itinerary_item", { title: "Move dinner" }, "update_pending", pending))).toBe(true);
    expect(validProposal(envelope("itinerary_item", { linkedExpense: bill }, "update_pending", pending))).toBe(false);
    expect(validProposal(envelope("itinerary_item", { linkedExpense: bill }, "update", event))).toBe(false);
    expect(validProposal(envelope("expense", bill, "update", event))).toBe(false);
    expect(validProposal(envelope("expense", { ...bill, status: "void" }))).toBe(false);
    expect(validProposal(envelope("itinerary_item", { isLocked: true }))).toBe(false);
    expect(validProposal(envelope("itinerary_item", { linkedExpense: { ...bill, bookingPin: "fake" } }))).toBe(false);
  });

  it("keeps event fields optional and nullable fields nullable; flight shape remains strict", () => {
    expect(patch("itinerary_item", "update").required ?? []).toEqual([]);
    expect(validProposal(envelope("itinerary_item", { endsAt: null }, "update_pending", pending))).toBe(true);
    expect(validProposal(envelope("itinerary_item", { startsAt: "not a date" }))).toBe(false);
    expect(validProposal(envelope("itinerary_item", { flight: { flightNumber: "JL123" } }))).toBe(true);
    expect(validProposal(envelope("itinerary_item", { flight: { flightNumber: "JL123", bookingCode: "fake" } }))).toBe(false);
  });

  it("directs free models to save supplied duration and meal type without inventing an end for untimed events", () => {
    const create = patch("itinerary_item");
    const properties = object(create.properties);
    expect(create.description).toContain("Include all supplied details");
    expect(object(properties.itemType).description).toContain("meal for breakfast, lunch, dinner");
    expect(object(properties.startsAt).description).toContain("not only in the message");
    expect(object(properties.endsAt).description).toContain("end time OR a duration");
    expect(object(properties.endsAt).description).toContain("do not invent a duration");
    const timed = { itemType: "meal", startsAt: "2030-04-01T10:00:00Z", endsAt: "2030-04-01T11:00:00Z" };
    expect(validProposal(envelope("itinerary_item", timed))).toBe(true);
    expect(aiItineraryPatchSchema.safeParse(timed).success).toBe(true);
    expect(create.required).not.toContain("endsAt");
    expect(validProposal(envelope("itinerary_item", { itemType: "activity", startsAt: timed.startsAt }))).toBe(true);
    for (const action of ["update", "update_pending"]) {
      expect(object(object(patch("itinerary_item", action).properties).endsAt).description).toContain("end time OR a duration");
    }
  });

  it("requires only the ordinary create essentials, not invented optional fields or defaults", () => {
    expect(patch("itinerary_item").required).toEqual(["tripDayId", "title", "visibility", "viewerMemberIds"]);
    for (const field of ["visibility", "viewerMemberIds"]) {
      const incomplete = envelope("itinerary_item", {});
      delete object(incomplete.patch)[field];
      expect(validProposal(incomplete)).toBe(false);
    }
    expect(patch("expense").required).toEqual(["description", "amountMinor", "currency", "payerMemberId", "occurredAt", "splitMemberIds"]);
    const missingDay = { ...envelope("itinerary_item", {}), patch: { title: "Synthetic event" } };
    expect(validProposal(missingDay)).toBe(false);
    for (const field of ["description", "amountMinor", "currency", "payerMemberId", "occurredAt", "splitMemberIds"]) {
      const incomplete: Schema = { ...bill };
      delete incomplete[field];
      expect(validProposal(envelope("expense", incomplete))).toBe(false);
    }
    expect(validProposal(envelope("expense", bill))).toBe(true);
    expect(patch("itinerary_item", "update_pending").required ?? []).toEqual([]);
  });

  it("never copies private content/IDs or disabled people into the schema", () => {
    const schema = freePlannerOutputSchema(base, {
      ...context, notes: "SECRET NOTE", aiInstructions: "SECRET INSTRUCTIONS",
      audienceDirectory: [...context.audienceDirectory, { id: other, status: "disabled", displayName: "SECRET NAME" }],
      itinerary: [...context.itinerary, { id: other, visibility: "private", notes: "SECRET EVENT" }],
      pendingItinerary: [...context.pendingItinerary, { requestId: other, operation: "update", targetItemId: other, patch: { visibility: "trip" } }],
      expenses: [{ id: other, amountMinor: 98765 }],
    });
    expect(JSON.stringify(schema)).not.toContain("SECRET");
    expect(JSON.stringify(schema)).not.toContain(other);
    expect(JSON.stringify(schema)).not.toContain("98765");
  });

  it("does not offer canonical edits when an event has a visible pending update", () => {
    const schema = freePlannerOutputSchema(base, { ...context, pendingItinerary: [{
      requestId: pending, operation: "update", targetItemId: event, patch: { visibility: "trip" },
    }] });
    expect(validProposal(envelope("itinerary_item", { title: "Changed" }, "update", event), schema)).toBe(false);
    expect(validProposal(envelope("itinerary_item", { title: "Changed" }, "update_pending", pending), schema)).toBe(true);
  });

  it("uses no invalid empty enums/unions for an absent or malformed context", () => {
    const schema = freePlannerOutputSchema(base, { days: [{ id: "not-uuid" }], audienceDirectory: [], itinerary: [] });
    const proposals = object(object(schema.properties).proposals);
    expect(proposals.maxItems).toBe(0);
    expect(JSON.stringify(schema)).not.toContain('"enum":[]');
    expect(JSON.stringify(schema)).not.toContain('"anyOf":[]');
    expect(validProposal(envelope("expense", bill), schema)).toBe(false);
  });
});
