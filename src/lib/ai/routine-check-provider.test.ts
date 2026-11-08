import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gemini: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateWithGemini: mocks.gemini }));
import { AiProviderFailureError } from "@/lib/ai/provider-failure";
import { createRoutineCheckProvider, routineTransport, verifyRoutineWebSearch } from "@/lib/ai/routine-check-provider";
import { DisruptionProviderInvocationError, DisruptionProviderToolError } from "@/lib/disruptions/provider";
import type { DisruptionProvider, DisruptionProviderResult } from "@/lib/disruptions/types";

const now = new Date("2026-11-08T07:30:00Z");
const result = (overrides: Partial<DisruptionProviderResult> = {}): DisruptionProviderResult => ({
  rawOutput: JSON.stringify({ date: "2026-11-08", source: "https://time.example/utc" }), effectiveModel: "claude-haiku-5-5",
  inputTokens: 300, outputTokens: 40, cachedInputTokens: 0, webSearchCount: 1, webSearchQueries: ["current UTC date and time"], ...overrides,
});
const provider = (check: DisruptionProvider["check"]): DisruptionProvider => ({ check });
const choice = { model: "claude-haiku-5-5" as const, effort: "low" as const };

describe("routine checks on a member's key (JOB-094)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the web search check only after a real search that found today's date", async () => {
    expect(await verifyRoutineWebSearch(choice, now, AbortSignal.timeout(1000), provider(async () => result()))).toEqual({ ok: true });
    expect(await verifyRoutineWebSearch(choice, now, AbortSignal.timeout(1000), provider(async () => result({ webSearchCount: 0 }))))
      .toEqual({ ok: false, reason: "no_search" });
    // A guessed date a week off means the model did not search.
    expect(await verifyRoutineWebSearch(choice, now, AbortSignal.timeout(1000),
      provider(async () => result({ rawOutput: JSON.stringify({ date: "2026-11-01", source: "https://x.example" }) }))))
      .toEqual({ ok: false, reason: "no_search" });
  });

  it("tells a refused key apart from a provider failure or a blocked tool", async () => {
    const refused = new DisruptionProviderInvocationError(new AiProviderFailureError({ code: "AI_PROVIDER_AUTH_REQUIRED", provider: "anthropic" }));
    expect(await verifyRoutineWebSearch(choice, now, AbortSignal.timeout(1000), provider(async () => { throw refused; })))
      .toEqual({ ok: false, reason: "auth" });
    expect(await verifyRoutineWebSearch(choice, now, AbortSignal.timeout(1000), provider(async () => { throw new Error("overloaded"); })))
      .toEqual({ ok: false, reason: "provider" });
    expect(await verifyRoutineWebSearch(choice, now, AbortSignal.timeout(1000), provider(async () => { throw new DisruptionProviderToolError(); })))
      .toEqual({ ok: false, reason: "no_search" });
  });

  it("runs Gemini with Google Search, the structured answer and the chosen thinking level", async () => {
    mocks.gemini.mockResolvedValue({ text: "{\"alerts\":[]}", modelVersion: null, inputTokens: 900, outputTokens: 30, cachedInputTokens: 0,
      webSearchQueries: ["Tokyo Narita delays today"], groundingDomains: [] });
    const gemini = createRoutineCheckProvider({ model: "gemini-3.8-flash", effort: "high" });
    const answer = await gemini.check({ prompt: "check", outputSchema: { type: "object" }, signal: AbortSignal.timeout(1000) });
    expect(mocks.gemini).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.8-flash", googleSearch: true, thinkingLevel: "high",
      responseJsonSchema: { type: "object" } }));
    expect(answer).toMatchObject({ effectiveModel: "gemini-3.8-flash", webSearchCount: 1, inputTokens: 900 });
  });

  it("fails closed when a grounding query names a private identifier", async () => {
    mocks.gemini.mockResolvedValue({ text: "{}", modelVersion: null, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0,
      webSearchQueries: ["booking 123456789 status"], groundingDomains: [] });
    const gemini = createRoutineCheckProvider({ model: "gemini-3.8-flash", effort: "low" });
    await expect(gemini.check({ prompt: "check", outputSchema: {}, signal: AbortSignal.timeout(1000) })).rejects.toBeInstanceOf(DisruptionProviderToolError);
  });

  it("labels each provider's transport", () => {
    expect(routineTransport("gpt-6.1-terra")).toBe("codex_sdk");
    expect(routineTransport("claude-haiku-5-5")).toBe("claude_agent_sdk");
    expect(routineTransport("gemini-3.5-flash-lite")).toBe("gemini_api");
  });
});
