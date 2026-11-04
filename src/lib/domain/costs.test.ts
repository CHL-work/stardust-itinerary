import { describe, expect, it } from "vitest";

import { estimateLlmCostUsd } from "./costs";

describe("estimateLlmCostUsd", () => {
  it("prices input, output, and cache tokens using a versioned rate", () => {
    const cost = estimateLlmCostUsd(
      {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 2_000,
      },
      {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 5,
        cacheReadUsdPerMillion: 0.1,
      },
    );

    expect(cost).toBe(0.0037);
  });

  it("rejects negative token counts", () => {
    expect(() =>
      estimateLlmCostUsd(
        { inputTokens: -1, outputTokens: 0 },
        { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
      ),
    ).toThrow(/token counts/);
  });
});
