import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { aiRecoveryReply, aiRequestFailureMessage, JsonRequestError } from "./app-shell";
import { AiConversationTranscript } from "./ai-conversation-page";
import { aiProviderFailureCopy, aiProviderFailureMessage } from "@/lib/ai/provider-failure-presentation";
import { parseAiProviderFailureDetails, type AiProviderFailureDetails } from "@/lib/ai/provider-failure";
import type { AiConversationMessage } from "@/lib/ai/conversation-history-types";
import { aiHistoryMessages } from "@/lib/ai/history-i18n";
import { aiImageMessages } from "@/lib/ai/image-i18n";
import { locales, messages } from "@/lib/i18n";

const failure: AiProviderFailureDetails = { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2026-09-10T01:00:00.000Z" };
const request: AiConversationMessage = { requestId: "synthetic", clientRequestId: null, conversationId: "synthetic-conversation", prompt: "Synthetic restaurant question", model: "claude-opus-4-6",
  status: "failed", createdAt: "2026-09-09T15:00:00.000Z", completedAt: "2026-09-09T15:00:10.000Z", errorCode: failure.code,
  providerFailure: failure, message: "Hidden provider diagnostic", result: null };
const idle = { phase: "idle" as const, request: null, result: null, error: null };

describe("direct, recovered and historical provider failures", () => {
  it.each(locales)("uses identical actionable %s feedback for direct and recovered terminal failures", (locale) => {
    for (const isOwner of [false, true]) {
      const options = { locale, timeZone: "Asia/Tokyo", isOwner };
      const expected = aiProviderFailureMessage(request, options);
      const direct = new JsonRequestError("Hidden upstream text", 429, failure.code, [], failure);
      expect(aiRequestFailureMessage(direct, messages[locale], aiImageMessages(locale), options)).toBe(expected);
      expect(aiRecoveryReply({ ...idle, error: direct }, messages[locale], aiImageMessages(locale), options)).toBe(expected);
      expect(aiRecoveryReply({ ...idle, request }, messages[locale], aiImageMessages(locale), options)).toBe(expected);
      expect(expected).not.toContain("Hidden");
    }
  });
  it.each(locales)("shows safe history metadata in %s and leaves older generic messages generic", (locale) => {
    const copy = aiProviderFailureCopy(locale);
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, { turns: [request, { ...request, requestId: "legacy", providerFailure: undefined, errorCode: "Error" }], locale, timeZone: "Asia/Tokyo", isOwner: true, messages: aiHistoryMessages(locale) }));
    expect(markup).toContain("Anthropic (Claude)"); expect(markup).toContain("10:00"); expect(markup).toContain("Asia/Tokyo");
    expect(markup).toContain(copy.owner); expect(markup).toContain(copy.unchanged); expect(markup).toContain(aiHistoryMessages(locale).messageFailed);
    expect(markup).not.toContain("Hidden provider diagnostic"); expect(markup).not.toContain(failure.code);
  });
  it("does not confuse an app-session 401 with a provider connection failure", () => {
    const options = { locale: "en" as const, timeZone: "Asia/Tokyo", isOwner: true };
    const auth: AiProviderFailureDetails = { code: "AI_PROVIDER_AUTH_REQUIRED", provider: "anthropic" };
    expect(aiRequestFailureMessage(new JsonRequestError("App session", 401, auth.code, [], auth), messages.en, undefined, options)).toBe(messages.en.aiSessionExpired);
    const provider = aiRequestFailureMessage(new JsonRequestError("Hidden auth diagnostic", 502, auth.code, [], auth), messages.en, undefined, options);
    expect(provider).toContain("connection renewed"); expect(provider).toContain("separate from your Google sign-in session");
    expect(provider).not.toBe(messages.en.aiSessionExpired);
  });
  it("does not replace successful answers or running progress with stale failure metadata", () => {
    const options = { locale: "en" as const, timeZone: "Asia/Tokyo", isOwner: false };
    expect(aiRecoveryReply({ ...idle, request: { ...request, status: "succeeded", message: "Saved answer" } }, messages.en, undefined, options)).toBe("Saved answer");
    const html = renderToStaticMarkup(createElement(AiConversationTranscript, { turns: [{ ...request, status: "running" }], ...options, messages: aiHistoryMessages("en") }));
    expect(html).toContain(aiHistoryMessages("en").messageRunning); expect(html).not.toContain("has reached");
  });
  it("does not resubmit, choose a model, or make requests while rendering failed history", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      const html = renderToStaticMarkup(createElement(AiConversationTranscript, { turns: [request], locale: "en", timeZone: "Asia/Tokyo", messages: aiHistoryMessages("en") }));
      expect(html).toContain(aiProviderFailureCopy("en").member); expect(html).not.toContain("<button"); expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("forwards only validated safe provider metadata from the actual HTTP error decoder", async () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const decoder = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "jsonRequest")!;
    const code = ts.transpileModule(decoder.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    let body: unknown = { error: "Hidden provider text", code: failure.code, providerFailure: failure };
    let status = 429;
    const fetch = vi.fn(async () => ({ ok: false, status, json: async () => body }));
    const feedbackTrail = { record: vi.fn() };
    const clearFeedbackContext = vi.fn();
    const decode = new Function("withStableSession", "fetch", "JsonRequestError", "parseAiProviderFailureDetails", "feedbackTrail", "clearFeedbackContext", `${code}; return jsonRequest;`)(
      (run: () => Promise<unknown>) => run(), fetch, JsonRequestError, parseAiProviderFailureDetails, feedbackTrail, clearFeedbackContext,
    ) as (url: string) => Promise<unknown>;
    await expect(decode("/synthetic-read-only")).rejects.toMatchObject({ code: failure.code, status: 429, providerFailure: failure });
    body = { code: failure.code, providerFailure: { ...failure, secret: "never display" } };
    await expect(decode("/synthetic-read-only")).rejects.toMatchObject({ providerFailure: null });
    expect(clearFeedbackContext).not.toHaveBeenCalled();
    status = 401;
    await expect(decode("/synthetic-read-only")).rejects.toMatchObject({ status: 401, providerFailure: null });
    expect(clearFeedbackContext).toHaveBeenCalledOnce();
    const offline = new Error("Synthetic network failure");
    fetch.mockRejectedValueOnce(offline);
    await expect(decode("/synthetic-read-only")).rejects.toBe(offline);
    expect(clearFeedbackContext).toHaveBeenCalledOnce();
    expect(feedbackTrail.record.mock.calls).toEqual(Array.from({ length: 4 }, () => ["request_error"]));
    expect(source).toContain('aiRecoveryReply(aiState, messages, aiImageMessages(locale), { locale, timeZone: overview?.trip.timeZone ?? "UTC", isOwner: overview?.session.isOwner ?? false })');
    expect(source).toContain('timeZone={overview.trip.timeZone} isOwner={overview.session.isOwner}');
  });
});
