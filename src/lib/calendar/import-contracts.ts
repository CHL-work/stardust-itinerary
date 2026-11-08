import { z } from "zod";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import { eventTimeZonesSchema } from "@/lib/app/event-time-zone-contract";

export const calendarSourceSchema = z.object({
  eventId: z.string().min(5).max(1024), title: z.string().min(1).max(240), location: z.string().max(300).nullable(),
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), allDay: z.boolean(),
  startDate: z.iso.date().nullable(), endDateExclusive: z.iso.date().nullable(),
  timeZones: eventTimeZonesSchema.nullable().optional(),
}).strict();
export type CalendarSource = z.infer<typeof calendarSourceSchema>;
export type CalendarSourceMetadata = { allDay: boolean; startDate: string | null; endDateExclusive: string | null;
  sourceStartsAt: string; sourceEndsAt: string };
export type CalendarImportExisting = { requestId: string; status: "pending" | "rejected" | "approved" | "invalidated";
  proposalRevision: number; itemId: string | null };
export type CalendarImportPreview = { previewToken: string; expiresAt: string; source: CalendarSource; existing: CalendarImportExisting | null };
export type CalendarImportResult = CalendarImportExisting & { replayed: boolean };
export type CalendarImportState = CalendarImportExisting & { canImport: false };
export const calendarImportInputSchema = z.object({
  previewToken: z.string().min(1).max(16000), visibility: z.enum(["private", "trip"]).optional(),
  viewerMemberIds: z.array(z.uuid()).max(19).optional(), itemType: z.enum(["activity", "meal", "lodging", "note"]).optional(),
  locationName: z.string().trim().max(300).nullable().optional(),
  mapUrl: z.url().max(2000).refine(isTrustedGoogleMapsUrl).nullable().optional(),
  aiReceiptToken: z.string().min(1).max(16000).optional(),
}).strict();
export type CalendarImportInput = z.infer<typeof calendarImportInputSchema>;
export const calendarImportErrorCodes = ["CALENDAR_IMPORT_RECONNECT", "CALENDAR_IMPORT_STALE", "CALENDAR_IMPORT_INVALID", "CALENDAR_IMPORT_UNAVAILABLE"] as const;
