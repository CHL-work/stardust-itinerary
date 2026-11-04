import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Client, Pool } from "pg";
import { createTrip } from "../src/lib/app/repository";
import { ownerModelRegistry, type OwnerModel } from "../src/lib/app/types";
import { prepareAiConversation } from "../src/lib/ai/conversation";
import { runAiPlanner } from "../src/lib/ai/planner";
import { aiProviderFailureDetails } from "../src/lib/ai/provider-failure";
import { sanitizePublicResearchSource } from "../src/lib/ai/public-research";
import type { AiPlannerResult } from "../src/lib/ai/request-recovery-types";
import type { AuthenticatedSession } from "../src/lib/auth/repository";
import { bindSyntheticAiOperator, sponsorSyntheticAiTrip, syntheticOperatorIdentity, withSyntheticAiOperator } from "./lib/synthetic-ai-operator";

// Explicit live SDK opt-in, never a replay of a traveler conversation. The
// caller creates/removes the exact fresh disposable database and verifies its
// absence afterwards. This script neither creates nor drops a database.
const databasePattern = /^stardust_test_ai_completion_[a-z0-9_]+$/u;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const models = ["gpt-6.1-sol", "claude-fable-5-1"] as const satisfies readonly OwnerModel[];
export const EXPECTED_MIGRATION_COUNT = 45;
export const FINAL_MIGRATION = "0049_custom_ai_instructions.sql";
export type CompletionOptions = { model: typeof models[number]; date: string };
export type DatabaseTarget = { connectionString: string; databaseName: string; host: string; port: string };
export type ResearchEvent = { event_type: string; payload: Record<string, unknown> };
type Fixture = { session: AuthenticatedSession; conversationId: string };
type Stage = "preflight" | "database" | "fixture" | "planner" | "assertions" | "replay" | "complete";
type FailureCode = "arguments_invalid" | "test_database_invalid" | "test_database_not_isolated" | "test_database_unconfirmed"
  | "test_database_connection_failed" | "test_database_not_fresh" | "migration_failed" | "migration_set_mismatch"
  | "fixture_failed" | "planner_failed" | "planner_result_mismatch" | "canonical_data_changed" | "research_incomplete"
  | "research_evidence_missing" | "answer_incomplete" | "request_replay_mismatch" | "cleanup_failed" | "unexpected_failure";
class CompletionEvalFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); this.name = "CompletionEvalFailure"; }
}
function requireCondition(value: unknown, code: FailureCode): asserts value {
  if (!value) throw new CompletionEvalFailure(code);
}
export type CompletionReport = {
  status: "passed" | "failed"; stage: Stage; model?: CompletionOptions["model"]; code?: string;
  sourceClassification?: "verified" | "partially_verified" | "unverified";
  targetCount?: number; queryCount?: number; verifiedCount?: number; unverifiedCount?: number;
  sourceDomains?: string[]; proposalCount?: number; replayVerified?: boolean; cleanupFailed?: boolean;
};
type Dependencies = {
  prepare: typeof prepareDatabase; context: typeof createSyntheticContext; planner: typeof runAiPlanner;
};

