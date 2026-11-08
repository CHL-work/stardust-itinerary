import { describe, expect, it } from "vitest";

import { estimateRequestUsd, isPricedModel, MODEL_PRICES_CHECKED_ON, modelPrices, webSearchUsdPerThousand } from "@/lib/ai/model-prices";
import { ownerModelRegistry, selectableOwnerModels } from "@/lib/app/types";

describe("published model prices (JOB-093)", () => {
  it("prices every selectable model under its registry provider, and nothing free", () => {
    expect(Object.keys(modelPrices).sort()).toEqual([...selectableOwnerModels].sort());
    for (const model of selectableOwnerModels) expect(modelPrices[model].provider).toBe(ownerModelRegistry[model].provider);
    expect(isPricedModel("guest-free")).toBe(false);
    expect(estimateRequestUsd({ model: "liquid/lfm-3-1.7b:free", at: "2026-11-08", inputTokens: 1000, outputTokens: 1000, cachedInputTokens: 0 })).toBeNull();
    expect(MODEL_PRICES_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("counts OpenAI cached tokens inside input, at the cached rate", () => {
    // gpt-6.1-sol: $2 input, $0.10 cached, $10 output per million.
    const cost = estimateRequestUsd({ model: "gpt-6.1-sol", at: "2026-11-08T00:00:00Z", inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 400_000 });
    expect(cost).toBeCloseTo(600_000 * 2 / 1e6 + 400_000 * 0.1 / 1e6 + 100_000 * 10 / 1e6, 9);
  });

  it("adds Anthropic cache reads on top of input, and charges each web search", () => {
    const cost = estimateRequestUsd({ model: "claude-sonnet-5-5", at: "2026-11-08T00:00:00Z", inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 50_000, webSearches: 3 });
    expect(cost).toBeCloseTo(10_000 * 2 / 1e6 + 50_000 * 0.1 / 1e6 + 1_000 * 10 / 1e6 + 3 * webSearchUsdPerThousand.anthropic / 1000, 9);
  });

  it("switches Gemini windows by date and charges one grounded request however many queries ran", () => {
    const usage = { model: "gemini-3.8-flash", inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0, webSearches: 4 };
    expect(estimateRequestUsd({ ...usage, at: "2026-12-31T23:00:00Z" })).toBeCloseTo(0.75 + 0.014, 9);
    expect(estimateRequestUsd({ ...usage, at: "2027-01-01T01:00:00Z" })).toBeCloseTo(1.5 + 0.014, 9);
  });

  it("treats missing or invalid token counts as zero", () => {
    expect(estimateRequestUsd({ model: "gpt-6-luna", at: new Date("2026-11-08"), inputTokens: null, outputTokens: -5, cachedInputTokens: null })).toBe(0);
    expect(estimateRequestUsd({ model: "gpt-6-luna", at: "not a date", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 })).toBeNull();
  });
});
