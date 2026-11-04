import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ownerModelRegistry, type OwnerModel } from "../src/lib/app/types";
import { aiProviderFailureDetails } from "../src/lib/ai/provider-failure";
import { runPublicResearch, type PublicResearchInput, type PublicResearchResult } from "../src/lib/ai/public-research-provider";
import { isBoundPublicResearchQuery, PUBLIC_RESEARCH_BUDGET_MS, selectPublicResearchHoursTargets, type PublicResearchTarget } from "../src/lib/ai/public-research";
import { assessReusableVenueHours, venueHoursTargetSchema } from "../src/lib/ai/venue-hours-evidence";
import { assessVenueHours, type VenueHoursStatus } from "../src/lib/ai/venue-hours";

// Opt-in supported-SDK probe of one fixed public venue, not an app conversation.
// No environment files, database, itinerary/expense writes, booking actions or
// automatic retries. The single research call consumes normal provider quota.
export const PUBLIC_REUSE_VENUE = "THEキャラSHOP ダイバーシティ東京 プラザ";
export const REUSE_WORKSPACE_PREFIX = "stardust-hours-reuse-eval-";
export type ReuseEvalOptions = { runLive: true; model: OwnerModel; date: string };
type EvalCode = "AI_HOURS_REUSE_EVAL_ARGUMENTS" | "AI_HOURS_REUSE_EVAL_WORKSPACE" | "AI_HOURS_REUSE_EVAL_TIMEOUT"
  | "AI_HOURS_REUSE_EVAL_FAILED" | "AI_HOURS_REUSE_EVAL_UNVERIFIED";
class ReuseEvalFailure extends Error {
  constructor(readonly code: EvalCode) { super(code); this.name = "ReuseEvalFailure"; }
}
export type ReuseEvalReport = {
  model: OwnerModel; researchStatus: "passed" | "failed"; classification: VenueHoursStatus | "not_assessed";
  researchCalls: number; searchCount: number; hoursAttempted: boolean; reused: boolean;
  sourceDomains: string[]; cleanupFailed: boolean; providerCleanupFailed: boolean; code?: string;
};
type Dependencies = {
  research: (input: PublicResearchInput) => Promise<PublicResearchResult>;
  createWorkspace: () => Promise<string>; removeWorkspace: (directory: string) => Promise<void>;
  now: () => Date;
};
const defaults: Dependencies = {
  research: runPublicResearch,
  createWorkspace: () => mkdtemp(join(tmpdir(), REUSE_WORKSPACE_PREFIX)),
  removeWorkspace: async (directory) => { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  now: () => new Date(),
};

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const value = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

export function parseReuseEvalOptions(raw: readonly string[]): ReuseEvalOptions {
  const args = raw.filter((argument) => argument !== "--");
  const models = args.filter((argument) => argument.startsWith("--model="));
  const dates = args.filter((argument) => argument.startsWith("--date="));
  const model = models[0]?.slice(8), date = dates[0]?.slice(7);
  if (args.length !== 3 || args.filter((argument) => argument === "--run-live").length !== 1
    || models.length !== 1 || dates.length !== 1 || !model || !Object.hasOwn(ownerModelRegistry, model)
    || !date || !validDate(date)) throw new ReuseEvalFailure("AI_HOURS_REUSE_EVAL_ARGUMENTS");
  return { runLive: true, model: model as OwnerModel, date };
}

/** Called immediately before both provider use and recursive removal. */
export function validateReuseWorkspace(directory: string): string {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !/^stardust-hours-reuse-eval-[A-Za-z0-9]+$/u.test(basename(target))) {
    throw new ReuseEvalFailure("AI_HOURS_REUSE_EVAL_WORKSPACE");
  }
  return target;
}

export function publicReuseTarget(date: string): PublicResearchTarget {
  if (!validDate(date)) throw new ReuseEvalFailure("AI_HOURS_REUSE_EVAL_ARGUMENTS");
  return { key: "R1", kind: "venue", subject: PUBLIC_REUSE_VENUE, date };
}

