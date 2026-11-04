import { z } from "zod";
import { assessVenueHours } from "@/lib/ai/venue-hours";
import { sanitizeVenueHoursSource } from "@/lib/ai/venue-hours-sources";

/** Public lookup identities only: no event, member, booking or financial fields. */
export const venueHoursTargetSchema = z.object({
  key: z.string().regex(/^V(?:[1-9]|1\d|20)$/u),
  venueName: z.string().min(1).max(240),
  date: z.iso.date(),
  timeZone: z.string().min(1).max(80).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; }
    catch { return false; }
  }),
}).strict();
const instantSchema = z.iso.datetime({ offset: true }).max(40);
export const venueHoursEvidenceSchema = venueHoursTargetSchema.extend({
  status: z.enum(["hours_found", "closed", "unknown"]),
  intervals: z.array(z.object({
    opensAt: instantSchema,
    closesAt: instantSchema,
    lastAdmissionAt: instantSchema.nullable(),
  }).strict()).max(6),
  sources: z.array(z.string().min(1).max(2_000)).max(5),
});
export type VenueHoursResearchTarget = z.infer<typeof venueHoursTargetSchema>;
export type VenueHoursEvidence = z.infer<typeof venueHoursEvidenceSchema>;
export type ReusableVenueHours = {
  hoursEvidence: VenueHoursEvidence[];
  attemptedHoursTargets: VenueHoursResearchTarget[];
};

/** A completed unknown is distinct from omitted, malformed or unsearched evidence. */
export function assessReusableVenueHours(
  targets: readonly VenueHoursResearchTarget[], raw: unknown, searchedKeys: ReadonlySet<string>,
  sanitizeSource: (source: string) => string | null = sanitizeVenueHoursSource,
): ReusableVenueHours {
  const result: ReusableVenueHours = { hoursEvidence: [], attemptedHoursTargets: [] };
  if (!Array.isArray(raw) || raw.length > 4) return result;
  const keys = new Set(targets.map((target) => target.key));
  const rows = raw.map((row) => venueHoursEvidenceSchema.safeParse(row));
  // Unknown identities and duplicate rows are ambiguous, not completed attempts.
  if (rows.some((row) => !row.success || !keys.has(row.data.key))
      || new Set(rows.flatMap((row) => row.success ? [row.data.key] : [])).size !== rows.length) return result;
  for (const parsed of rows) {
    if (!parsed.success) continue;
    const row = parsed.data;
    const target = targets.find((target) => target.key === row.key);
    if (!target || !searchedKeys.has(target.key) || row.venueName !== target.venueName
        || row.date !== target.date || row.timeZone !== target.timeZone) continue;
    if (row.status === "unknown") {
      // No opening claim or claimed supporting source is inferred from uncertainty.
      if (!row.intervals.length && !row.sources.length) result.attemptedHoursTargets.push({ ...target });
      continue;
    }
    // Reuse the final assessment's date/source/interval validator rather than
    // maintaining a second set of opening-hours rules. This synthetic arrival
    // only validates the evidence: actual visit times are assessed later.
    const sources = [...new Set(row.sources.map(sanitizeSource).filter((source): source is string => source !== null))];
    const assessment = assessVenueHours([{ ...target, proposalIndex: 0, public: true,
      startsAt: row.intervals[0]?.opensAt ?? null, endsAt: null }], [{ ...row, sources }], true, new Set([target.key]))[0];
    if (!assessment || assessment.status === "unverified") continue;
    result.hoursEvidence.push({ ...row, sources: assessment.sources });
    result.attemptedHoursTargets.push({ ...target });
  }
  return result;
}
