import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { packCatalogs } from "./catalogs";
import { localizedCatalog, packLocales, packSection, rawPack } from "./index";

const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map((match) => match[1]).sort();

/** Differences between an English catalog and its translation: missing, blank, extra or placeholder changes. */
function differences(english: unknown, translated: unknown, path: string, found: string[]): void {
  if (typeof english === "string") {
    if (typeof translated !== "string" || !translated.trim()) found.push(`${path}: missing`);
    else if (placeholders(english).join() !== placeholders(translated).join()) found.push(`${path}: placeholders differ`);
    return;
  }
  if (Array.isArray(english)) {
    if (!Array.isArray(translated) || translated.length !== english.length) { found.push(`${path}: list differs`); return; }
    english.forEach((item, index) => differences(item, translated[index], `${path}[${index}]`, found));
    return;
  }
  const source = english as Record<string, unknown>;
  if (!translated || typeof translated !== "object" || Array.isArray(translated)) { found.push(`${path}: missing`); return; }
  const target = translated as Record<string, unknown>;
  for (const key of Object.keys(source)) differences(source[key], target[key], `${path}.${key}`, found);
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) found.push(`${path}.${key}: not in English`);
}

/** Every string leaf of a catalog, with its path. */
function leaves(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => leaves(item, `${path}.${key}`));
}

/** Section names the source code reads, from every `localizedCatalog` and `packSection` call. */
function sectionsReadInCode(): Set<string> {
  const found = new Set<string>();
  const visit = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) && !path.includes("locale-packs")) {
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/(?:localizedCatalog(?:<[^(]*>)?|packSection)\(\s*[\w.]+,\s*"(\w+)"/gu)) found.add(match[1]!);
      }
    }
  };
  visit(join(process.cwd(), "src"));
  return found;
}

describe("locale packs (JOB-084)", () => {
  it("lists every section the code reads, and only those", () => {
    expect([...sectionsReadInCode()].sort()).toEqual(Object.keys(packCatalogs).sort());
  });

  it.each(packLocales)("translates every %s string with the English placeholders", (locale) => {
    const pack = rawPack(locale);
    const found: string[] = [];
    for (const [section, english] of Object.entries(packCatalogs)) differences(english, pack[section], section, found);
    for (const section of Object.keys(pack)) if (!Object.hasOwn(packCatalogs, section)) found.push(`${section}: not a section`);
    expect(found).toEqual([]);
  });

  it.each(packLocales)("leaves no English sentence untranslated in %s", (locale) => {
    const pack = rawPack(locale);
    const untranslated = Object.entries(packCatalogs).flatMap(([section, english]) => {
      const translated = new Map(leaves(pack[section] ?? {}, section));
      // Product and provider names, codes and short technical labels may stay as they are; a sentence may not.
      return leaves(english, section).filter(([path, text]) => text.split(/\s+/u).length >= 4 && translated.get(path) === text).map(([path]) => path);
    });
    expect(untranslated).toEqual([]);
  });

  it.each(packLocales)("writes no count as \"(s)\" and no spicy or Cantonese text in %s", (locale) => {
    const pack = rawPack(locale);
    const texts = Object.keys(packCatalogs).flatMap((section) => leaves(pack[section] ?? {}, section).map(([, text]) => text));
    expect(texts.filter((text) => text.includes("(s)"))).toEqual([]);
    expect(texts.filter((text) => /[嘅咗喺啲冇嚟]/u.test(text))).toEqual([]);
  });

  it("lays a pack over English and falls back to English for anything missing", () => {
    const english = { title: "Trip", nested: { count: "{count} items" }, list: ["a", "b"] };
    expect(packSection("en", "unknownSection", english)).toBe(english);
    expect(packSection("es", "unknownSection", english)).toEqual(english);
    expect(localizedCatalog("zh-HK-lihkg", "x", { en: 1, "zh-HK": 2, "ja-JP": 3 })).toBe(2);
    expect(localizedCatalog("zh-HK-lihkg", "x", { en: 1, "zh-HK": 2, "ja-JP": 3, "zh-HK-lihkg": 4 })).toBe(4);
    expect(localizedCatalog("ja-JP", "x", { en: 1, "zh-HK": 2, "ja-JP": 3 })).toBe(3);
    expect(localizedCatalog("en", "x", { en: 1, "zh-HK": 2, "ja-JP": 3 })).toBe(1);
  });
});
