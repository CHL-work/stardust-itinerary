import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AiConversationList, AiConversationPage, AiConversationTranscript } from "@/components/ai-conversation-page";
import type { AiConversationMessage, AiConversationSummary } from "@/lib/ai/conversation-history-types";
import { aiHistoryMessages } from "@/lib/ai/history-i18n";
import { aiImageMessages } from "@/lib/ai/image-i18n";
import { locales } from "@/lib/i18n";

const conversation: AiConversationSummary = {
  conversationId: "synthetic-conversation", title: "A museum and garden day", createdAt: "2030-04-01T00:00:00Z",
  lastUsedAt: "2030-04-01T01:30:00Z", closedAt: null, isActive: true, canResume: false,
};
const turn: AiConversationMessage = {
  requestId: "synthetic-request", clientRequestId: null, conversationId: conversation.conversationId,
  prompt: "Plan a museum visit.\nThen find a garden.", model: "gpt-6.1-sol", status: "succeeded",
  createdAt: "2030-04-01T01:30:00Z", completedAt: "2030-04-01T01:31:00Z", errorCode: null,
  message: "A museum and garden suggestion.", result: null,
};

describe("private AI conversation transcript", () => {
  it.each(locales)("shows private saved pictures with %s labels without public image optimization", (locale) => {
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, {
      turns: [{ ...turn, images: [{ id: "synthetic-image", width: 400, height: 300 }] }],
      tripId: "synthetic-trip", locale, timeZone: "Asia/Tokyo", messages: aiHistoryMessages(locale),
    }));
    expect(markup).toContain('src="/api/trips/synthetic-trip/ai/images/synthetic-image"');
    expect(markup).toContain('loading="lazy"'); expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain(aiImageMessages(locale).saved);
    expect(markup).not.toContain("/_next/image"); expect(markup).not.toContain("data:image");
  });
  it.each(locales)("renders both sides of the saved conversation with %s labels", (locale) => {
    const copy = aiHistoryMessages(locale);
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, { turns: [turn], locale, timeZone: "Asia/Tokyo", messages: copy }));
    expect(markup).toContain(copy.you);
    expect(markup).toContain(copy.assistant);
    expect(markup).toContain(copy.modelLabel);
    expect(markup).toContain(turn.prompt);
    expect(markup).toContain(turn.message);
    expect(markup).toContain('dateTime="2030-04-01T01:30:00Z"');
    expect(markup).toContain("gpt-6.1-sol");
  });

  it.each(locales)("uses %s progress and terminal feedback without raw failure details", (locale) => {
    const copy = aiHistoryMessages(locale);
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, {
      turns: [
        { ...turn, requestId: "running", status: "running", message: "Hidden unfinished provider output" },
        { ...turn, requestId: "failed", status: "failed", message: "Raw provider credential diagnostic", errorCode: "SensitiveDiagnostic" },
        { ...turn, requestId: "interrupted", status: "interrupted" },
      ], locale, timeZone: "Asia/Tokyo", messages: copy,
    }));
    expect(markup).toContain(copy.messageRunning);
    expect(markup).toContain(copy.messageFailed);
    expect(markup).toContain(copy.messageInterrupted);
    expect(markup).not.toContain("Hidden unfinished");
    expect(markup).not.toContain("Raw provider credential");
    expect(markup).not.toContain("SensitiveDiagnostic");
  });

  it("renders trip-local message times instead of silently using the server timezone", () => {
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, { turns: [turn], locale: "en", timeZone: "Asia/Tokyo", messages: aiHistoryMessages("en") }));
    expect(markup).toContain("10:30");
    expect(markup).not.toContain(">1:30");
  });

  it("escapes historical prompts and answers instead of interpreting them as HTML", () => {
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, {
      turns: [{ ...turn, prompt: '<img src=x onerror="alert(1)">', message: "<script>bad()</script>" }], locale: "en", timeZone: "Asia/Tokyo", messages: aiHistoryMessages("en"),
    }));
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
  });

  it("keeps message order and does not make browser requests while rendering old history", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const markup = renderToStaticMarkup(createElement(AiConversationTranscript, {
        turns: [{ ...turn, requestId: "one", prompt: "First prompt" }, { ...turn, requestId: "two", prompt: "Second prompt" }], locale: "en", timeZone: "Asia/Tokyo", messages: aiHistoryMessages("en"),
      }));
      expect(markup.indexOf("First prompt")).toBeLessThan(markup.indexOf("Second prompt"));
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("renders only valid public links and rejects malformed or credential-bearing sources", () => {
    const withSources = {
      ...turn,
      result: { message: "Saved researched answer", webSearch: { sources: ["javascript:alert(1)", "https://example.org/museum", "http://", "https://name:password@example.org/private"] } } as AiConversationMessage["result"],
    };
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, { turns: [withSources], locale: "en", timeZone: "Asia/Tokyo", messages: aiHistoryMessages("en") }));
    expect(markup).toContain('href="https://example.org/museum"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("password");
  });
});

