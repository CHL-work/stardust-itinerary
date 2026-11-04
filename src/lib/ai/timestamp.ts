import { z } from "zod";

const aiOffsetDateTimeSchema = z.iso.datetime({ offset: true });
const aiUtcDateTimeSchema = z.iso.datetime();

/**
 * Canonicalize a provider-supplied ISO instant without guessing a time zone or
 * repairing invalid calendar/time fields. Invalid values stay unchanged so the
 * caller's strict field schema can report the original bounded validation issue.
 */
export function normalizeAiIsoDateTime(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (aiUtcDateTimeSchema.safeParse(value).success) return value;

  const parsed = aiOffsetDateTimeSchema.safeParse(value);
  if (!parsed.success) return value;

  const fractionalSeconds = parsed.data.match(
    /\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/u,
  )?.[1];
  if (fractionalSeconds && /[1-9]/u.test(fractionalSeconds.slice(3))) {
    return value;
  }

  const instant = new Date(parsed.data);
  if (Number.isNaN(instant.getTime())) return value;
  return instant.toISOString();
}
