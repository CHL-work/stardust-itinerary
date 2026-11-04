import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Client, Pool } from "pg";

import { createChangeRequest, createTrip, createTripMember, getPendingItineraryRequestForEdit } from "../src/lib/app/repository";
import { ownerModelRegistry, ownerModels, type OwnerModel, type PendingItineraryEditDetail } from "../src/lib/app/types";
import { prepareAiConversation } from "../src/lib/ai/conversation";
import { runAiPlanner } from "../src/lib/ai/planner";
import type { AiPlannerResult } from "../src/lib/ai/request-recovery-types";
import type { AuthenticatedSession } from "../src/lib/auth/repository";
import { bindSyntheticAiOperator, sponsorSyntheticAiTrip, syntheticOperatorIdentity, withSyntheticAiOperator } from "./lib/synthetic-ai-operator";

const FINAL_MIGRATION = "0049_custom_ai_instructions.sql";
const EXPECTED_MIGRATION_COUNT = 45;
// Stay within the existing synthetic-operator reservation guard. The caller
// creates/removes this exact disposable database; this script never drops one.
const TEST_DATABASE_NAME = /^stardust_test_ai_reservation_pending_[a-z0-9_]+$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCATION = "架空食堂ほし 秋葉原";
const FIRST_FOLLOW_UP = "Update it to be in Cantonese but keep the location in Japanese. Do not search.";
const SECOND_FOLLOW_UP = "Update it: set the title to 「午餐時間」. Do not search.";
const PRIOR_PROMPT = "Create one private pending lunch called Lunch at Synthetic Hoshi Restaurant, at 架空食堂ほし 秋葉原 on 2030-04-01 12:00–13:00 Japan time, shared with Synthetic Guest, with a linked 5101 JPY expense paid by me and split with Synthetic Guest. This is a synthetic restaurant, not a real booking. Do not search.";
const PRIOR_RESULT = "The private Lunch at Synthetic Hoshi Restaurant proposal at 架空食堂ほし 秋葉原 is pending owner approval, with the requested linked expense. Neither event nor expense is approved.";

type FailureCode = "live_eval_not_authorized" | "missing_test_database_url" | "invalid_test_database_url" | "unsafe_test_database_name"
  | "non_loopback_test_database" | "test_database_has_url_options" | "test_database_matches_application_database"
  | "test_database_connection_failed" | "test_database_not_fresh" | "migration_failed" | "migration_set_mismatch"
  | "fixture_load_failed" | "fixture_shape_mismatch" | "synthetic_setup_failed" | "invalid_model"
  | "planner_failed" | "planner_result_mismatch" | "first_edit_mismatch" | "second_edit_mismatch"
  | "proposal_identity_changed" | "proposal_data_changed" | "canonical_data_changed" | "duplicate_proposal"
  | "web_search_was_used" | "request_replay_mismatch" | "unexpected_failure";
class PendingEditEvalFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); this.name = "PendingEditEvalFailure"; }
}
type DatabaseTarget = { connectionString: string; databaseName: string; host: string; port: string };
type Fixture = { session: AuthenticatedSession; conversationId: string; pending: PendingItineraryEditDetail };
function fail(code: FailureCode): never { throw new PendingEditEvalFailure(code); }
function requireCondition(value: unknown, code: FailureCode): asserts value { if (!value) fail(code); }

export function parseDatabaseTarget(value: string | undefined): DatabaseTarget {
  if (!value) fail("missing_test_database_url");
  let url: URL;
  try { url = new URL(value); } catch { fail("invalid_test_database_url"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail("invalid_test_database_url");
  let databaseName: string;
  try { databaseName = decodeURIComponent(url.pathname.slice(1)); } catch { fail("invalid_test_database_url"); }
  if (!TEST_DATABASE_NAME.test(databaseName)) fail("unsafe_test_database_name");
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) fail("non_loopback_test_database");
  if (url.search || url.hash) fail("test_database_has_url_options");
  return { connectionString: value, databaseName, host, port: url.port || "5432" };
}

export function requireIsolatedTarget(target: DatabaseTarget): void {
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"] as const) {
    const value = process.env[name];
    if (!value) continue;
    try {
      const application = new URL(value);
      if (target.databaseName === decodeURIComponent(application.pathname.slice(1))
        && LOOPBACK_HOSTS.has(application.hostname.toLowerCase()) && target.port === (application.port || "5432")) {
        fail("test_database_matches_application_database");
      }
    } catch (error) { if (error instanceof PendingEditEvalFailure) throw error; }
  }
}

