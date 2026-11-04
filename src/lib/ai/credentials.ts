import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { geminiEndpointFor } from "@/lib/ai/gemini";
import {
  CredentialEncryptionUnavailableError, credentialEncryptionConfigured, credentialHint, openCredential, sealCredential,
  type AiCredentialProvider,
} from "@/lib/ai/credential-crypto";
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
  if (!credentialEncryptionConfigured()) throw new AiKeysUnavailableError();
  // Validate before any transaction: the provider call can take seconds.
  if (!await validate(value)) throw new AiCredentialRejectedError();
  const sealed = sealCredential(value.apiKey, { userId: session.userId, provider: value.provider });
  const vertexLocation = value.vertexProject ? value.vertexLocation ?? "global" : null;
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const result = await client.query<CredentialRow>(
      `INSERT INTO user_ai_credentials (user_id, provider, ciphertext, nonce, key_version, key_hint,
         vertex_project, vertex_location, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, provider) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, key_version = EXCLUDED.key_version,
             key_hint = EXCLUDED.key_hint, vertex_project = EXCLUDED.vertex_project,
             vertex_location = EXCLUDED.vertex_location, validated_at = EXCLUDED.validated_at,
             updated_at = CURRENT_TIMESTAMP
       RETURNING provider, key_hint, vertex_project, validated_at, updated_at`,
      [session.userId, value.provider, sealed.ciphertext, sealed.nonce, sealed.keyVersion, credentialHint(value.apiKey),
        value.vertexProject ?? null, vertexLocation],
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

/** Server-only: the decrypted key for one provider, or null. Never send the result to a client. */
export async function readAiCredentialSecret(
  client: Pick<PoolClient, "query">, userId: string, provider: AiCredentialProvider,
): Promise<{ apiKey: string; vertex: { project: string; location: string } | null } | null> {
  const result = await client.query<{ ciphertext: Buffer; nonce: Buffer; key_version: number; vertex_project: string | null; vertex_location: string | null }>(
    `SELECT ciphertext, nonce, key_version, vertex_project, vertex_location
       FROM user_ai_credentials WHERE user_id = $1 AND provider = $2`, [userId, provider]);
  const row = result.rows[0];
  if (!row) return null;
  try {
    const apiKey = openCredential({ ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version }, { userId, provider });
    return { apiKey, vertex: row.vertex_project && row.vertex_location ? { project: row.vertex_project, location: row.vertex_location } : null };
  } catch (error) {
    // A key that no longer opens (changed encryption key, tampered row) is treated as absent. The
    // operator still sees that it happened; the log names no user, key or ciphertext.
    console.warn("A stored AI key could not be decrypted", {
      provider, keyVersion: row.key_version,
      reason: error instanceof CredentialEncryptionUnavailableError ? "encryption_unavailable" : "decrypt_failed",
    });
    return null;
  }
}

/** Providers the user holds keys for, without decrypting anything. */
export async function aiCredentialProvidersFor(client: Pick<PoolClient, "query">, userId: string): Promise<Set<AiCredentialProvider>> {
  const result = await client.query<{ provider: AiCredentialProvider }>(
    "SELECT provider FROM user_ai_credentials WHERE user_id = $1", [userId]);
  return new Set(result.rows.map((row) => row.provider));
}
