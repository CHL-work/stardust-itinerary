import { describe, expect, it } from "vitest";

import { estimateRequestUsd, isPricedModel, MODEL_PRICES_CHECKED_ON, modelPrices, retiredModelPrices, webSearchUsdPerThousand } from "@/lib/ai/model-prices";
import { ownerModelRegistry, retiredOwnerModelReplacements, selectableOwnerModels } from "@/lib/app/types";

describe("published model prices (JOB-093)", () => {
  it("prices every selectable model under its registry provider, and nothing free", () => {
    expect(Object.keys(modelPrices).sort()).toEqual([...selectableOwnerModels].sort());
    for (const model of selectableOwnerModels) expect(modelPrices[model].provider).toBe(ownerModelRegistry[model].provider);
    expect(isPricedModel("guest-free")).toBe(false);
    expect(estimateRequestUsd({ model: "liquid/lfm-3-1.7b:free", at: "2026-11-08", inputTokens: 1000, outputTokens: 1000, cachedInputTokens: 0 })).toBeNull();
    expect(MODEL_PRICES_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("counts OpenAI cached tokens inside input, at the cached rate", () => {
    // Standard-rate estimate below the long-context pricing threshold.
    const cost = estimateRequestUsd({ model: "gpt-6.2-sol", at: "2026-11-18T00:00:00Z", inputTokens: 100_000, outputTokens: 10_000, cachedInputTokens: 40_000 });
    expect(cost).toBeCloseTo(60_000 * 2 / 1e6 + 40_000 * 0.1 / 1e6 + 10_000 * 10 / 1e6, 9);
  });

  it("uses GPT-6.2 Astra's published prices, including cached input and search", () => {
    expect(modelPrices["gpt-6.2-astra"].windows).toEqual([{ input: 8, cachedInput: 0.4, output: 40 }]);
    const cost = estimateRequestUsd({ model: "gpt-6.2-astra", at: "2026-11-18", inputTokens: 100_000, outputTokens: 10_000, cachedInputTokens: 40_000, webSearches: 2 });
    expect(cost).toBeCloseTo(60_000 * 8 / 1e6 + 40_000 * 0.4 / 1e6 + 10_000 * 40 / 1e6 + 0.02, 9);
  });

  it("retains each retired model's own prices, not its replacement's", () => {
    expect(Object.keys(retiredModelPrices).sort()).toEqual(Object.keys(retiredOwnerModelReplacements).sort());
    const historical = [
      ["gpt-6.1-sol", 2, 0.1, 10],
      ["gpt-6-astra", 10, 1, 50],
      ["gpt-6.1-terra", 1, 0.05, 5],
      ["gpt-6-luna", 0.1, 0.01, 0.5],
    ] as const;
    for (const [model, input, cachedInput, output] of historical) {
      expect(isPricedModel(model)).toBe(true);
      expect(selectableOwnerModels).not.toContain(model);
      for (const at of ["2026-11-08", "2026-11-18"]) {
        expect(estimateRequestUsd({ model, at, inputTokens: 100_000, outputTokens: 10_000, cachedInputTokens: 40_000 }))
          .toBeCloseTo(60_000 * input / 1e6 + 40_000 * cachedInput / 1e6 + 10_000 * output / 1e6, 9);
      }
    }
  });

  it.each(["unknown", "constructor", "toString", "__proto__"])("does not price unknown or inherited object keys: %s", (model) => {
    expect(isPricedModel(model)).toBe(false);
    expect(estimateRequestUsd({ model, at: "2026-11-18", inputTokens: 1000, outputTokens: 1000, cachedInputTokens: 0 })).toBeNull();
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
