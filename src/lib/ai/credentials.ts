import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { geminiEndpointFor } from "@/lib/ai/gemini";
import {
  CredentialEncryptionUnavailableError, credentialAssociatedData, credentialEncryptionConfigured, credentialHint, currentCredentialKeyVersion,
  openCredential, sealCredential, type AiCredentialProvider,
} from "@/lib/ai/credential-crypto";
import { CredentialKmsUnavailableError, kmsOpen, kmsSeal, kmsSettings, type KmsSettings } from "@/lib/ai/credential-kms";
import { AppForbiddenError, AppInvalidInputError, appendAudit, assertTrip, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { AuthenticatedSession } from "@/lib/auth/repository";

export const aiCredentialProviders = ["openai", "anthropic", "google"] as const satisfies readonly AiCredentialProvider[];

/** What the browser may ever see about a saved key. */
export type AiCredentialSummary = { provider: AiCredentialProvider; hint: string; vertex: boolean; validatedAt: string; updatedAt: string };

export const aiCredentialInputSchema = z.strictObject({
  provider: z.enum(aiCredentialProviders),
  apiKey: z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/u, "API keys contain only visible ASCII characters."),
  vertexProject: z.string().trim().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u).optional(),
  vertexLocation: z.string().trim().regex(/^[a-z][a-z0-9-]{0,39}$/u).optional(),
}).refine((value) => value.provider === "google" || (!value.vertexProject && !value.vertexLocation), {
  message: "Only Gemini keys can name a Vertex AI project.",
});
export type AiCredentialInput = z.infer<typeof aiCredentialInputSchema>;

export class AiCredentialRejectedError extends AppInvalidInputError {
  constructor() {
    super("The provider did not accept this API key.");
    this.name = "AI_KEY_REJECTED";
  }
}

export class AiKeysUnavailableError extends AppForbiddenError {
  constructor() {
    super("Saving API keys is not configured on this server.");
    this.name = "AI_KEYS_UNAVAILABLE";
  }
}

const VALIDATION_TIMEOUT_MS = 8_000;

/**
 * How this server seals users' keys (JOB-069): with Cloud KMS when `CREDENTIAL_KMS_KEY` is set,
 * otherwise with the local key ring, or null when neither is configured (or KMS is misconfigured),
 * in which case keys cannot be saved. Settings shows users which one applies.
 */
export type AiKeyProtection = "kms" | "local";
export function aiKeyProtection(env: Record<string, string | undefined> = process.env): AiKeyProtection | null {
  const kms = kmsSettings(env);
  if (kms === "invalid") return null;
  if (kms) return "kms";
  return credentialEncryptionConfigured(env) ? "local" : null;
}

type StoredSeal = { sealedWith: "local"; ciphertext: Buffer; nonce: Buffer; keyVersion: number } | { sealedWith: "kms"; ciphertext: Buffer };
type StoredRow = { ciphertext: Buffer; nonce: Buffer | null; key_version: number | null; sealed_with?: string | null };

function activeKms(env: Record<string, string | undefined>): KmsSettings {
  const kms = kmsSettings(env);
  if (!kms || kms === "invalid") throw new CredentialEncryptionUnavailableError();
  return kms;
}

async function sealForStorage(secret: string, owner: { userId: string; provider: AiCredentialProvider },
  env: Record<string, string | undefined> = process.env): Promise<StoredSeal> {
  if (aiKeyProtection(env) === "kms") {
    return { sealedWith: "kms", ciphertext: await kmsSeal(secret, credentialAssociatedData(owner.userId, owner.provider), activeKms(env)) };
  }
  return { sealedWith: "local", ...sealCredential(secret, owner, env) };
}

/** Rows saved before migration 0059 have no `sealed_with`; they are all local. */
async function openStored(row: StoredRow, owner: { userId: string; provider: AiCredentialProvider },
  env: Record<string, string | undefined> = process.env): Promise<string> {
  if (row.sealed_with === "kms") return kmsOpen(row.ciphertext, credentialAssociatedData(owner.userId, owner.provider), activeKms(env));
  if (!row.nonce || row.key_version === null) throw new Error("Credential ciphertext is malformed.");
  return openCredential({ ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version }, owner, env);
}

async function hasSealedWithColumn(client: Pick<PoolClient, "query">): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_ai_credentials' AND column_name = 'sealed_with') AS present`);
  return result.rows[0]?.present === true;
}

