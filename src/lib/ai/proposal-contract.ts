import { z } from "zod";

import { expensePatchSchema, itineraryPatchSchema, linkedExpenseSchema } from "@/lib/app/validation";

// The provider-facing contract and final parser share a single schema. Maps are
// sanitized separately before repository validation; locking is never an AI field.
export const aiItineraryPatchSchema = itineraryPatchSchema
  .omit({ isLocked: true, mapUrl: true, departureMapUrl: true, destinationMapUrl: true })
  .extend({
    linkedExpense: linkedExpenseSchema.strict().optional(),
    mapUrl: z.url().max(2000).nullable().optional(),
    departureMapUrl: z.url().max(2000).nullable().optional(),
    destinationMapUrl: z.url().max(2000).nullable().optional(),
  })
  .strict();

export const aiExpensePatchSchema = expensePatchSchema.strict();

// Editing a pending event preserves its existing linked expense. Financial
// corrections remain in the manual editor; even explicit null is not an AI edit.
export const aiPendingItineraryPatchSchema = aiItineraryPatchSchema
  .omit({ linkedExpense: true })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Submit at least one pending event change." });

export const plannerPatchContract = {
  version: 2,
  itinerary_item: z.toJSONSchema(aiItineraryPatchSchema),
  pending_itinerary_item: z.toJSONSchema(aiPendingItineraryPatchSchema),
  expense: z.toJSONSchema(aiExpensePatchSchema),
};