/** Read only structured bound evidence; prose and URLs alone cannot pass. */
export function assessReuseResult(options: ReuseEvalOptions, result: PublicResearchResult) {
  const target = publicReuseTarget(options.date);
  const hoursTargets = selectPublicResearchHoursTargets([target], "Asia/Tokyo");
  const hoursTarget = hoursTargets[0]!;
  const searches = result.webSearchQueries.filter((query) => isBoundPublicResearchQuery(query, [target]));
  const searchedKeys = new Set(searches.length ? [hoursTarget.key] : []);
  const reusable = assessReusableVenueHours(hoursTargets, result.hoursEvidence, searchedKeys);
  const hoursAttempted = searches.length > 0 && (result.attemptedHoursTargets ?? []).some((raw) => {
    const parsed = venueHoursTargetSchema.safeParse(raw);
    return parsed.success && parsed.data.key === hoursTarget.key && parsed.data.venueName === hoursTarget.venueName
      && parsed.data.date === hoursTarget.date && parsed.data.timeZone === hoursTarget.timeZone;
  });
  const assessment = assessVenueHours([{ ...hoursTarget, proposalIndex: 0, public: true,
    startsAt: `${options.date}T15:00:00+09:00`, endsAt: `${options.date}T16:00:00+09:00` }],
  reusable.hoursEvidence, searches.length > 0, searchedKeys)[0]!;
  const sourceDomains = [...new Set(assessment.sources.map((source) => new URL(source).hostname))].slice(0, 5);
  const reused = hoursAttempted && reusable.hoursEvidence.length === 1 && assessment.status !== "unverified" && sourceDomains.length > 0;
  return { classification: assessment.status, searchCount: result.webSearchQueries.length, hoursAttempted, reused, sourceDomains };
}

export async function runReuseEvaluation(options: ReuseEvalOptions, overrides: Partial<Dependencies> = {}): Promise<ReuseEvalReport> {
  // Revalidate before creating a workspace or touching a provider, even for a
  // programmatic caller. The CLI cannot supply its own venue, prompt or path.
  if (options.runLive !== true) throw new ReuseEvalFailure("AI_HOURS_REUSE_EVAL_ARGUMENTS");
  parseReuseEvalOptions(["--run-live", `--model=${options.model}`, `--date=${options.date}`]);
  const dependency = { ...defaults, ...overrides };
  const report: ReuseEvalReport = { model: options.model, researchStatus: "failed", classification: "not_assessed",
    researchCalls: 0, searchCount: 0, hoursAttempted: false, reused: false, sourceDomains: [], cleanupFailed: false, providerCleanupFailed: false };
  const controller = new AbortController();
  let directory: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    directory = await dependency.createWorkspace();
    validateReuseWorkspace(directory);
    const target = publicReuseTarget(options.date);
    report.researchCalls = 1;
    const result = await Promise.race([
      dependency.research({ model: options.model, targets: [target], hoursTargets: selectPublicResearchHoursTargets([target], "Asia/Tokyo"),
        workDirectory: directory, abortController: controller, nowUtc: dependency.now().toISOString() }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new ReuseEvalFailure("AI_HOURS_REUSE_EVAL_TIMEOUT"));
      }, PUBLIC_RESEARCH_BUDGET_MS); }),
    ]);
    Object.assign(report, assessReuseResult(options, result));
    report.providerCleanupFailed = "cleanupFailed" in result && result.cleanupFailed === true;
    if (!report.reused) throw new ReuseEvalFailure("AI_HOURS_REUSE_EVAL_UNVERIFIED");
    report.researchStatus = "passed";
  } catch (error) {
    report.code = error instanceof ReuseEvalFailure ? error.code
      : aiProviderFailureDetails(error)?.code ?? "AI_HOURS_REUSE_EVAL_FAILED";
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    if (directory) {
      try { await dependency.removeWorkspace(validateReuseWorkspace(directory)); }
      catch { report.cleanupFailed = true; }
    }
  }
  return report;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const report = await runReuseEvaluation(parseReuseEvalOptions(args));
    console.log(JSON.stringify(report));
    if (report.researchStatus !== "passed" || report.cleanupFailed || report.providerCleanupFailed) process.exitCode = 1;
  } catch {
    process.exitCode = 1;
    console.error(JSON.stringify({ researchStatus: "not_started", code: "AI_HOURS_REUSE_EVAL_ARGUMENTS" }));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
