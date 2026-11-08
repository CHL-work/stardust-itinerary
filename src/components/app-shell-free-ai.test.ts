import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiCard, aiRequestModelChoice, parseFreeModelCatalog, scopedAiModelChoice, type FreeModelCatalog } from "@/components/app-shell";
import { aiKeysMessages } from "@/lib/ai/keys-i18n";
import { aiImageMessages } from "@/lib/ai/image-i18n";
import { GUEST_FREE_MODEL } from "@/lib/app/types";
import { locales, messages, type Locale } from "@/lib/i18n";

type Props = ComponentProps<typeof AiCard>;
const freeAi = { model: "dots.3 note", limit: 10, remainingToday: 8, isDefault: false };
const dots = "dots-studio/dots-3-note-preview:free";
const liquid = "liquid/lfm-3-1.7b:free";
const catalog: FreeModelCatalog = { status: "ready", models: [{ id: dots, label: "dots.3 note" }, { id: liquid, label: "Liquid LFM3" }], defaultModel: dots };
const ai: Props["overview"]["ai"] = { enabled: true, canSelectModel: false, ownerDefaultModel: "gpt-6.1-sol",
  effectiveModel: "gpt-6.1-sol", memberDailyLimit: 20, usedToday: 2, remainingToday: 18,
  hostSubscriptionEnabled: true, freeAi };
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");
function render(overrides: Partial<Props["overview"]["ai"]> = {}, props: Partial<Props> = {}, locale: Locale = "en") {
  return renderToStaticMarkup(createElement(AiCard, {
    overview: { session: { isOwner: false }, ai: { ...ai, ...overrides } } as Props["overview"],
    locale, messages: messages[locale], prompt: "Add ramen tomorrow", setPrompt: vi.fn(), reply: null,
    sources: [], memory: null, busy: false, thinking: false, selectedModel: "gpt-6.1-sol",
    setModel: vi.fn(), setOwnKeyChoice: vi.fn(), submit: vi.fn(), freeCatalog: catalog, ...props,
  }));
}