export function currentJapanDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}
export function parseOptions(args: readonly string[], now = new Date()): CompletionOptions {
  const input = args.filter((argument) => argument !== "--");
  const modelArgs = input.filter((argument) => argument.startsWith("--model="));
  const dateArgs = input.filter((argument) => argument.startsWith("--date="));
  const model = modelArgs[0]?.slice(8);
  const today = currentJapanDate(now);
  requireCondition(input.filter((argument) => argument === "--run-live").length === 1 && modelArgs.length === 1
    && dateArgs.length <= 1 && input.length === 2 + dateArgs.length && models.includes(model as CompletionOptions["model"])
    && (!dateArgs.length || dateArgs[0] === `--date=${today}`), "arguments_invalid");
  return { model: model as CompletionOptions["model"], date: today };
}
export function publicDiscoveryPrompt(date: string): string {
  requireCondition(/^\d{4}-\d{2}-\d{2}$/u.test(date), "arguments_invalid");
  return `For today, ${date} in Japan, research public anime pop-up shops, exhibitions or collaboration cafes in Nagoya for three separate topics: Pokémon, Detective Conan, and Gundam. This is a fixed public software-evaluation scenario; no personal profile applies. Give a concise English answer covering each topic, with official source links and applicable dates for verified findings. Clearly say when no current applicable activity could be verified; a permanent store is not proof of a current pop-up. I only want recommendations and research, not a plan change. Do not create, edit or propose any event or expense. Do not reserve, book or purchase anything.`;
}
export function parseDatabaseTarget(value: string | undefined): DatabaseTarget {
  requireCondition(value, "test_database_invalid");
  try {
    const url = new URL(value), databaseName = decodeURIComponent(url.pathname.slice(1)), host = url.hostname.toLowerCase();
    requireCondition(["postgres:", "postgresql:"].includes(url.protocol) && loopbackHosts.has(host)
      && !url.search && !url.hash && databaseName.length <= 63 && databasePattern.test(databaseName), "test_database_invalid");
    return { connectionString: value, databaseName, host, port: url.port || "5432" };
  } catch { throw new CompletionEvalFailure("test_database_invalid"); }
}
export function requireIsolatedTarget(target: DatabaseTarget): void {
  requireCondition(isDeepStrictEqual(target, parseDatabaseTarget(target.connectionString)), "test_database_invalid");
  requireCondition(process.env.TEST_DATABASE_CONFIRM_DESTROY === target.databaseName, "test_database_unconfirmed");
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"] as const) {
    const value = process.env[name];
    if (!value) continue;
    try {
      const application = new URL(value);
      requireCondition(!(target.databaseName === decodeURIComponent(application.pathname.slice(1))
        && loopbackHosts.has(application.hostname.toLowerCase()) && target.port === (application.port || "5432")), "test_database_not_isolated");
    } catch (error) { if (error instanceof CompletionEvalFailure) throw error; }
  }
}

type MigrationRunner = () => Promise<string[]>;
async function migrateAll(target: DatabaseTarget): Promise<string[]> {
  const moduleUrl = new URL("./db/migration-lib.mjs", import.meta.url).href;
  const { migrate } = await import(moduleUrl) as { migrate(input: { connectionString: string }): Promise<string[]> };
  return migrate({ connectionString: target.connectionString });
}
export async function prepareDatabase(target: DatabaseTarget, migrate: MigrationRunner = () => migrateAll(target)): Promise<void> {
  requireIsolatedTarget(target);
  const client = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
  let validated = false;
  try {
    await client.connect();
    const state = await client.query<{ database_name: string; object_count: number }>(
      `SELECT current_database() AS database_name,
       ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
       +(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
       +(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'))::integer AS object_count`);
    requireCondition(state.rows[0]?.database_name === target.databaseName, "test_database_connection_failed");
    requireCondition(state.rows[0]?.object_count === 0, "test_database_not_fresh");
    validated = true;
    const applied = await migrate();
    requireCondition(applied.length === EXPECTED_MIGRATION_COUNT && applied.at(-1) === FINAL_MIGRATION, "migration_set_mismatch");
    const fixture = await readFile(new URL("../database/fixtures/demo.sql", import.meta.url), "utf8");
    await client.query("BEGIN");
    try { await client.query(fixture); await client.query("COMMIT"); }
    catch { await client.query("ROLLBACK").catch(() => undefined); throw new CompletionEvalFailure("fixture_failed"); }
  } catch (error) {
    if (error instanceof CompletionEvalFailure) throw error;
    throw new CompletionEvalFailure(validated ? "migration_failed" : "test_database_connection_failed");
  } finally { await client.end().catch(() => undefined); }
}

