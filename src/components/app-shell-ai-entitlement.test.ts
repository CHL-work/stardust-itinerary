import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiCard } from "@/components/app-shell";
import { aiKeysMessages } from "@/lib/ai/keys-i18n";
import { ownKeyModels } from "@/lib/ai/own-key-model";
import { formatMessage, messages, locales, type Locale } from "@/lib/i18n";

type Overview = ComponentProps<typeof AiCard>["overview"];
function render(ai: Partial<Overview["ai"]>, isOwner: boolean, locale: Locale = "en") {
  const overview = { session: { isOwner }, ai: { enabled: true, ownerDefaultModel: "gpt-6.1-sol", effectiveModel: "gpt-6.1-sol", memberDailyLimit: 20, usedToday: 2, remainingToday: 18, ...ai } } as Overview;
  return renderToStaticMarkup(createElement(AiCard, { overview, locale, messages: messages[locale], prompt: "", setPrompt: vi.fn(), reply: null, sources: [], memory: null, busy: false, thinking: false, selectedModel: "gpt-6.1-sol", setModel: vi.fn(), submit: vi.fn(),
    imagePicker: { locale, images: [], preparing: false, error: null, add: vi.fn(), remove: vi.fn() },
  }));
}

describe("paid model choices require the current user's own matching API key", () => {
  it.each([
    {}, { canSelectModel: false }, { canSelectModel: true, hostSubscriptionEnabled: true, operatorOwnAi: true },
    { sharedKey: { sponsorName: "Synthetic owner", model: "claude-sonnet-5-5" } },
  ])("never reveals paid choices through ownership, shared funding or operator capability: %j", (ai) => {
    for (const owner of [true, false]) {
      const html = render(ai, owner);
      expect(html).not.toContain("model-select");
      expect(html).not.toContain("claude-sonnet-5-5");
      expect(html).not.toContain("gpt-6.1-sol");
      expect(html).toContain(aiKeysMessages("en").keyRequired.replaceAll("'", "&#x27;"));
    }
  });

  it.each(locales)("explains missing personal keys in %s without exposing shared models", (locale) => {
    const html = render({ enabled: false, canSelectModel: false, keyRequired: true }, true, locale);
    expect(html).toContain(aiKeysMessages(locale).keyRequired.replaceAll("'", "&#x27;"));
    expect(html).not.toContain("model-select");
    expect(html).toContain('disabled=""');
  });

  it("honors AI disabled state even with a personal key", () => {
    const html = render({ enabled: false, canSelectModel: true, keyRequired: false, ownKeyProviders: ["openai"] }, false);
    expect(html).toContain(messages.en.aiUnavailable);
    expect(html).not.toContain("model-select");
  });

  it.each(["anthropic", "openai", "google"] as const)("reveals only models for the user's %s key", (provider) => {
    const html = render({ canSelectModel: true, hostSubscriptionEnabled: true, ownKeyProviders: [provider], sharedKey: { sponsorName: "Sponsor", model: "claude-sonnet-5-5" } }, false);
    const copy = aiKeysMessages("en");
    expect(html).toContain("model-select");
    for (const model of ownKeyModels([provider])) expect(html).toContain(formatMessage(copy.ownModelOption, { model }));
    for (const other of ["anthropic", "openai", "google"] as const) {
      if (other !== provider) for (const model of ownKeyModels([other])) expect(html).not.toContain(`value="${model}"`);
    }
    expect(html).not.toContain("Sponsor");
    expect(html).toContain(copy.ownKeyAccess.replaceAll("'", "&#x27;"));
  });

  it("preserves owner-only shared-key administration without exposing secrets", () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const actions = source.slice(source.indexOf('{overview.session.isOwner ? <div className="member-actions">'), source.indexOf("{canInvite && memberClaimLinks[member.id]"));
    expect(actions).toContain("member.id !== overview.session.memberId ? <button");
    expect(actions).toContain("updateAiKeyGrant(member.id, !member.aiKeyGrant)");
    const grant = source.slice(source.indexOf("const updateAiKeyGrant ="), source.indexOf("const updateSharedModel ="));
    expect(grant).toContain("JSON.stringify({ shared })");
    expect(grant).not.toMatch(/apiKey|secret/iu);
  });

  it("keeps composer choice separate from trip settings and filters both settings pickers", () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const submit = source.slice(source.indexOf("const askAi ="), source.indexOf("const switchAiConversation ="));
    expect(submit).toContain("aiRequestModelChoice(overview.ai, selectedModel, ownKeyChoice, freeModels.catalog)");
    expect(submit).not.toContain("session.isOwner");
    const model = source.slice(source.indexOf("const updateModel ="), source.indexOf("const saveTripSettings ="));
    expect(model).toContain("if (!overview?.ai.canSelectModel) return");
    expect(source).toContain("overview.ai.canSelectModel && ownKeysToShare");
    expect(source).not.toContain("selectableOwnerModels.map");
    expect(source).not.toContain("new Set([...ownKeyModels");
  });
});
