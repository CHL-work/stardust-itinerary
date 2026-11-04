import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ownerModelRegistry, type OwnerModel } from "../src/lib/app/types";
import { aiProviderFailureDetails } from "../src/lib/ai/provider-failure";
import { withOperatorAiCredential } from "../src/lib/ai/credential-context";
import { runPublicResearch, type PublicResearchInput, type PublicResearchResult } from "../src/lib/ai/public-research-provider";
import { assessPublicResearch, isBoundPublicResearchQuery, PUBLIC_RESEARCH_BUDGET_MS, type PublicResearchTarget } from "../src/lib/ai/public-research";

// Explicit opt-in, one fixed public tariff target and one supported-SDK call.
// This does not load environment files, app conversations or a database, make
// bookings, create expenses, or assert that a published estimate is money owed.
export const PUBLIC_PRICE_SUBJECT = "Tokyo National Museum";
export const PRICE_WORKSPACE_PREFIX = "stardust-service-prices-eval-";
export type PriceEvalOptions = { runLive: true; model: OwnerModel };
type EvalCode = "AI_PRICE_EVAL_ARGUMENTS" | "AI_PRICE_EVAL_WORKSPACE" | "AI_PRICE_EVAL_TIMEOUT"
  | "AI_PRICE_EVAL_FAILED" | "AI_PRICE_EVAL_UNVERIFIED";
class PriceEvalFailure extends Error {
  constructor(readonly code: EvalCode) { super(code); this.name = "PriceEvalFailure"; }
}
export type PriceEvalReport = {
  model: OwnerModel; researchStatus: "passed" | "failed";
  classification: "published_estimate" | "unverified" | "not_assessed";
  researchCalls: number; searchCount: number; boundSearchCount: number; quoteCount: number;
  sourceDomains: string[]; cleanupFailed: boolean; providerCleanupFailed: boolean; code?: string;
};
type Dependencies = {
  research: (input: PublicResearchInput) => Promise<PublicResearchResult>;
  createWorkspace: () => Promise<string>; removeWorkspace: (directory: string) => Promise<void>;
  now: () => Date;
};
const defaults: Dependencies = {
  // A live operator check: the operator's keys, entered explicitly.
  research: (input: PublicResearchInput) => withOperatorAiCredential(() => runPublicResearch(input)),
  createWorkspace: () => mkdtemp(join(tmpdir(), PRICE_WORKSPACE_PREFIX)),
  removeWorkspace: async (directory) => { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  now: () => new Date(),
};

export function parsePriceEvalOptions(raw: readonly string[]): PriceEvalOptions {
  const args = raw.filter((argument) => argument !== "--");
  const models = args.filter((argument) => argument.startsWith("--model="));
  const model = models[0]?.slice(8);
  if (args.length !== 2 || args.filter((argument) => argument === "--run-live").length !== 1
    || models.length !== 1 || !model || !Object.hasOwn(ownerModelRegistry, model)) {
    throw new PriceEvalFailure("AI_PRICE_EVAL_ARGUMENTS");
  }
  return { runLive: true, model: model as OwnerModel };
}

/** Check the resolved exact temporary target before use and recursive cleanup. */
export function validatePriceWorkspace(directory: string): string {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !/^stardust-service-prices-eval-[A-Za-z0-9]+$/u.test(basename(target))) {
    throw new PriceEvalFailure("AI_PRICE_EVAL_WORKSPACE");
  }
  return target;
}

export function publicPriceTarget(): PublicResearchTarget {
  return { key: "R1", kind: "price", subject: PUBLIC_PRICE_SUBJECT, date: null };
}

/** Reuse the production evidence validator; prose, a URL or a price number alone cannot pass. */
export function assessPriceResult(result: PublicResearchResult, asOfDate?: string) {
  const target = publicPriceTarget();
  const searches = result.webSearchQueries.filter((query) => isBoundPublicResearchQuery(query, [target]));
  const fact = assessPublicResearch([target], result.facts, searches.length > 0,
    new Set(searches.length ? [target.key] : []), asOfDate)[0]!;
  const quotes = fact.status === "verified" ? fact.priceQuotes ?? [] : [];
  const sourceDomains = [...new Set(quotes.map((quote) => new URL(quote.source).hostname))].slice(0, 5);
  return {
    classification: quotes.length > 0 && sourceDomains.length > 0 ? "published_estimate" as const : "unverified" as const,
    searchCount: result.webSearchQueries.length, boundSearchCount: searches.length, quoteCount: quotes.length, sourceDomains,
  };
}

export async function runPriceEvaluation(options: PriceEvalOptions, overrides: Partial<Dependencies> = {}): Promise<PriceEvalReport> {
  // Programmatic use cannot bypass opt-in/model validation or supply private lookup data.
  if (options.runLive !== true) throw new PriceEvalFailure("AI_PRICE_EVAL_ARGUMENTS");
  parsePriceEvalOptions(["--run-live", `--model=${options.model}`]);
  const dependency = { ...defaults, ...overrides };
  const report: PriceEvalReport = { model: options.model, researchStatus: "failed", classification: "not_assessed",
    researchCalls: 0, searchCount: 0, boundSearchCount: 0, quoteCount: 0, sourceDomains: [],
    cleanupFailed: false, providerCleanupFailed: false };
  const controller = new AbortController();
  let directory: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    directory = await dependency.createWorkspace();
    const workDirectory = validatePriceWorkspace(directory);
    const nowUtc = dependency.now().toISOString();
    report.researchCalls = 1;
    const result = await Promise.race([
      dependency.research({ model: options.model, targets: [publicPriceTarget()], workDirectory, abortController: controller, nowUtc }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new PriceEvalFailure("AI_PRICE_EVAL_TIMEOUT"));
      }, PUBLIC_RESEARCH_BUDGET_MS); }),
    ]);
    Object.assign(report, assessPriceResult(result, nowUtc.slice(0, 10)));
    report.providerCleanupFailed = result.cleanupFailed === true;
    if (report.classification !== "published_estimate") throw new PriceEvalFailure("AI_PRICE_EVAL_UNVERIFIED");
    report.researchStatus = "passed";
  } catch (error) {
    report.code = error instanceof PriceEvalFailure ? error.code
      : aiProviderFailureDetails(error)?.code ?? "AI_PRICE_EVAL_FAILED";
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    if (directory) {
      try { await dependency.removeWorkspace(validatePriceWorkspace(directory)); }
      catch { report.cleanupFailed = true; }
    }
  }
  return report;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const report = await runPriceEvaluation(parsePriceEvalOptions(args));
    console.log(JSON.stringify(report));
    if (report.researchStatus !== "passed" || report.cleanupFailed || report.providerCleanupFailed) process.exitCode = 1;
  } catch {
    process.exitCode = 1;
    console.error(JSON.stringify({ researchStatus: "not_started", code: "AI_PRICE_EVAL_ARGUMENTS" }));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
