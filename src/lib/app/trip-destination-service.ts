import { createHmac, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { withOperatorAiCredential } from "@/lib/ai/credential-context";
import { DESTINATION_LOOKUP_PROMPT_VERSION, DESTINATION_LOOKUP_TIMEOUT_MS, lookupTripDestination } from "@/lib/ai/trip-destination-provider";
import { AppConflictError } from "@/lib/app/repository";
import { unavailableDestination, type DestinationDefaults, type DestinationLookupReason,
  type DestinationLookupResponse } from "@/lib/app/trip-destination-contract";
import { normalizeDestination, validateDestinationInput } from "@/lib/app/trip-destination-defaults";
import { validatedStoredDestinationDefaults as cachedDefaults } from "@/lib/app/trip-destination-cache";
import { publicSignupEnabled, type AccountPrincipal } from "@/lib/auth/account-session";
import type { AuthConfig } from "@/lib/auth/config";
import { isPlatformOperator } from "@/lib/auth/operator-access";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import type { Locale } from "@/lib/i18n";

type Principal = AuthenticatedSession | AccountPrincipal;
type Db = Pick<PoolClient, "query">;
type LookupRow = { id: string; request_payload_hash: Buffer; response_json: DestinationDefaults | null;
  status: "started" | "succeeded" | "failed"; error_code: string | null };
type Entitlement = "platform_operator" | "trip_creator";

function mode(): "off" | "operator" | "creators" {
  const configured = process.env.STARDUST_DESTINATION_LOOKUP ?? "creators";
  return configured === "operator" || configured === "creators" ? configured : "off";
}

async function entitlement(client: Db, userId: string): Promise<Entitlement | null> {
  if (mode() === "off") return null;
  if (await isPlatformOperator(client, userId)) return "platform_operator";
  return mode() === "creators" ? "trip_creator" : null;
}

/** The UI only shows this control to an already verified principal. The API
 * independently rechecks the exact session/grant, not merely account existence. */
export async function canLookupTripDestination(pool: Pool, _config: AuthConfig, userId: string): Promise<boolean> {
  if (mode() === "off") return false;
  const eligible = await pool.query(
    `SELECT 1 FROM oidc_identities oi WHERE oi.user_id=$1 AND oi.issuer='https://accounts.google.com'
      AND (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.user_id=oi.user_id AND tm.status='active')
        OR ($2::boolean AND EXISTS (SELECT 1 FROM auth_account_sessions a WHERE a.user_id=oi.user_id
          AND a.issuer=oi.issuer AND a.subject=oi.subject AND a.consumed_at IS NULL AND a.expires_at>clock_timestamp()))) LIMIT 1`,
    [userId, publicSignupEnabled()],
  );
  return eligible.rows.length > 0 && await entitlement(pool, userId) !== null;
}

async function currentPrincipal(client: Db, principal: Principal): Promise<boolean> {
  if ("kind" in principal) {
    if (!publicSignupEnabled()) return false;
    const result = await client.query(
      `SELECT 1 FROM auth_account_sessions a JOIN oidc_identities oi ON oi.user_id=a.user_id
        AND oi.issuer=a.issuer AND oi.subject=a.subject
       WHERE a.id=$1 AND a.user_id=$2 AND a.issuer=$3 AND a.subject=$4
         AND a.issuer='https://accounts.google.com' AND a.consumed_at IS NULL AND a.expires_at>clock_timestamp()`,
      [principal.accountSessionId, principal.userId, principal.issuer, principal.subject],
    );
    return result.rows.length === 1;
  }
  const result = await client.query(
    `SELECT 1 FROM auth_sessions s JOIN trip_members tm ON tm.trip_id=s.trip_id AND tm.id=s.member_id
      AND tm.user_id=s.user_id AND tm.status='active' AND tm.role=$6
     WHERE s.id=$1 AND s.trip_id=$2 AND s.member_id=$3 AND s.user_id=$4 AND s.generation=$5
       AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp()
       AND EXISTS (SELECT 1 FROM oidc_identities oi WHERE oi.user_id=s.user_id
         AND oi.issuer=$7 AND oi.subject=$8 AND oi.issuer='https://accounts.google.com')`,
    [principal.sessionId, principal.tripId, principal.memberId, principal.userId, principal.generation,
      principal.role, principal.issuer, principal.subject],
  );
  return result.rows.length === 1;
}

function digest(config: AuthConfig, purpose: string, value: string): Buffer {
  return createHmac("sha256", config.authSecret).update(`destination-lookup:${purpose}\0${value}`).digest();
}

function failureReason(code: string | null): DestinationLookupReason {
  return code === "TIMEOUT" ? "timeout" : code === "INVALID_OUTPUT" || code === "TOOL_BLOCKED"
    ? "invalid_output" : code === "AUTH_CHANGED" ? "not_entitled" : "provider_unavailable";
}

function response(requestId: string, defaults: DestinationDefaults, lookupId: string | null = null,
  source: DestinationLookupResponse["source"] = "none"): DestinationLookupResponse {
  return { ...defaults, requestId, lookupId, source };
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Uses the already-held transaction client: a pool.query here would deadlock
 * a size-one pool while keeping the account's admission lock occupied. */
async function throttle(client: Db, config: AuthConfig, userId: string): Promise<boolean> {
  const result = await client.query<{ attempt_count: number }>(
    `INSERT INTO auth_rate_limits(scope,key_hash,window_started_at,attempt_count)
      VALUES ('trip-destination-lookup',$1,CURRENT_TIMESTAMP,1)
     ON CONFLICT(scope,key_hash) DO UPDATE SET
       attempt_count=CASE WHEN auth_rate_limits.window_started_at<=CURRENT_TIMESTAMP-interval '1 hour'
         THEN 1 ELSE auth_rate_limits.attempt_count+1 END,
       window_started_at=CASE WHEN auth_rate_limits.window_started_at<=CURRENT_TIMESTAMP-interval '1 hour'
         THEN CURRENT_TIMESTAMP ELSE auth_rate_limits.window_started_at END RETURNING attempt_count`,
    [digest(config, "throttle", userId)],
  );
  return result.rows[0].attempt_count <= 30;
}

export async function runTripDestinationLookup(
  pool: Pool, config: AuthConfig, principal: Principal,
  input: { destination: string; locale: Locale; requestId: string },
  options: { provider?: typeof lookupTripDestination; timeoutMs?: number } = {},
): Promise<DestinationLookupResponse> {
  const unavailable = (reason: DestinationLookupReason) => response(input.requestId, unavailableDestination(reason));
  if (!validateDestinationInput(input.destination)) return unavailable("private_text");
  const normalized = normalizeDestination(input.destination);
  const inputHash = digest(config, "input", normalized);
  const payloadHash = digest(config, "payload", JSON.stringify([input.destination.trim(), input.locale]));
  const admission = await transaction(pool, async (client): Promise<{ id: string } | DestinationLookupResponse> => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify([principal.userId, "destination-lookup"])]);
    if (!await currentPrincipal(client, principal)) return unavailable("not_entitled");
    const access = await entitlement(client, principal.userId);
    if (!access) return unavailable("not_entitled");
    // A crashed worker cannot permanently keep this account busy. Only started
    // rows may change, and the original worker cannot overwrite this terminal.
    await client.query(`UPDATE account_ai_lookups SET status='failed',error_code='TIMEOUT',completed_at=CURRENT_TIMESTAMP
      WHERE user_id=$1 AND status='started' AND created_at<=CURRENT_TIMESTAMP-interval '60 seconds'`, [principal.userId]);
    const replay = await client.query<LookupRow>(
      "SELECT id,request_payload_hash,response_json,status,error_code FROM account_ai_lookups WHERE user_id=$1 AND client_request_id=$2",
      [principal.userId, input.requestId],
    );
    const old = replay.rows[0];
    if (old) {
      if (!old.request_payload_hash.equals(payloadHash)) throw new AppConflictError("This lookup request ID was already used for different input.");
      if (old.status === "succeeded") {
        const defaults = cachedDefaults(old.response_json, normalized);
        return defaults ? response(input.requestId, defaults, old.id, "cache") : unavailable("invalid_output");
      }
      return unavailable(old.status === "started" ? "busy" : failureReason(old.error_code));
    }
    if (!await throttle(client, config, principal.userId)) return unavailable("rate_limited");
    const cached = await client.query<LookupRow>(
      `SELECT id,response_json FROM account_ai_lookups WHERE user_id=$1 AND input_hash=$2 AND prompt_version=$3
        AND status='succeeded' AND created_at>CURRENT_TIMESTAMP-interval '30 days' ORDER BY created_at DESC LIMIT 1`,
      [principal.userId, inputHash, DESTINATION_LOOKUP_PROMPT_VERSION],
    );
    const defaults = cachedDefaults(cached.rows[0]?.response_json, normalized);
    if (defaults) return response(input.requestId, defaults, cached.rows[0].id, "cache");
    const counts = await client.query<{ busy: boolean; daily: number }>(
      `SELECT bool_or(status='started') AS busy,
         count(*) FILTER (WHERE created_at>=date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily
       FROM account_ai_lookups WHERE user_id=$1`, [principal.userId],
    );
    if (counts.rows[0]?.busy) return unavailable("busy");
    if (access !== "platform_operator" && counts.rows[0].daily >= 10) return unavailable("quota");
    const id = randomUUID();
    await client.query(
      `INSERT INTO account_ai_lookups(id,user_id,client_request_id,request_payload_hash,input_hash,destination_text,
        display_locale,prompt_version,entitlement) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, principal.userId, input.requestId, payloadHash, inputHash, normalized, input.locale, DESTINATION_LOOKUP_PROMPT_VERSION, access],
    );
    return { id };
  });
  if (!("id" in admission)) return admission;

  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: Awaited<ReturnType<typeof lookupTripDestination>> | null = null;
  let errorCode: string | null = null;
  try {
    result = await Promise.race([
      // Operator-funded for eligible creators (D-071).
      withOperatorAiCredential(() => (options.provider ?? lookupTripDestination)({ destination: normalized, locale: input.locale, signal: controller.signal })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject({ code: "TIMEOUT" }); }, options.timeoutMs ?? DESTINATION_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    errorCode = typeof code === "string" && ["TIMEOUT", "INVALID_OUTPUT", "TOOL_BLOCKED"].includes(code)
      ? code : "PROVIDER_UNAVAILABLE";
  } finally { if (timer) clearTimeout(timer); }

  return transaction(pool, async (client) => {
    const stillAllowed = await currentPrincipal(client, principal) && await entitlement(client, principal.userId) !== null;
    if (!stillAllowed) errorCode = "AUTH_CHANGED";
    const defaults = errorCode === null && result ? result.defaults : null;
    const finished = await client.query<{ id: string }>(
      `UPDATE account_ai_lookups SET status=$3,response_json=$4::jsonb,effective_model=$5,
        input_tokens=$6,output_tokens=$7,cached_input_tokens=$8,latency_ms=$9,error_code=$10,completed_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND user_id=$2 AND status='started' RETURNING id`,
      [admission.id, principal.userId, defaults ? "succeeded" : "failed", defaults ? JSON.stringify(defaults) : null,
        result?.effectiveModel ?? null, result?.usage.inputTokens ?? null, result?.usage.outputTokens ?? null,
        result?.usage.cachedInputTokens ?? null, Math.max(0, Math.min(2147483647, Date.now() - startedAt)),
        defaults ? null : errorCode ?? "PROVIDER_UNAVAILABLE"],
    );
    if (!stillAllowed) return unavailable("not_entitled");
    if (finished.rowCount !== 1) return unavailable("timeout");
    return defaults ? response(input.requestId, defaults, admission.id, "ai") : unavailable(failureReason(errorCode));
  });
}
