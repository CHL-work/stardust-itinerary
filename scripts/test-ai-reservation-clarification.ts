import { readFile } from "node:fs/promises";
import process from "node:process";
import { Client, Pool } from "pg";

import { createTrip, createTripMember } from "../src/lib/app/repository";
import { ownerModels, type OwnerModel } from "../src/lib/app/types";
import { aiItineraryPatchSchema } from "../src/lib/ai/proposal-contract";
import { runAiPlanner } from "../src/lib/ai/planner";
import { reservationExpenseReviewNotice } from "../src/lib/ai/reservation-assumptions";
import {
  containsKnownReservationSecret,
  inspectReservationSecrets,
} from "../src/lib/ai/reservation-secrets";
import type { AuthenticatedSession } from "../src/lib/auth/repository";
import { bindSyntheticAiOperator, sponsorSyntheticAiTrip, syntheticOperatorIdentity, withSyntheticAiOperator } from "./lib/synthetic-ai-operator";

const FINAL_MIGRATION = "0049_custom_ai_instructions.sql";
const EXPECTED_MIGRATION_COUNT = 45;
const TEST_DATABASE_NAME = /^stardust_test_ai_reservation_clarification_[a-z0-9_]+$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const EXPECTED_TOTAL_JPY = 50_101;
const SYNTHETIC_PIN = "739241";
const SYNTHETIC_PRIVATE_URL =
  "https://hotel.example.test/reservations/SYNTH-CLARIFY-ONLY/manage?pin=739241";
const PAYER_FOLLOW_UP = "梗係我啦，照上面資料做就得";

type FailureCode =
  | "missing_test_database_url" | "invalid_test_database_url" | "unsafe_test_database_name"
  | "non_loopback_test_database" | "test_database_has_url_options"
  | "test_database_matches_application_database" | "test_database_connection_failed"
  | "test_database_not_fresh" | "migration_failed" | "migration_set_mismatch"
  | "fixture_load_failed" | "fixture_shape_mismatch" | "synthetic_setup_failed"
  | "invalid_model" | "planner_failed" | "first_turn_mismatch" | "draft_receipt_mismatch"
  | "second_turn_mismatch" | "proposal_shape_mismatch" | "draft_reused"
  | "canonical_data_changed" | "reservation_secret_leaked" | "web_search_was_used"
  | "unexpected_failure";

class ClarificationEvalFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
    this.name = "ClarificationEvalFailure";
  }
}

type DatabaseTarget = { connectionString: string; databaseName: string; host: string; port: string };
type CanonicalCounts = { itineraryCount: number; expenseCount: number };

function fail(code: FailureCode): never { throw new ClarificationEvalFailure(code); }
function requireCondition(value: unknown, code: FailureCode): asserts value { if (!value) fail(code); }

function parseDatabaseTarget(value: string | undefined): DatabaseTarget {
  if (!value) fail("missing_test_database_url");
  let url: URL;
  try { url = new URL(value); } catch { fail("invalid_test_database_url"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail("invalid_test_database_url");
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!TEST_DATABASE_NAME.test(databaseName)) fail("unsafe_test_database_name");
  const host = url.hostname.toLocaleLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) fail("non_loopback_test_database");
  if (url.search || url.hash) fail("test_database_has_url_options");
  return { connectionString: value, databaseName, host, port: url.port || "5432" };
}

