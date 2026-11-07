import { z } from "zod";
import { plannerPatchContract } from "@/lib/ai/proposal-contract";

type Schema = Record<string, unknown>;

function object(value: unknown): Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Schema : {};
}
function rows(value: unknown): Schema[] { return Array.isArray(value) ? value.map(object) : []; }
const uuid = z.uuid();
function ids(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => uuid.safeParse(value).success))];
}

/** Keep the parser-derived schema; only intersect reference fields with known IDs. */
function narrowPatch(value: unknown, members: string[], days: string[], events: string[]): Schema {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== "object") return value;
    const schema = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$schema")
      .map(([key, child]) => [key, visit(child)]));
    const properties = object(schema.properties);
    for (const key of ["payerMemberId", "memberId", "tripDayId"] as const) {
      if (!Object.hasOwn(properties, key)) continue;
      const available = key === "tripDayId" ? days : members;
      if (available.length) properties[key] = { ...object(properties[key]), enum: available };
      else delete properties[key];
    }
    for (const key of ["splitMemberIds", "viewerMemberIds"] as const) {
      if (!Object.hasOwn(properties, key)) continue;
      const list = object(properties[key]);
      list.items = members.length ? { ...object(list.items), enum: members } : { type: "string" };
      if (!members.length) list.maxItems = 0;
    }
    if (Object.hasOwn(properties, "itineraryItemId")) {
      // This field is optional/nullable. A pending request is never a canonical event ID.
      properties.itineraryItemId = events.length
        ? { ...object(properties.itineraryItemId), enum: [...events, null] } : { type: "null" };
    }
    if (Object.hasOwn(properties, "splitAmounts")) {
      properties.splitAmounts = { ...object(properties.splitAmounts),
        description: "Omit for equal sharing; application code calculates equal shares. Include only exact unequal minor-unit amounts supplied by the user, using the listed member IDs." };
    }
    return schema;
  };
  return object(visit(value));
}

/**
 * A generation aid, never authorization. Call with safeFreePlanningContext only;
 * the full ordinary parser, audience, money and concurrency checks still run.
 * No personal text is copied into schema descriptions or examples.
 */
export function freePlannerOutputSchema(baseSchema: unknown, context: unknown): Schema {
  const base = structuredClone(object(baseSchema));
  const properties = object(base.properties);
  const proposals = object(properties.proposals);
  const envelope = object(proposals.items);
  const envelopeProperties = object(envelope.properties);
  const source = object(context);
  const members = ids(rows(source.audienceDirectory).filter((member) =>
    member.status === undefined || member.status === "active" || member.status === "invited").map((member) => member.id));
  const days = ids(rows(source.days).map((day) => day.id));
  const events = ids(rows(source.itinerary).filter((event) => event.visibility === "trip").map((event) => event.id));
  const visibleEvents = new Set(events);
  const pending = rows(source.pendingItinerary).filter((item) => object(item.patch).visibility === "trip"
    && (item.operation === "create" && item.targetItemId == null
      || item.operation === "update" && typeof item.targetItemId === "string" && visibleEvents.has(item.targetItemId)));
  const pendingIds = ids(pending.map((item) => item.requestId));
  const pendingTargets = new Set(pending.map((item) => item.targetItemId));
  const editableEvents = events.filter((id) => !pendingTargets.has(id));

  const eventPatch = narrowPatch(plannerPatchContract.itinerary_item, members, days, events);
  if (!members.length) delete object(eventPatch.properties).linkedExpense;
  const pendingPatch = narrowPatch(plannerPatchContract.pending_itinerary_item, members, days, events);
  const expensePatch = narrowPatch(plannerPatchContract.expense, members, days, events);
  object(expensePatch.properties).status = { type: "string", enum: ["draft", "posted"] };
  const variants: Schema[] = [];
  const variant = (entityType: string, actions: string[], targets: string[] | null, patch: Schema) => ({
    type: "object", additionalProperties: false,
    properties: {
      entityType: { type: "string", enum: [entityType] },
      action: { type: "string", enum: actions },
      entityId: targets ? { type: "string", enum: targets } : { type: "null" },
      baseRevision: targets ? { type: "integer", minimum: 1, maximum: 2_147_483_647 } : { type: "null" },
      patch,
      reason: structuredClone(envelopeProperties.reason ?? { type: "string", minLength: 1, maxLength: 1000 }),
    },
    required: ["entityType", "action", "entityId", "baseRevision", "patch", "reason"],
  });
  if (days.length) {
    const createPatch = structuredClone(eventPatch);
    createPatch.required = ["tripDayId", "title", "visibility", "viewerMemberIds"];
    variants.push(variant("itinerary_item", ["create"], null, createPatch));
  }
  if (editableEvents.length) {
    const editPatch = structuredClone(eventPatch);
    delete object(editPatch.properties).linkedExpense;
    variants.push(variant("itinerary_item", ["update", "cancel", "restore"], editableEvents, editPatch));
  }
  if (pendingIds.length) variants.push(variant("itinerary_item", ["update_pending"], pendingIds, pendingPatch));
  if (members.length) {
    expensePatch.required = ["description", "amountMinor", "currency", "payerMemberId", "occurredAt", "splitMemberIds"];
    variants.push(variant("expense", ["create"], null, expensePatch));
  }
  // Empty enums and anyOf are invalid JSON Schema. An empty context can still answer/clarify.
  proposals.items = variants.length ? { anyOf: variants } : { type: "object", additionalProperties: false, properties: {} };
  if (!variants.length) proposals.maxItems = 0;
  return base;
}
