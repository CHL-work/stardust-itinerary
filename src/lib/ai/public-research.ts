import { z } from "zod";
import { containsReservationSecret, redactReservationSecrets } from "@/lib/ai/reservation-secrets";
import { sanitizeKnownPublicArticleSource, sanitizeVenueHoursSource } from "@/lib/ai/venue-hours-sources";
import { containsPrivateIdentifier, sanitizePublicText } from "@/lib/disruptions/privacy";
import { venueHoursEvidenceSchema, venueHoursTargetSchema, type VenueHoursResearchTarget } from "@/lib/ai/venue-hours-evidence";
import { assessPublishedPriceQuotes, containsUnsupportedPriceService, MAX_PUBLISHED_PRICE_QUOTES, publishedPriceQuoteSchema, type PublishedPriceQuote } from "@/lib/ai/price-evidence";

export const PUBLIC_RESEARCH_MAX_TARGETS = 3;
export const PUBLIC_RESEARCH_BUDGET_MS = 90_000;
export const PUBLIC_RESEARCH_FINALIZATION_RESERVE_MS = 60_000;
export const PUBLIC_RESEARCH_MIN_BUDGET_MS = 8_000;

export const publicResearchRequestSchema = z.object({
  kind: z.enum(["venue", "discovery", "travel", "exchange_rate", "price"]),
  subject: z.string().min(1).max(180),
  date: z.iso.date().nullable(),
}).strict();
export const publicResearchRequestsSchema = z.array(publicResearchRequestSchema).max(PUBLIC_RESEARCH_MAX_TARGETS);
export const publicResearchRequestJsonSchema = z.toJSONSchema(publicResearchRequestsSchema, { target: "draft-7" });
export type PublicResearchRequest = z.infer<typeof publicResearchRequestSchema>;
export type PublicResearchTarget = PublicResearchRequest & { key: string };
export type PublicResearchFact = PublicResearchTarget & {
  status: "verified" | "unverified";
  summary: string;
  sources: string[];
  priceQuotes?: PublishedPriceQuote[];
};

const currencyCodes = new Set(Intl.supportedValuesOf("currency"));
const keySchema = z.string().regex(/^R[1-3]$/u);
export const publicResearchTargetSchema = publicResearchRequestSchema.extend({ key: keySchema });
export const publicResearchFactSchema = publicResearchTargetSchema.extend({
  status: z.enum(["verified", "unverified"]),
  summary: z.string().max(1_200),
  sources: z.array(z.string().min(1).max(2_000)).max(5),
  priceQuotes: z.array(publishedPriceQuoteSchema).max(MAX_PUBLISHED_PRICE_QUOTES).optional(),
});
export const publicResearchResponseSchema = z.object({
  facts: z.array(publicResearchFactSchema).max(PUBLIC_RESEARCH_MAX_TARGETS),
  hours: z.array(venueHoursEvidenceSchema).max(PUBLIC_RESEARCH_MAX_TARGETS).optional(),
}).strict();
// Strict provider output still declares every row field. Runtime evidence is
// assessed independently so one malformed tier does not erase valid siblings.
const publicResearchEvidenceFactSchema = publicResearchFactSchema.extend({
  priceQuotes: z.array(z.unknown()).max(MAX_PUBLISHED_PRICE_QUOTES).optional(),
});
export const publicResearchEvidenceResponseSchema = publicResearchResponseSchema.extend({
  facts: z.array(publicResearchEvidenceFactSchema).max(PUBLIC_RESEARCH_MAX_TARGETS),
});
// The legacy parser may omit hours, but strict provider Structured Outputs must
// require every property. An empty hours array represents no requested evidence.
export const publicResearchOutputSchema = z.toJSONSchema(publicResearchResponseSchema.required({ hours: true }).extend({
  facts: z.array(publicResearchFactSchema.required({ priceQuotes: true })).max(PUBLIC_RESEARCH_MAX_TARGETS),
}), { target: "draft-7" });

function validCurrencyPair(subject: string): boolean {
  if (!/^[A-Z]{3}\/[A-Z]{3}$/u.test(subject)) return false;
  const [from, to] = subject.split("/");
  return from !== to && currencyCodes.has(from!) && currencyCodes.has(to!);
}

