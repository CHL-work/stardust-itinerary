import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { Client, Pool } from "pg";

import { createTrip } from "../src/lib/app/repository";
import { ownerModelRegistry, ownerModels, type OwnerModel } from "../src/lib/app/types";
import { prepareAiConversation } from "../src/lib/ai/conversation";
import { runAiPlanner } from "../src/lib/ai/planner";
import type { AuthenticatedSession } from "../src/lib/auth/repository";
import { bindSyntheticAiOperator, sponsorSyntheticAiTrip, syntheticOperatorIdentity, withSyntheticAiOperator } from "./lib/synthetic-ai-operator";

const FINAL_MIGRATION = "0049_custom_ai_instructions.sql";
const EXPECTED_MIGRATION_COUNT = 45;
const TEST_DATABASE_NAME = /^stardust_test_ai_search_[a-z0-9_]+$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FOLLOW_UP = "you search for it";
const PRIOR_PROMPT = "Remember Tokyo Skytree's official website as the public venue to research. Wait for my follow-up, and do not propose any trip change.";
const PRIOR_RESULT = "Understood. The public reference is Tokyo Skytree's official website. I will wait and will not propose a trip change.";

type FailureCode =
  | "missing_test_database_url" | "invalid_test_database_url" | "unsafe_test_database_name"
  | "non_loopback_test_database" | "test_database_has_url_options"
  | "test_database_matches_application_database" | "test_database_connection_failed"
  | "test_database_not_fresh" | "migration_failed" | "migration_set_mismatch"
  | "fixture_load_failed" | "fixture_shape_mismatch" | "synthetic_setup_failed"
  | "invalid_model" | "planner_failed" | "planner_result_mismatch"
  | "search_evidence_missing" | "canonical_data_changed" | "unexpected_failure";

class SearchEvalFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
    this.name = "SearchEvalFailure";
  }
}

type DatabaseTarget = { connectionString: string; databaseName: string; host: string; port: string };
type Counts = { days: number; members: number; items: number; audiences: number; expenses: number; splits: number };

function fail(code: FailureCode): never { throw new SearchEvalFailure(code); }
function requireCondition(value: unknown, code: FailureCode): asserts value { if (!value) fail(code); }

function parseDatabaseTarget(value: string | undefined): DatabaseTarget {
  if (!value) fail("missing_test_database_url");
  let url: URL;
  try { url = new URL(value); } catch { fail("invalid_test_database_url"); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail("invalid_test_database_url");
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!TEST_DATABASE_NAME.test(databaseName)) fail("unsafe_test_database_name");
  const host = url.hostname.toLocaleLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) fail("non_loopback_test_database");
  if (url.search || url.hash) fail("test_database_has_url_options");
  return { connectionString: value, databaseName, host, port: url.port || "5432" };
}

