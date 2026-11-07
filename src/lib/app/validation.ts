import { z } from "zod";

import { flightDetailsSchema } from "@/lib/app/flight";
import { isTrustedGoogleMapsUrl, transportMapUrlMessage } from "@/lib/app/transport";
import { isSupportedLedgerCurrency } from "@/lib/app/supported-currencies";
import { tripDateErrors, validTripDate } from "@/lib/app/trip-date-range";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

import { ownerModels, selectableOwnerModels } from "@/lib/app/types";
import { locales } from "@/lib/i18n";

export const expenseSplitAmountsSchema = z.array(z.object({
  memberId: z.uuid(),
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()).min(1).max(20).refine((shares) => new Set(shares.map((share) => share.memberId)).size === shares.length,
  { message: "Custom shares must include each participant exactly once." });

export const linkedExpenseSchema = z.object({
  description: z.string().trim().min(1).max(240),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  payerMemberId: z.uuid(),
  occurredAt: z.iso.datetime(),
  status: z.enum(["draft", "posted"]).optional(),
  splitMemberIds: z.array(z.uuid()).min(1).max(20),
  splitAmounts: expenseSplitAmountsSchema.optional(),
});

export const itineraryPatchSchema = z.object({
  tripDayId: z.uuid().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  itemType: z.enum(["activity", "meal", "transport", "lodging", "note"]).optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  locationName: z.string().trim().max(300).nullable().optional(),
  mapUrl: z.url().max(2000).refine(isTrustedGoogleMapsUrl, transportMapUrlMessage).nullable().optional(),
  departureLocationName: z.string().trim().min(1).max(300).nullable().optional(),
  departureMapUrl: z.url().max(2000).refine(isTrustedGoogleMapsUrl, transportMapUrlMessage).nullable().optional(),
  destinationLocationName: z.string().trim().min(1).max(300).nullable().optional(),
  destinationMapUrl: z.url().max(2000).refine(isTrustedGoogleMapsUrl, transportMapUrlMessage).nullable().optional(),
  // Transport events only (JOB-082); the whole object is replaced, and null removes it.
  flight: flightDetailsSchema.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  visibility: z.enum(["trip", "private"]).optional(),
  viewerMemberIds: z.array(z.uuid()).max(19).optional(),
  status: z.enum(["draft", "planned", "cancelled", "completed"]).optional(),
  isLocked: z.boolean().optional(),
  linkedExpense: linkedExpenseSchema.optional(),
});

export const pendingItineraryEditSchema = z.object({
  proposalRevision: z.number().int().positive(),
  patch: itineraryPatchSchema
    .omit({ linkedExpense: true })
    .extend({ linkedExpense: linkedExpenseSchema.nullable().optional() })
    .refine((patch) => Object.keys(patch).length > 0, {
      message: "Submit at least one event change.",
    }),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export const expensePatchSchema = z.object({
  description: z.string().trim().min(1).max(240).optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  payerMemberId: z.uuid().optional(),
  itineraryItemId: z.uuid().nullable().optional(),
  occurredAt: z.iso.datetime().optional(),
  status: z.enum(["draft", "posted", "void"]).optional(),
  splitMemberIds: z.array(z.uuid()).min(1).max(20).optional(),
  splitAmounts: expenseSplitAmountsSchema.optional(),
});

export const changeRequestSchema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("itinerary_item"),
    entityId: z.uuid().nullable().optional(),
    operation: z.enum(["create", "update", "cancel", "restore"]),
    baseRevision: z.number().int().positive().nullable().optional(),
    patch: itineraryPatchSchema,
    reason: z.string().trim().min(1).max(1000),
    source: z.enum(["member", "owner", "ai", "import"]).optional(),
    applyNow: z.boolean().optional(),
  }),
  z.object({
    entityType: z.literal("expense"),
    entityId: z.uuid().nullable().optional(),
    operation: z.enum(["create", "update", "void"]),
    baseRevision: z.number().int().positive().nullable().optional(),
    patch: expensePatchSchema,
    reason: z.string().trim().min(1).max(1000),
    source: z.enum(["member", "owner", "ai", "import"]).optional(),
    applyNow: z.boolean().optional(),
  }),
]);

export const reviewRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  proposalRevision: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
});