/** Absent fields remain compatible with saved/provider responses predating this contract. */
export function parsePublicResearchRequests(raw?: unknown): PublicResearchRequest[] {
  const requests = publicResearchRequestsSchema.parse(raw === undefined ? [] : raw);
  if (requests.some((request) => request.kind === "exchange_rate" && !validCurrencyPair(request.subject))) {
    throw new Error("AI_PUBLIC_RESEARCH_INVALID");
  }
  return requests;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

const privateOrInstructionText = /\b(?:private|password|passcode|booking\s*(?:number|reference|id)|reservation\s*(?:number|reference|id)|my\s+(?:home|house|address)|ignore|instructions?|system\s+prompt|execute|upload|download|send\s+to|curl|powershell|javascript)\b|私(?:人|密)|密碼|密码|予約番号|暗証番号|忽略|無視|指令/iu;

function publicSubject(request: PublicResearchRequest): boolean {
  if (request.kind === "exchange_rate") return validCurrencyPair(request.subject);
  const subject = request.subject.normalize("NFKC");
  if (request.kind === "price" && containsUnsupportedPriceService(subject)) return false;
  return subject === subject.trim() && subject.length >= 2 && !containsPrivateIdentifier(subject)
    && !containsReservationSecret(subject) && !privateOrInstructionText.test(subject)
    && !/[\u0000-\u001f\u007f\p{Cf}<>`{};\\]|[a-z][a-z0-9+.-]*:\/\/|(?:https?|file):|www\.|\b[\w-]+\.[a-z]{2,}(?:\b|\/)|[?=&]/iu.test(subject)
    && !/%[0-9a-f]{2}/iu.test(subject);
}

export type PublicResearchPrivacy = {
  forbiddenTexts?: readonly string[];
  memberNames?: readonly string[];
  privacyBlocked?: boolean;
  userDisabled?: boolean;
};

/** Only this allowlisted projection may enter the isolated researcher. */
export function selectPublicResearchTargets(
  requests: readonly PublicResearchRequest[], privacy: PublicResearchPrivacy = {},
): PublicResearchTarget[] {
  if (privacy.userDisabled) return [];
  const blockedLabels = [...privacy.forbiddenTexts ?? [], ...privacy.memberNames ?? []]
    .map(normalized).filter(Boolean);
  return parsePublicResearchRequests(requests).flatMap((request, index) => {
    // A latest ISO pair carries no receipt amount, transaction date or person.
    // This narrow projection remains safe even when the planner saw a receipt.
    if (privacy.privacyBlocked && (request.kind !== "exchange_rate" || request.date !== null)) return [];
    const subject = normalized(request.subject);
    if (!publicSubject(request) || blockedLabels.some((label) => subject.includes(label))) return [];
    return [{ key: `R${index + 1}`, kind: request.kind, subject: request.subject, date: request.date }];
  });
}

/** Recheck the public projection at the provider boundary, never trust a caller's cast. */
export function validatePublicResearchTargets(raw: unknown): PublicResearchTarget[] {
  const targets = z.array(publicResearchTargetSchema).min(1).max(PUBLIC_RESEARCH_MAX_TARGETS).parse(raw);
  parsePublicResearchRequests(targets.map(({ kind, subject, date }) => ({ kind, subject, date })));
  if (new Set(targets.map((target) => target.key)).size !== targets.length
      || targets.some((target) => !publicSubject(target))) throw new Error("AI_PUBLIC_RESEARCH_INVALID");
  return targets;
}

/** Reuse only already-authorized public subjects, never preliminary proposal fields. */
export function selectPublicResearchHoursTargets(
  targets: readonly PublicResearchTarget[], timeZone: string,
): VenueHoursResearchTarget[] {
  if (!targets.length) return [];
  const projected = validatePublicResearchTargets(targets).flatMap((target) => target.kind === "venue" && target.date
    ? [{ key: `V${target.key.slice(1)}`, venueName: target.subject, date: target.date, timeZone }] : []);
  const unique = projected.filter((target, index) => projected.findIndex((other) =>
    other.venueName === target.venueName && other.date === target.date && other.timeZone === target.timeZone) === index);
  return validatePublicResearchHoursTargets(targets, unique);
}

/** A hours target cannot widen the isolated search's approved subject or date. */
export function validatePublicResearchHoursTargets(
  targets: readonly PublicResearchTarget[], raw?: unknown,
): VenueHoursResearchTarget[] {
  const hoursTargets = z.array(venueHoursTargetSchema).max(PUBLIC_RESEARCH_MAX_TARGETS).parse(raw === undefined ? [] : raw);
  if (new Set(hoursTargets.map((target) => target.key)).size !== hoursTargets.length
      || new Set(hoursTargets.map((target) => JSON.stringify([target.venueName, target.date, target.timeZone]))).size !== hoursTargets.length
      || hoursTargets.some((hours) => !targets.some((target) => target.kind === "venue"
        && target.subject === hours.venueName && target.date === hours.date))) throw new Error("AI_PUBLIC_RESEARCH_INVALID");
  return hoursTargets;
}

export function publicResearchQuery(target: PublicResearchTarget): string {
  const terms = target.kind === "exchange_rate" ? "exchange rate dated market quote currency converter"
    : target.kind === "travel" ? "official transport timetable fares service notices"
      : target.kind === "discovery" ? "official events exhibitions pop-up collaborations locations dates"
      : target.kind === "price" ? "official menu service prices duration tiers admission tariff tax mandatory optional fees conditions"
        : "official visitor information opening hours tickets admission";
  return `${target.subject} ${target.date ?? "latest"} ${terms}`;
}

/** Follow-up retrieval can refine a public topic, but cannot introduce app context. */
export function isBoundPublicResearchQuery(query: string, targets: readonly PublicResearchTarget[]): boolean {
  query = query.normalize("NFKC");
  if (!query || query.length > 500 || containsPrivateIdentifier(query) || containsReservationSecret(query)
      || privateOrInstructionText.test(query) || /[\u0000-\u001f\u007f\p{Cf}<>`{};\\]|[a-z][a-z0-9+.-]*:\/\/|(?:https?|file):|www\.|[?=&]|%[0-9a-f]{2}/iu.test(query)) return false;
  const normalizedQuery = normalized(query);
  return targets.some((target) => {
    if (target.kind === "price" && containsUnsupportedPriceService(query)) return false;
    if (target.kind === "exchange_rate") {
      const pair = target.subject.split("/");
      const words = query.toUpperCase().match(/\b[A-Z]{3}\b/gu) ?? [];
      if (!pair.every((code) => new RegExp(`(?:^|[^a-z])${code}(?:$|[^a-z])`, "iu").test(query))) return false;
      if (words.some((word) => currencyCodes.has(word) && !pair.includes(word))) return false;
      // Public source dates are useful; private transaction amounts are not.
      return !/\d/u.test(query.replace(/\b\d{4}-\d{2}-\d{2}\b/gu, ""));
    }
    const compact = (value: string) => normalized(value).replace(/[^\p{L}\p{N}]/gu, "");
    return compact(normalizedQuery).includes(compact(target.subject));
  });
}