function requireIsolatedTarget(target: DatabaseTarget): void {
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"] as const) {
    const configured = process.env[name];
    if (!configured) continue;
    try {
      const url = new URL(configured);
      const configuredHost = LOOPBACK_HOSTS.has(url.hostname.toLocaleLowerCase())
        ? "loopback" : url.hostname.toLocaleLowerCase();
      const targetHost = LOOPBACK_HOSTS.has(target.host) ? "loopback" : target.host;
      if (target.databaseName === decodeURIComponent(url.pathname.replace(/^\//u, ""))
          && targetHost === configuredHost && target.port === (url.port || "5432")) {
        fail("test_database_matches_application_database");
      }
    } catch (error) {
      if (error instanceof ClarificationEvalFailure) throw error;
    }
  }
}

function selectedModel(): OwnerModel {
  const value = process.argv.slice(2).find((argument) => argument.startsWith("--model="))?.slice(8);
  if (!value || !ownerModels.includes(value as OwnerModel)) fail("invalid_model");
  return value as OwnerModel;
}

async function prepareDatabase(target: DatabaseTarget): Promise<void> {
  const client = new Client({ connectionString: target.connectionString });
  try {
    await client.connect();
    const result = await client.query<{
      database_name: string; relation_count: number; routine_count: number; type_count: number;
    }>(
      `SELECT current_database() AS database_name,
              (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AS relation_count,
              (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS routine_count,
              (SELECT count(*)::integer FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS type_count`,
    );
    const state = result.rows[0];
    requireCondition(state?.database_name === target.databaseName, "test_database_connection_failed");
    requireCondition(state.relation_count === 0 && state.routine_count === 0 && state.type_count === 0,
      "test_database_not_fresh");
  } catch (error) {
    if (error instanceof ClarificationEvalFailure) throw error;
    fail("test_database_connection_failed");
  } finally { await client.end().catch(() => undefined); }

  try {
    const moduleUrl = new URL("./db/migration-lib.mjs", import.meta.url).href;
    const { migrate } = await import(moduleUrl) as {
      migrate(input: { connectionString: string; through: string }): Promise<string[]>;
    };
    const applied = await migrate({ connectionString: target.connectionString, through: FINAL_MIGRATION });
    requireCondition(applied.length === EXPECTED_MIGRATION_COUNT && applied.at(-1) === FINAL_MIGRATION,
      "migration_set_mismatch");
  } catch (error) {
    if (error instanceof ClarificationEvalFailure) throw error;
    fail("migration_failed");
  }

  const fixtureClient = new Client({ connectionString: target.connectionString });
  try {
    const fixture = await readFile(new URL("../database/fixtures/demo.sql", import.meta.url), "utf8");
    await fixtureClient.connect();
    await fixtureClient.query("BEGIN");
    await fixtureClient.query(fixture);
    await fixtureClient.query("COMMIT");
  } catch {
    await fixtureClient.query("ROLLBACK").catch(() => undefined);
    fail("fixture_load_failed");
  } finally { await fixtureClient.end().catch(() => undefined); }
}

async function canonicalCounts(pool: Pool, tripId: string): Promise<CanonicalCounts> {
  const result = await pool.query<{ itinerary_count: number; expense_count: number }>(
    `SELECT (SELECT count(*)::integer FROM itinerary_items WHERE trip_id=$1) AS itinerary_count,
            (SELECT count(*)::integer FROM expenses WHERE trip_id=$1) AS expense_count`, [tripId]);
  return {
    itineraryCount: result.rows[0]?.itinerary_count ?? -1,
    expenseCount: result.rows[0]?.expense_count ?? -1,
  };
}

async function createSyntheticContext(pool: Pool): Promise<{
  session: AuthenticatedSession; guestMemberId: string; firstDayId: string;
}> {
  try {
    const shape = await pool.query<{ trip_count: number; item_count: number; expense_count: number; owner_count: number }>(
      `SELECT (SELECT count(*)::integer FROM trips) AS trip_count,
              (SELECT count(*)::integer FROM itinerary_items) AS item_count,
              (SELECT count(*)::integer FROM expenses) AS expense_count,
              (SELECT count(*)::integer FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL) AS owner_count`);
    requireCondition(JSON.stringify(shape.rows[0]) === JSON.stringify({
      trip_count: 1, item_count: 1, expense_count: 1, owner_count: 1,
    }), "fixture_shape_mismatch");
    const fixtureOwner = await pool.query<{ trip_id: string; member_id: string; user_id: string }>(
      `SELECT trip_id,id AS member_id,user_id FROM trip_members
        WHERE role='owner' AND status='active' AND user_id IS NOT NULL`);
    const owner = fixtureOwner.rows[0];
    requireCondition(owner && fixtureOwner.rowCount === 1, "fixture_shape_mismatch");
    await bindSyntheticAiOperator(pool, owner.user_id);
    const sourceSession: AuthenticatedSession = {
      sessionId: "synthetic-clarification-source", tripId: owner.trip_id, memberId: owner.member_id,
      userId: owner.user_id, role: "owner", displayName: "DDB",
      expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date("2030-04-06T00:00:00Z"),
      issuer: syntheticOperatorIdentity.issuer, subject: syntheticOperatorIdentity.subject, generation: 1,
    };
    const trip = await createTrip(pool, sourceSession, {
      name: "Synthetic clarification evaluation", destinationName: "Tokyo, Japan",
      timeZone: "Asia/Tokyo", defaultLocale: "zh-HK-lihkg", defaultCurrency: "JPY",
      startsOn: "2030-04-01", endsOn: "2030-04-05", maxMembers: 2,
    });
    await sponsorSyntheticAiTrip(pool, trip.tripId, owner.user_id);
    const session: AuthenticatedSession = {
      ...sourceSession, sessionId: "synthetic-clarification-owner",
      tripId: trip.tripId, memberId: trip.memberId,
    };
    const guest = await createTripMember(pool, session, trip.tripId, { displayName: "Guest" });
    const firstDay = await pool.query<{ id: string }>(
      `SELECT id FROM trip_days WHERE trip_id=$1 AND day_date=DATE '2030-04-01'`, [trip.tripId]);
    requireCondition(firstDay.rowCount === 1 && firstDay.rows[0], "synthetic_setup_failed");
    return { session, guestMemberId: guest.id, firstDayId: firstDay.rows[0].id };
  } catch (error) {
    if (error instanceof ClarificationEvalFailure) throw error;
    fail("synthetic_setup_failed");
  }
}

function missingPayerPrompt(): string {
  return `Create exactly one private lodging event with one linked expense from this synthetic receipt. The private event is for DDB and Guest. Split the final expense equally between DDB and Guest. Before preparing the proposal, ask me who pays and wait for my answer. Do not use web search.

合成テスト用ホテル予約（実在の予約ではありません）
ホテル名: 架空ホテル夕星 東京
チェックイン: 2030-04-01 15:00 JST (+09:00)
チェックアウト: 2030-04-05 11:00 JST (+09:00)
通常小計: ¥55,001
VIP割引: -¥4,900
最終請求額: ¥50,101
支払者: 記載なし
予約PIN: ${SYNTHETIC_PIN}
予約管理URL: ${SYNTHETIC_PRIVATE_URL}`;
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === new Set(actual).size
    && [...actual].sort().join("|") === [...expected].sort().join("|");
}

function sameInstant(actual: string | null | undefined, expected: string): boolean {
  return typeof actual === "string" && Date.parse(actual) === Date.parse(expected);
}

async function draftReceipt(
  pool: Pool,
  tripId: string,
  requestId: string,
  eventType: "planning.draft" | "planning.draft.receipt",
  state: "awaiting_details" | "consumed",
  rootRequestId: string,
  sourceRequestIds: readonly string[],
): Promise<Record<string, unknown>> {
  const result = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM ai_request_events
      WHERE trip_id=$1 AND ai_request_id=$2 AND event_type=$3
      ORDER BY sequence DESC LIMIT 1`, [tripId, requestId, eventType]);
  const payload = result.rows[0]?.payload;
  const sources = Array.isArray(payload?.sourceRequestIds)
    && payload.sourceRequestIds.every((value): value is string => typeof value === "string")
    ? payload.sourceRequestIds : [];
  requireCondition(result.rowCount === 1 && payload?.state === state
    && payload.rootRequestId === rootRequestId && sameMembers(sources, sourceRequestIds)
    && typeof payload.expiresAt === "string" && Number.isFinite(Date.parse(payload.expiresAt)),
  "draft_receipt_mismatch");
  return payload;
}

async function requireNoSearch(pool: Pool, tripId: string, requestId: string): Promise<void> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM ai_request_events
      WHERE trip_id=$1 AND ai_request_id=$2 AND event_type LIKE 'web.search.%'`, [tripId, requestId]);
  requireCondition(result.rows[0]?.count === 1, "web_search_was_used");
  const policy = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM ai_request_events
      WHERE trip_id=$1 AND ai_request_id=$2 AND event_type='web.search.policy'`, [tripId, requestId]);
  requireCondition(policy.rowCount === 1 && policy.rows[0]?.payload.enabled === false,
    "web_search_was_used");
}

async function assertNoSecretPersistence(pool: Pool, session: AuthenticatedSession, prompt: string): Promise<void> {
  const secrets = inspectReservationSecrets(prompt);
  requireCondition(secrets.credentials.includes(SYNTHETIC_PIN)
    && secrets.privateUrls.includes(SYNTHETIC_PRIVATE_URL), "reservation_secret_leaked");
  const requests = await pool.query<{ result_text: string | null; error_message: string | null }>(
    `SELECT result_text,error_message FROM ai_requests WHERE trip_id=$1`, [session.tripId]);
  const events = await pool.query<{ payload_text: string }>(
    `SELECT payload::text AS payload_text FROM ai_request_events WHERE trip_id=$1`, [session.tripId]);
  const checkpoints = await pool.query<{ summary_text: string; summary_json_text: string }>(
    `SELECT summary_text,summary_json::text AS summary_json_text
       FROM ai_conversation_checkpoints WHERE trip_id=$1`, [session.tripId]);
  const proposals = await pool.query<{ patch_text: string; reason: string }>(
    `SELECT proposed_patch::text AS patch_text,reason FROM change_requests WHERE trip_id=$1`, [session.tripId]);
  const audits = await pool.query<{ before_text: string | null; after_text: string | null; metadata_text: string }>(
    `SELECT before_state::text AS before_text,after_state::text AS after_text,metadata::text AS metadata_text
       FROM audit_events WHERE trip_id=$1`, [session.tripId]);
  const surfaces = [
    ...requests.rows.flatMap((row) => [row.result_text ?? "", row.error_message ?? ""]),
    ...events.rows.map((row) => row.payload_text),
    ...checkpoints.rows.flatMap((row) => [row.summary_text, row.summary_json_text]),
    ...proposals.rows.flatMap((row) => [row.patch_text, row.reason]),
    ...audits.rows.flatMap((row) => [row.before_text ?? "", row.after_text ?? "", row.metadata_text]),
  ];
  requireCondition(surfaces.every((surface) => !containsKnownReservationSecret(surface, secrets)),
    "reservation_secret_leaked");
}

async function runEvaluation(target: DatabaseTarget, model: OwnerModel): Promise<void> {
  await prepareDatabase(target);
  await withSyntheticAiOperator(target.connectionString, async () => {
  const pool = new Pool({ connectionString: target.connectionString, max: 2 });
  try {
    const { session, guestMemberId, firstDayId } = await createSyntheticContext(pool);
    const before = await canonicalCounts(pool, session.tripId);
    requireCondition(before.itineraryCount === 0 && before.expenseCount === 0, "synthetic_setup_failed");
    const firstPrompt = missingPayerPrompt();
    let first: Awaited<ReturnType<typeof runAiPlanner>>;
    try { first = await runAiPlanner(pool, session, firstPrompt, model, "zh-HK-lihkg"); }
    catch { fail("planner_failed"); }
    requireCondition(first.model === model && first.proposalCount === 0 && first.proposalIds.length === 0
      && first.proposalId === null && first.changeStatus === null && first.entityId === null
      && first.webSearch.performed === false, "first_turn_mismatch");
    await draftReceipt(
      pool, session.tripId, first.requestId, "planning.draft", "awaiting_details",
      first.requestId, [first.requestId],
    );
    await requireNoSearch(pool, session.tripId, first.requestId);
    let proposalCount = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM change_requests WHERE trip_id=$1`, [session.tripId]);
    requireCondition(proposalCount.rows[0]?.count === 0, "first_turn_mismatch");

    let second: Awaited<ReturnType<typeof runAiPlanner>>;
    try { second = await runAiPlanner(pool, session, PAYER_FOLLOW_UP, model, "zh-HK-lihkg"); }
    catch { fail("planner_failed"); }
    if (!(second.model === model && second.proposalCount === 1 && second.proposalIds.length === 1
      && second.proposalId === second.proposalIds[0] && second.changeStatus === "pending"
      && second.entityId === null && second.memory.previousTurnsUsed >= 1
      && second.webSearch.performed === false)) {
      console.error("Second-turn shape:", JSON.stringify({
        model: second.model,
        proposalCount: second.proposalCount,
        proposalIds: second.proposalIds.length,
        changeStatus: second.changeStatus,
        hasEntityId: second.entityId !== null,
        previousTurnsUsed: second.memory.previousTurnsUsed,
        webSearchPerformed: second.webSearch.performed,
      }));
    }
    requireCondition(second.model === model && second.proposalCount === 1 && second.proposalIds.length === 1
      && second.proposalId === second.proposalIds[0] && second.changeStatus === "pending"
      && second.entityId === null && second.memory.previousTurnsUsed >= 1
      && second.webSearch.performed === false, "second_turn_mismatch");
    await draftReceipt(
      pool, session.tripId, first.requestId, "planning.draft", "consumed",
      first.requestId, [first.requestId, second.requestId],
    );
    await draftReceipt(
      pool, session.tripId, second.requestId, "planning.draft.receipt", "consumed",
      first.requestId, [first.requestId, second.requestId],
    );
    await requireNoSearch(pool, session.tripId, second.requestId);
    const proposalResult = await pool.query<{ proposed_patch: unknown; status: string; entity_type: string; operation: string }>(
      `SELECT proposed_patch,status,entity_type,operation FROM change_requests
        WHERE trip_id=$1 AND id=$2`, [session.tripId, second.proposalId]);
    const proposal = proposalResult.rows[0];
    const parsed = aiItineraryPatchSchema.safeParse(proposal?.proposed_patch);
    requireCondition(proposalResult.rowCount === 1 && proposal?.status === "pending"
      && proposal.entity_type === "itinerary_item" && proposal.operation === "create" && parsed.success,
    "proposal_shape_mismatch");
    const patch = parsed.data;
    requireCondition(patch.tripDayId === firstDayId && patch.itemType === "lodging"
      && patch.status === "planned" && patch.visibility === "private"
      && sameMembers(patch.viewerMemberIds ?? [], [guestMemberId])
      && sameInstant(patch.startsAt, "2030-04-01T06:00:00Z")
      && sameInstant(patch.endsAt, "2030-04-05T02:00:00Z")
      && patch.linkedExpense?.amountMinor === EXPECTED_TOTAL_JPY
      && patch.linkedExpense.currency === "JPY"
      && patch.linkedExpense.payerMemberId === session.memberId
      && sameMembers(patch.linkedExpense.splitMemberIds, [session.memberId, guestMemberId])
      && sameInstant(patch.linkedExpense.occurredAt, "2030-04-01T06:00:00Z"),
    "proposal_shape_mismatch");

    let third: Awaited<ReturnType<typeof runAiPlanner>>;
    try { third = await runAiPlanner(pool, session, PAYER_FOLLOW_UP, model, "zh-HK-lihkg"); }
    catch { fail("planner_failed"); }
    requireCondition(third.proposalCount === 0 && third.proposalIds.length === 0
      && third.proposalId === null && third.changeStatus === null && third.entityId === null
      && third.webSearch.performed === false, "draft_reused");
    const thirdRequest = await pool.query<{ status: string; proposal_id: string | null }>(
      `SELECT status,proposal_id FROM ai_requests WHERE trip_id=$1 AND id=$2`,
      [session.tripId, third.requestId]);
    requireCondition(thirdRequest.rowCount === 1 && thirdRequest.rows[0]?.status === "succeeded"
      && thirdRequest.rows[0].proposal_id === null, "draft_reused");
    const detachedDraftEvents = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ai_request_events
        WHERE trip_id=$1 AND ai_request_id=$2
          AND event_type IN ('planning.draft','planning.draft.receipt')`,
      [session.tripId, third.requestId]);
    requireCondition(detachedDraftEvents.rows[0]?.count === 0, "draft_reused");
    await draftReceipt(
      pool, session.tripId, first.requestId, "planning.draft", "consumed",
      first.requestId, [first.requestId, second.requestId],
    );
    proposalCount = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM change_requests WHERE trip_id=$1`, [session.tripId]);
    requireCondition(proposalCount.rows[0]?.count === 1, "draft_reused");

    // A fresh request with no payer can use a disclosed tentative requester
    // assignment, without requiring another clarification turn.
    const defaultsPrompt = firstPrompt.replace(
      "Before preparing the proposal, ask me who pays and wait for my answer. ", "",
    ).replace("架空ホテル夕星 東京", "架空ホテル朝星 東京");
    const defaults = await runAiPlanner(pool, session, defaultsPrompt, model, "zh-HK-lihkg");
    requireCondition(defaults.proposalCount === 1 && defaults.changeStatus === "pending"
      && defaults.message.includes(reservationExpenseReviewNotice("zh-HK-lihkg")), "proposal_shape_mismatch");
    const defaultProposal = await pool.query<{ proposed_patch: unknown; reason: string; status: string }>(
      `SELECT proposed_patch,reason,status FROM change_requests WHERE trip_id=$1 AND id=$2`,
      [session.tripId, defaults.proposalId],
    );
    const defaultPatch = aiItineraryPatchSchema.parse(defaultProposal.rows[0]?.proposed_patch);
    requireCondition(defaultProposal.rows[0]?.status === "pending"
      && defaultProposal.rows[0].reason.includes(reservationExpenseReviewNotice("zh-HK-lihkg"))
      && defaultPatch.visibility === "private" && defaultPatch.itemType === "lodging"
      && sameMembers(defaultPatch.viewerMemberIds ?? [], [guestMemberId])
      && defaultPatch.linkedExpense?.payerMemberId === session.memberId
      && defaultPatch.linkedExpense.amountMinor === EXPECTED_TOTAL_JPY
      && defaultPatch.linkedExpense.currency === "JPY"
      && sameMembers(defaultPatch.linkedExpense.splitMemberIds, [session.memberId, guestMemberId])
      && sameInstant(defaultPatch.startsAt, "2030-04-01T06:00:00Z")
      && sameInstant(defaultPatch.endsAt, "2030-04-05T02:00:00Z"), "proposal_shape_mismatch");
    await requireNoSearch(pool, session.tripId, defaults.requestId);
    const after = await canonicalCounts(pool, session.tripId);
    requireCondition(JSON.stringify(after) === JSON.stringify(before), "canonical_data_changed");
    await assertNoSecretPersistence(pool, session, firstPrompt);
  } finally { await pool.end(); }
  });
}

async function main(): Promise<void> {
  const target = parseDatabaseTarget(process.env.TEST_DATABASE_URL);
  requireIsolatedTarget(target);
  const model = selectedModel();
  await runEvaluation(target, model);
  console.log(`AI reservation clarification eval passed: ${model}.`);
}

main().catch((error: unknown) => {
  const code = error instanceof ClarificationEvalFailure ? error.code : "unexpected_failure";
  console.error(`AI reservation clarification eval failed: ${code}.`);
  process.exitCode = 1;
});
