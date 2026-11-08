import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiRoutineView, ChatEffortSelect, preferencesNotice, type AiPreferencesState } from "@/components/ai-routine-section";
import type { AiPreferences } from "@/lib/ai/preferences-types";

const preferences = (overrides: Partial<AiPreferences> = {}, routine: Partial<AiPreferences["routine"]> = {}): AiPreferences => ({
  chatEffort: null, providers: ["anthropic"], revision: 2,
  routine: { enabled: false, model: null, effort: "medium", active: false, lastCheckAt: null, checksToday: 0, ...routine },
  ...overrides,
});
const state = (value: AiPreferences | null, extra: Partial<AiPreferencesState> = {}): AiPreferencesState =>
  ({ phase: "ready", preferences: value, saving: false, checking: false, notice: null, ...extra });
const render = (value: AiPreferencesState) => renderToStaticMarkup(createElement(AiRoutineView,
  { locale: "en", timeZone: "Asia/Tokyo", state: value, save: () => undefined }));

describe("AI tab routine checks (JOB-094)", () => {
  it("needs a saved key before it can turn on", () => {
    const html = render(state(preferences({ providers: [] })));
    expect(html).toContain("Add an API key that can search the web to use routine checks.");
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""/u);
    expect(html).not.toContain("<select");
  });

  it("offers only models of saved providers, defaulting to the provider's low-cost routine model", () => {
    const html = render(state(preferences({ providers: ["anthropic", "google"] })));
    expect(html).toContain('<option value="claude-haiku-5-5" selected="">claude-haiku-5-5</option>');
    expect(html).toContain("gemini-3.8-flash");
    expect(html).not.toContain("gpt-6.1-sol");
    expect(html).toContain('<option value="medium" selected="">Medium</option>');
    // What the checks do sits behind the section's single "?".
    expect(html.match(/popovertarget|popoverTarget/giu)?.length).toBe(1);
    expect(html).toContain("flights 24 and 12 hours before departure");
  });

  it("shows when checks last ran, a replaced key, and a running search check", () => {
    const on = preferences({}, { enabled: true, active: true, model: "claude-haiku-5-5", lastCheckAt: "2026-11-08T01:05:00Z", checksToday: 3 });
    expect(render(state(on))).toMatch(/On · last check 10:05\sAM · 3 today/u);
    expect(render(state({ ...on, routine: { ...on.routine, lastCheckAt: null } }))).toContain("On · no checks yet");
    expect(render(state({ ...on, routine: { ...on.routine, active: false } }))).toContain("Your key changed.");
    expect(render(state(on, { checking: true }))).toContain("Checking that this key can search the web…");
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
