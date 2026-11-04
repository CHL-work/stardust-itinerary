import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderFailureError } from "@/lib/ai/provider-failure";
import { PUBLIC_RESEARCH_BUDGET_MS } from "@/lib/ai/public-research";
import type { PublicResearchInput, PublicResearchResult } from "@/lib/ai/public-research-provider";

// Even an accidental default dependency call in these tests cannot start a provider.
const provider = vi.hoisted(() => ({ research: vi.fn() }));
vi.mock("@/lib/ai/public-research-provider", () => ({ runPublicResearch: provider.research }));

import {
  assessPriceResult, main, parsePriceEvalOptions, PRICE_WORKSPACE_PREFIX, PUBLIC_PRICE_SUBJECT,
  publicPriceTarget, runPriceEvaluation, validatePriceWorkspace, type PriceEvalOptions,
} from "../../../scripts/test-ai-service-prices";

const options: PriceEvalOptions = { runLive: true, model: "gpt-6.1-sol" };
const safeDirectory = join(tmpdir(), `${PRICE_WORKSPACE_PREFIX}a1B2c3`);
const source = "https://www.tnm.jp/synthetic-public-admission";
const quote = { service: "Synthetic general admission", durationMinutes: null, currency: "JPY", baseFeeMinor: 1234,
  priceUnit: "per_person" as const, tax: "included" as const, fees: [], conditions: "Synthetic base tariff; special exhibitions separate.",
  source, validFrom: null, validThrough: null };
const fact = { key: "R1", kind: "price" as const, subject: PUBLIC_PRICE_SUBJECT, date: null, status: "verified" as const,
  summary: "Synthetic published admission tariff; final purchase and liability are not established.", sources: [source], priceQuotes: [quote] };
function result(overrides: Partial<PublicResearchResult> = {}): PublicResearchResult {
  return { facts: [fact], inputTokens: 100, outputTokens: 50, cachedInputTokens: null,
    webSearchQueries: [`${PUBLIC_PRICE_SUBJECT} latest official admission prices`], sourceUrls: [source], ...overrides };
}
function dependencies(response: PublicResearchResult = result()) {
  return { research: vi.fn<(input: PublicResearchInput) => Promise<PublicResearchResult>>().mockResolvedValue(response),
    createWorkspace: vi.fn().mockResolvedValue(safeDirectory), removeWorkspace: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2030-04-01T00:00:00.000Z") };
}
const priorExitCode = process.exitCode;
beforeEach(() => { vi.clearAllMocks(); provider.research.mockRejectedValue(new Error("Unexpected default provider call")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); process.exitCode = priorExitCode; });

describe("database-free public service-price evaluator guards", () => {
  it.each([
    [], ["--model=gpt-6.1-sol"], ["--run-live"], ["--run-live", "--model=unknown"],
    ["--run-live", "--model=__proto__"], ["--run-live", "--model=constructor"],
    ["--run-live", "--model=gpt-6.1-sol", "--date=2030-04-02"],
    ["--run-live", "--model=gpt-6.1-sol", "--prompt=private"],
    ["--run-live", "--model=gpt-6.1-sol", "--venue=private"],
    ["--run-live", "--model=gpt-6.1-sol", "--work-directory=C:\\Code"],
    ["--run-live", "--run-live", "--model=gpt-6.1-sol"],
    ["--run-live", "--model=gpt-6.1-sol", "--model=claude-opus-5-5"],
  ].map((args) => ({ args })))("rejects missing opt-in and extra or ambiguous arguments: $args", ({ args }) => {
    expect(() => parsePriceEvalOptions(args)).toThrow("AI_PRICE_EVAL_ARGUMENTS");
    expect(provider.research).not.toHaveBeenCalled();
  });
  it("accepts a registered model while keeping subject and date code-owned", () => {
    expect(parsePriceEvalOptions(["--", "--run-live", "--model=gpt-6.1-sol"])).toEqual(options);
    expect(parsePriceEvalOptions(["--run-live", "--model=claude-opus-5-5"]).model).toBe("claude-opus-5-5");
    expect(publicPriceTarget()).toEqual({ key: "R1", kind: "price", subject: "Tokyo National Museum", date: null });
  });
  it.each([{ ...options, runLive: false }, { ...options, model: "unknown" }])("revalidates programmatic input before workspace or provider use", async (invalid) => {
    const dependency = dependencies();
    await expect(runPriceEvaluation(invalid as PriceEvalOptions, dependency)).rejects.toThrow("AI_PRICE_EVAL_ARGUMENTS");
    expect(dependency.createWorkspace).not.toHaveBeenCalled(); expect(dependency.research).not.toHaveBeenCalled();
  });
  it.each([
    resolve(tmpdir()), resolve(tmpdir(), ".."), process.cwd(), join(tmpdir(), "unrelated-a1B2c3"),
    join(tmpdir(), PRICE_WORKSPACE_PREFIX), join(tmpdir(), `${PRICE_WORKSPACE_PREFIX}a1B2c3`, "nested"),
  ])("refuses provider use and recursive cleanup outside the exact temporary target: %s", async (directory) => {
    expect(() => validatePriceWorkspace(directory)).toThrow("AI_PRICE_EVAL_WORKSPACE");
    const dependency = dependencies(); dependency.createWorkspace.mockResolvedValue(directory);
    expect(await runPriceEvaluation(options, dependency)).toMatchObject({ researchStatus: "failed", researchCalls: 0, code: "AI_PRICE_EVAL_WORKSPACE" });
    expect(dependency.research).not.toHaveBeenCalled(); expect(dependency.removeWorkspace).not.toHaveBeenCalled();
  });
  it("does not echo rejected input in command-line diagnostics", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await main(["--run-live", "--model=private@example.test", "--prompt=secret"]);
    expect(output).toHaveBeenCalledExactlyOnceWith('{"researchStatus":"not_started","code":"AI_PRICE_EVAL_ARGUMENTS"}');
    expect(process.exitCode).toBe(1); expect(provider.research).not.toHaveBeenCalled();
  });
});

