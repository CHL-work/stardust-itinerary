import { isLocale, type Locale } from "@/lib/i18n";

export const localeCookieName = "stardust.locale";
export const localeCookieMaxAge = 365 * 24 * 60 * 60;

/** An explicit URL chooses this view only. Only the language selector saves a preference. */
export function preferredLocale(account: unknown, browser: unknown, explicit?: unknown): Locale {
  for (const value of [explicit, account, browser]) {
    if (typeof value === "string" && isLocale(value)) return value;
  }
  return "en";
}
