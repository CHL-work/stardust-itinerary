import { describe, expect, it } from "vitest";

import { summarizeAiUsage, usageService } from "@/lib/ai/usage-summary";

const now = new Date("2026-11-08T10:00:00Z");
const row = (overrides: Partial<Parameters<typeof summarizeAiUsage>[0][number]> = {}) => ({
  day: "2026-11-08", feature: "planning", model: "gpt-6.1-sol", provider: "openai", payer: "mine" as const,
  requests: 1, input_tokens: "1000", output_tokens: "500", cached_input_tokens: "0", web_searches: "0", ...overrides,
});

describe("AI tab usage summary (JOB-093)", () => {
  it("maps request features to the tab's four services", () => {
    expect(["planning", "off_topic", "policy_denial"].map(usageService)).toEqual(["chat", "chat", "chat"]);
    expect(["flight_status", "disruption_monitor"].map(usageService)).toEqual(["routine", "routine"]);
    expect(usageService("trip_destination_defaults")).toBe("tripSetup");
    expect(usageService("calendar_location")).toBe("other");
  });

  it("always returns 30 UTC days ending today, with tokens per service", () => {
    const summary = summarizeAiUsage([row(), row({ day: "2026-10-10", feature: "flight_status" }), row({ day: "2026-10-01" })], now);
    expect(summary.days).toHaveLength(30);
    expect(summary.since).toBe("2026-10-10");
    expect(summary.days.at(-1)).toEqual({ date: "2026-11-08", tokens: { chat: 1500, routine: 0, tripSetup: 0, other: 0 } });
    expect(summary.days[0].tokens.routine).toBe(1500);
    // A row outside the window still counts in the totals the query returned, but draws no bar.
    expect(summary.total.requests).toBe(3);
  });

  it("estimates cost only for requests the account's own key paid for", () => {
    const summary = summarizeAiUsage([
      row({ payer: "mine", web_searches: "2" }),
      row({ payer: "free", model: "guest-free", provider: "kilo" }),
      row({ payer: "others", model: "gpt-6-astra" }),
    ], now);
    const mine = 1000 * 2 / 1e6 + 500 * 10 / 1e6 + 2 * 10 / 1000;
    expect(summary.total.costUsd).toBeCloseTo(mine, 6);
    expect(summary.total.webSearches).toBe(2);
    expect(summary.models.find((model) => model.payer === "free")?.costUsd).toBeNull();
    expect(summary.models.find((model) => model.payer === "others")?.costUsd).toBeNull();
    expect(summary.services.find((service) => service.service === "chat")?.tokens).toBe(4500);
  });

  it("adds Anthropic cache reads to the token count and sorts models by tokens", () => {
    const summary = summarizeAiUsage([
      row({ model: "claude-haiku-5-5", provider: "anthropic", input_tokens: "100", output_tokens: "100", cached_input_tokens: "5000" }),
      row({ model: "gemini-3.8-flash", provider: "google", input_tokens: "1000", output_tokens: "0", cached_input_tokens: "900" }),
    ], now);
    expect(summary.models.map((model) => [model.model, model.tokens])).toEqual([["claude-haiku-5-5", 5200], ["gemini-3.8-flash", 1000]]);
  });
});