/**
 * Ask the provider whether the key works, with the cheapest read-only call it offers. Nothing about
 * the response is kept except "accepted". A rejected key is never stored.
 */
export async function validateAiCredential(input: AiCredentialInput, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const signal = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
  let response: Response;
  try {
    // Never follow a redirect: fetch would forward the x-api-key and x-goog-api-key headers to it.
    if (input.provider === "openai") {
      response = await fetchImpl("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${input.apiKey}` }, redirect: "error", signal,
      });
    } else if (input.provider === "anthropic") {
      response = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" }, redirect: "error", signal,
      });
    } else {
      const endpoint = geminiEndpointFor(input.apiKey, input.vertexProject, input.vertexLocation ?? (input.vertexProject ? "global" : null));
      if (!endpoint) return false;
      // countTokens is free and works for both Gemini API and Vertex AI keys.
      response = await fetchImpl(endpoint.url("gemini-3.5-flash-lite").replace(/:generateContent$/u, ":countTokens"), {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": endpoint.apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ok" }] }] }), redirect: "error", signal,
      });
    }
  } catch {
    throw new AppInvalidInputError("The provider could not be reached to check this key. Try again.");
  }
  await response.body?.cancel().catch(() => {});
  return response.ok;
}

type CredentialRow = {
  provider: AiCredentialProvider; key_hint: string; vertex_project: string | null; validated_at: Date; updated_at: Date;
};

function summary(row: CredentialRow): AiCredentialSummary {
  return { provider: row.provider, hint: row.key_hint, vertex: row.vertex_project !== null,
    validatedAt: row.validated_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

export async function listAiCredentials(pool: Pool, session: AuthenticatedSession, tripId: string): Promise<AiCredentialSummary[]> {
  assertTrip(session, tripId);
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const result = await client.query<CredentialRow>(
      `SELECT provider, key_hint, vertex_project, validated_at, updated_at
         FROM user_ai_credentials WHERE user_id = $1 ORDER BY provider`, [session.userId]);
    return result.rows.map(summary);
  });
}

export async function saveAiCredential(
  pool: Pool, session: AuthenticatedSession, tripId: string, input: AiCredentialInput,
  validate: (input: AiCredentialInput) => Promise<boolean> = (value) => validateAiCredential(value),
): Promise<AiCredentialSummary> {
  assertTrip(session, tripId);
  const value = aiCredentialInputSchema.parse(input);
  if (!aiKeyProtection()) throw new AiKeysUnavailableError();
  // Validate and seal before any transaction: the provider and KMS calls can take seconds.
  if (!await validate(value)) throw new AiCredentialRejectedError();
  const sealed = await sealForStorage(value.apiKey, { userId: session.userId, provider: value.provider });
  const vertexLocation = value.vertexProject ? value.vertexLocation ?? "global" : null;
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const sealedColumn = await hasSealedWithColumn(client);
    // A KMS ciphertext needs migration 0059; the deploy runs migrations before the web server.
    if (sealed.sealedWith === "kms" && !sealedColumn) throw new AiKeysUnavailableError();
    const nonce = sealed.sealedWith === "local" ? sealed.nonce : null;
    const keyVersion = sealed.sealedWith === "local" ? sealed.keyVersion : null;
    const values = [session.userId, value.provider, sealed.ciphertext, nonce, keyVersion, credentialHint(value.apiKey),
      value.vertexProject ?? null, vertexLocation];
    const result = await client.query<CredentialRow>(sealedColumn
      ? `INSERT INTO user_ai_credentials (user_id, provider, ciphertext, nonce, key_version, key_hint,
           vertex_project, vertex_location, validated_at, sealed_with)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9)
         ON CONFLICT (user_id, provider) DO UPDATE
           SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, key_version = EXCLUDED.key_version,
               sealed_with = EXCLUDED.sealed_with, key_hint = EXCLUDED.key_hint, vertex_project = EXCLUDED.vertex_project,
               vertex_location = EXCLUDED.vertex_location, validated_at = EXCLUDED.validated_at,
               updated_at = CURRENT_TIMESTAMP
         RETURNING provider, key_hint, vertex_project, validated_at, updated_at`
      : `INSERT INTO user_ai_credentials (user_id, provider, ciphertext, nonce, key_version, key_hint,
           vertex_project, vertex_location, validated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, provider) DO UPDATE
           SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, key_version = EXCLUDED.key_version,
               key_hint = EXCLUDED.key_hint, vertex_project = EXCLUDED.vertex_project,
               vertex_location = EXCLUDED.vertex_location, validated_at = EXCLUDED.validated_at,
               updated_at = CURRENT_TIMESTAMP
         RETURNING provider, key_hint, vertex_project, validated_at, updated_at`,
      sealedColumn ? [...values, sealed.sealedWith] : values,
    );
    await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "ai_credential",
      action: "ai.credential.saved", metadata: { provider: value.provider } });
    return summary(result.rows[0]!);
  });
}

