import type { DestinationDefaults } from "@/lib/app/trip-destination-contract";
import { validateLookupOutput } from "@/lib/app/trip-destination-defaults";

/** Recheck cached codes against today's server sets and rebuild labels. Cached
 * prose, obsolete zones/currencies or malformed rows are never sent blindly. */
export function validatedStoredDestinationDefaults(raw: unknown, destination: string): DestinationDefaults | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.reason !== null || !Array.isArray(value.timeZoneCandidates)) return null;
  try {
    return validateLookupOutput({ status: value.status, countryCode: value.countryCode, timeZone: value.timeZone,
      timeZoneCandidates: value.timeZoneCandidates.map((candidate) => candidate && typeof candidate === "object" ? candidate.value : undefined),
      currency: value.currency ?? value.unsupportedLocalCurrency,
      currencyCandidates: value.currencyCandidates }, destination);
  } catch { return null; }
}
