import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { withUserAiCredential } from "@/lib/ai/credential-context";
import { readAiCredentialSecret } from "@/lib/ai/credentials";
import {
  aiEfforts, isAiEffort, isSelectableModel, modelProvider, ROUTINE_DEFAULT_EFFORT, routineDefaultModels, type AiEffort,
} from "@/lib/ai/effort";
import type { AiPreferences } from "@/lib/ai/preferences-types";
import { routineAutoState, routineIsActive, type RoutineAutoRow } from "@/lib/ai/routine-auto-check";
import { verifyRoutineWebSearch, type RoutineSearchCheck } from "@/lib/ai/routine-check-provider";
import { AppConflictError, AppInvalidInputError, appendAudit, assertTrip, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import { selectableOwnerModels, type KeyedModelProvider, type SelectableOwnerModel } from "@/lib/app/types";
import type { AuthConfig } from "@/lib/auth/config";
import { isGuestSession } from "@/lib/auth/guest-identity";
import { enforceRateLimit, type AuthenticatedSession } from "@/lib/auth/repository";

/**
 * Account AI preferences on the AI tab (JOB-094, D-106): the effort for chat on your own key, and routine
 * checks: on/off, model and effort. Routine checks run only after the chosen model passed one live web
 * search on your saved key; a key saved again later must pass again before checks resume. Since JOB-096
 * (D-108) saving a key starts that check by itself and turns checks on, unless the member turned them off.
 */
export type { AiPreferences } from "@/lib/ai/preferences-types";

export const aiPreferencesInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  chatEffort: z.enum(aiEfforts).nullable().optional(),
  routine: z.object({
    enabled: z.boolean(),
    model: z.enum(selectableOwnerModels).optional(),
    effort: z.enum(aiEfforts).optional(),
  }).strict().optional(),
}).strict();
export type AiPreferencesInput = z.infer<typeof aiPreferencesInputSchema>;

/** The chosen model cannot search the web on this key, or the provider refused or failed the check. */
export class RoutineSearchCheckError extends Error {
  constructor(readonly reason: Exclude<RoutineSearchCheck, { ok: true }>["reason"]) {
    super(reason === "no_search" ? "This key could not search the web with that model."
      : reason === "auth" ? "The provider refused this key." : "The web search check failed. Try again later.");
    this.name = "RoutineSearchCheckError";
  }
}

const SEARCH_CHECKS_PER_HOUR = 10;
const GUEST_SEARCH_CHECKS_PER_DAY = 3;

/** Each web search check calls the provider on the member's key: bound how often one account can start one. */
export async function limitRoutineSearchChecks(pool: Pool, config: AuthConfig, session: AuthenticatedSession): Promise<void> {
  await enforceRateLimit(pool, config, { scope: "ai-routine-search-check", key: session.userId, userId: session.userId,
    maximum: SEARCH_CHECKS_PER_HOUR, windowSeconds: 3600 });
  if (isGuestSession(session)) {
    await enforceRateLimit(pool, config, { scope: "ai-routine-search-check-guest", key: session.userId, userId: session.userId,
      maximum: GUEST_SEARCH_CHECKS_PER_DAY, windowSeconds: 86_400 });
  }
}

type PreferenceRow = RoutineAutoRow & {
  chat_effort: string | null; routine_effort: string; routine_enabled_at: Date | null; revision: number;
};
type Db = Pick<PoolClient, "query">;
const rowColumns = `chat_effort, routine_enabled, routine_model, routine_effort, routine_verified_model, routine_verified_at,
  routine_enabled_at, revision, routine_opted_out, routine_check_model, routine_check_at, routine_check_result`;

