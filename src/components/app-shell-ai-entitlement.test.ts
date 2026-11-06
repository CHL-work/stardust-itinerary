import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiCard } from "@/components/app-shell";
import { aiKeysMessages } from "@/lib/ai/keys-i18n";
import { ownKeyModels } from "@/lib/ai/own-key-model";
import { providerDefaultModels } from "@/lib/app/types";
import { formatMessage, messages, locales, type Locale } from "@/lib/i18n";

type Overview = ComponentProps<typeof AiCard>["overview"];
function render(ai: Partial<Overview["ai"]>, isOwner: boolean, locale: Locale = "en") {
  const overview = { session: { isOwner }, ai: { enabled: true, ownerDefaultModel: "gpt-6.1-sol", effectiveModel: "gpt-6.1-sol", memberDailyLimit: 20, usedToday: 2, remainingToday: 18, ...ai } } as Overview;
  return renderToStaticMarkup(createElement(AiCard, { overview, messages: messages[locale], prompt: "", setPrompt: vi.fn(), reply: null, sources: [], memory: null, busy: false, thinking: false, selectedModel: "gpt-6.1-sol", setModel: vi.fn(), submit: vi.fn(),
    imagePicker: { locale, images: [], preparing: false, error: null, add: vi.fn(), remove: vi.fn() },
  }));
}

describe("host AI subscription is separate from trip ownership", () => {
  it("does not grant a model selector merely because a member is a trip owner", () => {
    const html = render({ canSelectModel: false, hostSubscriptionEnabled: true }, true);
    expect(html).not.toContain("model-select"); expect(html).not.toContain(messages.en.aiOwnerPolicy);
    expect(html).toContain(messages.en.aiMemberPolicy);
  });
  it("requires the server's explicit capability even if older fixtures omit it", () => {
    expect(render({}, true)).not.toContain("model-select");
  });
  it("permits the operator's explicit capability independently of trip ownership", () => {
    const html = render({ canSelectModel: true, hostSubscriptionEnabled: true }, false);
    expect(html).toContain("model-select"); expect(html).toContain(messages.en.aiOwnerPolicy);
  });
  it.each(locales)("tells the platform operator, in %s, that their own AI reads links and adds at once (JOB-072)", (locale) => {
    const html = render({ canSelectModel: true, hostSubscriptionEnabled: true, operatorOwnAi: true }, true, locale);
    expect(html).toContain(aiKeysMessages(locale).operatorAccess.replaceAll("'", "&#x27;"));
    expect(html).not.toContain(messages[locale].aiOwnerPolicy);
    expect(html).toContain("model-select");
  });
  it.each(locales)("asks for the user's own key in an unsponsored trip with clear %s copy", (locale) => {
    const html = render({ enabled: false, canSelectModel: false, hostSubscriptionEnabled: false, keyRequired: true }, true, locale);
    expect(html).toContain(aiKeysMessages(locale).keyRequired.replaceAll("'", "&#x27;"));
    expect(html).not.toContain("model-select"); expect(html).not.toContain(messages[locale].aiOwnerPolicy);
    expect(html).toContain('disabled=""');
  });
  it("says AI is unavailable when an owner turned it off in an unsponsored trip", () => {
    const html = render({ enabled: false, canSelectModel: false, hostSubscriptionEnabled: false, keyRequired: false, ownKeyProviders: ["openai"] }, false);
    expect(html).toContain(messages.en.aiUnavailable); expect(html).not.toContain("model-select");
  });
  it("offers own-key models, with an automatic default, when every request runs on the user's key", () => {
    const html = render({ canSelectModel: false, hostSubscriptionEnabled: false, ownKeyProviders: ["anthropic", "google"] }, false);
    const copy = aiKeysMessages("en");
    expect(html).toContain("model-select");
    expect(html).toContain(formatMessage(copy.autoOption, { model: providerDefaultModels.anthropic }));
    for (const model of ownKeyModels(["anthropic", "google"])) expect(html).toContain(formatMessage(copy.ownModelOption, { model }));
    expect(html).not.toContain(formatMessage(copy.ownModelOption, { model: "gpt-6.1-sol" }));
    expect(html).not.toContain(formatMessage(messages.en.aiMemberQuota, { remaining: 18, limit: 20 }));
    expect(html).toContain(copy.ownKeyAccess.replaceAll("'", "&#x27;"));
  });
  it("keeps the free trip AI as the default choice in a sponsored trip", () => {
    const html = render({ canSelectModel: false, hostSubscriptionEnabled: true, ownKeyProviders: ["google"] }, false);
    const copy = aiKeysMessages("en");
    expect(html).toContain(`<option value="" selected="">${formatMessage(copy.sponsoredOption, { model: "gpt-6.1-sol" })}</option>`);
    expect(html).toContain(formatMessage(messages.en.aiMemberQuota, { remaining: 18, limit: 20 }));
  });
  it.each(locales)("tells a member whose shared key and model run, with the trip's limit, in %s", (locale) => {
    const html = render({ canSelectModel: false, hostSubscriptionEnabled: false, sharedKey: { sponsorName: "Synthetic owner", model: "claude-sonnet-5-5" } }, false, locale);
    const copy = aiKeysMessages(locale);
    expect(html).toContain(formatMessage(copy.sharedAccess, { owner: "Synthetic owner", model: "claude-sonnet-5-5", limit: 20 }).replaceAll("'", "&#x27;"));
    expect(html).toContain(formatMessage(messages[locale].aiMemberQuota, { remaining: 18, limit: 20 }));
    expect(html).not.toContain("model-select");
  });
  it("labels the default choice as the shared key when the member also holds a key in a sponsored trip", () => {
    const html = render({ canSelectModel: false, hostSubscriptionEnabled: true, ownKeyProviders: ["google"],
      sharedKey: { sponsorName: "Synthetic owner", model: "claude-sonnet-5-5" } }, false);
    expect(html).toContain(`<option value="" selected="">${formatMessage(aiKeysMessages("en").sharedOption, { model: "claude-sonnet-5-5", owner: "Synthetic owner" }).replaceAll("'", "&#x27;")}</option>`);
  });
  it("offers the share switch only to owners, never for themselves, and never shows a key", () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const actions = source.slice(source.indexOf('{overview.session.isOwner ? <div className="member-actions">'), source.indexOf("{canInvite && memberClaimLinks[member.id]"));
    expect(actions).toContain("member.id !== overview.session.memberId ? <button");
    expect(actions).toContain("updateAiKeyGrant(member.id, !member.aiKeyGrant)");
    const grant = source.slice(source.indexOf("const updateAiKeyGrant ="), source.indexOf("const updateSharedModel ="));
    expect(grant).toContain("JSON.stringify({ shared })");
    expect(grant).not.toMatch(/apiKey|secret/iu);
  });
  it("never offers an own-key choice through the operator's trip settings control", () => {
    const html = render({ canSelectModel: false, hostSubscriptionEnabled: false, ownKeyProviders: ["openai"] }, false);
    expect(html).not.toContain('data-feedback-action="settings_save" class="model-select"');
  });
  it("does not attach model overrides based on owner role in submitted requests", () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const submit = source.slice(source.indexOf("const askAi ="), source.indexOf("const switchAiConversation ="));
    expect(submit).toContain("overview.ai.canSelectModel === true");
    expect(submit).not.toContain("session.isOwner");
    const model = source.slice(source.indexOf("const updateModel ="), source.indexOf("const saveTripSettings ="));
    expect(model).toContain("if (!overview?.ai.canSelectModel) return");
  });
});