function requireIsolatedTarget(target: DatabaseTarget): void {
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"] as const) {
    const value = process.env[name];
    if (!value) continue;
    try {
      const url = new URL(value);
      const host = LOOPBACK_HOSTS.has(url.hostname.toLocaleLowerCase()) ? "loopback" : url.hostname;
      if (target.databaseName === decodeURIComponent(url.pathname.replace(/^\//u, ""))
          && (LOOPBACK_HOSTS.has(target.host) ? "loopback" : target.host) === host
          && target.port === (url.port || "5432")) fail("test_database_matches_application_database");
    } catch (error) {
      if (error instanceof SearchEvalFailure) throw error;
    }
  }
}

function selectedModel(): OwnerModel {
  const value = process.argv.slice(2).find((item) => item.startsWith("--model="))?.slice(8);
  if (!value || !ownerModels.includes(value as OwnerModel)) fail("invalid_model");
  return value as OwnerModel;
}

async function prepareDatabase(target: DatabaseTarget): Promise<void> {
  const client = new Client({ connectionString: target.connectionString });
  try {
    await client.connect();
    const state = await client.query<{ database_name: string; object_count: number }>(
      `SELECT current_database() AS database_name,
              ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
               +(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
               +(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'))::integer AS object_count`,
    );
    requireCondition(state.rows[0]?.database_name === target.databaseName, "test_database_connection_failed");
    requireCondition(state.rows[0]?.object_count === 0, "test_database_not_fresh");
  } catch (error) {
    if (error instanceof SearchEvalFailure) throw error;
    fail("test_database_connection_failed");
  } finally { await client.end().catch(() => undefined); }

  try {
    const moduleUrl = new URL("./db/migration-lib.mjs", import.meta.url).href;
    const { migrate } = await import(moduleUrl) as { migrate(input: { connectionString: string; through: string }): Promise<string[]> };
    const applied = await migrate({ connectionString: target.connectionString, through: FINAL_MIGRATION });
    requireCondition(applied.length === EXPECTED_MIGRATION_COUNT && applied.at(-1) === FINAL_MIGRATION, "migration_set_mismatch");
  } catch (error) {
    if (error instanceof SearchEvalFailure) throw error;
    fail("migration_failed");
  }

  const fixtureClient = new Client({ connectionString: target.connectionString });
  try {
    const fixture = await readFile(new URL("../database/fixtures/demo.sql", import.meta.url), "utf8");
    await fixtureClient.connect();
    await fixtureClient.query("BEGIN");
    await fixtureClient.query(fixture);
    await fixtureClient.query("COMMIT");
  } catch { await fixtureClient.query("ROLLBACK").catch(() => undefined); fail("fixture_load_failed"); }
  finally { await fixtureClient.end().catch(() => undefined); }
}

async function tripCounts(pool: Pool, tripId: string): Promise<Counts> {
  const result = await pool.query<Counts>(
    `SELECT (SELECT count(*)::integer FROM trip_days WHERE trip_id=$1) AS days,
            (SELECT count(*)::integer FROM trip_members WHERE trip_id=$1) AS members,
            (SELECT count(*)::integer FROM itinerary_items WHERE trip_id=$1) AS items,
            (SELECT count(*)::integer FROM itinerary_item_viewers WHERE trip_id=$1) AS audiences,
            (SELECT count(*)::integer FROM expenses WHERE trip_id=$1) AS expenses,
            (SELECT count(*)::integer FROM expense_splits WHERE trip_id=$1) AS splits`, [tripId]);
  return result.rows[0]!;
}

async function createSyntheticContext(pool: Pool, model: OwnerModel): Promise<AuthenticatedSession> {
  try {
    const fixture = await pool.query<{ trip_count: number; item_count: number; expense_count: number; owner_count: number }>(
      `SELECT (SELECT count(*)::integer FROM trips) AS trip_count,
              (SELECT count(*)::integer FROM itinerary_items) AS item_count,
              (SELECT count(*)::integer FROM expenses) AS expense_count,
              (SELECT count(*)::integer FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL) AS owner_count`);
    requireCondition(JSON.stringify(fixture.rows[0]) === JSON.stringify({ trip_count: 1, item_count: 1, expense_count: 1, owner_count: 1 }), "fixture_shape_mismatch");
    const ownerResult = await pool.query<{ trip_id: string; member_id: string; user_id: string; display_name: string }>(
      `SELECT trip_id,id AS member_id,user_id,display_name FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL`);
    const owner = ownerResult.rows[0];
    requireCondition(owner && ownerResult.rowCount === 1, "fixture_shape_mismatch");
    await bindSyntheticAiOperator(pool, owner.user_id);
    const fixtureSession: AuthenticatedSession = {
      sessionId: "synthetic-search-source-owner", tripId: owner.trip_id, memberId: owner.member_id,
      userId: owner.user_id, role: "owner", displayName: owner.display_name,
      expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date("2030-04-06T00:00:00Z"),
      issuer: syntheticOperatorIdentity.issuer, subject: syntheticOperatorIdentity.subject, generation: 1,
    };
    const trip = await createTrip(pool, fixtureSession, {
      name: "Synthetic search evaluation", destinationName: "Tokyo, Japan", timeZone: "Asia/Tokyo",
      defaultLocale: "en", defaultCurrency: "JPY", startsOn: "2030-04-01", endsOn: "2030-04-05", maxMembers: 1,
    });
    await sponsorSyntheticAiTrip(pool, trip.tripId, owner.user_id);
    const session = { ...fixtureSession, sessionId: "synthetic-search-owner", tripId: trip.tripId, memberId: trip.memberId };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const conversation = await prepareAiConversation(client, session);
      requireCondition(conversation.turns.length === 0, "synthetic_setup_failed");
      const priorRequestId = randomUUID();
      await client.query(
        `INSERT INTO ai_requests (trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,feature,prompt_text,result_text,
           requested_model,effective_model,provider,transport,authentication_mode,billing_basis,status,input_tokens,output_tokens,cached_input_tokens,latency_ms,created_at,completed_at)
         VALUES ($1,$2,$3,$4,$5,'owner','planning',$6,$7,$8,$8,'synthetic','synthetic_fixture','none','none','succeeded',0,0,0,0,
           CURRENT_TIMESTAMP-INTERVAL '2 seconds',CURRENT_TIMESTAMP-INTERVAL '1 second')`,
        [session.tripId, priorRequestId, session.memberId, session.userId, conversation.conversationId, PRIOR_PROMPT, PRIOR_RESULT, model]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return session;
  } catch (error) {
    if (error instanceof SearchEvalFailure) throw error;
    fail("synthetic_setup_failed");
  }
}

function isSafeSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && Boolean(url.hostname);
  } catch { return false; }
}

