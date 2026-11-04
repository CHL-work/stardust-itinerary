import { z } from "zod";

import { disruptionReasonCodes, type DisruptionAlert } from "@/lib/disruptions/types";
import { sanitizePublicSourceUrl, sanitizePublicText } from "@/lib/disruptions/privacy";

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const instantSchema = z.string().max(40).refine(
  (value) => ISO_INSTANT_PATTERN.test(value) && Number.isFinite(Date.parse(value)),
  "Expected an ISO 8601 timestamp.",
);

const impactAssessmentSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  sourceAuthority: z.enum(["official", "corroborated", "unknown"]),
  match: z.enum(["exact_venue", "explicit_transport", "nearby", "unknown"]),
  effect: z.enum(["cancelled", "unavailable", "access_blocked", "delay", "schedule_change", "minor", "unknown"]),
  minimumDelayMinutes: z.number().int().min(0).max(10_080).nullable(),
  affectedEntity: z.string().trim().min(1).max(180).nullable(),
  evidenceSummary: z.string().trim().min(1).max(800),
  ongoing: z.boolean(),
}).strict();

const alertSchema = z.object({
  eventKey: z.string().regex(/^E[1-9]\d{0,2}$/u),
  state: z.enum(["possible", "confirmed", "resolved"]),
  reasonCode: z.enum(disruptionReasonCodes),
  severity: z.enum(["info", "warning", "critical"]),
  detail: z.string().trim().min(1).max(800),
  // A translation failure must not discard otherwise valid sourced evidence.
  localizedDetails: z.unknown().optional(),
  sourceUrls: z.array(z.url().max(2_000)).min(1).max(5),
  affectedFrom: instantSchema.nullable(),
  affectedUntil: instantSchema.nullable(),
  validForMinutes: z.number().int().min(15).max(360),
  impactAssessment: impactAssessmentSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.affectedFrom && value.affectedUntil
      && Date.parse(value.affectedUntil) < Date.parse(value.affectedFrom)) {
    context.addIssue({
      code: "custom",
      path: ["affectedUntil"],
      message: "affectedUntil must be on or after affectedFrom.",
    });
  }
});

const responseSchema = z.object({
  alerts: z.array(alertSchema).max(24),
}).strict();

export const disruptionOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    alerts: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          eventKey: { type: "string", pattern: "^E[1-9][0-9]{0,2}$" },
          state: { type: "string", enum: ["possible", "confirmed", "resolved"] },
          reasonCode: { type: "string", enum: [...disruptionReasonCodes] },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          detail: { type: "string", minLength: 1, maxLength: 800 },
          localizedDetails: {
            type: "object", additionalProperties: false,
            properties: {
              en: { type: "string", minLength: 1, maxLength: 800 },
              "zh-HK": { type: "string", minLength: 1, maxLength: 800 },
              "ja-JP": { type: "string", minLength: 1, maxLength: 800 },
            },
            required: ["en", "zh-HK", "ja-JP"],
          },
          sourceUrls: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string", maxLength: 2_000 },
          },
          affectedFrom: { type: ["string", "null"], maxLength: 40 },
          affectedUntil: { type: ["string", "null"], maxLength: 40 },
          validForMinutes: { type: "integer", minimum: 15, maximum: 360 },
          impactAssessment: {
            type: "object", additionalProperties: false,
            properties: {
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              sourceAuthority: { type: "string", enum: ["official", "corroborated", "unknown"] },
              match: { type: "string", enum: ["exact_venue", "explicit_transport", "nearby", "unknown"] },
              effect: { type: "string", enum: ["cancelled", "unavailable", "access_blocked", "delay", "schedule_change", "minor", "unknown"] },
              minimumDelayMinutes: { type: ["integer", "null"], minimum: 0, maximum: 10_080 },
              affectedEntity: { type: ["string", "null"], minLength: 1, maxLength: 180 },
              evidenceSummary: { type: "string", minLength: 1, maxLength: 800 },
              ongoing: { type: "boolean" },
            },
            required: ["confidence", "sourceAuthority", "match", "effect", "minimumDelayMinutes", "affectedEntity", "evidenceSummary", "ongoing"],
          },
        },
        required: [
          "eventKey", "state", "reasonCode", "severity", "detail", "localizedDetails", "sourceUrls",
          "affectedFrom", "affectedUntil", "validForMinutes", "impactAssessment",
        ],
      },
    },
  },
  required: ["alerts"],
} as const;

export function parseDisruptionOutput(rawOutput: string, allowedKeys: ReadonlySet<string>): DisruptionAlert[] {
  const parsed = responseSchema.parse(JSON.parse(rawOutput));
  const seen = new Set<string>();
  return parsed.alerts.map((alert) => {
    if (!allowedKeys.has(alert.eventKey)) {
      throw new Error("The disruption response referenced an unknown event key.");
    }
    if (seen.has(alert.eventKey)) {
      throw new Error("The disruption response repeated an event key.");
    }
    seen.add(alert.eventKey);
    const sourceUrls = [...new Set(alert.sourceUrls
      .map(sanitizePublicSourceUrl)
      .filter((url): url is string => Boolean(url)))];
    if (sourceUrls.length === 0 || sourceUrls.length !== alert.sourceUrls.length) {
      throw new Error("The disruption response contained a non-public source URL.");
    }
    const { localizedDetails: proposedTranslations, ...evidence } = alert;
    const localizedDetails = parseDisruptionLocalizations(proposedTranslations);
    return {
      ...evidence,
      detail: sanitizePublicText(alert.detail, 800),
      ...(alert.impactAssessment ? { impactAssessment: {
        ...alert.impactAssessment,
        affectedEntity: alert.impactAssessment.affectedEntity === null ? null
          : sanitizePublicText(alert.impactAssessment.affectedEntity, 180),
        evidenceSummary: sanitizePublicText(alert.impactAssessment.evidenceSummary, 800),
      } } : {}),
      ...(localizedDetails ? { localizedDetails } : {}),
      sourceUrls,
    };
  });
}

const localizedDetailsSchema = z.object({
  en: z.string().trim().min(1).max(800),
  "zh-HK": z.string().trim().min(1).max(800),
  "ja-JP": z.string().trim().min(1).max(800),
}).strict();

export function parseDisruptionLocalizations(value: unknown): DisruptionAlert["localizedDetails"] | null {
  const parsed = localizedDetailsSchema.safeParse(value);
  if (!parsed.success) return null;
  const clean = localizedDetailsSchema.safeParse({
    en: sanitizePublicText(parsed.data.en, 800),
    "zh-HK": sanitizePublicText(parsed.data["zh-HK"], 800),
    "ja-JP": sanitizePublicText(parsed.data["ja-JP"], 800),
  });
  return clean.success ? clean.data : null;
}
