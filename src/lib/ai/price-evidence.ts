import { z } from "zod";
import { isSupportedLedgerCurrency } from "@/lib/app/supported-currencies";
import { containsPrivateIdentifier } from "@/lib/disruptions/privacy";
import { containsReservationSecret } from "@/lib/ai/reservation-secrets";

export const MAX_PUBLISHED_PRICE_QUOTES = 12;
const minorAmount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const publishedPriceQuoteSchema = z.object({
  service: z.string().min(1).max(160),
  durationMinutes: z.number().int().min(1).max(43_200).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  baseFeeMinor: minorAmount,
  priceUnit: z.enum(["per_person", "per_group", "per_item", "per_night", "per_hour", "per_session", "package", "unknown"]),
  tax: z.enum(["included", "excluded", "not_applicable", "unknown"]),
  fees: z.array(z.object({
    name: z.string().min(1).max(100),
    amountMinor: minorAmount.nullable(),
    requirement: z.enum(["mandatory", "optional", "unknown"]),
    conditions: z.string().max(240),
  }).strict()).max(8),
  conditions: z.string().max(500),
  source: z.string().min(1).max(2_000),
  validFrom: z.iso.date().nullable(),
  validThrough: z.iso.date().nullable(),
}).strict();
export type PublishedPriceQuote = z.infer<typeof publishedPriceQuoteSchema>;

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();

/** Narrow explicit exclusions, not a complete semantic service classifier. */
export function containsUnsupportedPriceService(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/\bnon[\s-]+sexual\b/giu, "ordinary");
  return /\b(?:sexual\s+services?|erotic\s+(?:massage|services?)|sex\s+workers?|prostitut\w*|brothels?|commercial\s+sex)\b|性服務|性服务|援交|買春|売春|(?:性|風俗)サービス|風俗店|デリヘル|ソープランド/iu.test(normalized);
}

function safeEvidenceText(value: string): boolean {
  return !containsPrivateIdentifier(value) && !containsReservationSecret(value)
    && !containsUnsupportedPriceService(value)
    && !/[\u0000-\u001f\u007f\p{Cf}]|https?:\/\//iu.test(value);
}

/** Extracted tariffs are estimates only: this function never computes a bill. */
export function assessPublishedPriceQuotes(
  raw: unknown,
  sources: readonly string[],
  applicableDate: string | null,
  sanitizeSource: (source: string) => string | null,
  asOfDate = new Date().toISOString().slice(0, 10),
): PublishedPriceQuote[] | null {
  const parsed = z.array(z.unknown()).min(1).max(MAX_PUBLISHED_PRICE_QUOTES).safeParse(raw);
  if (!parsed.success) return null;
  const date = applicableDate ?? asOfDate;
  if (!z.iso.date().safeParse(date).success) return null;
  const identities = new Map<string, PublishedPriceQuote | null>();
  for (const rawQuote of parsed.data) {
    const row = publishedPriceQuoteSchema.safeParse(rawQuote);
    if (!row.success) continue;
    const quote = row.data;
    const identity = JSON.stringify([normalize(quote.service), quote.durationMinutes, quote.priceUnit,
      quote.validFrom, quote.validThrough, normalize(quote.conditions)]);
    // Neither side of a duplicate/conflicting tariff is authoritative.
    if (identities.has(identity)) { identities.set(identity, null); continue; }
    identities.set(identity, null);
    const source = sanitizeSource(quote.source);
    if (!source || !sources.includes(source) || !isSupportedLedgerCurrency(quote.currency)
      || !quote.service.trim() || !safeEvidenceText(quote.service) || !safeEvidenceText(quote.conditions)
      || quote.fees.some((fee) => !fee.name.trim() || !safeEvidenceText(fee.name) || !safeEvidenceText(fee.conditions))
      || (quote.validFrom && quote.validThrough && quote.validFrom > quote.validThrough)
      || (quote.validFrom && quote.validFrom > date) || (quote.validThrough && quote.validThrough < date)) continue;
    identities.set(identity, { ...quote, source });
  }
  const accepted = [...identities.values()].filter((row): row is PublishedPriceQuote => row !== null);
  return accepted.length ? accepted : null;
}
