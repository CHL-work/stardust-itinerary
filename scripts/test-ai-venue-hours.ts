import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { ownerModelRegistry, type OwnerModel } from "../src/lib/app/types";
import { runVenueHoursResearch } from "../src/lib/ai/venue-hours-provider";
import { assessVenueHours, VENUE_HOURS_BUDGET_MS } from "../src/lib/ai/venue-hours";

// Opt-in public-only research evaluation. No .env file, app database, traveler
// prompt, itinerary write or booking action is used. This consumes provider quota.
const args = process.argv.slice(2).filter((value) => value !== "--");
const model = args.find((value) => value.startsWith("--model="))?.slice(8);
const date = args.find((value) => value.startsWith("--date="))?.slice(7);
if (args.length !== 2 || !model || !Object.hasOwn(ownerModelRegistry, model)
  || !date || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
  || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  || new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) {
  throw new Error("Supply --model=<registered-model> and --date=<a Monday YYYY-MM-DD> for the public closure fixture.");
}
const workDirectory = await mkdtemp(join(tmpdir(), "stardust-hours-eval-"));
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  const target = { key: "V1", venueName: "とんかつ 丸五 東京都千代田区外神田1-8-14", date, timeZone: "Asia/Tokyo" };
  const result = await Promise.race([
    runVenueHoursResearch({ model: model as OwnerModel, targets: [target], workDirectory,
      abortController: controller, nowUtc: new Date().toISOString() }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("AI_VENUE_HOURS_EVAL_TIMEOUT")); }, VENUE_HOURS_BUDGET_MS); }),
  ]);
  const checked = assessVenueHours([{ ...target, proposalIndex: 0, public: true,
    startsAt: `${date}T18:00:00+09:00`, endsAt: `${date}T19:00:00+09:00` }], result.assessments, result.webSearchQueries.length > 0)[0]!;
  if (checked.status !== "closed" || !checked.sources.length) {
    const rows = Array.isArray(result.assessments) ? result.assessments as Array<Record<string, unknown>> : [];
    console.error(JSON.stringify({ diagnostic: "public_fixture_only", classification: checked.status,
      searches: result.webSearchQueries.length, acceptedSourceCount: result.sourceUrls.length,
      returned: rows.slice(0, 4).map((row) => ({ status: row.status, keyMatches: row.key === target.key,
        venueMatches: row.venueName === target.venueName, dateMatches: row.date === date, zoneMatches: row.timeZone === target.timeZone,
        intervals: Array.isArray(row.intervals) ? row.intervals.length : null,
        sourceDomains: Array.isArray(row.sources) ? row.sources.slice(0, 5).map((source) => { try { return new URL(String(source)).hostname; } catch { return "invalid"; } }) : [],
      })) }));
    throw new Error("AI_VENUE_HOURS_EVAL_NOT_GROUNDED_CLOSED");
  }
  console.log(JSON.stringify({ model, status: "passed", classification: checked.status,
    searches: result.webSearchQueries.length, sources: checked.sources.length,
    inputTokens: result.inputTokens, outputTokens: result.outputTokens }));
} catch (error) {
  process.exitCode = 1;
  const code = error instanceof Error && /^AI_VENUE_HOURS_[A-Z_]+$/u.test(error.message) ? error.message : "AI_VENUE_HOURS_EVAL_FAILED";
  console.error(JSON.stringify({ model, status: "failed", code }));
} finally {
  if (timer) clearTimeout(timer);
  controller.abort();
  // Delete only the exact generated child of the system temp directory.
  const target = resolve(workDirectory);
  if (dirname(target) !== resolve(tmpdir()) || !/^stardust-hours-eval-[A-Za-z0-9]+$/u.test(basename(target))) {
    throw new Error("Invalid evaluation cleanup target");
  }
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
