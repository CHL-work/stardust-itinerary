import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { withUserAiCredential } from "@/lib/ai/credential-context";
import { readAiCredentialSecret } from "@/lib/ai/credentials";
import {
  aiEfforts, isAiEffort, isSelectableModel, modelProvider, ROUTINE_DEFAULT_EFFORT, routineDefaultModels, type AiEffort,
} from "@/lib/ai/effort";
import type { AiPreferences } from "@/lib/ai/preferences-types";
import { verifyRoutineWebSearch, type RoutineSearchCheck } from "@/lib/ai/routine-check-provider";
import { AppConflictError, AppInvalidInputError, appendAudit, assertTrip, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import { selectableOwnerModels, type KeyedModelProvider, type SelectableOwnerModel } from "@/lib/app/types";
import type { AuthenticatedSession } from "@/lib/auth/repository";

/**
 * Account AI preferences on the AI tab (JOB-094, D-106): the effort for chat on your own key, and routine
 * checks: on/off, model and effort. Routine checks turn on only after the chosen model passed one live web
 * search on your saved key; a key saved again later must pass again before checks resume.
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

type PreferenceRow = {
  chat_effort: string | null; routine_enabled: boolean; routine_model: string | null; routine_effort: string;
  routine_verified_model: string | null; routine_verified_at: Date | null; routine_enabled_at: Date | null; revision: number;
};
type Db = Pick<PoolClient, "query">;

async function readRow(client: Db, userId: string, lock = false): Promise<PreferenceRow | null> {
  const result = await client.query<PreferenceRow>(
    `SELECT chat_effort, routine_enabled, routine_model, routine_effort, routine_verified_model, routine_verified_at,
            routine_enabled_at, revision
       FROM account_ai_preferences WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
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

function view(row: PreferenceRow | null, keys: Map<KeyedModelProvider, Date>, activity: { lastCheckAt: string | null; checksToday: number }): AiPreferences {
  const model = row && isSelectableModel(row.routine_model) ? row.routine_model : null;
  const enabled = Boolean(row?.routine_enabled && model);
  const keyTime = model ? keys.get(modelProvider(model)) : undefined;
  return {
    chatEffort: row && isAiEffort(row.chat_effort) ? row.chat_effort : null,
    routine: {
      enabled,
      model,
      effort: row && isAiEffort(row.routine_effort) ? row.routine_effort : ROUTINE_DEFAULT_EFFORT,
      active: Boolean(enabled && keyTime && row?.routine_verified_at && row.routine_verified_model === model
        && keyTime.getTime() <= row.routine_verified_at.getTime()),
      ...activity,
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
    const enable = value.routine ? value.routine.enabled : Boolean(row?.routine_enabled);
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
    const saved = await client.query<PreferenceRow>(
      `INSERT INTO account_ai_preferences (user_id, chat_effort, routine_enabled, routine_model, routine_effort,
         routine_verified_model, routine_verified_at, routine_enabled_at, revision, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
       ON CONFLICT (user_id) DO UPDATE SET chat_effort = EXCLUDED.chat_effort, routine_enabled = EXCLUDED.routine_enabled,
         routine_model = EXCLUDED.routine_model, routine_effort = EXCLUDED.routine_effort,
         routine_verified_model = EXCLUDED.routine_verified_model, routine_verified_at = EXCLUDED.routine_verified_at,
         routine_enabled_at = EXCLUDED.routine_enabled_at, revision = account_ai_preferences.revision + 1, updated_at = EXCLUDED.updated_at
       RETURNING chat_effort, routine_enabled, routine_model, routine_effort, routine_verified_model, routine_verified_at,
         routine_enabled_at, revision`,
      [session.userId, chatEffort, enable, routineModel, routineEffort, verifiedModel, verifiedAt, enabledAt, at],
    );
    const before = { chatEffort: row?.chat_effort ?? null, routineEnabled: Boolean(row?.routine_enabled),
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
