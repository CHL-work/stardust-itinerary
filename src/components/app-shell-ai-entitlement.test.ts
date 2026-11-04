import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiCard } from "@/components/app-shell";
import { memberManagementMessages } from "@/lib/app/member-management-i18n";
import { messages, locales, type Locale } from "@/lib/i18n";

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
  it.each(locales)("disables unsponsored public-trip AI with clear %s copy", (locale) => {
    const html = render({ enabled: false, canSelectModel: false, hostSubscriptionEnabled: false }, true, locale);
    expect(html).toContain(memberManagementMessages(locale).aiUnsponsored.replaceAll("'", "&#x27;"));
    expect(html).not.toContain("model-select"); expect(html).not.toContain(messages[locale].aiOwnerPolicy);
    expect(html).toContain('disabled=""');
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
