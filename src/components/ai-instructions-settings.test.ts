import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiInstructionsSettings } from "@/components/ai-instructions-settings";
import { createAiInstructionsController, type AiInstructionsRequest, type AiInstructionsSnapshot } from "@/components/ai-instructions-state";
import { AiCard } from "@/components/app-shell";
import { AiConversationList, AiConversationPage, AiConversationTranscript } from "@/components/ai-conversation-page";
import { aiInstructionsMessages } from "@/lib/ai/instructions-i18n";
import { aiHistoryMessages } from "@/lib/ai/history-i18n";
import { locales, messages } from "@/lib/i18n";

const saved = { instructions: "Prefer relaxed days.", revision: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const request = vi.fn<AiInstructionsRequest>().mockResolvedValue(saved);
  const changed = vi.fn();
  const controller = createAiInstructionsController("synthetic-trip", request as AiInstructionsRequest, changed);
  return { controller, request, changed };
}
afterEach(() => vi.useRealTimers());

describe("private account AI instructions editor", () => {
  it("loads only the signed-in user's own no-store snapshot without a submitted identity", async () => {
    const { controller, request } = harness();
    await controller.load();
    expect(request).toHaveBeenCalledWith("/api/trips/synthetic-trip/ai/instructions", { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(controller.getState()).toEqual({ phase: "ready", draft: saved.instructions, saved, notice: null });
    controller.dispose();
  });
  it("does not save typing and explicitly saves the current optimistic revision", async () => {
    const { controller, request } = harness();
    await controller.load();
    controller.edit("More museums.\nAvoid early starts.");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ instructions: "More museums.\nAvoid early starts.", revision: 2 });
    await controller.save();
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ instructions: "More museums.\nAvoid early starts.", expectedRevision: 1 });
    expect(request.mock.calls[1]![1]!.method).toBe("PATCH");
    expect(controller.getState().notice).toBe("saved");
    expect(controller.getState().saved?.revision).toBe(2);
    controller.dispose();
  });
  it("clears only saved instructions with the same revision-protected API", async () => {
    const { controller, request } = harness(); await controller.load();
    request.mockResolvedValueOnce({ instructions: "", revision: 2 });
    await controller.clear();
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ instructions: "", expectedRevision: 1 });
    expect(controller.getState()).toEqual({ phase: "ready", draft: "", saved: { instructions: "", revision: 2 }, notice: "cleared" });
    controller.dispose();
  });
  it("accepts the initially empty server state", async () => {
    const { controller, request } = harness(); request.mockResolvedValueOnce({ instructions: "", revision: 1 });
    await controller.load(); expect(controller.getState().draft).toBe(""); expect(controller.getState().notice).toBeNull();
    controller.dispose();
  });
  it("blocks saving until a snapshot is loaded and caps text before the request", async () => {
    const { controller, request } = harness();
    await controller.save(); expect(request).not.toHaveBeenCalled();
    await controller.load(); controller.edit("x".repeat(8_001)); await controller.save();
    expect(request).toHaveBeenCalledTimes(1); expect(controller.getState().notice).toBe("limit");
    controller.edit("x".repeat(8_000)); request.mockResolvedValueOnce({ instructions: "x".repeat(8_000), revision: 2 });
    await controller.save(); expect(request).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("preserves unsaved text on conflict and requires an explicit reload before another write", async () => {
    const { controller, request } = harness(); await controller.load(); controller.edit("My unsaved text");
    request.mockRejectedValueOnce({ status: 409, message: "Never display raw diagnostics" });
    await controller.save(); expect(controller.getState().notice).toBe("conflict"); expect(controller.getState().draft).toBe("My unsaved text");
    controller.edit("Text still editable for copying"); await controller.save(); await controller.clear();
    expect(request).toHaveBeenCalledTimes(2); expect(controller.getState().notice).toBe("conflict");
    request.mockResolvedValueOnce({ instructions: "Updated on another device", revision: 5 }); await controller.load();
    expect(controller.getState().draft).toBe("Updated on another device"); expect(controller.getState().saved?.revision).toBe(5);
    controller.dispose();
  });
  it("retains the draft after ordinary save failure and supports retry", async () => {
    const { controller, request } = harness(); await controller.load(); controller.edit("Unsaved text");
    request.mockRejectedValueOnce(new Error("Secret provider diagnostic")); await controller.save();
    expect(controller.getState().draft).toBe("Unsaved text"); expect(controller.getState().notice).toBe("saveFailed");
    expect(JSON.stringify(controller.getState())).not.toContain("Secret");
    request.mockResolvedValueOnce({ instructions: "Unsaved text", revision: 2 }); await controller.save();
    expect(controller.getState().notice).toBe("saved"); controller.dispose();
  });
  it.each([401, 403])("clears all private text on authorization loss (%s)", async (status) => {
    const { controller, request } = harness(); await controller.load(); controller.edit("Private draft");
    request.mockRejectedValueOnce({ status }); await controller.save();
    expect(controller.getState()).toEqual({ phase: "forbidden", saved: null, draft: "", notice: "unavailable" });
    controller.edit("Cannot restore"); await controller.load(); await controller.clear();
    expect(request).toHaveBeenCalledTimes(2); expect(controller.getState().draft).toBe(""); controller.dispose();
  });
  it("shows a retryable load error without enabling a write against unknown revision", async () => {
    const { controller, request } = harness(); request.mockRejectedValueOnce(new Error("Network"));
    await controller.load(); await controller.save();
    expect(controller.getState().notice).toBe("loadFailed"); expect(request).toHaveBeenCalledTimes(1);
    await controller.load(); expect(controller.getState().phase).toBe("ready"); controller.dispose();
  });
  it.each([{ instructions: "x".repeat(8_001), revision: 1 }, { instructions: "Example", revision: 0 }, { instructions: "Example", revision: -1 }, { instructions: "Example", revision: 1.2 }])("rejects malformed server state", async (invalid) => {
    const { controller, request } = harness(); request.mockResolvedValueOnce(invalid);
    await controller.load(); expect(controller.getState().saved).toBeNull(); expect(controller.getState().notice).toBe("loadFailed"); controller.dispose();
  });
  it("disposes old identity requests without publishing private text into a later editor", async () => {
    const first = harness(); const pending = deferred<AiInstructionsSnapshot>(); first.request.mockReturnValueOnce(pending.promise);
    const loading = first.controller.load(); first.controller.dispose();
    const second = harness(); second.request.mockResolvedValueOnce({ instructions: "Different account", revision: 1 }); await second.controller.load();
    pending.resolve(saved); await loading;
    expect(first.changed).toHaveBeenCalledTimes(1); expect(first.controller.getState().draft).toBe("");
    expect(first.request.mock.calls[0]![1]!.signal?.aborted).toBe(true);
    expect(second.controller.getState().draft).toBe("Different account"); second.controller.dispose();
  });
  it("discards late save responses after leaving the editor", async () => {
    const { controller, request, changed } = harness(); await controller.load(); controller.edit("New instructions");
    const pending = deferred<AiInstructionsSnapshot>(); request.mockReturnValueOnce(pending.promise);
    const saving = controller.save(); controller.dispose(); const count = changed.mock.calls.length;
    pending.resolve({ instructions: "New instructions", revision: 2 }); await saving;
    expect(changed).toHaveBeenCalledTimes(count);
  });
  it("does not issue duplicate saves or mutate the draft during a save", async () => {
    const { controller, request } = harness(); await controller.load(); controller.edit("One update");
    const pending = deferred<AiInstructionsSnapshot>(); request.mockReturnValueOnce(pending.promise);
    const saving = controller.save(); await controller.save(); controller.edit("Late typing");
    expect(request).toHaveBeenCalledTimes(2); expect(controller.getState().draft).toBe("One update");
    pending.resolve({ instructions: "One update", revision: 2 }); await saving; controller.dispose();
  });
  it("lets only the newest read replace state", async () => {
    const { controller, request } = harness(); const first = deferred<AiInstructionsSnapshot>(); request.mockReturnValueOnce(first.promise);
    const oldRead = controller.load(); request.mockResolvedValueOnce({ instructions: "Newest", revision: 3 }); await controller.load();
    first.resolve(saved); await oldRead; expect(controller.getState().draft).toBe("Newest"); controller.dispose();
  });
  it("bounds hanging fetches with cancellation", async () => {
    vi.useFakeTimers(); const { controller, request } = harness();
    request.mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("Timeout")))));
    const loading = controller.load(); await vi.advanceTimersByTimeAsync(15_000); await loading;
    expect(controller.getState().notice).toBe("loadFailed"); controller.dispose();
  });
});