describe("private conversation navigation", () => {
  it.each(locales)("labels current and old conversations in %s with independent selection", (locale) => {
    const copy = aiHistoryMessages(locale);
    const select = vi.fn();
    const markup = renderToStaticMarkup(createElement(AiConversationList, {
      conversations: [conversation, { ...conversation, conversationId: "old", title: "Earlier museum chat", isActive: false, canResume: true, closedAt: "2030-04-02T00:00:00Z" }],
      selectedId: "old", locale, timeZone: "Asia/Tokyo", messages: copy, select,
    }));
    expect(markup).toContain(copy.currentConversation);
    expect(markup).toContain(copy.archivedConversation);
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("Earlier museum chat");
    expect(select).not.toHaveBeenCalled();
    expect(markup).not.toContain("disabled");
  });

  it("escapes the private conversation title and falls back for a blank one", () => {
    const copy = aiHistoryMessages("en");
    const markup = renderToStaticMarkup(createElement(AiConversationList, {
      conversations: [{ ...conversation, title: "<script>title()</script>" }, { ...conversation, conversationId: "blank", title: "" }],
      selectedId: null, locale: "en", timeZone: "Asia/Tokyo", messages: copy, select: vi.fn(),
    }));
    expect(markup).toContain("&lt;script&gt;title()");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain(copy.newConversation);
  });

  it.each(locales)("offers a private scrollable AI page in %s without firing actions on render", (locale) => {
    const copy = aiHistoryMessages(locale);
    const request = vi.fn() as ComponentProps<typeof AiConversationPage>["request"];
    const newConversation = vi.fn().mockResolvedValue(undefined);
    const resumeConversation = vi.fn().mockResolvedValue(undefined);
    const composer = vi.fn();
    const markup = renderToStaticMarkup(createElement(AiConversationPage, {
      tripId: "synthetic-trip", locale, timeZone: "Asia/Tokyo", messages: copy,
      recovery: { phase: "running", request: null, result: null, error: null },
      request, newConversation, resumeConversation, renderComposer: composer,
    }));
    expect(markup).toContain(copy.privateNotice);
    expect(markup).toContain(copy.busyNotice);
    expect(markup).toContain(copy.title);
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('class="ai-history-transcript"');
    expect(markup).toContain("disabled");
    expect(request).not.toHaveBeenCalled();
    expect(newConversation).not.toHaveBeenCalled();
    expect(resumeConversation).not.toHaveBeenCalled();
    expect(composer).not.toHaveBeenCalled();
  });

  it("wires private GET-only loading, explicit continuation, no browser storage and responsive scrolling", () => {
    const source = readFileSync(new URL("./ai-conversation-page.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./ai-conversation-page.css", import.meta.url), "utf8");
    expect(source).toContain('cache: "no-store", signal: abort.signal');
    expect(source).toContain("15_000");
    expect(source).toContain("client.dispose()");
    expect(source).toContain("props.resumeConversation(id)");
    expect(source).toContain("history.conversation.canResume");
    expect(source).toContain("!history.accessDenied");
    expect(source).toContain('className="ai-history-composer" disabled={actionBusy || history.messageLoading}');
    expect(source).toContain("anchor.top + node.scrollHeight - anchor.height");
    expect(source).toContain("nearBottom.current");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|method:\s*["']POST/u);
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("white-space: pre-wrap");
    expect(css).toContain("background: var(--panel-raised");
    expect(css).toContain("color: var(--ink");
    expect(css).not.toContain("#eee7fa");
  });
});