export async function deleteAiCredential(pool: Pool, session: AuthenticatedSession, tripId: string, provider: AiCredentialProvider): Promise<void> {
  assertTrip(session, tripId);
  if (!aiCredentialProviders.includes(provider)) throw new AppInvalidInputError("Unknown provider.");
  await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const result = await client.query("DELETE FROM user_ai_credentials WHERE user_id = $1 AND provider = $2", [session.userId, provider]);
    if (result.rowCount) {
      await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "ai_credential",
        action: "ai.credential.deleted", metadata: { provider } });
    }
  });
}

/** Requests that ran on a user's keys, per provider: their own, and members' through a shared key. */
export type AiKeyUsage = Record<AiCredentialProvider, { today: number; last30Days: number; sharedToday: number; sharedLast30Days: number }>;

/**
 * The key owner's own view of what their keys paid for (JOB-066), across every trip: counts only,
 * never prompts. Shared use counts requests where one of the user's memberships was the sponsor.
 */
export async function aiKeyUsage(pool: Pool, session: AuthenticatedSession, tripId: string): Promise<AiKeyUsage> {
  assertTrip(session, tripId);
  const usage = Object.fromEntries(aiCredentialProviders.map((provider) =>
    [provider, { today: 0, last30Days: 0, sharedToday: 0, sharedLast30Days: 0 }])) as AiKeyUsage;
  const sponsorColumn = await pool.query<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_requests' AND column_name = 'credential_sponsor_member_id') AS present`);
  const shared = sponsorColumn.rows[0]?.present
    ? `OR (request.credential_source = 'shared' AND EXISTS (SELECT 1 FROM trip_members sponsor
         WHERE sponsor.trip_id = request.trip_id AND sponsor.id = request.credential_sponsor_member_id AND sponsor.user_id = $1))`
    : "";
  const result = await pool.query<{ provider: AiCredentialProvider; own_today: string; own_month: string; shared_today: string; shared_month: string }>(
    `SELECT request.provider,
            count(*) FILTER (WHERE request.credential_source = 'own' AND request.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS own_today,
            count(*) FILTER (WHERE request.credential_source = 'own')::text AS own_month,
            count(*) FILTER (WHERE request.credential_source = 'shared' AND request.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS shared_today,
            count(*) FILTER (WHERE request.credential_source = 'shared')::text AS shared_month
       FROM ai_requests request
      WHERE request.created_at >= CURRENT_TIMESTAMP - interval '30 days' AND request.status <> 'rejected'
        AND request.provider IN ('openai', 'anthropic', 'google')
        AND ((request.credential_source = 'own' AND request.actor_user_id = $1) ${shared})
      GROUP BY request.provider`,
    [session.userId],
  );
  for (const row of result.rows) {
    usage[row.provider] = { today: Number(row.own_today), last30Days: Number(row.own_month),
      sharedToday: Number(row.shared_today), sharedLast30Days: Number(row.shared_month) };
  }
  return usage;
}

/** Server-only: the decrypted key for one provider, or null. Never send the result to a client. */
export async function readAiCredentialSecret(
  client: Pick<PoolClient, "query">, userId: string, provider: AiCredentialProvider,
): Promise<{ apiKey: string; vertex: { project: string; location: string } | null } | null> {
  // `*` keeps this working on databases from before migration 0059, which have no `sealed_with`.
  const result = await client.query<StoredRow & { vertex_project: string | null; vertex_location: string | null }>(
    "SELECT * FROM user_ai_credentials WHERE user_id = $1 AND provider = $2", [userId, provider]);
  const row = result.rows[0];
  if (!row) return null;
  try {
    const apiKey = await openStored(row, { userId, provider });
    return { apiKey, vertex: row.vertex_project && row.vertex_location ? { project: row.vertex_project, location: row.vertex_location } : null };
  } catch (error) {
    // A key that no longer opens (changed encryption key, tampered row, KMS unreachable or
    // refusing) is treated as absent. The operator still sees that it happened; the log names no
    // user, key or ciphertext.
    console.warn("A stored AI key could not be decrypted", {
      provider, sealedWith: row.sealed_with ?? "local", keyVersion: row.key_version,
      reason: error instanceof CredentialEncryptionUnavailableError ? "encryption_unavailable"
        : error instanceof CredentialKmsUnavailableError ? `kms_${error.step}` : "decrypt_failed",
    });
    return null;
  }
}