export function sanitizePublicResearchSource(raw: string): string | null {
  const safe = sanitizeVenueHoursSource(raw);
  if (!safe) return null;
  const url = new URL(safe);
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return null; }
  if (url.port || url.hostname.startsWith("[") || !url.hostname.includes(".") || url.hostname.endsWith(".localhost")
      || /\/(?:accounts?|login|sign-?in|checkout|reservations?|bookings?|receipts?|orders?)(?:\/|$)/iu.test(path)) return null;
  const publicArticle = sanitizeKnownPublicArticleSource(safe);
  if (publicArticle) return publicArticle;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Status means bounded source-backed extraction, not independently fetched proof. */
export function assessPublicResearch(
  targets: readonly PublicResearchTarget[], rawFacts: unknown, searchPerformed: boolean, searchedKeys?: ReadonlySet<string>, asOfDate?: string,
): PublicResearchFact[] {
  const rows = Array.isArray(rawFacts) && rawFacts.length <= PUBLIC_RESEARCH_MAX_TARGETS ? rawFacts : [];
  const keys = new Set(targets.map((target) => target.key));
  const invalidRoot = rows.some((row) => !row || typeof row !== "object" || !keys.has(row.key));
  return targets.map((target) => {
    const unknown: PublicResearchFact = { ...target, status: "unverified", summary: "No sufficient current public evidence was verified.", sources: [] };
    const matching = rows.filter((row) => row && typeof row === "object" && row.key === target.key);
    if (!searchPerformed || (searchedKeys && !searchedKeys.has(target.key)) || invalidRoot || matching.length !== 1) return unknown;
    const parsed = publicResearchEvidenceFactSchema.safeParse(matching[0]);
    if (!parsed.success) return unknown;
    const fact = parsed.data;
    if (fact.kind !== target.kind || fact.subject !== target.subject || fact.date !== target.date || fact.status !== "verified") return unknown;
    const sources = [...new Set(fact.sources.map(sanitizePublicResearchSource).filter((source): source is string => Boolean(source)))];
    const summary = sanitizePublicText(redactReservationSecrets(fact.summary), 1_200)
      .replace(/https?:\/\/\S+/giu, "[source link omitted]");
    if (!sources.length || !summary || summary === "[redacted]") return unknown;
    if (target.kind === "price") {
      if (!publicSubject(target)) return unknown;
      const priceQuotes = assessPublishedPriceQuotes(fact.priceQuotes, sources, target.date, sanitizePublicResearchSource, asOfDate);
      return priceQuotes ? { ...target, status: "verified",
        summary: "Source-backed published tariff rows are available; these are estimates, not confirmed charges.",
        sources, priceQuotes } : unknown;
    }
    if (fact.priceQuotes?.length) return unknown;
    return { ...target, status: "verified", summary, sources };
  });
}
