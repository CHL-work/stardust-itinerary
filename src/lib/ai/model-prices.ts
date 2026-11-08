import { selectableOwnerModels, type KeyedModelProvider, type SelectableOwnerModel } from "@/lib/app/types";
import { estimateLlmCostUsd } from "@/lib/domain/costs";

/**
 * Published standard prices of the registered models in USD per million tokens (JOB-093, D-105), checked
 * against the providers' pricing pages on the date below. The AI tab shows costs from these as estimates;
 * the provider's bill is final. A later window applies from its UTC date onward.
 */
export const MODEL_PRICES_CHECKED_ON = "2026-11-08";

type PriceWindow = Readonly<{ from?: string; input: number; cachedInput: number; output: number }>;
type ModelPrice = Readonly<{ provider: KeyedModelProvider; windows: readonly PriceWindow[] }>;

export const modelPrices: Readonly<Record<SelectableOwnerModel, ModelPrice>> = {
  "gpt-6.1-sol": { provider: "openai", windows: [{ input: 2, cachedInput: 0.1, output: 10 }] },
  "gpt-6-astra": { provider: "openai", windows: [{ input: 10, cachedInput: 1, output: 50 }] },
  "gpt-6.1-terra": { provider: "openai", windows: [{ input: 1, cachedInput: 0.05, output: 5 }] },
  "gpt-6-luna": { provider: "openai", windows: [{ input: 0.1, cachedInput: 0.01, output: 0.5 }] },
  // Haiku's prompts over 100,000 tokens cost more; the app's prompts stay far below that.
  "claude-haiku-5-5": { provider: "anthropic", windows: [{ input: 0.1, cachedInput: 0.01, output: 0.5 }] },
  "claude-sonnet-5-5": { provider: "anthropic", windows: [{ input: 2, cachedInput: 0.1, output: 10 }] },
  "claude-opus-5-5": { provider: "anthropic", windows: [{ input: 4, cachedInput: 0.2, output: 20 }] },
  "claude-fable-5-1": { provider: "anthropic", windows: [{ input: 10, cachedInput: 0.25, output: 50 }] },
  "gemini-4-argon": { provider: "google", windows: [
    { input: 2, cachedInput: 0.1, output: 10 },
    { from: "2026-12-01", input: 4, cachedInput: 0.2, output: 20 },
  ] },
  "gemini-3.8-flash": { provider: "google", windows: [
    { input: 0.75, cachedInput: 0.075, output: 3.75 },
    { from: "2027-01-01", input: 1.5, cachedInput: 0.15, output: 7.5 },
  ] },
  "gemini-3.5-flash-lite": { provider: "google", windows: [{ input: 0.3, cachedInput: 0.03, output: 2.5 }] },
};

/**
 * Search fees in USD per thousand: OpenAI and Anthropic bill each web search; Google bills each grounded
 * request after a monthly free allowance, which the estimate ignores.
 */
export const webSearchUsdPerThousand: Readonly<Record<KeyedModelProvider, number>> = { openai: 10, anthropic: 10, google: 14 };

export function isPricedModel(model: string): model is SelectableOwnerModel {
  return (selectableOwnerModels as readonly string[]).includes(model);
}

function priceAt(price: ModelPrice, at: Date): PriceWindow {
  const day = at.toISOString().slice(0, 10);
  let current = price.windows[0];
  for (const window of price.windows) if (!window.from || window.from <= day) current = window;
  return current;
}

function tokens(value: number | null | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export type PricedUsage = {
  model: string;
  at: Date | string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  webSearches?: number | null;
};

/** The estimated USD cost of one request, or null for a model without a published price (free models). */
export function estimateRequestUsd(usage: PricedUsage): number | null {
  if (!isPricedModel(usage.model)) return null;
  const at = usage.at instanceof Date ? usage.at : new Date(usage.at);
  if (!Number.isFinite(at.getTime())) return null;
  const price = modelPrices[usage.model];
  const window = priceAt(price, at);
  const cached = tokens(usage.cachedInputTokens);
  const input = tokens(usage.inputTokens);
  // OpenAI and Google count cached tokens inside the input count; Anthropic reports them separately.
  const uncached = price.provider === "anthropic" ? input : Math.max(0, input - cached);
  const tokenCost = estimateLlmCostUsd(
    { inputTokens: uncached, outputTokens: tokens(usage.outputTokens), cacheReadTokens: Math.min(cached, price.provider === "anthropic" ? cached : input) },
    { inputUsdPerMillion: window.input, outputUsdPerMillion: window.output, cacheReadUsdPerMillion: window.cachedInput },
  );
  const searches = tokens(usage.webSearches);
  const billedSearches = price.provider === "google" ? Math.min(searches, 1) : searches;
  return tokenCost + (billedSearches * webSearchUsdPerThousand[price.provider]) / 1000;
}