describe("free model choice for every member (JOB-086)", () => {
  it.each([
    { label: "sponsored member", settings: {} },
    { label: "operator", settings: { canSelectModel: true } },
    { label: "own key", settings: { hostSubscriptionEnabled: false, ownKeyProviders: ["anthropic"] } },
    { label: "shared key", settings: { sharedKey: { sponsorName: "Synthetic sponsor", model: "claude-sonnet-5-5" } } },
    { label: "keyless member or guest", settings: { hostSubscriptionEnabled: false, freeAi: { ...freeAi, isDefault: true } } },
  ])("offers $label one picker, with a free choice", ({ settings }) => {
    const html = render(settings);
    expect(html.match(/<select /gu)).toHaveLength(1);
    expect(html).toContain(`value="free:${dots}"`);
    expect(html).toContain(`value="free:${liquid}"`);
    expect(html).not.toContain('data-feedback-action="settings_save"');
  });

  it("never defaults to shared or operator paid models without the user's own key", () => {
    expect(aiRequestModelChoice(ai, "gpt-6.1-sol", "", catalog)).toEqual({ model: GUEST_FREE_MODEL, freeModel: dots, free: true, unavailable: false });
    expect(aiRequestModelChoice({ ...ai, canSelectModel: true }, "gpt-6-astra", "", catalog).model).toBe(GUEST_FREE_MODEL);
    expect(aiRequestModelChoice({ ...ai, ownKeyProviders: ["anthropic"] }, "gpt-6.1-sol", "claude-sonnet-5-5").model).toBe("claude-sonnet-5-5");
    expect(render()).toContain(aiKeysMessages("en").freePrivacy);
    expect(render()).not.toContain('value="gpt-6.1-sol"');
    expect(render()).not.toContain('value="claude-sonnet-5-5"');
    expect(aiRequestModelChoice(ai, "gpt-6.1-sol", "gpt-6-astra", catalog).unavailable).toBe(true);
  });

  it("sends an explicit free model for the keyless default", () => {
    const settings = { ...ai, freeAi: { ...freeAi, isDefault: true } };
    expect(aiRequestModelChoice(settings, "gpt-6.1-sol", "", catalog)).toEqual({ model: GUEST_FREE_MODEL, freeModel: dots, free: true, unavailable: false });
    const html = render(settings);
    expect(html).toContain(`<option value="free:${dots}" selected="">`);
    expect(html).not.toContain(escape(aiKeysMessages("en").keyRequired));
    expect(html).not.toContain('disabled=""');
  });

  it.each(locales)("keeps the %s privacy and text-only notes visible even with a previous reply", (locale) => {
    const html = render({}, { ownKeyChoice: GUEST_FREE_MODEL, reply: "Synthetic previous reply." }, locale);
    const copy = aiKeysMessages(locale);
    expect(html).toContain(escape(copy.freePrivacy));
    expect(html).toContain(escape(copy.freeTextOnly));
    expect(html.indexOf(escape(copy.freePrivacy))).toBeLessThan(html.indexOf('<form '));
    expect(html).toContain("Synthetic previous reply.");
    expect(html).not.toContain(escape(copy.ownKeyAccess));
  });

  it("does not change a selected free model into a paid request when free access disappears", () => {
    const settings = { ...ai, freeAi: null, canSelectModel: true, ownKeyProviders: ["openai"] };
    expect(aiRequestModelChoice(settings, "gpt-6-astra", GUEST_FREE_MODEL))
      .toEqual({ model: GUEST_FREE_MODEL, freeModel: undefined, free: true, unavailable: true });
    const html = render(settings, { ownKeyChoice: GUEST_FREE_MODEL });
    expect(html).toContain(`<option value="free:${dots}" disabled="" selected="">`);
    expect(html).toContain(escape(aiKeysMessages("en").freeUnavailable));
    expect(html).toContain(`<button disabled="" aria-label="${messages.en.sendAiPrompt}"`);
  });

  it("blocks sending an exhausted free allowance without selecting a paid fallback", () => {
    const html = render({ freeAi: { ...freeAi, remainingToday: 0 } }, { ownKeyChoice: GUEST_FREE_MODEL });
    expect(html).toContain(`<option value="free:${dots}" selected="">`);
    expect(html).toContain(`<button disabled="" aria-label="${messages.en.sendAiPrompt}"`);
  });

  it("disables picture additions but lets a person remove retained pictures before sending", () => {
    const html = render({}, { ownKeyChoice: GUEST_FREE_MODEL, imagePicker: {
      locale: "en", preparing: false, error: null, add: vi.fn(), remove: vi.fn(),
      images: [{ id: "synthetic", previewUrl: "blob:synthetic", width: 100, height: 100,
        input: { mediaType: "image/jpeg", data: "synthetic-image-not-rendered" } }],
    } });
    expect(html).toContain(escape(aiKeysMessages("en").freeRemoveImages));
    expect(html).toMatch(/<input[^>]*type="file"[^>]*disabled=""/u);
    expect(html).toContain(`<button type="button" aria-label="${aiImageMessages("en").remove} 1"`);
    expect(html).toContain(`<button disabled="" aria-label="${messages.en.sendAiPrompt}"`);
    expect(html).not.toContain("synthetic-image-not-rendered");
  });

  it("scopes free and paid choices to the current trip and member", () => {
    expect(scopedAiModelChoice({ scope: "trip-a:member-a", model: GUEST_FREE_MODEL }, "trip-b:member-a")).toBe("");
    expect(scopedAiModelChoice({ scope: "trip-a:member-a", model: "gpt-6-astra" }, "trip-a:member-b")).toBe("");
    expect(scopedAiModelChoice({ scope: "trip-a:member-a", model: GUEST_FREE_MODEL }, "trip-a:member-a")).toBe(GUEST_FREE_MODEL);
  });

  it("sends the exact chosen free ID and never silently replaces a removed model", () => {
    expect(aiRequestModelChoice(ai, "gpt-6.1-sol", `free:${liquid}`, catalog)).toEqual({ model: GUEST_FREE_MODEL, freeModel: liquid, free: true, unavailable: false });
    const changed = { ...catalog, models: [catalog.models[0]] };
    expect(aiRequestModelChoice(ai, "gpt-6.1-sol", `free:${liquid}`, changed)).toEqual({ model: GUEST_FREE_MODEL, freeModel: liquid, free: true, unavailable: true });
    expect(aiRequestModelChoice(ai, "gpt-6.1-sol", `free:${liquid}`, { ...catalog, status: "error" }).unavailable).toBe(true);
  });

  it.each(locales)("shows localized catalog loading, failure and empty states in %s, with no refresh button (JOB-097)", (locale) => {
    const copy = aiKeysMessages(locale);
    for (const [status, message] of [["loading", copy.freeModelsLoading], ["error", copy.freeModelsFailed], ["ready", copy.freeModelsEmpty]] as const) {
      const html = render({}, { freeCatalog: { status, models: [], defaultModel: null } }, locale);
      expect(html).toContain(escape(message));
      expect(html).not.toContain('class="mini-button"');
      expect(html).toContain(`<button disabled="" aria-label="${messages[locale].sendAiPrompt}"`);
    }
    // A ready catalog with models needs no status line at all.
    expect(render({}, {}, locale)).not.toContain('class="free-model-status"');
  });

  it("validates the catalog response before putting identifiers into request bodies", () => {
    expect(parseFreeModelCatalog(catalog)).toEqual(catalog);
    expect(parseFreeModelCatalog({ models: [], defaultModel: dots })).toEqual({ status: "ready", models: [], defaultModel: null });
    expect(() => parseFreeModelCatalog({ models: [{ id: "https://evil.example", label: "invalid" }] })).toThrow();
    expect(() => parseFreeModelCatalog({ models: [catalog.models[0], catalog.models[0]] })).toThrow();
  });

  it("guards programmatic sends as well as disabled controls", () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const submit = source.slice(source.indexOf("const askAi ="), source.indexOf("const switchAiConversation ="));
    expect(submit).toContain("choice.unavailable || (choice.free && aiImages.images.length > 0)");
    expect(submit).toContain("...(choice.model ? { model: choice.model } : {})");
    expect(submit).toContain("...(choice.freeModel ? { freeModel: choice.freeModel } : {})");
    const settings = source.slice(source.indexOf("const updateModel ="), source.indexOf("const saveTripSettings ="));
    expect(settings).not.toContain("GUEST_FREE_MODEL");
    const card = source.slice(source.indexOf("export function AiCard("), source.indexOf("function sourceHost("));
    expect(card).toContain("setOwnKeyChoice?.(event.target.value)");
    expect(card).not.toContain("setModel(event.target.value)");
    expect(card).not.toContain("/ai/settings");
    const catalogHook = source.slice(source.indexOf("function useFreeModelCatalog("), source.indexOf("export function aiRequestModelChoice("));
    expect(catalogHook).toContain("AbortController");
    expect(catalogHook).toContain("FREE_CATALOG_CLIENT_TTL_MS");
    expect(catalogHook).toContain("cached?.scope === scope");
    expect(catalogHook).toContain("cancelled || abort.signal.aborted");
  });
});
