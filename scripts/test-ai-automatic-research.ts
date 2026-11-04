import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Client, Pool } from "pg";

import { createTrip } from "../src/lib/app/repository";
import { ownerModelRegistry, ownerModels, type OwnerModel } from "../src/lib/app/types";
import { prepareAiConversation } from "../src/lib/ai/conversation";
import { runAiPlanner } from "../src/lib/ai/planner";
import { aiItineraryPatchSchema } from "../src/lib/ai/proposal-contract";
import type { AiPlannerResult } from "../src/lib/ai/request-recovery-types";
import type { AuthenticatedSession } from "../src/lib/auth/repository";
import { bindSyntheticAiOperator, sponsorSyntheticAiTrip, syntheticOperatorIdentity, withSyntheticAiOperator } from "./lib/synthetic-ai-operator";

const FINAL_MIGRATION = "0049_custom_ai_instructions.sql";
const EXPECTED_MIGRATION_COUNT = 45;
// The caller creates/removes this exact disposable database. This evaluator never drops one.
const TEST_DATABASE_NAME = /^stardust_test_ai_auto_[a-z0-9_]+$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const SYNTHETIC_PROMPT = "Create one public Tokyo Skytree visit in Tokyo, Japan on 2030-04-02 from 10:00 to 11:00 Japan time, with one linked HKD 123.45 admission expense. I paid it and I am the only split participant. Keep HKD 123.45 as the ledger amount and currency. Also give me the latest HKD/JPY exchange rate as a dated reference only, without converting or replacing this expense. This is a synthetic software evaluation, not a real booking.";

type FailureCode = "live_eval_not_authorized" | "missing_test_database_url" | "invalid_test_database_url" | "unsafe_test_database_name"
  | "non_loopback_test_database" | "test_database_has_url_options" | "test_database_matches_application_database"
  | "test_database_connection_failed" | "test_database_not_fresh" | "migration_failed" | "migration_set_mismatch"
  | "fixture_load_failed" | "fixture_shape_mismatch" | "synthetic_setup_failed" | "invalid_model"
  | "planner_failed" | "planner_result_mismatch" | "proposal_shape_mismatch" | "canonical_data_changed"
  | "automatic_research_missing" | "search_evidence_missing" | "unverified_fx_message_mismatch" | "request_replay_mismatch" | "unexpected_failure";
class AutomaticResearchEvalFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); this.name = "AutomaticResearchEvalFailure"; }
}
type DatabaseTarget = { connectionString: string; databaseName: string; host: string; port: string };
type Fixture = { session: AuthenticatedSession; conversationId: string; dayId: string };
export type ResearchEvent = { event_type: string; payload: Record<string, unknown> };
type SafeDiagnostics = {
  stage: "preflight" | "database" | "fixture" | "planner" | "assertions" | "replay" | "complete";
  model?: OwnerModel; proposalCount?: number; queryCount?: number; sourceCount?: number;
  requestedCount?: number; completedCount?: number; finalizedCount?: number; outcome?: string;
  evaluationMode?: "strict_sourced_fx" | "workflow_allow_unverified";
  sourceOutcome?: "verified" | "unverified" | "missing";
};
let diagnostics: SafeDiagnostics = { stage: "preflight" };
function fail(code: FailureCode): never { throw new AutomaticResearchEvalFailure(code); }
function requireCondition(value: unknown, code: FailureCode): asserts value { if (!value) fail(code); }

