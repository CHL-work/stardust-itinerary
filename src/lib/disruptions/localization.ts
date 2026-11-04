import type { Locale } from "@/lib/i18n";

export type LocalizedDisruptionDetails = {
  en: string;
  "zh-HK": string;
  "ja-JP": string;
};

const detailLocales = ["en", "zh-HK", "ja-JP"] as const;

/** Translation failure must not suppress the original sourced warning. */
export function parseLocalizedDisruptionDetails(value: unknown): LocalizedDisruptionDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== detailLocales.length) return null;
  for (const locale of detailLocales) {
    if (!Object.prototype.hasOwnProperty.call(record, locale)) return null;
    const detail = record[locale];
    if (typeof detail !== "string" || !detail.trim() || detail.length > 800) return null;
  }
  return {
    en: (record.en as string).trim(),
    "zh-HK": (record["zh-HK"] as string).trim(),
    "ja-JP": (record["ja-JP"] as string).trim(),
  };
}

export function disruptionDetailLocale(locale: Locale): keyof LocalizedDisruptionDetails {
  return locale === "zh-HK-lihkg" ? "zh-HK" : locale;
}

export function selectLocalizedDisruptionDetail(value: unknown, locale: Locale): string | null {
  return parseLocalizedDisruptionDetails(value)?.[disruptionDetailLocale(locale)] ?? null;
}