export const aiRequestSchema = z.object({
  images: z.array(z.strictObject({
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z.string().min(1).max(2_796_204),
  })).max(3).optional(),
  prompt: z.string().trim().min(1).max(8000),
  model: z.enum(ownerModels).optional(),
  freeModel: z.string().max(160).regex(/^[a-z0-9][a-z0-9._-]{0,60}\/[a-z0-9][a-z0-9._:-]{0,100}$/u).optional(),
  locale: z.enum(locales).optional(),
  clientRequestId: z.uuid().optional(),
  conversationId: z.uuid().nullable().optional(),
}).refine((value) => !value.freeModel || value.model === "guest-free", {
  path: ["freeModel"], message: "An individual free model requires the Free AI choice.",
});

export const aiRecoveryQuerySchema = z.object({ clientRequestId: z.uuid().optional() });

export const aiConversationActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("new"), purpose: z.literal("trip").optional() }),
  z.strictObject({ action: z.literal("resume"), conversationId: z.uuid() }),
]);

export const aiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  ownerDefaultModel: z.enum(selectableOwnerModels).optional(),
  memberDailyLimit: z.number().int().min(1).max(1000).optional(),
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "Submit at least one AI setting.",
});

export const createMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  /** Let the new member use the adding owner's own AI keys in this trip (JOB-063). */
  shareAiKeys: z.boolean().optional(),
});

export const aiKeyGrantSchema = z.strictObject({ shared: z.boolean() });

export const joinLinkSchema = z.strictObject({
  /** People joining through the link may use the creating owner's own AI keys (JOB-063). */
  shareAiKeys: z.boolean().optional(),
});

export const updateMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  disabled: z.boolean().optional(),
  role: z.enum(["owner", "editor", "viewer"]).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).refine((input) => input.displayName !== undefined || input.disabled !== undefined || input.role !== undefined, {
  message: "Submit a name, role or access change.",
}).refine((input) => input.role === undefined || input.expectedRevision !== undefined, {
  message: "Refresh the member list before changing a role.",
});

export const memberPermissionsSchema = z.object({
  canEditItinerary: z.boolean(),
  itineraryRequiresApproval: z.boolean(),
  canEditExpenses: z.boolean(),
  expenseRequiresApproval: z.boolean(),
  canSyncCalendar: z.boolean(),
});

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const tripSettingsSchema = z.object({
  destinationName: z.string().trim().min(1).max(160),
  timeZone: z.string().trim().min(1).max(80).refine(isIanaTimeZone, "Enter a valid IANA time zone."),
  maxMembers: z.number().int().min(1).max(20),
  startsOn: z.iso.date().refine(validTripDate),
  endsOn: z.iso.date().refine(validTripDate),
  expectedStartsOn: z.iso.date().refine(validTripDate),
  expectedEndsOn: z.iso.date().refine(validTripDate),
}).partial().refine(
  (input) => input.destinationName !== undefined
    || input.timeZone !== undefined
    || input.maxMembers !== undefined
    || input.startsOn !== undefined
    || input.endsOn !== undefined,
  "Submit at least one trip setting.",
).superRefine((input, context) => {
  if ((input.expectedStartsOn === undefined) !== (input.expectedEndsOn === undefined)) {
    context.addIssue({ code: "custom", path: ["expectedStartsOn"], message: "Supply both expected trip dates." });
  }
  if (input.startsOn && input.endsOn) {
    if (input.endsOn < input.startsOn) {
      context.addIssue({ code: "custom", path: ["endsOn"], message: tripDateErrors.order });
    } else if ((Date.parse(`${input.endsOn}T00:00:00Z`) - Date.parse(`${input.startsOn}T00:00:00Z`)) / 86_400_000 > 365) {
      context.addIssue({ code: "custom", path: ["endsOn"], message: tripDateErrors.length });
    }
  }
});

export const createTripSchema = z.object({
  name: z.string().trim().min(1).max(160),
  destinationName: z.string().trim().min(1).max(160),
  timeZone: z.string().trim().min(1).max(80).refine((value) => canonicalTripTimeZone(value) !== null, "Enter a valid IANA time zone."),
  destinationLookupId: z.uuid().optional(),
  defaultLocale: z.enum(locales),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)
    .refine(isSupportedLedgerCurrency, "Select a supported currency."),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  maxMembers: z.number().int().min(1).max(20),
}).superRefine((input, context) => {
  const start = Date.parse(`${input.startsOn}T00:00:00Z`);
  const end = Date.parse(`${input.endsOn}T00:00:00Z`);
  if (end < start) {
    context.addIssue({
      code: "custom",
      path: ["endsOn"],
      message: "The end date must be on or after the start date.",
    });
  } else if ((end - start) / 86_400_000 > 365) {
    context.addIssue({
      code: "custom",
      path: ["endsOn"],
      message: "A trip can contain at most 366 calendar days.",
    });
  }
});
