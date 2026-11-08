import type { Locale } from "@/lib/i18n";

/** Finish persistence before navigation, including on the no-trip creation screen. */
export async function saveLocalePreference(locale: Locale, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl("/api/account/locale", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }), signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch { return false; }
}