describe("source-backed published estimate classification", () => {
  it("accepts only a matching structured tariff after an observed subject-bound search", () => {
    expect(assessPriceResult(result())).toEqual({ classification: "published_estimate", searchCount: 1,
      boundSearchCount: 1, quoteCount: 1, sourceDomains: ["www.tnm.jp"] });
  });
  it.each([
    { facts: [] }, { facts: [{ ...fact, priceQuotes: undefined }] }, { facts: [{ ...fact, priceQuotes: [] }] },
    { facts: [{ ...fact, status: "unverified" as const }] }, { facts: [fact, fact] },
    { facts: [{ ...fact, key: "R2" }] }, { facts: [{ ...fact, subject: "Kyoto National Museum" }] },
    { facts: [{ ...fact, kind: "venue" as const }] }, { facts: [{ ...fact, date: "2030-04-02" }] },
    { facts: [{ ...fact, sources: [] }] }, { facts: [{ ...fact, priceQuotes: [{ ...quote, source: "https://unrelated.example.test/tariff" }] }] },
    { facts: [{ ...fact, priceQuotes: [{ ...quote, source: "https://user:secret@example.test/private" }] }] },
    { facts: [{ ...fact, priceQuotes: [{ ...quote, baseFeeMinor: -1 }] }] },
    { facts: [{ ...fact, priceQuotes: [{ ...quote, baseFeeMinor: Number.MAX_SAFE_INTEGER + 1 }] }] },
    { facts: [{ ...fact, priceQuotes: [quote, quote] }] },
    { webSearchQueries: [] }, { webSearchQueries: ["another museum admission prices"] },
  ])("does not infer a price from prose, URL-only, malformed or unbound evidence: %j", (override) => {
    expect(assessPriceResult(result(override))).toMatchObject({ classification: "unverified", quoteCount: 0, sourceDomains: [] });
  });
  it("keeps unknown mandatory fees as an estimate without adding a payable total", () => {
    const feeQuote = { ...quote, fees: [{ name: "Synthetic mandatory supplement", amountMinor: null,
      requirement: "mandatory" as const, conditions: "Exact amount unavailable" }] };
    const assessed = assessPriceResult(result({ facts: [{ ...fact, priceQuotes: [feeQuote] }] }));
    expect(assessed).toEqual({ classification: "published_estimate", searchCount: 1, boundSearchCount: 1,
      quoteCount: 1, sourceDomains: ["www.tnm.jp"] });
    expect(JSON.stringify(assessed)).not.toMatch(/1234|amount|payable|total|supplement/iu);
  });
  it("uses the same research date to reject expired or not-yet-applicable tariffs", async () => {
    for (const datedQuote of [{ ...quote, validThrough: "2030-03-31" }, { ...quote, validFrom: "2030-04-02" }]) {
      const dependency = dependencies(result({ facts: [{ ...fact, priceQuotes: [datedQuote] }] }));
      expect(await runPriceEvaluation(options, dependency)).toMatchObject({ classification: "unverified", quoteCount: 0,
        code: "AI_PRICE_EVAL_UNVERIFIED", researchCalls: 1 });
      expect(dependency.research).toHaveBeenCalledOnce();
    }
    const currentQuote = { ...quote, validFrom: "2030-04-01", validThrough: "2030-04-01" };
    expect(await runPriceEvaluation(options, dependencies(result({ facts: [{ ...fact, priceQuotes: [currentQuote] }] }))))
      .toMatchObject({ classification: "published_estimate", quoteCount: 1 });
  });
  it("reports counts and domains without tariff values, service text, source paths or raw diagnostics", async () => {
    const response = result({ facts: [{ ...fact, summary: "Untrusted response with private provider diagnostics" }] });
    const report = await runPriceEvaluation(options, dependencies(response));
    expect(report).toMatchObject({ researchStatus: "passed", classification: "published_estimate", quoteCount: 1, sourceDomains: ["www.tnm.jp"] });
    expect(JSON.stringify(report)).not.toMatch(/1234|JPY|general admission|synthetic-public-admission|https:|summary|inputTokens|private|diagnostics/u);
    expect(Object.keys(report).sort()).toEqual(["model", "researchStatus", "classification", "researchCalls", "searchCount",
      "boundSearchCount", "quoteCount", "sourceDomains", "cleanupFailed", "providerCleanupFailed"].sort());
  });
});

