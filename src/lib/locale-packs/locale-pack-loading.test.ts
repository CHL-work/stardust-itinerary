import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// As in the browser: no pack is bundled, and the page installs its own (JOB-085, D-097).
vi.mock("@/lib/locale-packs/store", () => ({ bundledPacks: {} }));

import { feedbackCopy } from "@/lib/feedback/i18n";
import { getMessages, locales, menuLocales } from "@/lib/i18n";
import { installLocalePack, localePack, packLocales, packSection } from "@/lib/locale-packs";
import { bundledPacks as browserPacks } from "@/lib/locale-packs/store.browser";

const spanish = JSON.parse(readFileSync("src/lib/locale-packs/es.json", "utf8")) as Record<string, Record<string, unknown>>;

describe("loading only the selected language (JOB-085)", () => {
  it("shows English until the page installs a pack, then the pack, even in records built at load", () => {
    const english = getMessages("en");
    expect(getMessages("es").today).toBe(english.today);
    expect(feedbackCopy.es.heading).toBe(feedbackCopy.en.heading);
    expect(localePack("es")).toBeNull();

    installLocalePack("es", spanish);
    expect(getMessages("es").today).toBe(spanish.messages!.today);
    expect(feedbackCopy.es.heading).toBe(spanish.feedback!.heading);
    expect(localePack("es")).toBe(spanish);
    // Other added languages stay English until their own pack arrives.
    expect(getMessages("de").today).toBe(english.today);
  });

  it("ignores a pack for an original locale, a malformed pack and a second install", () => {
    installLocalePack("en", { messages: { today: "Altered" } });
    expect(getMessages("en").today).not.toBe("Altered");
    installLocalePack("fr", ["not", "a", "pack"]);
    installLocalePack("fr", null);
    expect(localePack("fr")).toBeNull();
    installLocalePack("ru", { messages: { today: "First" } });
    installLocalePack("ru", { messages: { today: "Second" } });
    expect(packSection("ru", "messages", { today: "Today" }).today).toBe("First");
    expect(localePack("zh-HK")).toBeNull();
  });

  it("bundles no pack into browser code", () => {
    expect(browserPacks).toEqual({});
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain('"@/lib/locale-packs/store": { browser: "./src/lib/locale-packs/store.browser.ts" }');
    for (const locale of packLocales) expect(readFileSync("src/lib/locale-packs/store.ts", "utf8")).toContain(`"./${locale}.json"`);
  });

  it("always lists English first in the language menus, then every other locale once", () => {
    expect(menuLocales[0]).toBe("en");
    expect([...menuLocales].sort()).toEqual([...locales].sort());
  });
});