export function parseDatabaseTarget(value: string | undefined): DatabaseTarget {
  if (!value) fail("missing_test_database_url");
  let url: URL;
  try { url = new URL(value); } catch { fail("invalid_test_database_url"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail("invalid_test_database_url");
  let databaseName: string;
  try { databaseName = decodeURIComponent(url.pathname.slice(1)); } catch { fail("invalid_test_database_url"); }
  if (databaseName.length > 63 || !TEST_DATABASE_NAME.test(databaseName)) fail("unsafe_test_database_name");
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
    } catch (error) { if (error instanceof AutomaticResearchEvalFailure) throw error; }
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
    if (error instanceof AutomaticResearchEvalFailure) throw error;
    fail("test_database_connection_failed");
  } finally { await client.end().catch(() => undefined); }

  try {
    const moduleUrl = new URL("./db/migration-lib.mjs", import.meta.url).href;
    const { migrate } = await import(moduleUrl) as { migrate(input: { connectionString: string; through: string }): Promise<string[]> };
    const applied = await migrate({ connectionString: target.connectionString, through: FINAL_MIGRATION });
    requireCondition(applied.length === EXPECTED_MIGRATION_COUNT && applied.at(-1) === FINAL_MIGRATION, "migration_set_mismatch");
  } catch (error) {
    if (error instanceof AutomaticResearchEvalFailure) throw error;
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

async function createSyntheticContext(pool: Pool): Promise<Fixture> {
  try {
    const fixture = await pool.query<{ trip_count: number; item_count: number; expense_count: number; owner_count: number }>(
      `SELECT (SELECT count(*)::integer FROM trips) AS trip_count,
        (SELECT count(*)::integer FROM itinerary_items) AS item_count,
        (SELECT count(*)::integer FROM expenses) AS expense_count,
        (SELECT count(*)::integer FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL) AS owner_count`,
    );
    requireCondition(isDeepStrictEqual(fixture.rows[0], { trip_count: 1, item_count: 1, expense_count: 1, owner_count: 1 }), "fixture_shape_mismatch");
    const ownerResult = await pool.query<{ trip_id: string; member_id: string; user_id: string; display_name: string }>(
      `SELECT trip_id,id AS member_id,user_id,display_name FROM trip_members WHERE role='owner' AND status='active' AND user_id IS NOT NULL`,
    );
    const owner = ownerResult.rows[0];
    requireCondition(owner && ownerResult.rowCount === 1, "fixture_shape_mismatch");
    await bindSyntheticAiOperator(pool, owner.user_id);
    const sourceSession: AuthenticatedSession = {
      sessionId: "synthetic-automatic-research-source", tripId: owner.trip_id, memberId: owner.member_id, userId: owner.user_id,
      role: "owner", displayName: owner.display_name, expiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date("2030-04-06T00:00:00Z"), issuer: syntheticOperatorIdentity.issuer,
      subject: syntheticOperatorIdentity.subject, generation: 1,
    };
    const trip = await createTrip(pool, sourceSession, {
      name: "Synthetic automatic research evaluation", destinationName: "Tokyo, Japan", timeZone: "Asia/Tokyo",
      defaultLocale: "en", defaultCurrency: "JPY", startsOn: "2030-04-01", endsOn: "2030-04-05", maxMembers: 1,
    });
    await sponsorSyntheticAiTrip(pool, trip.tripId, owner.user_id);
    const session = { ...sourceSession, sessionId: "synthetic-automatic-research-owner", tripId: trip.tripId, memberId: trip.memberId };
    const day = await pool.query<{ id: string }>(`SELECT id FROM trip_days WHERE trip_id=$1 AND day_date=DATE '2030-04-02'`, [session.tripId]);
    requireCondition(day.rowCount === 1 && day.rows[0], "synthetic_setup_failed");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const conversation = await prepareAiConversation(client, session);
      requireCondition(conversation.turns.length === 0, "synthetic_setup_failed");
      await client.query("COMMIT");
      return { session, conversationId: conversation.conversationId, dayId: day.rows[0].id };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) { if (error instanceof AutomaticResearchEvalFailure) throw error; fail("synthetic_setup_failed"); }
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

export function assertProposal(patch: unknown, dayId: string, memberId: string): void {
  const parsed = aiItineraryPatchSchema.safeParse(patch);
  requireCondition(parsed.success, "proposal_shape_mismatch");
  const item = parsed.data;
  const expense = item.linkedExpense;
  requireCondition(item.tripDayId === dayId && item.itemType === "activity" && item.status === "planned"
    && item.visibility === "trip" && !item.viewerMemberIds?.length
    && new Date(item.startsAt ?? "invalid").getTime() === Date.parse("2030-04-02T01:00:00Z")
    && new Date(item.endsAt ?? "invalid").getTime() === Date.parse("2030-04-02T02:00:00Z")
    && /skytree|スカイツリー|晴空塔/iu.test(item.locationName ?? "")
    && expense?.amountMinor === 12345 && expense.currency === "HKD" && expense.payerMemberId === memberId
    && isDeepStrictEqual(expense.splitMemberIds, [memberId]), "proposal_shape_mismatch");
}

function safeSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && Boolean(url.hostname);
  } catch { return false; }
}

// This English synthetic-evaluation sanity check is deliberately conservative,
// not an application validator or proof that arbitrary prose contains no claim.
export function hasSafeUnverifiedFxMessage(message: string): boolean {
  const text = message.normalize("NFKC").replace(/[*_`]/gu, "");
  const topic = /\b(?:HKD\s*(?:\/|to|→|-)\s*JPY|(?:exchange|reference|conversion)\s+rate|FX(?:\s+rate)?)\b/iu;
  const uncertain = /\b(?:unverified|unavailable|unconfirmed|not\s+(?:verified|confirmed|established|available)|no\s+(?:reliable|verified|confirmed|dated)\s+(?:reference\s+)?(?:rate|quote)|(?:unable\s+to|could(?:\s+not|n't)|can(?:not|'t)|did(?:\s+not|n't)|have(?:\s+not|n't))\s+(?:\w+\s+){0,3}(?:verify|confirm|find|establish|retrieve|obtain|provide))\b/iu;
  const explicitUncertainty = text.split(/[\n.!?]+/u).some((sentence) => topic.test(sentence) && uncertain.test(sentence));
  const quotedPairRate = /\b(?:\d+(?:[.,]\d+)?\s*HKD|HKD\s*\d+(?:[.,]\d+)?)\s*(?:=|≈|~|equals?|is|to)\s*(?:JPY\s*|¥\s*)?\d|\b\d+(?:[.,]\d+)?\s*(?:JPY|yen)\s*(?:\/|per|for)\s*(?:one\s*|1\s*)?HKD\b/iu;
  const quotedNamedRate = /\b(?:HKD\s*(?:\/|to|→|-)\s*JPY|(?:exchange|reference|conversion|FX)\s+rate)\s*(?::|=|≈|~|is\b|was\b|of\b)\s*(?:(?:about|approximately|around)\s+)?(?:JPY\s*|¥\s*)?\d/iu;
  return explicitUncertainty && !quotedPairRate.test(text) && !quotedNamedRate.test(text);
}

export function assertResearchEvidence(events: readonly ResearchEvent[], result: AiPlannerResult, allowUnverified = false): void {
  const requested = events.filter((event) => event.event_type === "public.research.requested");
  const completed = events.filter((event) => event.event_type === "public.research.completed");
  const finalized = events.filter((event) => event.event_type === "public.research.finalized");
  const receipt = completed[0]?.payload;
  const facts = Array.isArray(receipt?.facts) ? receipt.facts : [];
  const queries = Array.isArray(receipt?.queries) ? receipt.queries : [];
  const sources = Array.isArray(receipt?.sourceUrls) ? receipt.sourceUrls : [];
  const fxFacts = facts.filter((fact) => fact && typeof fact === "object" && fact.kind === "exchange_rate");
  const fxStatus = fxFacts.length === 1 && ["verified", "unverified"].includes(fxFacts[0]?.status) ? fxFacts[0].status as "verified" | "unverified" : "missing";
  const safeOutcome = ["researched", "unverified", "failed", "timeout", "cleanup_failed"].includes(String(receipt?.outcome))
    ? String(receipt?.outcome) : "other";
  diagnostics = { ...diagnostics, requestedCount: requested.length, completedCount: completed.length, finalizedCount: finalized.length,
    outcome: safeOutcome, sourceOutcome: fxStatus };
  requireCondition(requested.length === 1 && completed.length === 1 && finalized.length === 1
    && Number(requested[0]?.payload.eligibleCount) > 0 && ["researched", "unverified"].includes(String(receipt?.outcome))
    && finalized[0]?.payload.finalized === true && Number(finalized[0]?.payload.factCount) > 0
    && (fxStatus === "verified" ? receipt?.outcome === "researched" : allowUnverified && fxStatus === "unverified"), "automatic_research_missing");
  requireCondition(result.webSearch.performed && result.webSearch.queryCount > 0
    && result.webSearch.sources.every(safeSource) && Number(receipt?.queryCount) > 0
    && queries.some((query) => typeof query === "string" && /HKD/iu.test(query) && /JPY/iu.test(query))
    && sources.every(safeSource), "search_evidence_missing");
  if (fxStatus === "verified") {
    requireCondition(result.webSearch.sources.length > 0 && sources.length > 0, "search_evidence_missing");
  } else {
    requireCondition(hasSafeUnverifiedFxMessage(result.message), "unverified_fx_message_mismatch");
  }
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

async function runEvaluation(target: DatabaseTarget, model: OwnerModel, allowUnverified = false): Promise<void> {
  diagnostics = { stage: "database", model, evaluationMode: allowUnverified ? "workflow_allow_unverified" : "strict_sourced_fx" };
  await prepareDatabase(target);
  await withSyntheticAiOperator(target.connectionString, async () => {
    const pool = new Pool({ connectionString: target.connectionString, max: 2 });
    try {
      diagnostics.stage = "fixture";
      const fixture = await createSyntheticContext(pool);
      const beforeCanonical = await canonicalSnapshot(pool);
      const key = randomUUID();
      diagnostics.stage = "planner";
      let result: AiPlannerResult;
      try {
        const response = await runAiPlanner(pool, fixture.session, SYNTHETIC_PROMPT, model, "en", key, fixture.conversationId);
        requireCondition("requestId" in response, "planner_result_mismatch");
        result = response;
      } catch (error) { if (error instanceof AutomaticResearchEvalFailure) throw error; fail("planner_failed"); }
      diagnostics = { ...diagnostics, stage: "assertions", proposalCount: result.proposalCount,
        queryCount: result.webSearch.queryCount, sourceCount: result.webSearch.sources.length };
      const events = await pool.query<ResearchEvent>(
        `SELECT event_type,payload FROM ai_request_events WHERE trip_id=$1 AND ai_request_id=$2 ORDER BY sequence`,
        [fixture.session.tripId, result.requestId],
      );
      requireCondition(result.model === model && result.proposalCount === 1 && result.proposalIds.length === 1
        && result.proposalIds[0] === result.proposalId && result.changeStatus === "pending" && result.entityId === null, "planner_result_mismatch");
      const requests = await pool.query<{ status: string; requested_model: string; effective_model: string | null; provider: string; transport: string; authentication_mode: string; proposal_id: string | null }>(
        `SELECT status,requested_model,effective_model,provider,transport,authentication_mode,proposal_id FROM ai_requests WHERE trip_id=$1 AND id=$2`,
        [fixture.session.tripId, result.requestId],
      );
      const request = requests.rows[0]; const profile = ownerModelRegistry[model];
      requireCondition(requests.rowCount === 1 && request?.status === "succeeded" && request.requested_model === model
        && Boolean(request.effective_model) && request.provider === profile.provider && request.transport === profile.transport
        && request.authentication_mode === profile.authenticationMode && request.proposal_id === result.proposalId, "planner_result_mismatch");
      const proposals = await pool.query<{ id: string; source: string; entity_type: string; entity_id: string | null; operation: string; status: string; proposal_revision: number; proposed_patch: unknown; reviewed_at: Date | null; applied_revision: number | null }>(
        `SELECT id,source,entity_type,entity_id,operation,status,proposal_revision,proposed_patch,reviewed_at,applied_revision FROM change_requests WHERE trip_id=$1`,
        [fixture.session.tripId],
      );
      const proposal = proposals.rows[0];
      requireCondition(proposals.rowCount === 1 && proposal?.id === result.proposalId && proposal.source === "ai"
        && proposal.entity_type === "itinerary_item" && proposal.entity_id === null && proposal.operation === "create"
        && proposal.status === "pending" && proposal.proposal_revision === 1 && proposal.reviewed_at === null && proposal.applied_revision === null, "proposal_shape_mismatch");
      assertProposal(proposal.proposed_patch, fixture.dayId, fixture.session.memberId);
      requireCondition(await canonicalSnapshot(pool) === beforeCanonical, "canonical_data_changed");
      diagnostics.stage = "replay";
      const beforeReplay = await replaySnapshot(pool, fixture.session.tripId);
      const replay = await runAiPlanner(pool, fixture.session, SYNTHETIC_PROMPT, model, "en", key, fixture.conversationId);
      requireCondition("request" in replay && replay.request?.status === "succeeded"
        && replay.request.requestId === result.requestId && isDeepStrictEqual(replay.request.result, result), "request_replay_mismatch");
      requireCondition(await replaySnapshot(pool, fixture.session.tripId) === beforeReplay, "request_replay_mismatch");
      requireCondition(await canonicalSnapshot(pool) === beforeCanonical, "canonical_data_changed");
      // Both evaluation modes verify ledger, canonical and exact-key recovery
      // invariants before deciding whether the live FX evidence was sufficient.
      diagnostics.stage = "assertions";
      assertResearchEvidence(events.rows, result, allowUnverified);
      diagnostics.stage = "complete";
    } finally { await pool.end(); }
  });
}

export async function main(): Promise<void> {
  const model = selectedModel(process.argv.slice(2));
  const allowUnverified = process.argv.slice(2).includes("--allow-unverified");
  const target = parseDatabaseTarget(process.env.TEST_DATABASE_URL);
  requireIsolatedTarget(target);
  await runEvaluation(target, model, allowUnverified);
  console.log(`AI automatic research ${allowUnverified ? "workflow" : "strict sourced-FX benchmark"} passed: ${JSON.stringify(diagnostics)}.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    const code = error instanceof AutomaticResearchEvalFailure ? error.code : "unexpected_failure";
    console.error(`AI automatic research eval failed: ${code}; ${JSON.stringify(diagnostics)}.`);
    process.exitCode = 1;
  });
}
