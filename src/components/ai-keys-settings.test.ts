import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiKeysView, aiKeyProviders, savedKeyLine } from "@/components/ai-keys-settings";
import { aiKeysMessages } from "@/lib/ai/keys-i18n";
import { formatMessage, locales } from "@/lib/i18n";

const saved = { provider: "anthropic" as const, hint: "KEY9", vertex: false, validatedAt: "2030-04-01T00:00:00.000Z", updatedAt: "2030-04-01T00:00:00.000Z" };
const empty = { apiKey: "", vertexProject: "" };
const render = (locale: (typeof locales)[number] = "en") => renderToStaticMarkup(createElement(AiKeysView, {
  copy: aiKeysMessages(locale), locale, keys: [saved], phase: "ready", busy: null, notice: null,
  drafts: { openai: empty, anthropic: empty, google: empty },
  edit: () => undefined, save: () => () => undefined, remove: () => () => undefined, reload: () => undefined,
}));

describe("Settings → AI keys", () => {
  it("lists every provider and shows only the last four characters of a saved key", () => {
    const html = render();
    for (const name of ["OpenAI", "Anthropic (Claude)", "Google Gemini"]) expect(html).toContain(name);
    expect(html).toContain("Key ending in KEY9");
    expect(html.match(/No key saved/gu)).toHaveLength(2);
  });

  it("uses password fields with autocomplete off and offers a Vertex AI project only for Gemini", () => {
    const html = render();
    expect(html.match(/type="password"/gu)).toHaveLength(aiKeyProviders.length);
    expect(html.match(/autoComplete="off"|autocomplete="off"/giu)?.length).toBeGreaterThanOrEqual(aiKeyProviders.length);
    expect(html.match(/ai-key-google-vertex/gu)?.length).toBeGreaterThan(0);
    expect(html).not.toContain("ai-key-openai-vertex");
    expect(html).toContain("Check and replace");
  });

  it("shows the owner how much each saved key was used, and shared use only when there is some", () => {
    const counts = (shared: number) => ({ today: 2, last30Days: 9, sharedToday: 0, sharedLast30Days: shared });
    const html = renderToStaticMarkup(createElement(AiKeysView, {
      copy: aiKeysMessages("en"), locale: "en", keys: [saved], phase: "ready", busy: null, notice: null,
      usage: { openai: counts(0), anthropic: counts(3), google: counts(0) },
      drafts: { openai: empty, anthropic: empty, google: empty },
      edit: () => undefined, save: () => () => undefined, remove: () => () => undefined, reload: () => undefined,
    }));
    const copy = aiKeysMessages("en");
    expect(html).toContain(formatMessage(copy.usageLine, { today: 2, month: 9 }));
    expect(html.match(/Your requests on this key/gu)).toHaveLength(1);
    expect(html).toContain(formatMessage(copy.sharedUsageLine, { today: 0, month: 3 }));
    expect(render()).not.toContain("Your requests on this key");
  });

  it("is complete and neutral in every locale", () => {
    const english = aiKeysMessages("en");
    for (const locale of locales) {
      const copy = aiKeysMessages(locale);
      expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
      for (const value of Object.values(copy)) expect(value.trim()).not.toBe("");
      expect(savedKeyLine(copy, locale, saved)).toContain("KEY9");
      expect(render(locale)).toContain(copy.title);
    }
  });
});
