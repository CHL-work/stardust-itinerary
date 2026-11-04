export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
};

export type TokenPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheWriteUsdPerMillion?: number;
  cacheReadUsdPerMillion?: number;
};

function validCount(value: number | undefined): number {
  const resolved = value ?? 0;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError("token counts must be non-negative safe integers");
  }
  return resolved;
}

export function estimateLlmCostUsd(
  usage: TokenUsage,
  pricing: TokenPricing,
): number {
  const components = [
    validCount(usage.inputTokens) * pricing.inputUsdPerMillion,
    validCount(usage.outputTokens) * pricing.outputUsdPerMillion,
    validCount(usage.cacheWriteTokens) * (pricing.cacheWriteUsdPerMillion ?? 0),
    validCount(usage.cacheReadTokens) * (pricing.cacheReadUsdPerMillion ?? 0),
  ];

  const total = components.reduce((sum, component) => sum + component, 0) / 1_000_000;
  return Math.round(total * 1_000_000_000) / 1_000_000_000;
}
