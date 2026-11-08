import type { PoolClient } from "pg";

import { withUserAiCredential } from "@/lib/ai/credential-context";
import { readAiCredentialSecret } from "@/lib/ai/credentials";
import { isAiEffort, isSelectableModel, modelProvider, type AiEffort } from "@/lib/ai/effort";
import { routineTransport } from "@/lib/ai/routine-check-provider";
import { ownerModelRegistry, selectableOwnerModels, type KeyedModelProvider, type SelectableOwnerModel } from "@/lib/app/types";
import { DISRUPTION_MODEL } from "@/lib/disruptions/provider";

/**
 * Who pays for a trip's routine checks (JOB-094, D-106). The operator's keys pay only in sponsored trips,
 * from the background worker. In every other trip, one active member who turned routine checks on pays
 * with their own key: owners first, then whoever turned them on earliest. The member's account must not
 * be suspended, must still hold a key for the chosen model's provider, and that key must have passed the
 * web search check after it was last saved. Members' keys are decrypted only by the web server.
 */
export type RoutinePayer = {
  memberId: string;
  userId: string;
  model: SelectableOwnerModel;
  effort: AiEffort;
  provider: KeyedModelProvider;
};

export type RoutineFunding = { kind: "operator" } | { kind: "member"; payer: RoutinePayer };

const registryModels = [...selectableOwnerModels];
const registryProviders = registryModels.map((model) => ownerModelRegistry[model].provider);

/**
 * An EXISTS/LATERAL-ready payer query for the trip whose id is `${tripColumn}`. Parameters `$models` and
 * `$providers` are the registry arrays from `routinePayerParameters`, at the given positions.
 */
export function routinePayerSql(tripColumn: string, modelsParam: number, providersParam: number): string {
  return `SELECT m.id AS member_id, m.user_id, p.routine_model AS model, p.routine_effort AS effort, registry.provider
       FROM trip_members m
       JOIN app_users payer_user ON payer_user.id = m.user_id AND payer_user.suspended_at IS NULL
       JOIN account_ai_preferences p ON p.user_id = m.user_id AND p.routine_enabled
        AND p.routine_verified_model = p.routine_model
       JOIN unnest($${modelsParam}::text[], $${providersParam}::text[]) AS registry(model, provider) ON registry.model = p.routine_model
       JOIN user_ai_credentials c ON c.user_id = m.user_id AND c.provider = registry.provider
        AND c.updated_at <= p.routine_verified_at
      WHERE m.trip_id = ${tripColumn} AND m.status = 'active'
      ORDER BY (m.role = 'owner') DESC, p.routine_enabled_at, m.id
      LIMIT 1`;
}

export function routinePayerParameters(): [string[], string[]] {
  return [registryModels, registryProviders];
}

type PayerRow = { member_id: string; user_id: string; model: string; effort: string; provider: string };

export function payerFromRow(row: PayerRow | undefined): RoutinePayer | null {
  if (!row || !isSelectableModel(row.model) || !isAiEffort(row.effort)) return null;
  const provider = modelProvider(row.model);
  if (provider !== row.provider) return null;
  return { memberId: row.member_id, userId: row.user_id, model: row.model, effort: row.effort, provider };
}

export async function loadRoutinePayer(client: Pick<PoolClient, "query">, tripId: string): Promise<RoutinePayer | null> {
  const [models, providers] = routinePayerParameters();
  const result = await client.query<PayerRow>(routinePayerSql("$1", 2, 3), [tripId, models, providers]);
  return payerFromRow(result.rows[0]);
}

/**
 * Runs `work` inside the payer's credential context. Returns null without calling `work` when the key no
 * longer opens (removed, unreadable, or this process may not decrypt it).
 */
export async function withRoutinePayerKey<T>(client: Pick<PoolClient, "query">, payer: RoutinePayer, work: () => Promise<T>): Promise<{ value: T } | null> {
  const key = await readAiCredentialSecret(client, payer.userId, payer.provider);
  if (!key) return null;
  const value = await withUserAiCredential({ source: "own", provider: payer.provider, apiKey: key.apiKey, vertex: key.vertex,
    ...(key.vertexExpress ? { vertexExpress: true } : {}) }, work);
  return { value };
}

/** The `ai_requests` columns that record who paid for a routine check and which model ran. */
export function routineRequestColumns(funding: RoutineFunding): {
  model: string; provider: KeyedModelProvider; transport: string; credentialSource: "own" | null; credentialMemberId: string | null; effort: AiEffort;
} {
  if (funding.kind === "operator") {
    return { model: DISRUPTION_MODEL, provider: "openai", transport: "codex_sdk", credentialSource: null, credentialMemberId: null, effort: "medium" };
  }
  const { payer } = funding;
  return { model: payer.model, provider: payer.provider, transport: routineTransport(payer.model), credentialSource: "own",
    credentialMemberId: payer.memberId, effort: payer.effort };
}
