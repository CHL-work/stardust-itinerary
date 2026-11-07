import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

/** The accessible name of the "?" info button (JOB-073). */
export function infoTipLabel(locale: Locale): string {
  return localizedCatalog(locale, "infoTip", { en: { more: "More info" }, "zh-HK": { more: "了解更多" }, "ja-JP": { more: "詳しく" } }).more;
}
