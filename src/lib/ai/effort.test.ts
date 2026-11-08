import { describe, expect, it } from "vitest";

import { aiEfforts, isAiEffort, lookupModels, modelProvider, registryEffort, ROUTINE_DEFAULT_EFFORT, routineDefaultModels } from "@/lib/ai/effort";
import { modelPrices } from "@/lib/ai/model-prices";

describe("effort and default models (JOB-094)", () => {
  it("offers three effort levels and validates them", () => {
    expect([...aiEfforts]).toEqual(["low", "medium", "high"]);
    expect(isAiEffort("medium")).toBe(true);
    expect(isAiEffort("max")).toBe(false);
    expect(ROUTINE_DEFAULT_EFFORT).toBe("medium");
  });

  it("turns routine checks on with each provider's most capable searching model (JOB-096, D-108)", () => {
    expect(routineDefaultModels).toEqual({ openai: "gpt-6-astra", anthropic: "claude-opus-5-5", google: "gemini-4-argon" });
    for (const [provider, model] of Object.entries(routineDefaultModels)) expect(modelProvider(model)).toBe(provider);
  });

  it("defaults trip setup to a registered, low-cost model of each provider", () => {
    for (const [provider, model] of Object.entries(lookupModels)) {
      expect(modelProvider(model)).toBe(provider);
      // Never the most expensive model of the provider.
      const prices = Object.values(modelPrices).filter((price) => price.provider === provider).map((price) => price.windows[0].output);
      expect(modelPrices[model].windows[0].output).toBeLessThan(Math.max(...prices));
    }
  });

  it("keeps each model's tuned registry effort as the chat default", () => {
    expect(registryEffort("gpt-6.1-sol")).toBe("low");
    expect(registryEffort("gpt-6-astra")).toBe("medium");
    expect(registryEffort("claude-sonnet-5-5")).toBe("low");
    expect(registryEffort("gemini-3.8-flash")).toBeNull();
  });
});
