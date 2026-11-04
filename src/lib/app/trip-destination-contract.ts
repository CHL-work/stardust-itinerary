import type { Locale } from "@/lib/i18n";

export type DestinationLookupReason = "not_entitled" | "rate_limited" | "quota" | "busy" | "timeout" | "provider_unavailable" | "invalid_output" | "private_text";
export type DestinationDefaults = {
  status: "resolved" | "ambiguous" | "unknown" | "unavailable";
  reason: DestinationLookupReason | null;
  countryCode: string | null;
  countryLabels: Record<Locale, string> | null;
  timeZone: string | null;
  timeZoneCandidates: { value: string; label: Record<Locale, string> }[];
  countryTimeZones: string[];
  currency: string | null;
  currencyCandidates: string[];
  unsupportedLocalCurrency: string | null;
};

export type DestinationLookupResponse = DestinationDefaults & {
  requestId: string;
  lookupId: string | null;
  source: "ai" | "cache" | "none";
};

export function unavailableDestination(reason: DestinationLookupReason): DestinationDefaults {
  return { status: "unavailable", reason, countryCode: null, countryLabels: null, timeZone: null,
    timeZoneCandidates: [], countryTimeZones: [], currency: null, currencyCandidates: [], unsupportedLocalCurrency: null };
}
