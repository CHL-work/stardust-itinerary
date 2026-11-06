import type { Locale } from "@/lib/i18n";

/** The accessible name of the "?" info button (JOB-073). */
export function infoTipLabel(locale: Locale): string {
  return locale === "ja-JP" ? "詳しく" : locale === "zh-HK" || locale === "zh-HK-lihkg" ? "了解更多" : "More info";
}
