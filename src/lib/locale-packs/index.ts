import { bundledPacks } from "@/lib/locale-packs/store";

/**
 * Languages added in JOB-084 (D-096). Each has one pack of every catalog's text, keyed by section, in a JSON
 * file beside this one. Anything missing or malformed in a pack falls back to English, so a gap never blanks
 * the screen; the locale-pack tests keep every pack complete.
 *
 * Where the packs are (JOB-085, D-097): the server bundles every pack (`store.ts`). Browser code bundles none
 * (`store.browser.ts`); a page sends only its language's pack, which `LocalePackScope` installs.
 */
export const packLocales = ["zh-CN", "zh-TW", "es", "pt-BR", "fr", "de", "ru", "id"] as const;
export type PackLocale = (typeof packLocales)[number];
export type LocalePack = Record<string, unknown>;

/** Packs the browser received from the server; the server never needs this. */
const installed = new Map<PackLocale, LocalePack>();

export function isPackLocale(locale: string): locale is PackLocale {
  return (packLocales as readonly string[]).includes(locale);
}

function packFor(locale: PackLocale): LocalePack | undefined {
  return bundledPacks[locale] ?? installed.get(locale);
}

/** Adds a pack the server sent with a page. Ignores anything else, and a pack already present. */
export function installLocalePack(locale: string, pack: unknown): void {
  if (!isPackLocale(locale) || packFor(locale)) return;
  if (pack && typeof pack === "object" && !Array.isArray(pack)) installed.set(locale, pack as LocalePack);
}

/** The pack a page sends to the browser for its language, or null for the four original locales. */
export function localePack(locale: string): LocalePack | null {
  return isPackLocale(locale) ? packFor(locale) ?? null : null;
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
 * A catalog section in an added language, or the English section itself for any other locale. The caller
 * passes its English catalog, which also defines the shape. Until the browser has the pack, the English
 * section shows and nothing is cached, so the pack applies as soon as it is installed.
 */
export function packSection<T>(locale: string, section: string, english: T): T {
  if (!isPackLocale(locale)) return english;
  const pack = packFor(locale);
  if (!pack) return english;
  const key = `${locale}:${section}`;
  if (!cache.has(key)) cache.set(key, overlay(english, pack[section]));
  return cache.get(key) as T;
}

/**
 * A catalog record for every locale: the given ones, plus each added language read when it is used, so a
 * record built when a module loads still shows a pack installed afterwards.
 */
export function withPackLocales<T, B extends Record<string, T>>(base: B, section: string, english: T): B & Record<PackLocale, T> {
  const record = { ...base } as B & Record<PackLocale, T>;
  for (const locale of packLocales) {
    Object.defineProperty(record, locale, { enumerable: true, get: () => packSection(locale, section, english) });
  }
  return record;
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
export function rawPack(locale: PackLocale): LocalePack {
  return packFor(locale) ?? {};
}
