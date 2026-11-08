import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiRoutineSection, AiRoutineView, ChatEffortSelect, preferencesNotice, type AiPreferencesState } from "@/components/ai-routine-section";
import type { AiPreferences } from "@/lib/ai/preferences-types";

const preferences = (overrides: Partial<AiPreferences> = {}, routine: Partial<AiPreferences["routine"]> = {}): AiPreferences => ({
  chatEffort: null, providers: ["anthropic"], revision: 2,
  routine: { enabled: false, model: null, effort: "medium", active: false, lastCheckAt: null, checksToday: 0, optedOut: false, autoCheck: null, ...routine },
  ...overrides,
});
const state = (value: AiPreferences | null, extra: Partial<AiPreferencesState> = {}): AiPreferencesState =>
  ({ phase: "ready", preferences: value, saving: false, checking: false, notice: null, ...extra });
const render = (value: AiPreferencesState) => renderToStaticMarkup(createElement(AiRoutineView,
  { locale: "en", timeZone: "Asia/Tokyo", state: value, save: () => undefined }));

describe("AI tab routine checks (JOB-094, JOB-096)", () => {
  it("says a saved key turns them on", () => {
    const html = render(state(preferences({ providers: [] })));
    expect(html).toContain("Routine checks turn on when you save an API key that can search the web.");
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""/u);
    expect(html).not.toContain("<select");
  });

  it("offers only models of saved providers, defaulting to the provider's routine model at medium effort", () => {
    const html = render(state(preferences({ providers: ["anthropic", "google"] })));
    expect(html).toContain('<option value="claude-opus-5-5" selected="">claude-opus-5-5</option>');
    expect(html).toContain("gemini-4-argon");
    expect(html).not.toContain("gpt-6.1-sol");
    expect(html).toContain('<option value="medium" selected="">Medium</option>');
    // What the checks do sits behind the section's single "?".
    expect(html.match(/popovertarget|popoverTarget/giu)?.length).toBe(1);
    expect(html).toContain("They turn on by themselves when you save a key that passes a web search test");
    expect(html).toContain("flights 24 and 12 hours before departure");
  });

  it("shows when checks last ran, a replaced key, and a running search check", () => {
    const on = preferences({}, { enabled: true, active: true, model: "claude-opus-5-5", lastCheckAt: "2026-11-08T01:05:00Z", checksToday: 3 });
    expect(render(state(on))).toMatch(/On · last check 10:05\sAM · 3 today/u);
    expect(render(state({ ...on, routine: { ...on.routine, lastCheckAt: null } }))).toContain("On · no checks yet");
    expect(render(state({ ...on, routine: { ...on.routine, active: false } }))).toContain("Your key changed.");
    expect(render(state(on, { checking: true }))).toContain("Checking that this key can search the web…");
  });

  it("shows the automatic check after a key is saved: running with its model, then why it failed", () => {
    const running = render(state(preferences({ providers: ["openai", "anthropic"] }, { autoCheck: { state: "running", model: "gpt-6-astra", reason: null } })));
    expect(running).toContain("Checking that this key can search the web…");
    expect(running).toContain('<option value="gpt-6-astra" selected="">gpt-6-astra</option>');
    // Ticked while it runs, and locked until it finishes.
    const toggle = (html: string) => html.match(/<input type="checkbox"[^>]*>/u)?.[0] ?? "";
    expect(toggle(running)).toContain('checked=""');
    expect(toggle(running)).toContain('disabled=""');
    const failed = render(state(preferences({}, { autoCheck: { state: "failed", model: "claude-opus-5-5", reason: "no_search" } })));
    expect(failed).toContain("can&#x27;t search the web with that model");
    expect(toggle(failed)).not.toContain('checked=""');
    expect(render(state(preferences({}, { autoCheck: { state: "failed", model: "claude-opus-5-5", reason: "auth" } })))).toContain("The provider refused this key.");
  });

  it("says Checking in the section header while a check runs", () => {
    const section = (value: AiPreferencesState) => renderToStaticMarkup(createElement(AiRoutineSection,
      { locale: "en", timeZone: "Asia/Tokyo", state: value, save: () => undefined }));
    expect(section(state(preferences({}, { autoCheck: { state: "running", model: "claude-opus-5-5", reason: null } })))).toContain("Checking…");
    expect(section(state(preferences({}, { enabled: true, active: true, model: "claude-opus-5-5" })))).toContain(">On<");
    expect(section(state(preferences()))).toContain(">Off<");
  });

  it("maps server refusals to brief notices", () => {
    expect(preferencesNotice({ code: "ROUTINE_SEARCH_UNAVAILABLE", status: 400 })).toBe("routineSearchUnavailable");
    expect(preferencesNotice({ code: "ROUTINE_KEY_REJECTED", status: 400 })).toBe("routineKeyRejected");
    expect(preferencesNotice({ code: "ROUTINE_CHECK_FAILED", status: 503 })).toBe("routineCheckFailed");
    expect(preferencesNotice({ code: "ROUTINE_CHECKS_LIMITED", status: 429 })).toBe("routineLimited");
    expect(preferencesNotice({ status: 409 })).toBe("saveConflict");
    expect(preferencesNotice(new Error("network"))).toBe("saveFailed");
    expect(render(state(preferences(), { notice: "routineSearchUnavailable" }))).toContain("can&#x27;t search the web with that model");
  });

  it("offers chat effort with each model's default first, only to accounts with a key", () => {
    const html = renderToStaticMarkup(createElement(ChatEffortSelect, { locale: "en", state: state(preferences({ chatEffort: "high" })), save: () => undefined }));
    expect(html).toContain('<option value="">Default</option>');
    expect(html).toContain('<option value="high" selected="">High</option>');
    expect(renderToStaticMarkup(createElement(ChatEffortSelect, { locale: "en", state: state(preferences({ providers: [] })), save: () => undefined }))).toBe("");
  });
});
