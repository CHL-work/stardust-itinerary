import de from "./de.json";
import es from "./es.json";
import fr from "./fr.json";
import id from "./id.json";
import ptBr from "./pt-BR.json";
import ru from "./ru.json";
import zhCn from "./zh-CN.json";
import zhTw from "./zh-TW.json";

/**
 * Languages added in JOB-084 (D-096). Each has one pack of every catalog's text, keyed by section, in
 * a JSON file beside this one. Anything missing or malformed in a pack falls back to English, so a
 * gap never blanks the screen; the locale-pack tests keep every pack complete.
 */
export const packLocales = ["zh-CN", "zh-TW", "es", "pt-BR", "fr", "de", "ru", "id"] as const;
export type PackLocale = (typeof packLocales)[number];

type Pack = Record<string, unknown>;
const packs: Record<PackLocale, Pack> = {
  "zh-CN": zhCn, "zh-TW": zhTw, es, "pt-BR": ptBr, fr, de, ru, id,
};

export function isPackLocale(locale: string): locale is PackLocale {
  return (packLocales as readonly string[]).includes(locale);
}

/** English text with the pack's translation laid over it: strings only, same shape, never a blank string. */
function overlay(english: unknown, translated: unknown): unknown {
  if (typeof english === "string") return typeof translated === "string" && translated.trim() ? translated : english;
  if (Array.isArray(english)) {
    return Array.isArray(translated) && translated.length === english.length
      ? english.map((item, index) => overlay(item, translated[index])) : english;
  }
  if (english && typeof english === "object") {
    const source = translated && typeof translated === "object" && !Array.isArray(translated) ? translated as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(english).map(([key, value]) => [key, overlay(value, source[key])]));
  }
  return english;
}

const cache = new Map<string, unknown>();

/**
 * A catalog section in an added language, or the English section itself for any other locale. The
 * caller passes its English catalog, which also defines the shape; the result is cached per section.
 */
export function packSection<T>(locale: string, section: string, english: T): T {
  if (!isPackLocale(locale)) return english;
  const key = `${locale}:${section}`;
  if (!cache.has(key)) cache.set(key, overlay(english, packs[locale][section]));
  return cache.get(key) as T;
}

/** A catalog in each of the four original locales; the spicy Cantonese mode reads the Cantonese one unless it has its own. */
export type BaseCatalogs<T> = { en: T; "zh-HK": T; "ja-JP": T; "zh-HK-lihkg"?: T };

/**
 * The catalog for a locale: one of the original four, or, for an added language, the English catalog with that
 * language's pack section laid over it.
 */
export function localizedCatalog<T>(locale: string, section: string, catalogs: BaseCatalogs<T>): T {
  if (isPackLocale(locale)) return packSection(locale, section, catalogs.en);
  if (locale === "zh-HK-lihkg") return catalogs["zh-HK-lihkg"] ?? catalogs["zh-HK"];
  if (locale === "zh-HK" || locale === "ja-JP") return catalogs[locale];
  return catalogs.en;
}

/** The raw pack, for completeness tests only. */
export function rawPack(locale: PackLocale): Pack {
  return packs[locale];
}
