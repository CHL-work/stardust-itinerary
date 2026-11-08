import { describe, expect, it } from "vitest";

import { ROUTINE_CHECK_STALE_MS, routineAutoCandidate, routineAutoState, type RoutineAutoRow } from "@/lib/ai/routine-auto-check";
import type { KeyedModelProvider } from "@/lib/app/types";

const at = (minute: number) => new Date(Date.UTC(2031, 4, 1, 9, minute));
const now = at(30);
const keys = (entries: Partial<Record<KeyedModelProvider, number>>) =>
  new Map(Object.entries(entries).map(([provider, minute]) => [provider as KeyedModelProvider, at(minute!)]));
const row = (overrides: Partial<RoutineAutoRow> = {}): RoutineAutoRow => ({
  routine_enabled: false, routine_model: null, routine_verified_model: null, routine_verified_at: null, routine_opted_out: false,
  routine_check_model: null, routine_check_at: null, routine_check_result: null, ...overrides,
});
const on = (model: string, verifiedMinute: number, extra: Partial<RoutineAutoRow> = {}) => row({ routine_enabled: true, routine_model: model,
  routine_verified_model: model, routine_verified_at: at(verifiedMinute), routine_check_model: model, routine_check_at: at(verifiedMinute),
  routine_check_result: "ok", ...extra });

describe("routine checks turning on by themselves (JOB-096, D-108)", () => {
  it("starts with the saved key's provider default, newest key first", () => {
    expect(routineAutoState(null, keys({ openai: 1 }), now)).toEqual({ state: "due", model: "gpt-6-astra", reason: null });
    expect(routineAutoCandidate(null, keys({ anthropic: 1 }), now)).toBe("claude-opus-5-5");
    expect(routineAutoCandidate(null, keys({ google: 1 }), now)).toBe("gemini-4-argon");
    expect(routineAutoCandidate(null, keys({ openai: 1, anthropic: 5 }), now)).toBe("claude-opus-5-5");
    expect(routineAutoState(null, keys({}), now)).toBeNull();
  });

  it("keeps a model the member chose for the same provider", () => {
    expect(routineAutoCandidate(row({ routine_model: "claude-sonnet-5-5" }), keys({ anthropic: 1 }), now)).toBe("claude-sonnet-5-5");
    expect(routineAutoCandidate(row({ routine_model: "claude-sonnet-5-5" }), keys({ openai: 1 }), now)).toBe("gpt-6-astra");
  });

  it("never turns checks on for a member who turned them off", () => {
    expect(routineAutoState(row({ routine_opted_out: true }), keys({ openai: 20 }), now)).toBeNull();
  });

  it("shows a running check, then lets a stale one start again", () => {
    const running = row({ routine_check_model: "gpt-6-astra", routine_check_at: at(29) });
    expect(routineAutoState(running, keys({ openai: 1 }), now)).toEqual({ state: "running", model: "gpt-6-astra", reason: null });
    const later = new Date(at(29).getTime() + ROUTINE_CHECK_STALE_MS + 1000);
    expect(routineAutoState(running, keys({ openai: 1 }), later)).toEqual({ state: "due", model: "gpt-6-astra", reason: null });
  });

  it("does not retry a failed key until it is saved again", () => {
    const failed = row({ routine_check_model: "gpt-6-astra", routine_check_at: at(10), routine_check_result: "no_search" });
    expect(routineAutoState(failed, keys({ openai: 1 }), now)).toEqual({ state: "failed", model: "gpt-6-astra", reason: "no_search" });
    expect(routineAutoState(failed, keys({ openai: 20 }), now)).toEqual({ state: "due", model: "gpt-6-astra", reason: null });
    // Another provider's key that was never checked is tried when it is the newest key; an older one is not.
    expect(routineAutoState(failed, keys({ openai: 1, google: 20 }), now)).toEqual({ state: "due", model: "gemini-4-argon", reason: null });
    const googleFailed = row({ routine_check_model: "gemini-4-argon", routine_check_at: at(10), routine_check_result: "auth" });
    expect(routineAutoState(googleFailed, keys({ openai: 1, google: 5 }), now)).toEqual({ state: "failed", model: "gemini-4-argon", reason: "auth" });
  });

  it("does nothing while checks work, and checks a key saved again with the chosen model", () => {
    const working = on("claude-sonnet-5-5", 10);
    expect(routineAutoState(working, keys({ anthropic: 5, openai: 20 }), now)).toBeNull();
    expect(routineAutoState(working, keys({ anthropic: 20 }), now)).toEqual({ state: "due", model: "claude-sonnet-5-5", reason: null });
    const recheckFailed = on("claude-sonnet-5-5", 10, { routine_check_at: at(25), routine_check_result: "auth" });
    expect(routineAutoState(recheckFailed, keys({ anthropic: 20 }), now)).toEqual({ state: "failed", model: "claude-sonnet-5-5", reason: "auth" });
  });

  it("moves to the newest remaining key, once, after the key checks ran on was removed", () => {
    const removed = on("gpt-6-astra", 10);
    expect(routineAutoCandidate(removed, keys({ anthropic: 5 }), now)).toBe("claude-opus-5-5");
    const tried = { ...removed, routine_enabled: false, routine_check_model: "claude-opus-5-5", routine_check_at: at(25), routine_check_result: "provider" };
    expect(routineAutoState(tried, keys({ anthropic: 5 }), now)).toEqual({ state: "failed", model: "claude-opus-5-5", reason: "provider" });
  });
});