async function readRow(client: Db, userId: string, lock = false): Promise<PreferenceRow | null> {
  const result = await client.query<PreferenceRow>(
    `SELECT ${rowColumns} FROM account_ai_preferences WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
  return result.rows[0] ?? null;
}

async function keyTimes(client: Db, userId: string): Promise<Map<KeyedModelProvider, Date>> {
  const result = await client.query<{ provider: KeyedModelProvider; updated_at: Date }>(
    "SELECT provider, updated_at FROM user_ai_credentials WHERE user_id = $1 ORDER BY provider", [userId]);
  return new Map(result.rows.map((row) => [row.provider, row.updated_at]));
}

/** Server-only: the account's chat effort for its own-key requests; null means each model's default. */
export async function readChatEffort(client: Db, userId: string): Promise<AiEffort | null> {
  const result = await client.query<{ chat_effort: string | null }>(
    "SELECT chat_effort FROM account_ai_preferences WHERE user_id = $1", [userId]);
  const value = result.rows[0]?.chat_effort ?? null;
  return isAiEffort(value) ? value : null;
}

async function routineActivity(client: Db, userId: string): Promise<{ lastCheckAt: string | null; checksToday: number }> {
  const result = await client.query<{ last_check_at: Date | null; checks_today: number }>(
    `SELECT max(r.created_at) AS last_check_at,
            count(*) FILTER (WHERE r.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS checks_today
       FROM trip_members payer
       JOIN ai_requests r ON r.trip_id = payer.trip_id AND r.credential_member_id = payer.id
      WHERE payer.user_id = $1 AND r.credential_source = 'own' AND r.initiator_kind = 'system'
        AND r.created_at >= CURRENT_TIMESTAMP - interval '30 days'`, [userId]);
  const row = result.rows[0];
  return { lastCheckAt: row?.last_check_at ? row.last_check_at.toISOString() : null, checksToday: row?.checks_today ?? 0 };
}

function view(row: PreferenceRow | null, keys: Map<KeyedModelProvider, Date>, activity: { lastCheckAt: string | null; checksToday: number },
  now = new Date()): AiPreferences {
  const model = row && isSelectableModel(row.routine_model) ? row.routine_model : null;
  return {
    chatEffort: row && isAiEffort(row.chat_effort) ? row.chat_effort : null,
    routine: {
      // On only while the chosen model's key is saved: removing that key stops the checks.
      enabled: Boolean(row?.routine_enabled && model && keys.has(modelProvider(model))),
      model,
      effort: row && isAiEffort(row.routine_effort) ? row.routine_effort : ROUTINE_DEFAULT_EFFORT,
      active: routineIsActive(row, keys),
      ...activity,
      optedOut: Boolean(row?.routine_opted_out),
      autoCheck: routineAutoState(row, keys, now),
    },
    providers: [...keys.keys()],
    revision: row?.revision ?? 0,
  };
}

export async function getAiPreferences(pool: Pool, session: AuthenticatedSession, tripId: string): Promise<AiPreferences> {
  assertTrip(session, tripId);
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    return view(await readRow(client, session.userId), await keyTimes(client, session.userId), await routineActivity(client, session.userId));
  });
}

type SaveDependencies = {
  now?: () => Date;
  /** Runs just before a live search check, so the route can rate-limit only real checks. */
  beforeSearchCheck?: () => Promise<void>;
  /** Tests replace the live search check. */
  verify?: (input: { userId: string; model: SelectableOwnerModel; effort: AiEffort; client: Db }) => Promise<RoutineSearchCheck>;
};

async function liveSearchCheck(input: { userId: string; model: SelectableOwnerModel; effort: AiEffort; client: Db }): Promise<RoutineSearchCheck> {
  const provider = modelProvider(input.model);
  const key = await readAiCredentialSecret(input.client, input.userId, provider);
  if (!key) return { ok: false, reason: "auth" };
  return withUserAiCredential({ source: "own", provider, apiKey: key.apiKey, vertex: key.vertex,
    ...(key.vertexExpress ? { vertexExpress: true } : {}) },
  () => verifyRoutineWebSearch({ model: input.model, effort: input.effort }, new Date(), AbortSignal.timeout(90_000)));
}

/**
 * Saves the account's preferences. Turning routine checks on, or choosing another model for them, runs the
 * web search check first, outside any transaction; the save then rechecks the revision and the key.
 * Turning them off records that the member chose so: a key saved later no longer turns them on.
 */
export async function saveAiPreferences(
  pool: Pool, session: AuthenticatedSession, tripId: string, input: AiPreferencesInput, dependencies: SaveDependencies = {},
): Promise<AiPreferences> {
  assertTrip(session, tripId);
  const value = aiPreferencesInputSchema.parse(input);
  const current = await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    return { row: await readRow(client, session.userId), keys: await keyTimes(client, session.userId) };
  });
  if ((current.row?.revision ?? 0) !== value.expectedRevision) {
    throw new AppConflictError("Your AI settings changed elsewhere. Reload before saving.");
  }

  let routineModel: SelectableOwnerModel | null = current.row && isSelectableModel(current.row.routine_model) ? current.row.routine_model : null;
  let routineEffort: AiEffort = current.row && isAiEffort(current.row.routine_effort) ? current.row.routine_effort : ROUTINE_DEFAULT_EFFORT;
  let verifiedNow = false;
  if (value.routine) {
    const firstProvider = (["openai", "anthropic", "google"] as const).find((provider) => current.keys.has(provider));
    routineModel = value.routine.model ?? routineModel ?? (firstProvider ? routineDefaultModels[firstProvider] : null);
    routineEffort = value.routine.effort ?? routineEffort;
    if (value.routine.enabled) {
      if (!routineModel || !current.keys.has(modelProvider(routineModel))) {
        throw new AppInvalidInputError("Add an API key for this model's provider first.");
      }
      const keyTime = current.keys.get(modelProvider(routineModel))!;
      const stillVerified = current.row?.routine_verified_model === routineModel && current.row.routine_verified_at !== null
        && keyTime.getTime() <= current.row.routine_verified_at.getTime();
      if (!stillVerified) {
        await dependencies.beforeSearchCheck?.();
        const check = await (dependencies.verify ?? liveSearchCheck)({ userId: session.userId, model: routineModel, effort: routineEffort, client: pool });
        if (!check.ok) throw new RoutineSearchCheckError(check.reason);
        verifiedNow = true;
      }
    }
  }

  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const row = await readRow(client, session.userId, true);
    if ((row?.revision ?? 0) !== value.expectedRevision) throw new AppConflictError("Your AI settings changed elsewhere. Reload before saving.");
    const keys = await keyTimes(client, session.userId);
    // Checks whose key was removed are off, so saving only the chat effort never needs that key.
    const wasOn = Boolean(row?.routine_enabled && isSelectableModel(row.routine_model) && keys.has(modelProvider(row.routine_model)));
    const enable = value.routine ? value.routine.enabled : wasOn;
    if (enable && (!routineModel || !keys.has(modelProvider(routineModel)))) {
      throw new AppInvalidInputError("Add an API key for this model's provider first.");
    }
    // A key replaced during the check would not be the key that passed it.
    if (verifiedNow && routineModel && keys.get(modelProvider(routineModel))?.getTime() !== current.keys.get(modelProvider(routineModel))?.getTime()) {
      throw new AppConflictError("Your API key changed during the check. Try again.");
    }
    // The database clock, which also stamped the key's `updated_at` that the payer check compares against.
    const at = dependencies.now?.() ?? (await client.query<{ now: Date }>("SELECT CURRENT_TIMESTAMP AS now")).rows[0].now;
    const chatEffort = value.chatEffort !== undefined ? value.chatEffort : (row && isAiEffort(row.chat_effort) ? row.chat_effort : null);
    const verifiedModel = verifiedNow ? routineModel : row?.routine_verified_model ?? null;
    const verifiedAt = verifiedNow ? at : row?.routine_verified_at ?? null;
    const enabledAt = enable ? (row?.routine_enabled && row.routine_model === routineModel && row.routine_enabled_at ? row.routine_enabled_at : at) : null;
    // Only switching checks off is a choice to keep them off; saving a model or effort while off is not.
    const optedOut = value.routine
      ? (value.routine.enabled ? false : wasOn ? true : Boolean(row?.routine_opted_out))
      : Boolean(row?.routine_opted_out);
    // A passing manual check is the latest check too, so an earlier automatic failure no longer shows.
    const check = verifiedNow ? { model: routineModel, at, result: "ok" }
      : { model: row?.routine_check_model ?? null, at: row?.routine_check_at ?? null, result: row?.routine_check_result ?? null };
    const saved = await client.query<PreferenceRow>(
      `INSERT INTO account_ai_preferences (user_id, chat_effort, routine_enabled, routine_model, routine_effort,
         routine_verified_model, routine_verified_at, routine_enabled_at, routine_opted_out, routine_check_model,
         routine_check_at, routine_check_result, revision, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13)
       ON CONFLICT (user_id) DO UPDATE SET chat_effort = EXCLUDED.chat_effort, routine_enabled = EXCLUDED.routine_enabled,
         routine_model = EXCLUDED.routine_model, routine_effort = EXCLUDED.routine_effort,
         routine_verified_model = EXCLUDED.routine_verified_model, routine_verified_at = EXCLUDED.routine_verified_at,
         routine_enabled_at = EXCLUDED.routine_enabled_at, routine_opted_out = EXCLUDED.routine_opted_out,
         routine_check_model = EXCLUDED.routine_check_model, routine_check_at = EXCLUDED.routine_check_at,
         routine_check_result = EXCLUDED.routine_check_result, revision = account_ai_preferences.revision + 1,
         updated_at = EXCLUDED.updated_at
       RETURNING ${rowColumns}`,
      [session.userId, chatEffort, enable, routineModel, routineEffort, verifiedModel, verifiedAt, enabledAt, optedOut,
        check.model, check.at, check.result, at],
    );
    const before = { chatEffort: row?.chat_effort ?? null, routineEnabled: wasOn,
      routineModel: row?.routine_model ?? null, routineEffort: row?.routine_effort ?? ROUTINE_DEFAULT_EFFORT };
    const after = { chatEffort, routineEnabled: enable, routineModel, routineEffort };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await appendAudit(client, {
        tripId, actorMemberId: session.memberId, entityType: "ai_preferences",
        action: before.routineEnabled !== after.routineEnabled ? (enable ? "ai.routine.enabled" : "ai.routine.disabled") : "ai.preferences.updated",
        before, after, metadata: { revision: saved.rows[0].revision, searchChecked: verifiedNow },
      });
    }
    return view(saved.rows[0], keys, await routineActivity(client, session.userId));
  });
}

/** A started automatic check: the model and effort it tests, and its claim time, which only this run may finish. */
export type RoutineAutoClaim = { model: SelectableOwnerModel; effort: AiEffort; claimedAt: Date };

/**
 * Starts the automatic web search check when one is due (JOB-096): right after a key is saved, or when the
 * AI tab finds a key saved before checks turned on by themselves. The account's row is locked, so two web
 * servers never start the same check; the caller runs it after responding, with runRoutineAutoCheck.
 */
export async function claimRoutineAutoCheck(
  pool: Pool, session: AuthenticatedSession, tripId: string, options: { beforeCheck?: () => Promise<void>; now?: Date } = {},
): Promise<RoutineAutoClaim | null> {
  assertTrip(session, tripId);
  const now = options.now ?? new Date();
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const keys = await keyTimes(client, session.userId);
    let row = await readRow(client, session.userId, true);
    if (!row) {
      if (routineAutoState(null, keys, now)?.state !== "due") return null;
      await client.query("INSERT INTO account_ai_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [session.userId]);
      row = await readRow(client, session.userId, true);
    }
    const state = row ? routineAutoState(row, keys, now) : null;
    if (!row || state?.state !== "due") return null;
    await options.beforeCheck?.();
    const claimed = await client.query<{ routine_check_at: Date }>(
      `UPDATE account_ai_preferences SET routine_check_model = $2, routine_check_at = CURRENT_TIMESTAMP, routine_check_result = NULL,
         revision = revision + 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 RETURNING routine_check_at`, [session.userId, state.model]);
    return { model: state.model, effort: isAiEffort(row.routine_effort) ? row.routine_effort : ROUTINE_DEFAULT_EFFORT,
      claimedAt: claimed.rows[0]!.routine_check_at };
  });
}

/**
 * Runs a claimed check and records the result. A pass turns routine checks on with the checked model,
 * unless the member turned them off meanwhile, the key was saved again, or another check replaced this one.
 */
export async function runRoutineAutoCheck(
  pool: Pool, session: AuthenticatedSession, tripId: string, claim: RoutineAutoClaim, dependencies: Pick<SaveDependencies, "verify"> = {},
): Promise<"enabled" | "failed" | "skipped"> {
  let check: RoutineSearchCheck;
  try {
    check = await (dependencies.verify ?? liveSearchCheck)({ userId: session.userId, model: claim.model, effort: claim.effort, client: pool });
  } catch {
    check = { ok: false, reason: "provider" };
  }
  return inTransaction(pool, async (client) => {
    const row = await readRow(client, session.userId, true);
    if (!row || row.routine_check_model !== claim.model || row.routine_check_at?.getTime() !== claim.claimedAt.getTime()) return "skipped";
    const keyTime = (await keyTimes(client, session.userId)).get(modelProvider(claim.model));
    // A key saved again during the check is not the key that passed; its own save starts a new check.
    const sameKey = keyTime !== undefined && keyTime.getTime() <= claim.claimedAt.getTime();
    if (!check.ok || !sameKey || row.routine_opted_out) {
      await client.query(`UPDATE account_ai_preferences SET routine_check_result = $2, revision = revision + 1,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [session.userId, check.ok ? "ok" : check.reason]);
      return check.ok ? "skipped" : "failed";
    }
    const wasOn = row.routine_enabled && row.routine_model === claim.model;
    const saved = await client.query<{ revision: number }>(
      `UPDATE account_ai_preferences SET routine_enabled = true, routine_model = $2, routine_verified_model = $2,
         routine_verified_at = CURRENT_TIMESTAMP,
         routine_enabled_at = CASE WHEN $3::boolean THEN routine_enabled_at ELSE CURRENT_TIMESTAMP END,
         routine_check_result = 'ok', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 RETURNING revision`, [session.userId, claim.model, wasOn]);
    if (!wasOn) {
      await appendAudit(client, {
        tripId, actorMemberId: session.memberId, entityType: "ai_preferences", action: "ai.routine.enabled",
        before: { routineEnabled: row.routine_enabled, routineModel: row.routine_model },
        after: { routineEnabled: true, routineModel: claim.model, routineEffort: claim.effort },
        metadata: { revision: saved.rows[0]!.revision, searchChecked: true, automatic: true },
      });
    }
    return "enabled";
  });
}
