import { z } from "zod";

export const calendarLocationSearchInput = z.strictObject({
  subject: z.string().trim().min(2).max(140),
  consent: z.literal(true),
  locale: z.enum(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"]).default("en"),
  requestId: z.uuid(),
});

export type CalendarLocationSearchInput = z.infer<typeof calendarLocationSearchInput>;
export type CalendarLocationSearchResult = {
  requestId: string;
  status: "found" | "unverified" | "unavailable" | "running";
  locationName: string | null;
  mapUrl: string | null;
  sources: Array<{ title: string; url: string }>;
  aiReceiptToken: string | null;
};

export const calendarLocationEvidenceSchema = z.strictObject({
  subject: z.string().min(2).max(180),
  status: z.enum(["found", "unverified"]),
  venueName: z.string().max(180).nullable(),
  address: z.string().max(300).nullable(),
  sources: z.array(z.string().max(2000)).max(4),
});
export type CalendarLocationEvidence = z.infer<typeof calendarLocationEvidenceSchema>;