export type AiCredentialReencryption = {
  sealer: AiKeyProtection; currentVersion: number | null; reencrypted: number; unreadable: number; remaining: number;
};

/**
 * With Cloud KMS configured (JOB-069): seal and open a synthetic value, move every key still under the
 * local ring into KMS, then open every KMS-sealed key once, to prove that this server's identity can
 * use the KMS key. Each of those checks is a use that KMS logs, like any other. Same locking and
 * counting rules as the local rotation below.
 */
async function moveAiCredentialsToKms(
  pool: Pool, kms: KmsSettings, env: Record<string, string | undefined>, batchSize: number,
): Promise<AiCredentialReencryption> {
  // Prove that this server can use the key before moving anything, even when no key is saved yet:
  // a synthetic value bound to no real account must come back unchanged.
  const probe = `stardust-kms-probe-${randomUUID()}`;
  const probeData = credentialAssociatedData("00000000-0000-4000-8000-000000000000", "openai");
  if (await kmsOpen(await kmsSeal(probe, probeData, kms), probeData, kms) !== probe) throw new CredentialEncryptionUnavailableError();
  const unreadableRows = new Set<string>();
  let reencrypted = 0;
  for (;;) {
    const batch = await inTransaction(pool, async (client) => {
      const rows = await client.query<{ user_id: string; provider: AiCredentialProvider; ciphertext: Buffer; nonce: Buffer; key_version: number }>(
        `SELECT user_id, provider, ciphertext, nonce, key_version FROM user_ai_credentials
          WHERE sealed_with = 'local' AND NOT ((user_id::text || ':' || provider) = ANY ($1::text[]))
          ORDER BY user_id, provider LIMIT $2 FOR UPDATE SKIP LOCKED`, [[...unreadableRows], batchSize]);
      let moved = 0;
      for (const row of rows.rows) {
        const owner = { userId: row.user_id, provider: row.provider };
        let secret: string;
        try {
          secret = openCredential({ ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version }, owner, env);
        } catch {
          unreadableRows.add(`${row.user_id}:${row.provider}`);
          continue;
        }
        const ciphertext = await kmsSeal(secret, credentialAssociatedData(owner.userId, owner.provider), kms);
        await client.query(
          `UPDATE user_ai_credentials SET ciphertext = $3, nonce = NULL, key_version = NULL, sealed_with = 'kms'
            WHERE user_id = $1 AND provider = $2 AND sealed_with = 'local'`, [row.user_id, row.provider, ciphertext]);
        moved += 1;
      }
      return { fetched: rows.rows.length, moved };
    });
    reencrypted += batch.moved;
    if (batch.fetched < batchSize) break;
  }
  let unreadableKms = 0;
  let after: { userId: string; provider: string } | null = null;
  for (;;) {
    const rows: { rows: { user_id: string; provider: AiCredentialProvider; ciphertext: Buffer }[] } = await pool.query(
      `SELECT user_id, provider, ciphertext FROM user_ai_credentials
        WHERE sealed_with = 'kms' AND ($1::uuid IS NULL OR (user_id, provider) > ($1::uuid, $2::text))
        ORDER BY user_id, provider LIMIT $3`, [after?.userId ?? null, after?.provider ?? "", batchSize]);
    for (const row of rows.rows) {
      try {
        await kmsOpen(row.ciphertext, credentialAssociatedData(row.user_id, row.provider), kms);
      } catch {
        unreadableKms += 1;
      }
    }
    if (rows.rows.length < batchSize) break;
    const last = rows.rows[rows.rows.length - 1]!;
    after = { userId: last.user_id, provider: last.provider };
  }
  const remaining = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM user_ai_credentials WHERE sealed_with = 'local'");
  return { sealer: "kms", currentVersion: null, reencrypted, unreadable: unreadableRows.size + unreadableKms,
    remaining: Number(remaining.rows[0]?.count ?? 0) };
}

