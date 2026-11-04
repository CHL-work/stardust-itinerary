import { z } from "zod";
import { locales, type Locale } from "@/lib/i18n";
import { containsReservationSecret } from "@/lib/ai/reservation-secrets";
import { containsPrivateIdentifier } from "@/lib/disruptions/privacy";
import { type DestinationDefaults } from "@/lib/app/trip-destination-contract";
import { destinationCurrencyCodes, regionCurrencies, SUGGESTION_EXCLUDED_CURRENCIES } from "@/lib/app/region-currencies";
import { isSupportedLedgerCurrency } from "@/lib/app/supported-currencies";
import { canonicalTripTimeZone, isTripTimeZone } from "@/lib/app/trip-time-zone";

export { canonicalTripTimeZone, isTripTimeZone };

export function normalizeDestination(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

/** Destination is a public place label only, never a booking, address book or command. */
export function validateDestinationInput(value: string): boolean {
  const subject = value.normalize("NFKC").trim();
  return subject.length >= 2 && subject.length <= 160 && !containsPrivateIdentifier(subject)
    && !containsReservationSecret(subject)
    && !/\b(?:private|password|passcode|booking\s*(?:number|reference|id)|reservation\s*(?:number|reference|id)|my\s+(?:home|house|address)|ignore|instructions?|system\s+prompt|execute|upload|download|send\s+to|curl|powershell|javascript)\b|私(?:人|密)|密碼|密码|予約番号|暗証番号|忽略|無視|指令/iu.test(subject)
    && !/[\u0000-\u001f\u007f\p{Cf}<>`{};\\]|[a-z][a-z0-9+.-]*:\/\/|(?:https?|file):|www\.|\b[\w-]+\.[a-z]{2,}(?:\b|\/)|[?=&]/iu.test(subject)
    && !/%[0-9a-f]{2}/iu.test(subject);
}

export function zonesForRegion(countryCode: string): string[] {
  if (!Object.hasOwn(regionCurrencies, countryCode)) return [];
  const locale = new Intl.Locale(`und-${countryCode}`) as Intl.Locale & { getTimeZones(): string[] | undefined };
  return [...new Set((locale.getTimeZones() ?? []).map(canonicalTripTimeZone).filter((zone): zone is string => zone !== null))].sort();
}

export function countryLabels(countryCode: string): Record<Locale, string> {
  return Object.fromEntries(locales.map((locale) => [locale,
    new Intl.DisplayNames(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { type: "region" }).of(countryCode) ?? countryCode,
  ])) as Record<Locale, string>;
}

function zoneLabels(zone: string): Record<Locale, string> {
  return Object.fromEntries(locales.map((locale) => {
    const name = new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, {
      timeZone: zone, timeZoneName: "longGeneric",
    }).formatToParts(new Date("2020-01-01T00:00:00Z")).find((part) => part.type === "timeZoneName")?.value ?? zone;
    return [locale, `${name} — ${zone}`];
  })) as Record<Locale, string>;
}

const countryNames = new Map<string, string>();
for (const locale of ["en", "zh-HK", "zh-Hant", "ja"]) {
  const names = new Intl.DisplayNames(locale, { type: "region" });
  for (const code of Object.keys(regionCurrencies)) {
    countryNames.set(normalizeDestination(names.of(code) ?? code), code);
    countryNames.set(normalizeDestination(code), code);
  }
}
for (const [code, aliases] of Object.entries({
  US: ["USA", "United States of America", "America", "美國", "美国", "アメリカ"],
  GB: ["UK", "Britain", "Great Britain", "英國", "英国", "イギリス"],
  JP: ["日本国", "日本國"], HK: ["Hong Kong SAR", "香港特別行政區"],
  KR: ["South Korea", "韓國", "韩国", "韓国"], CN: ["China", "中国", "中國"],
})) for (const alias of aliases) countryNames.set(normalizeDestination(alias), code);

function emptyDefaults(): DestinationDefaults {
  return { status: "unknown", reason: null, countryCode: null, countryLabels: null, timeZone: null,
    timeZoneCandidates: [], countryTimeZones: [], currency: null, currencyCandidates: [], unsupportedLocalCurrency: null };
}

function supportedCurrency(code: string): boolean {
  return destinationCurrencyCodes.has(code) && isSupportedLedgerCurrency(code) && !SUGGESTION_EXCLUDED_CURRENCIES.has(code);
}

function withCountry(countryCode: string): DestinationDefaults {
  const defaults = emptyDefaults();
  const country = regionCurrencies[countryCode]!;
  const zones = zonesForRegion(countryCode);
  return { ...defaults, countryCode, countryLabels: countryLabels(countryCode), countryTimeZones: zones,
    currency: supportedCurrency(country.primary) ? country.primary : null,
    currencyCandidates: country.alternates.filter(supportedCurrency),
    unsupportedLocalCurrency: supportedCurrency(country.primary) ? null : country.primary };
}

/** Pure helper for explicit non-AI callers; Auto never short-circuits through it. */
export function resolveDeterministicDestination(text: string): DestinationDefaults | null {
  const countryCode = countryNames.get(normalizeDestination(text));
  if (!countryCode) return null;
  const defaults = withCountry(countryCode);
  const zones = defaults.countryTimeZones;
  if (!zones.length) return null;
  return { ...defaults, status: zones.length === 1 ? "resolved" : "ambiguous",
    timeZone: zones.length === 1 ? zones[0]! : null,
    timeZoneCandidates: zones.length > 1 ? zones.slice(0, 5).map((value) => ({ value, label: zoneLabels(value) })) : [] };
}

export const destinationLookupOutputSchema = z.strictObject({
  status: z.enum(["resolved", "ambiguous", "unknown"]),
  countryCode: z.string().regex(/^[A-Z]{2}$/u).nullable(),
  timeZone: z.string().max(80).nullable(),
  timeZoneCandidates: z.array(z.string().max(80)).max(5),
  currency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  currencyCandidates: z.array(z.string().regex(/^[A-Z]{3}$/u)).max(2),
});

/** Model text never crosses this boundary: only validated/localized public codes do. */
export function validateLookupOutput(raw: unknown, destinationNormalized: string): DestinationDefaults {
  const parsed = destinationLookupOutputSchema.parse(raw);
  if (parsed.status === "unknown") return emptyDefaults();
  const cc = parsed.countryCode;
  if (cc && (!Object.hasOwn(regionCurrencies, cc) || !zonesForRegion(cc).length)) throw new Error("DESTINATION_INVALID_COUNTRY");
  const explicitCountry = countryNames.get(normalizeDestination(destinationNormalized));
  if (explicitCountry && cc !== explicitCountry) throw new Error("DESTINATION_COUNTRY_MISMATCH");
  let defaults = cc ? withCountry(cc) : emptyDefaults();
  const canonical = parsed.timeZone === null ? null : canonicalTripTimeZone(parsed.timeZone);
  const zone = canonical && (!cc || defaults.countryTimeZones.includes(canonical)) ? canonical : null;
  const wholeCountry = cc !== null && countryNames.get(normalizeDestination(destinationNormalized)) === cc;
  const multiple = wholeCountry && defaults.countryTimeZones.length > 1;
  const candidateZones = [...new Set(parsed.timeZoneCandidates.map(canonicalTripTimeZone)
    .filter((candidate): candidate is string => candidate !== null && (!cc || defaults.countryTimeZones.includes(candidate))))];
  const resolved = parsed.status === "resolved" && zone !== null && cc !== null && !multiple;
  const candidateValues = resolved ? [] : candidateZones.length >= 2 ? candidateZones : defaults.countryTimeZones.slice(0, 5);
  defaults = { ...defaults, status: resolved ? "resolved" : "ambiguous", timeZone: resolved ? zone : null,
    timeZoneCandidates: candidateValues.map((value) => ({ value, label: zoneLabels(value) })) };
  // A country table wins over a model's inconsistent local currency, but a known,
  // supported alternative may be offered for an explicit human choice.
  const offered = [parsed.currency, ...parsed.currencyCandidates, ...defaults.currencyCandidates]
    .filter((value): value is string => value !== null && supportedCurrency(value) && value !== defaults.currency);
  defaults.currencyCandidates = [...new Set(offered)].slice(0, 2);
  if (!cc) {
    defaults.currency = null;
    defaults.currencyCandidates = [];
    const unsupported = [parsed.currency, ...parsed.currencyCandidates]
      .find((value) => value !== null && destinationCurrencyCodes.has(value) && !supportedCurrency(value));
    defaults.unsupportedLocalCurrency = unsupported ?? null;
  }
  return defaults;
}