export function selectedModel(args: readonly string[]): OwnerModel {
  requireCondition(args.includes("--run-live"), "live_eval_not_authorized");
  const selected = args.filter((argument) => argument.startsWith("--model="));
  const value = selected[0]?.slice(8);
  if (selected.length !== 1 || !value || !ownerModels.includes(value as OwnerModel)) fail("invalid_model");
  return value as OwnerModel;
}

export async function prepareDatabase(target: DatabaseTarget): Promise<void> {
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
    if (error instanceof PendingEditEvalFailure) throw error;
    fail("test_database_connection_failed");
  } finally { await client.end().catch(() => undefined); }

  try {
    const moduleUrl = new URL("./db/migration-lib.mjs", import.meta.url).href;
    const { migrate } = await import(moduleUrl) as { migrate(input: { connectionString: string; through: string }): Promise<string[]> };
    const applied = await migrate({ connectionString: target.connectionString, through: FINAL_MIGRATION });
    requireCondition(applied.length === EXPECTED_MIGRATION_COUNT && applied.at(-1) === FINAL_MIGRATION, "migration_set_mismatch");
  } catch (error) {
    if (error instanceof PendingEditEvalFailure) throw error;
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

async function createSyntheticContext(pool: Pool, model: OwnerModel): Promise<Fixture> {
  try {
    const fixture = await pool.query<{ trip_count: number; item_count: number; expense_count: number; owner_count: number }>(
      `SELECT (SELECT count(*)::integer FROM trips) AS trip_count,
        (SELECT count(*)::integer FROM itinerary_items) AS item_count,
        (SELECT count(*)::integer FROM expenses) AS expense_count,
        (SELECT count(*)::integer FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL) AS owner_count`,
    );
    requireCondition(JSON.stringify(fixture.rows[0]) === JSON.stringify({ trip_count: 1, item_count: 1, expense_count: 1, owner_count: 1 }), "fixture_shape_mismatch");
    const ownerResult = await pool.query<{ trip_id: string; member_id: string; user_id: string; display_name: string }>(
      `SELECT trip_id,id AS member_id,user_id,display_name FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL`,
    );
    const owner = ownerResult.rows[0];
    requireCondition(owner && ownerResult.rowCount === 1, "fixture_shape_mismatch");
    await bindSyntheticAiOperator(pool, owner.user_id);
    const sourceSession: AuthenticatedSession = {
      sessionId: "synthetic-pending-source", tripId: owner.trip_id, memberId: owner.member_id, userId: owner.user_id,
      role: "owner", displayName: owner.display_name, expiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date("2030-04-06T00:00:00Z"), issuer: syntheticOperatorIdentity.issuer,
      subject: syntheticOperatorIdentity.subject, generation: 1,
    };
    const trip = await createTrip(pool, sourceSession, {
      name: "Synthetic pending-edit evaluation", destinationName: "Tokyo, Japan", timeZone: "Asia/Tokyo",
      defaultLocale: "zh-HK", defaultCurrency: "JPY", startsOn: "2030-04-01", endsOn: "2030-04-05", maxMembers: 2,
    });
    await sponsorSyntheticAiTrip(pool, trip.tripId, owner.user_id);
    const session = { ...sourceSession, sessionId: "synthetic-pending-owner", tripId: trip.tripId, memberId: trip.memberId };
    const guest = await createTripMember(pool, session, session.tripId, { displayName: "Synthetic Guest" });
    const day = await pool.query<{ id: string }>(`SELECT id FROM trip_days WHERE trip_id=$1 AND day_date=DATE '2030-04-01'`, [session.tripId]);
    requireCondition(day.rowCount === 1 && day.rows[0], "synthetic_setup_failed");
    const proposed = await createChangeRequest(pool, session, session.tripId, {
      entityType: "itinerary_item", operation: "create", entityId: null, baseRevision: null, source: "ai",
      reason: "Synthetic evaluator pending restaurant, never a real booking",
      patch: { tripDayId: day.rows[0].id, title: "Lunch at Synthetic Hoshi Restaurant", itemType: "meal",
        startsAt: "2030-04-01T03:00:00Z", endsAt: "2030-04-01T04:00:00Z", locationName: LOCATION,
        notes: "Synthetic lunch for the evaluation; no actual reservation.", visibility: "private", viewerMemberIds: [guest.id], status: "planned",
        linkedExpense: { description: "Synthetic lunch charge", amountMinor: 5101, currency: "JPY", payerMemberId: session.memberId,
          occurredAt: "2030-04-01T03:00:00Z", status: "posted", splitMemberIds: [session.memberId, guest.id] },
      },
    });
    const pending = await getPendingItineraryRequestForEdit(pool, session, session.tripId, proposed.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const conversation = await prepareAiConversation(client, session);
      requireCondition(conversation.turns.length === 0, "synthetic_setup_failed");
      await client.query(
        `INSERT INTO ai_requests (trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,feature,prompt_text,result_text,
          requested_model,effective_model,provider,transport,authentication_mode,billing_basis,status,proposal_id,input_tokens,output_tokens,cached_input_tokens,latency_ms,created_at,completed_at)
         VALUES ($1,$2,$3,$4,$5,'owner','planning',$6,$7,$8,$8,'synthetic','synthetic_fixture','none','none','succeeded',$9,0,0,0,0,
          CURRENT_TIMESTAMP-INTERVAL '2 seconds',CURRENT_TIMESTAMP-INTERVAL '1 second')`,
        [session.tripId, randomUUID(), session.memberId, session.userId, conversation.conversationId, PRIOR_PROMPT, PRIOR_RESULT, model, proposed.id],
      );
      await client.query("COMMIT");
      return { session, conversationId: conversation.conversationId, pending };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) { if (error instanceof PendingEditEvalFailure) throw error; fail("synthetic_setup_failed"); }
}

async function canonicalSnapshot(pool: Pool): Promise<string> {
  const digests: string[] = [];
  for (const table of ["itinerary_items", "itinerary_item_viewers", "itinerary_revisions", "expenses", "expense_splits", "expense_revisions"] as const) {
    const result = await pool.query<{ digest: string }>(
      `SELECT md5(COALESCE(jsonb_agg(row_data ORDER BY row_data::text),'[]'::jsonb)::text) AS digest
       FROM (SELECT to_jsonb(record) AS row_data FROM ${table} record) snapshot`,
    );
    digests.push(result.rows[0]?.digest ?? "missing");
  }
  return JSON.stringify(digests);
}

export function assertPreserved(before: PendingItineraryEditDetail, after: PendingItineraryEditDetail, allowedFields: readonly string[]): void {
  requireCondition(after.requestId === before.requestId && after.status === "pending" && after.targetItemId === null
    && after.requestedByMemberId === before.requestedByMemberId && after.createdByMemberId === before.createdByMemberId
    && after.source === before.source && after.createdAt === before.createdAt && after.operation === "create"
    && after.proposalRevision === before.proposalRevision + 1, "proposal_identity_changed");
  const unchanged = (patch: PendingItineraryEditDetail["patch"]) => Object.fromEntries(Object.entries(patch).filter(([key]) => !allowedFields.includes(key)));
  requireCondition(isDeepStrictEqual(unchanged(after.patch), unchanged(before.patch)), "proposal_data_changed");
  requireCondition(after.patch.locationName === LOCATION && after.patch.linkedExpense !== null, "proposal_data_changed");
}

async function assertPlannerReceipt(pool: Pool, fixture: Fixture, result: AiPlannerResult, model: OwnerModel): Promise<void> {
  requireCondition(result.model === model && result.proposalCount === 1 && result.proposalIds.length === 1
    && result.proposalId === fixture.pending.requestId && result.proposalIds[0] === fixture.pending.requestId
    && result.changeStatus === "pending" && result.entityId === null && result.memory.previousTurnsUsed >= 1, "planner_result_mismatch");
  requireCondition(!result.webSearch.performed && result.webSearch.queryCount === 0 && result.webSearch.sources.length === 0, "web_search_was_used");
  const request = await pool.query<{ status: string; proposal_id: string; provider: string; transport: string; authentication_mode: string; effective_model: string | null }>(
    `SELECT status,proposal_id,provider,transport,authentication_mode,effective_model FROM ai_requests WHERE trip_id=$1 AND id=$2`, [fixture.session.tripId, result.requestId],
  );
  const profile = ownerModelRegistry[model]; const row = request.rows[0];
  requireCondition(request.rowCount === 1 && row?.status === "succeeded" && row.proposal_id === fixture.pending.requestId
    && row.provider === profile.provider && row.transport === profile.transport && row.authentication_mode === profile.authenticationMode
    && Boolean(row.effective_model), "planner_result_mismatch");
  const policy = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM ai_request_events WHERE trip_id=$1 AND ai_request_id=$2 AND event_type LIKE 'web.search.%'`, [fixture.session.tripId, result.requestId],
  );
  requireCondition(policy.rowCount === 1 && policy.rows[0]?.payload.enabled === false, "web_search_was_used");
  const proposals = await pool.query<{ count: number }>(`SELECT count(*)::integer AS count FROM change_requests WHERE trip_id=$1`, [fixture.session.tripId]);
  requireCondition(proposals.rows[0]?.count === 1, "duplicate_proposal");
}

async function replaySnapshot(pool: Pool, tripId: string): Promise<string> {
  const result = await pool.query<{ state: unknown }>(
    `SELECT jsonb_build_object(
      'requests',(SELECT count(*) FROM ai_requests WHERE trip_id=$1),
      'events',(SELECT count(*) FROM ai_request_events WHERE trip_id=$1),
      'audits',(SELECT count(*) FROM audit_events WHERE trip_id=$1),
      'proposalRevisions',(SELECT jsonb_agg(jsonb_build_object('id',id,'revision',proposal_revision,'patch',proposed_patch) ORDER BY id) FROM change_requests WHERE trip_id=$1)
     ) AS state`, [tripId],
  );
  return JSON.stringify(result.rows[0]?.state);
}

async function runEvaluation(target: DatabaseTarget, model: OwnerModel): Promise<void> {
  await prepareDatabase(target);
  await withSyntheticAiOperator(target.connectionString, async () => {
    const pool = new Pool({ connectionString: target.connectionString, max: 2 });
    try {
      const fixture = await createSyntheticContext(pool, model);
      const beforeCanonical = await canonicalSnapshot(pool);
      const submit = async (prompt: string, clientRequestId: string): Promise<AiPlannerResult> => {
        try {
          const result = await runAiPlanner(pool, fixture.session, prompt, model, "zh-HK", clientRequestId, fixture.conversationId);
          requireCondition("requestId" in result, "planner_result_mismatch");
          return result;
        } catch (error) { if (error instanceof PendingEditEvalFailure) throw error; fail("planner_failed"); }
      };
      const first = await submit(FIRST_FOLLOW_UP, randomUUID());
      await assertPlannerReceipt(pool, fixture, first, model);
      const afterFirst = await getPendingItineraryRequestForEdit(pool, fixture.session, fixture.session.tripId, fixture.pending.requestId);
      assertPreserved(fixture.pending, afterFirst, ["title", "notes"]);
      // A venue's proper name may stay in its source language. The meal text must translate;
      // the second turn separately requires an exact, fully Chinese replacement title.
      requireCondition(afterFirst.patch.title !== fixture.pending.patch.title
        && /\p{Script=Han}/u.test(afterFirst.patch.title) && !/\bLunch\b/iu.test(afterFirst.patch.title), "first_edit_mismatch");
      requireCondition(await canonicalSnapshot(pool) === beforeCanonical, "canonical_data_changed");

      const secondKey = randomUUID();
      const second = await submit(SECOND_FOLLOW_UP, secondKey);
      await assertPlannerReceipt(pool, fixture, second, model);
      const afterSecond = await getPendingItineraryRequestForEdit(pool, fixture.session, fixture.session.tripId, fixture.pending.requestId);
      assertPreserved(afterFirst, afterSecond, ["title"]);
      requireCondition(afterSecond.patch.title === "午餐時間", "second_edit_mismatch");
      const beforeReplay = await replaySnapshot(pool, fixture.session.tripId);
      const replay = await runAiPlanner(pool, fixture.session, SECOND_FOLLOW_UP, model, "zh-HK", secondKey, fixture.conversationId);
      requireCondition("request" in replay && replay.request?.status === "succeeded"
        && replay.request.requestId === second.requestId && isDeepStrictEqual(replay.request.result, second), "request_replay_mismatch");
      requireCondition(await replaySnapshot(pool, fixture.session.tripId) === beforeReplay, "request_replay_mismatch");
      requireCondition(await canonicalSnapshot(pool) === beforeCanonical, "canonical_data_changed");
    } finally { await pool.end(); }
  });
}

export async function main(): Promise<void> {
  const model = selectedModel(process.argv.slice(2));
  const target = parseDatabaseTarget(process.env.TEST_DATABASE_URL);
  requireIsolatedTarget(target);
  await runEvaluation(target, model);
  console.log(`AI pending edit eval passed: ${model}.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    const code = error instanceof PendingEditEvalFailure ? error.code : "unexpected_failure";
    console.error(`AI pending edit eval failed: ${code}.`);
    process.exitCode = 1;
  });
}