/**
 * Key rotation: re-seal every saved key that is not under the current encryption key. Rows are
 * locked in small batches and skipped when a request holds them, so a concurrent save is never
 * overwritten; a row that no longer opens is left in place, counted, and treated as absent, and its
 * owner adds the key again. `updated_at` is the owner's last change, so it stays. Rows already under
 * the current version are opened too: a key replaced without raising its version would otherwise
 * make every saved key unreadable while this reported nothing to do. Counts only.
 *
 * With Cloud KMS configured, keys move into KMS instead. Without it, keys already sealed by KMS
 * cannot be opened here and are counted as unreadable.
 */
export async function reencryptAiCredentials(
  pool: Pool, env: Record<string, string | undefined> = process.env, batchSize = 100,
): Promise<AiCredentialReencryption> {
  const kms = kmsSettings(env);
  if (kms === "invalid") throw new CredentialEncryptionUnavailableError();
  if (kms) return moveAiCredentialsToKms(pool, kms, env, batchSize);
  const currentVersion = currentCredentialKeyVersion(env);
  const unreadableRows = new Set<string>();
  let reencrypted = 0;
  for (;;) {
    const batch = await inTransaction(pool, async (client) => {
      const rows = await client.query<{ user_id: string; provider: AiCredentialProvider; ciphertext: Buffer; nonce: Buffer; key_version: number }>(
        `SELECT user_id, provider, ciphertext, nonce, key_version FROM user_ai_credentials
          WHERE key_version <> $1 AND NOT ((user_id::text || ':' || provider) = ANY ($2::text[]))
          ORDER BY user_id, provider LIMIT $3 FOR UPDATE SKIP LOCKED`, [currentVersion, [...unreadableRows], batchSize]);
      let moved = 0;
      for (const row of rows.rows) {
        const owner = { userId: row.user_id, provider: row.provider };
        let secret: string;
        try {
          secret = openCredential({ ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version }, owner, env);
        } catch {
          unreadableRows.add(`${row.user_id}:${row.provider}`);
          continue;
        }
        const sealed = sealCredential(secret, owner, env);
        await client.query(
          `UPDATE user_ai_credentials SET ciphertext = $3, nonce = $4, key_version = $5
            WHERE user_id = $1 AND provider = $2 AND key_version = $6`,
          [row.user_id, row.provider, sealed.ciphertext, sealed.nonce, sealed.keyVersion, row.key_version]);
        moved += 1;
      }
      return { fetched: rows.rows.length, moved };
    });
    reencrypted += batch.moved;
    if (batch.fetched < batchSize) break;
  }
  let unreadableCurrent = 0;
  let after: { userId: string; provider: string } | null = null;
  for (;;) {
    const rows: { rows: { user_id: string; provider: AiCredentialProvider; ciphertext: Buffer; nonce: Buffer; key_version: number }[] } = await pool.query(
      `SELECT user_id, provider, ciphertext, nonce, key_version FROM user_ai_credentials
        WHERE key_version = $1 AND ($2::uuid IS NULL OR (user_id, provider) > ($2::uuid, $3::text))
        ORDER BY user_id, provider LIMIT $4`, [currentVersion, after?.userId ?? null, after?.provider ?? "", batchSize]);
    for (const row of rows.rows) {
      try {
        openCredential({ ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version }, { userId: row.user_id, provider: row.provider }, env);
      } catch {
        unreadableCurrent += 1;
      }
    }
    if (rows.rows.length < batchSize) break;
    const last = rows.rows[rows.rows.length - 1]!;
    after = { userId: last.user_id, provider: last.provider };
  }
  const remaining = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM user_ai_credentials WHERE key_version <> $1", [currentVersion]);
  // Only KMS-sealed rows have no key version (migration 0059).
  const kmsSealed = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM user_ai_credentials WHERE key_version IS NULL");
  return { sealer: "local", currentVersion, reencrypted, unreadable: unreadableRows.size + unreadableCurrent + Number(kmsSealed.rows[0]?.count ?? 0),
    remaining: Number(remaining.rows[0]?.count ?? 0) };
}

/** Providers the user holds keys for, without decrypting anything. */
export async function aiCredentialProvidersFor(client: Pick<PoolClient, "query">, userId: string): Promise<Set<AiCredentialProvider>> {
  const result = await client.query<{ provider: AiCredentialProvider }>(
    "SELECT provider FROM user_ai_credentials WHERE user_id = $1", [userId]);
  return new Set(result.rows.map((row) => row.provider));
}