function hasOfficialSkytreeSource(values: readonly string[]): boolean {
  return values.some((value) => {
    const host = new URL(value).hostname.toLocaleLowerCase();
    return host === "tokyo-skytree.jp" || host.endsWith(".tokyo-skytree.jp");
  });
}

async function runEvaluation(target: DatabaseTarget, model: OwnerModel): Promise<void> {
  await prepareDatabase(target);
  await withSyntheticAiOperator(target.connectionString, async () => {
  const pool = new Pool({ connectionString: target.connectionString, max: 2 });
  try {
    const session = await createSyntheticContext(pool, model);
    const before = await tripCounts(pool, session.tripId);
    let result: Awaited<ReturnType<typeof runAiPlanner>>;
    try { result = await runAiPlanner(pool, session, FOLLOW_UP, model, "en"); }
    catch { fail("planner_failed"); }
    requireCondition(result.model === model && result.proposalCount === 0 && result.proposalIds.length === 0
      && result.proposalId === null && result.changeStatus === null && result.entityId === null
      && result.memory.previousTurnsUsed === 1, "planner_result_mismatch");
    requireCondition(result.webSearch.performed && result.webSearch.queryCount > 0
      && result.webSearch.sources.length > 0 && result.webSearch.sources.every(isSafeSource)
      && hasOfficialSkytreeSource(result.webSearch.sources),
    "search_evidence_missing");

    const request = await pool.query<{ status: string; requested_model: string; effective_model: string | null; provider: string; transport: string; authentication_mode: string; proposal_id: string | null }>(
      `SELECT status,requested_model,effective_model,provider,transport,authentication_mode,proposal_id
         FROM ai_requests WHERE trip_id=$1 AND id=$2`, [session.tripId, result.requestId]);
    const row = request.rows[0];
    const profile = ownerModelRegistry[model];
    requireCondition(request.rowCount === 1 && row?.status === "succeeded" && row.requested_model === model
      && typeof row.effective_model === "string" && row.effective_model.length > 0 && row.provider === profile.provider
      && row.transport === profile.transport && row.authentication_mode === profile.authenticationMode && row.proposal_id === null,
    "planner_result_mismatch");
    const events = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type,payload FROM ai_request_events WHERE trip_id=$1 AND ai_request_id=$2
         AND event_type IN ('web.search.policy','web.search.completed','web.search.missing','web.search.blocked') ORDER BY sequence`,
      [session.tripId, result.requestId]);
    const policy = events.rows.find((event) => event.event_type === "web.search.policy")?.payload;
    const completed = events.rows.find((event) => event.event_type === "web.search.completed")?.payload;
    const eventSources = Array.isArray(completed?.sourceUrls) ? completed.sourceUrls : [];
    requireCondition(events.rows.length === 2 && policy?.intent === "required" && policy.requested === true
      && policy.enabled === true && completed?.searched === true && Number(completed.queryCount) > 0
      && eventSources.length > 0 && eventSources.every(isSafeSource) && hasOfficialSkytreeSource(eventSources),
    "search_evidence_missing");
    const proposals = await pool.query<{ count: number }>(`SELECT count(*)::integer AS count FROM change_requests WHERE trip_id=$1`, [session.tripId]);
    requireCondition(proposals.rows[0]?.count === 0, "planner_result_mismatch");
    requireCondition(JSON.stringify(await tripCounts(pool, session.tripId)) === JSON.stringify(before), "canonical_data_changed");
  } finally { await pool.end(); }
  });
}

async function main(): Promise<void> {
  const target = parseDatabaseTarget(process.env.TEST_DATABASE_URL);
  requireIsolatedTarget(target);
  const model = selectedModel();
  await runEvaluation(target, model);
  console.log(`AI search eval passed: ${model}.`);
}

main().catch((error: unknown) => {
  const code = error instanceof SearchEvalFailure ? error.code : "unexpected_failure";
  console.error(`AI search eval failed: ${code}.`);
  process.exitCode = 1;
});