async function createSyntheticContext(pool: Pool, date: string): Promise<Fixture> {
  const ownerResult = await pool.query<{ trip_id: string; member_id: string; user_id: string; display_name: string }>(
    `SELECT trip_id,id AS member_id,user_id,display_name FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL`);
  const owner = ownerResult.rows[0];
  requireCondition(ownerResult.rowCount === 1 && owner?.user_id === "00000000-0000-4000-8000-000000000001", "fixture_failed");
  await bindSyntheticAiOperator(pool, owner.user_id);
  const sourceSession: AuthenticatedSession = {
    sessionId: "synthetic-research-completion-source", tripId: owner.trip_id, memberId: owner.member_id, userId: owner.user_id,
    role: "owner", displayName: owner.display_name, expiresAt: new Date(Date.now() + 3_600_000),
    absoluteExpiresAt: new Date(Date.now() + 3 * 86_400_000), issuer: syntheticOperatorIdentity.issuer,
    subject: syntheticOperatorIdentity.subject, generation: 1,
  };
  const trip = await createTrip(pool, sourceSession, { name: "Synthetic public research completion", destinationName: "Nagoya, Japan",
    timeZone: "Asia/Tokyo", defaultLocale: "en", defaultCurrency: "JPY", startsOn: date, endsOn: date, maxMembers: 1 });
  await sponsorSyntheticAiTrip(pool, trip.tripId, owner.user_id);
  const session = { ...sourceSession, sessionId: "synthetic-research-completion-owner", tripId: trip.tripId, memberId: trip.memberId };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const conversation = await prepareAiConversation(client, session);
    requireCondition(conversation.turns.length === 0, "fixture_failed");
    await client.query("COMMIT");
    return { session, conversationId: conversation.conversationId };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function snapshot(pool: Pool, mode: "canonical" | "replay", tripId: string): Promise<string> {
  const tables = mode === "canonical"
    ? ["itinerary_items", "itinerary_item_viewers", "itinerary_revisions", "expenses", "expense_splits", "expense_revisions",
      "member_payments", "member_payment_revisions", "member_payment_actions", "change_requests"]
    : ["ai_requests", "ai_request_events", "audit_events"];
  const hashes = [];
  for (const table of tables) {
    const result = await pool.query<{ digest: string }>(
      `SELECT md5(COALESCE(jsonb_agg(row_data ORDER BY row_data::text),'[]'::jsonb)::text) AS digest
       FROM (SELECT to_jsonb(record) AS row_data FROM ${table} record ${mode === "replay" ? "WHERE trip_id=$1" : ""}) snapshot`,
      mode === "replay" ? [tripId] : []);
    requireCondition(typeof result.rows[0]?.digest === "string", "canonical_data_changed");
    hashes.push(result.rows[0].digest);
  }
  return JSON.stringify(hashes);
}

const topics = [/pok[eé]mon|ポケモン/iu, /detective\s+conan|名探偵コナン/iu, /gundam|ガンダム/iu];
/** Conservative English fixture checks, not a general semantic truth verifier. */
export function assertAnswer(message: string, allUnverified: boolean): void {
  requireCondition(message.trim().length >= 120 && /nagoya|名古屋/iu.test(message) && topics.every((topic) => topic.test(message)), "answer_incomplete");
  if (allUnverified) {
    // This narrow disclaimer describes the limits of an unsuccessful lookup,
    // not an assertion that an activity exists. Do not exempt the surrounding
    // paragraph or a bare "nothing is running" phrase: other positive claims
    // must still fail the synthetic all-unverified benchmark.
    const availabilityClaims = message.replace(/\bthis\s+does(?:\s+not|n['’]t)\s+mean\s+(?:that\s+)?nothing\s+is\s+running\s+today,\s*only\s+that\s+nothing\s+could\s+be\s+confirmed\s+from\s+current\s+public\s+sources\s+in\s+this\s+research\s+round\b/giu, "lookup uncertainty");
    requireCondition(/unverified|not\s+(?:verified|confirmed)|could(?:\s+not|n't)\s+(?:verify|confirm|find)|unable\s+to\s+(?:verify|confirm|find)|no\s+(?:current|confirmed|verified)/iu.test(message)
      && !/\b(?:is|are|will\s+be)\s+(?:currently\s+)?(?:open|running|available|taking\s+place)\b/iu.test(availabilityClaims), "answer_incomplete");
  }
}
export function assertResearchCompletion(events: readonly ResearchEvent[], result: AiPlannerResult): Pick<CompletionReport,
  "sourceClassification" | "targetCount" | "queryCount" | "verifiedCount" | "unverifiedCount" | "sourceDomains"> {
  const requested = events.filter((event) => event.event_type === "public.research.requested");
  const completed = events.filter((event) => event.event_type === "public.research.completed");
  const finalized = events.filter((event) => event.event_type === "public.research.finalized");
  const receipt = completed[0]?.payload;
  const targetCount = Number(requested[0]?.payload.eligibleCount);
  requireCondition(requested.length === 1 && completed.length === 1 && finalized.length === 1
    && Number.isInteger(targetCount) && targetCount >= 2 && targetCount <= 3
    && requested[0]?.payload.hoursTargetCount === 0 && receipt?.targetCount === targetCount
    && ["researched", "unverified"].includes(String(receipt?.outcome)) && finalized[0]?.payload.finalized === true
    && finalized[0]?.payload.factCount === targetCount, "research_incomplete");
  const facts = Array.isArray(receipt?.facts) ? receipt.facts as Array<Record<string, unknown>> : [];
  const queries = Array.isArray(receipt?.queries) ? receipt.queries : [];
  const sources = Array.isArray(receipt?.sourceUrls) ? receipt.sourceUrls : [];
  requireCondition(facts.length === targetCount && new Set(facts.map((fact) => fact.key)).size === targetCount
    && facts.every((fact) => /^R[1-3]$/u.test(String(fact.key)) && fact.kind === "discovery" && ["verified", "unverified"].includes(String(fact.status)))
    && queries.length >= targetCount && queries.every((query) => typeof query === "string")
    && topics.filter((topic) => queries.some((query) => typeof query === "string" && topic.test(query))).length >= 2
    && receipt?.queryCount === queries.length && result.webSearch.performed && result.webSearch.queryCount >= queries.length
    && sources.every((source) => typeof source === "string" && sanitizePublicResearchSource(source))
    && result.webSearch.sources.every((source) => sanitizePublicResearchSource(source)), "research_evidence_missing");
  const verifiedCount = facts.filter((fact) => fact.status === "verified").length;
  requireCondition(!verifiedCount || (sources.length > 0 && result.webSearch.sources.length > 0), "research_evidence_missing");
  assertAnswer(result.message, verifiedCount === 0);
  const sourceDomains = [...new Set([...sources as string[], ...result.webSearch.sources].map((source) => new URL(source).hostname))].sort().slice(0, 15);
  return { targetCount, queryCount: result.webSearch.queryCount, verifiedCount, unverifiedCount: facts.length - verifiedCount,
    sourceClassification: verifiedCount === facts.length ? "verified" : verifiedCount ? "partially_verified" : "unverified", sourceDomains };
}

export async function runEvaluation(target: DatabaseTarget, options: CompletionOptions, overrides: Partial<Dependencies> = {}): Promise<CompletionReport> {
  const report: CompletionReport = { status: "failed", stage: "preflight", model: options.model };
  const dependency = { prepare: prepareDatabase, context: createSyntheticContext, planner: runAiPlanner, ...overrides };
  try {
    parseOptions(["--run-live", `--model=${options.model}`, `--date=${options.date}`]); requireIsolatedTarget(target);
    report.stage = "database"; await dependency.prepare(target);
    await withSyntheticAiOperator(target.connectionString, async () => {
      const pool = new Pool({ connectionString: target.connectionString, max: 2, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
      try {
        report.stage = "fixture";
        const fixture = await dependency.context(pool, options.date);
        const before = await snapshot(pool, "canonical", fixture.session.tripId), key = randomUUID();
        const prompt = publicDiscoveryPrompt(options.date);
        report.stage = "planner";
        // The real planner owns the shared bounded phase deadlines and exact
        // generated-workspace cleanup. Do not detach it with a second retry/race.
        const result = await dependency.planner(pool, fixture.session, prompt, options.model, "en", key, fixture.conversationId);
        requireCondition("requestId" in result, "planner_result_mismatch");
        report.stage = "assertions"; report.proposalCount = result.proposalCount;
        requireCondition(result.model === options.model && result.proposalCount === 0 && result.proposalIds.length === 0
          && result.proposalId === null && result.changeStatus === null && result.entityId === null, "planner_result_mismatch");
        const request = await pool.query<{ status: string; requested_model: string; effective_model: string; provider: string; transport: string;
          authentication_mode: string; proposal_id: string | null; response_json: unknown; actor_user_id: string; actor_member_id: string; client_request_id: string }>(
          `SELECT status,requested_model,effective_model,provider,transport,authentication_mode,proposal_id,response_json,
           actor_user_id,actor_member_id,client_request_id FROM ai_requests WHERE trip_id=$1 AND id=$2`, [fixture.session.tripId, result.requestId]);
        const row = request.rows[0], profile = ownerModelRegistry[options.model];
        requireCondition(request.rowCount === 1 && row?.status === "succeeded" && row.requested_model === options.model
          && Boolean(row.effective_model) && row.provider === profile.provider && row.transport === profile.transport
          && row.authentication_mode === profile.authenticationMode && row.proposal_id === null && isDeepStrictEqual(row.response_json, result)
          && row.actor_user_id === fixture.session.userId && row.actor_member_id === fixture.session.memberId && row.client_request_id === key, "planner_result_mismatch");
        const events = await pool.query<ResearchEvent>("SELECT event_type,payload FROM ai_request_events WHERE trip_id=$1 AND ai_request_id=$2 ORDER BY sequence", [fixture.session.tripId, result.requestId]);
        requireCondition(await snapshot(pool, "canonical", fixture.session.tripId) === before, "canonical_data_changed");
        Object.assign(report, assertResearchCompletion(events.rows, result));
        report.stage = "replay";
        const replayBefore = await snapshot(pool, "replay", fixture.session.tripId);
        const replay = await dependency.planner(pool, fixture.session, prompt, options.model, "en", key, fixture.conversationId);
        requireCondition("request" in replay && replay.request?.status === "succeeded" && replay.request.requestId === result.requestId
          && isDeepStrictEqual(replay.request.result, result) && await snapshot(pool, "replay", fixture.session.tripId) === replayBefore, "request_replay_mismatch");
        requireCondition(await snapshot(pool, "canonical", fixture.session.tripId) === before, "canonical_data_changed");
        report.replayVerified = true;
      } finally { try { await pool.end(); } catch { report.cleanupFailed = true; } }
    });
    requireCondition(!report.cleanupFailed, "cleanup_failed");
    report.stage = "complete"; report.status = "passed";
  } catch (error) {
    report.code = error instanceof CompletionEvalFailure ? error.code : aiProviderFailureDetails(error)?.code
      ?? (report.stage === "planner" ? "planner_failed" : "unexpected_failure");
  }
  return report;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<CompletionReport> {
  try {
    const options = parseOptions(args), target = parseDatabaseTarget(process.env.TEST_DATABASE_URL);
    requireIsolatedTarget(target);
    return await runEvaluation(target, options);
  } catch (error) {
    return { status: "failed", stage: "preflight", code: error instanceof CompletionEvalFailure ? error.code : "unexpected_failure" };
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = await main();
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}