describe("localized Settings instructions and retired preference controls", () => {
  it.each(locales)("renders an accessible, bounded, private Settings editor in %s", (locale) => {
    const copy = aiInstructionsMessages(locale); const request = vi.fn();
    const html = renderToStaticMarkup(createElement(AiInstructionsSettings, { tripId: "synthetic", scope: "trip:member:user", locale, request }));
    for (const text of [copy.title, copy.description, copy.privacy, copy.label, copy.loading, copy.save, copy.clear]) expect(html).toContain(text);
    expect(html).toContain('maxLength="8000"'); expect(html).toContain('aria-describedby="ai-instructions-privacy ai-instructions-count"');
    expect(html).toContain('aria-busy="true"'); expect(html).toContain('disabled=""'); expect(request).not.toHaveBeenCalled();
  });
  it("uses neutral identical Cantonese privacy, clear, and conflict wording", () => {
    expect(aiInstructionsMessages("zh-HK-lihkg")).toEqual(aiInstructionsMessages("zh-HK"));
  });
  it.each(locales)("offers only ordinary new chats and labels legacy history archived in %s", (locale) => {
    const copy = aiInstructionsMessages(locale); const start = vi.fn(); const request = vi.fn();
    const html = renderToStaticMarkup(createElement(AiConversationPage, {
      tripId: "synthetic", locale, timeZone: "Asia/Tokyo", messages: aiHistoryMessages(locale),
      recovery: { phase: "idle", request: null, result: null, error: null }, request,
      newConversation: start, resumeConversation: vi.fn(), renderComposer: vi.fn(),
    }));
    expect(html.match(/data-feedback-action="ai_new"/g)).toHaveLength(1); expect(start).not.toHaveBeenCalled();
    const list = renderToStaticMarkup(createElement(AiConversationList, {
      conversations: [{ conversationId: "old", title: "Earlier chat", createdAt: "2030-04-01T00:00:00Z", lastUsedAt: "2030-04-01T00:00:00Z", closedAt: "2030-04-02T00:00:00Z", isActive: false, canResume: false, purpose: "preferences" }],
      selectedId: "old", locale, timeZone: "Asia/Tokyo", messages: aiHistoryMessages(locale), select: vi.fn(),
    }));
    expect(list).toContain(copy.archived);
  });
  it.each(locales)("cannot submit text or pictures into an archived preference chat in %s", (locale) => {
    const overview = { ai: { enabled: true } } as ComponentProps<typeof AiCard>["overview"];
    const html = renderToStaticMarkup(createElement(AiCard, {
      overview, messages: messages[locale], locale, readOnly: true, prompt: "", setPrompt: vi.fn(),
      reply: null, sources: [], memory: null, busy: false, thinking: false, selectedModel: "gpt-6.1-sol", setModel: vi.fn(), submit: vi.fn(),
      imagePicker: { locale, images: [], preparing: false, error: null, add: vi.fn(), remove: vi.fn() },
    }));
    expect(html).toContain(aiInstructionsMessages(locale).archivedNotice);
    expect(html).not.toContain("<form"); expect(html).not.toContain("<textarea"); expect(html).not.toContain('type="file"');
  });
  it("shows historical text without rendering removed structured preference receipts", () => {
    const turn = { requestId: "old", clientRequestId: null, conversationId: "old", prompt: "Old prompt", model: "gpt-6.1-sol", createdAt: "2030-04-01T00:00:00Z", completedAt: null, status: "succeeded" as const, message: "Old answer", errorCode: null,
      result: { message: "Old answer", webSearch: { sources: [] }, preferenceChanges: [{ id: "old-memory", action: "created", subject: "Retired receipt content" }] } };
    const html = renderToStaticMarkup(createElement(AiConversationTranscript, { turns: [turn] as unknown as ComponentProps<typeof AiConversationTranscript>["turns"], locale: "en", timeZone: "Asia/Tokyo", messages: aiHistoryMessages("en") }));
    expect(html).toContain("Old answer"); expect(html).not.toContain("Retired receipt content");
  });
  it("fences private editor lifecycle and exposes Settings to members without an owner-only gate", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    const editor = readFileSync("src/components/ai-instructions-settings.tsx", "utf8");
    const state = readFileSync("src/components/ai-instructions-state.ts", "utf8");
    const page = readFileSync("src/components/ai-conversation-page.tsx", "utf8");
    expect(shell).toContain('scope={`${overview.trip.id}:${overview.session.memberId}:${overview.session.userId ?? ""}`}');
    expect(shell).toContain('{!activityAccessLost ? <AiInstructionsSettings');
    expect(shell).toContain('confirmInstructionsLeave()');
    expect(shell).not.toMatch(/personalMemories|catalogPreferences|preferenceManagerScope|savePersonalMemory|managePreferences/u);
    expect(editor).toContain('key={props.scope}'); expect(editor).toContain('current.dispose()');
    expect(editor).toContain('window.confirm(copy.clearConfirm)'); expect(editor).toContain('window.confirm(copy.reloadConfirm)');
    expect(editor + state).not.toMatch(/localStorage|sessionStorage|indexedDB/u);
    expect(page).toContain('history.conversation.canResume && history.conversation.purpose !== "preferences"');
    expect(page).toContain('if (id && history.conversation?.purpose === "preferences") return;');
  });
});