describe("single-call price evaluator lifecycle", () => {
  it("uses a single fixed public research call and guarded cleanup, not app or database operations", async () => {
    const dependency = dependencies();
    const report = await runPriceEvaluation(options, dependency);
    expect(report).toMatchObject({ researchStatus: "passed", researchCalls: 1, classification: "published_estimate", cleanupFailed: false });
    expect(dependency.research).toHaveBeenCalledExactlyOnceWith({ model: options.model, targets: [publicPriceTarget()],
      workDirectory: resolve(safeDirectory), abortController: expect.any(AbortController), nowUtc: "2030-04-01T00:00:00.000Z" });
    expect(dependency.research.mock.calls[0]![0].abortController.signal.aborted).toBe(true);
    expect(dependency.removeWorkspace).toHaveBeenCalledExactlyOnceWith(resolve(safeDirectory));
    const script = readFileSync(resolve("scripts/test-ai-service-prices.ts"), "utf8");
    expect(script).not.toMatch(/runAiPlanner|createChangeRequest|from ["']pg["']|loadEnvConfig|DATABASE_URL|process\.env|readFile/u);
    expect(provider.research).not.toHaveBeenCalled();
  });
  it("retains a published estimate when workspace cleanup fails", async () => {
    const dependency = dependencies(); dependency.removeWorkspace.mockRejectedValue(new Error("Private cleanup path"));
    const report = await runPriceEvaluation(options, dependency);
    expect(report).toMatchObject({ researchStatus: "passed", classification: "published_estimate", cleanupFailed: true });
    expect(report.code).toBeUndefined(); expect(JSON.stringify(report)).not.toContain("Private cleanup path");
  });
  it("reports successful provider cleanup failure separately without losing the evidence", async () => {
    const dependency = dependencies(result({ cleanupFailed: true }));
    expect(await runPriceEvaluation(options, dependency)).toMatchObject({ researchStatus: "passed", classification: "published_estimate",
      providerCleanupFailed: true, cleanupFailed: false });
    expect(dependency.research).toHaveBeenCalledOnce(); expect(dependency.removeWorkspace).toHaveBeenCalledOnce();
  });
  it("classifies unknown tariff evidence honestly and does not retry or extrapolate", async () => {
    const dependency = dependencies(result({ facts: [{ ...fact, priceQuotes: [] }] }));
    expect(await runPriceEvaluation(options, dependency)).toMatchObject({ researchStatus: "failed", classification: "unverified",
      code: "AI_PRICE_EVAL_UNVERIFIED", researchCalls: 1 });
    expect(dependency.research).toHaveBeenCalledOnce(); expect(dependency.removeWorkspace).toHaveBeenCalledOnce();
  });
  it("bounds an abort-ignoring provider and preserves the timeout when cleanup also fails", async () => {
    vi.useFakeTimers();
    const dependency = dependencies(); dependency.research.mockImplementation(() => new Promise(() => undefined));
    dependency.removeWorkspace.mockRejectedValue(new Error("Private cleanup path"));
    const pending = runPriceEvaluation(options, dependency);
    await vi.advanceTimersByTimeAsync(PUBLIC_RESEARCH_BUDGET_MS);
    expect(await pending).toMatchObject({ code: "AI_PRICE_EVAL_TIMEOUT", researchStatus: "failed", cleanupFailed: true, researchCalls: 1 });
    expect(dependency.research).toHaveBeenCalledOnce(); expect(dependency.removeWorkspace).toHaveBeenCalledOnce();
    expect(dependency.research.mock.calls[0]![0].abortController.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps only safe typed provider error codes", async () => {
    const dependency = dependencies(); dependency.research.mockRejectedValue(new AiProviderFailureError({
      code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2030-04-01T01:00:00.000Z" }));
    expect(await runPriceEvaluation(options, dependency)).toMatchObject({ code: "AI_PROVIDER_RATE_LIMITED", researchCalls: 1 });
    dependency.research.mockRejectedValue(new Error("private SDK diagnostics secret@example.test"));
    const report = await runPriceEvaluation(options, dependency);
    expect(report.code).toBe("AI_PRICE_EVAL_FAILED"); expect(JSON.stringify(report)).not.toMatch(/secret|private|diagnostics/u);
  });
  it("redacts temporary workspace creation failures before a provider call", async () => {
    const dependency = dependencies(); dependency.createWorkspace.mockRejectedValue(new Error("Private machine path"));
    const report = await runPriceEvaluation(options, dependency);
    expect(report).toMatchObject({ code: "AI_PRICE_EVAL_FAILED", researchCalls: 0 });
    expect(JSON.stringify(report)).not.toContain("Private machine path");
    expect(dependency.research).not.toHaveBeenCalled(); expect(dependency.removeWorkspace).not.toHaveBeenCalled();
  });
});
