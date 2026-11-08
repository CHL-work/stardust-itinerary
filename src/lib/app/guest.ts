import { createHmac, randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { inTransaction } from "@/lib/app/repository";
import { recordDailyCount } from "@/lib/admin/daily-counts";
import type { AuthConfig } from "@/lib/auth/config";
import { GUEST_ISSUER } from "@/lib/auth/guest-identity";
import type { AccountGrant } from "@/lib/auth/account-session";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/tokens";
import type { Locale } from "@/lib/i18n";

/**
 * Guest accounts: a try-it-now account that starts at Create Trip, permanently
 * deleted 24 hours after creation. A guest has a synthetic identity under its own issuer, so no
 * Google sign-in can ever reach it. AI uses its own API key or the enabled keyless free lane.
 */
export { GUEST_ISSUER, isGuestSession } from "@/lib/auth/guest-identity";
export const GUEST_LIFETIME_HOURS = 24;
const DEFAULT_ACTIVE_GUEST_LIMIT = 200;
const DEFAULT_GUESTS_PER_ADDRESS = 3;

export class GuestCapacityError extends Error {
  constructor() {
    super("Guest trips are busy right now. Try again later, or sign in with Google.");
    this.name = "GuestCapacityError";
  }
}

export class GuestAddressLimitError extends Error {
  constructor() {
    super("Too many guest trips are active from here. Use one you already started, or try again tomorrow.");
    this.name = "GuestAddressLimitError";
  }
}

export function guestModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GUEST_MODE_ENABLED === "true";
}

function positiveSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Whether guest creation must pass Cloudflare Turnstile. With guest mode on, a missing secret is a
 * misconfiguration that disables guest creation, unless the operator explicitly waives the check
 * for a private instance with GUEST_ALLOW_WITHOUT_TURNSTILE=true.
 */
export function turnstileMode(env: Record<string, string | undefined> = process.env): "required" | "waived" | "misconfigured" {
  if (env.TURNSTILE_SECRET_KEY?.trim()) return "required";
  return env.GUEST_ALLOW_WITHOUT_TURNSTILE === "true" ? "waived" : "misconfigured";
}

/**
 * Cloudflare Turnstile verification for guest creation. Fails closed on anything but a successful
 * answer for this site's hostname and the guest action. Never follows redirects.
 */
export async function verifyTurnstile(
  token: string | undefined, remoteAddress: string | null, expected: { hostname: string; action: string },
  env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteAddress) body.set("remoteip", remoteAddress);
  try {
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body, redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: unknown; hostname?: unknown; action?: unknown };
    return result.success === true && result.hostname === expected.hostname && result.action === expected.action;
  } catch {
    return false;
  }
}

/** A keyed hash of the address a guest was created from: enough to count, nothing to read back. */
function guestOriginHash(config: AuthConfig, address: string): Buffer {
  return createHmac("sha256", config.authSecret).update(`stardust-guest-origin:${address}`).digest();
}

/**
 * Create only an isolated guest identity and a one-use Create Trip grant. No trip or events exist
 * until the guest submits the normal form. Google sign-in never adopts this identity or its data.
 */
export async function createGuestSession(
  pool: Pool, config: AuthConfig,
  input: { userAgent: string | null; locale: Locale; address: string; now?: Date },
  env: Record<string, string | undefined> = process.env,
): Promise<{ grant: AccountGrant; userId: string }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + GUEST_LIFETIME_HOURS * 60 * 60 * 1000);
  const origin = guestOriginHash(config, input.address);
  return inTransaction(pool, async (client) => {
    // One lock serializes guest creation, so the capacity checks below are exact.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('stardust-guest-creation', 0))");
    const active = await client.query<{ total: number; from_origin: number }>(
      `SELECT count(*)::integer AS total, count(*) FILTER (WHERE guest_origin_hash = $1)::integer AS from_origin
         FROM app_users WHERE guest_expires_at > CURRENT_TIMESTAMP`, [origin]);
    if ((active.rows[0]?.total ?? 0) >= positiveSetting(env.GUEST_ACTIVE_LIMIT, DEFAULT_ACTIVE_GUEST_LIMIT)) throw new GuestCapacityError();
    if ((active.rows[0]?.from_origin ?? 0) >= positiveSetting(env.GUEST_PER_ADDRESS_LIMIT, DEFAULT_GUESTS_PER_ADDRESS)) {
      throw new GuestAddressLimitError();
    }

    const userId = randomUUID();
    const subject = randomUUID();
    await client.query("INSERT INTO app_users (id, display_name, guest_expires_at, guest_origin_hash) VALUES ($1, $2, $3, $4)",
      [userId, "Guest", expiresAt, origin]);
    await client.query("INSERT INTO oidc_identities (issuer, subject, user_id) VALUES ($1, $2, $3)", [GUEST_ISSUER, subject, userId]);
    // Counted without the account, so the count outlives the guest's purge (JOB-069).
    await recordDailyCount(client, "guest_created");
    const rawToken = createOpaqueToken();
    const issued = await client.query<{ expires_at: Date }>(
      `INSERT INTO auth_account_sessions (id,user_id,issuer,subject,token_hash,expires_at)
       VALUES ($1,$2,$3,$4,$5,LEAST(CURRENT_TIMESTAMP + interval '15 minutes',$6)) RETURNING expires_at`,
      [randomUUID(),userId,GUEST_ISSUER,subject,hashOpaqueToken(config.authSecret,"account-onboarding",rawToken),expiresAt],
    );
    return { grant: { rawToken, expiresAt: issued.rows[0].expires_at }, userId };
  });
}

/**
 * Permanently delete expired guests, each in its own transaction, through the guarded database
 * function. Returns counts only; nothing about a guest's content is logged.
 */
export async function purgeExpiredGuests(pool: Pool, options: { limit?: number } = {}): Promise<{ purged: number; refused: number }> {
  // Guests refused before go last, so they can never hold back the others.
  const candidates = await pool.query<{ id: string }>(
    `SELECT id FROM app_users WHERE guest_expires_at IS NOT NULL AND guest_expires_at <= CURRENT_TIMESTAMP
      ORDER BY guest_purge_refused_at NULLS FIRST, guest_expires_at LIMIT $1`, [options.limit ?? 100]);
  let purged = 0;
  let refused = 0;
  for (const candidate of candidates.rows) {
    try {
      const result = await inTransaction(pool, (client) =>
        client.query<{ purged: boolean }>("SELECT app_purge_expired_guest($1) AS purged", [candidate.id]));
      if (result.rows[0]?.purged) purged += 1;
    } catch {
      // The function refuses anything not provably guest-only; leave it for the operator.
      refused += 1;
      await pool.query("UPDATE app_users SET guest_purge_refused_at = CURRENT_TIMESTAMP WHERE id = $1", [candidate.id]).catch(() => {});
    }
  }
  // Rate-limit windows last at most a day; old counters are only clutter.
  await pool.query("DELETE FROM auth_rate_limits WHERE window_started_at < CURRENT_TIMESTAMP - interval '2 days'").catch(() => {});
  // The admin page's daily counts are kept for 90 days (JOB-069).
  await pool.query("DELETE FROM platform_daily_counts WHERE day < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 90").catch(() => {});
  return { purged, refused };
}
