import { createHmac, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import {
  appendAudit, applyPermittedChangeRequestWithClient, createChangeRequestWithClient, inTransaction,
} from "@/lib/app/repository";
import { recordDailyCount } from "@/lib/admin/daily-counts";
import type { AuthConfig } from "@/lib/auth/config";
import { GUEST_ISSUER } from "@/lib/auth/guest-identity";
import { insertSession, type AuthenticatedSession, type SessionGrant } from "@/lib/auth/repository";
import type { Locale } from "@/lib/i18n";

/**
 * Guest accounts (JOB-064, D-077): a try-it-now account with one synthetic demo trip, permanently
 * deleted 24 hours after creation. A guest has a synthetic identity under its own issuer, so no
 * Google sign-in can ever reach it, and it can use AI only with its own API key.
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

/** A date in Tokyo, `offset` days from now, as YYYY-MM-DD. */
function tokyoDate(now: Date, offset: number): string {
  return new Date(now.getTime() + (9 * 60 + offset * 24 * 60) * 60_000).toISOString().slice(0, 10);
}

const demoTitles: Record<"en" | "zh" | "ja", { trip: string; guest: string; events: string[] }> = {
  en: { trip: "Demo trip to Tokyo", guest: "Guest", events: [
    "Check in at the hotel", "Dinner in Shinjuku", "Morning walk at Meiji Jingu", "Lunch in Harajuku",
    "Shibuya at sunset", "Breakfast at Tsukiji Outer Market", "Train to Haneda Airport"] },
  zh: { trip: "東京示範旅程", guest: "訪客", events: [
    "酒店入住", "新宿晚餐", "明治神宮晨早散步", "原宿午餐", "澀谷日落", "築地場外市場早餐", "搭車去羽田機場"] },
  ja: { trip: "東京デモ旅行", guest: "ゲスト", events: [
    "ホテルにチェックイン", "新宿で夕食", "明治神宮で朝の散歩", "原宿でランチ", "夕暮れの渋谷", "築地場外市場で朝食", "羽田空港へ電車で移動"] },
};

/** The synthetic demo itinerary: day index, local start time, type and place. */
const demoEvents = [
  { day: 0, time: "15:00", type: "lodging", place: "Shinjuku, Tokyo" },
  { day: 0, time: "19:00", type: "meal", place: "Shinjuku, Tokyo" },
  { day: 1, time: "09:30", type: "activity", place: "Meiji Jingu, Shibuya, Tokyo" },
  { day: 1, time: "12:30", type: "meal", place: "Harajuku, Tokyo" },
  { day: 1, time: "17:00", type: "activity", place: "Shibuya Crossing, Tokyo" },
  { day: 2, time: "08:30", type: "meal", place: "Tsukiji Outer Market, Tokyo" },
  { day: 2, time: "13:00", type: "transport", place: "Haneda Airport, Tokyo" },
] as const;

/**
 * Create a guest account with its demo trip and a session for it, in one transaction. The session
 * and the account end together, when the purge job deletes everything 24 hours later.
 */
export async function createGuestSession(
  pool: Pool, config: AuthConfig,
  input: { userAgent: string | null; locale: Locale; address: string; now?: Date },
  env: Record<string, string | undefined> = process.env,
): Promise<{ grant: SessionGrant; tripId: string }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + GUEST_LIFETIME_HOURS * 60 * 60 * 1000);
  const copy = demoTitles[input.locale === "ja-JP" ? "ja" : input.locale.startsWith("zh") ? "zh" : "en"];
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
    const tripId = randomUUID();
    const memberId = randomUUID();
    const subject = randomUUID();
    await client.query("INSERT INTO app_users (id, display_name, guest_expires_at, guest_origin_hash) VALUES ($1, $2, $3, $4)",
      [userId, copy.guest, expiresAt, origin]);
    await client.query("INSERT INTO oidc_identities (issuer, subject, user_id) VALUES ($1, $2, $3)", [GUEST_ISSUER, subject, userId]);
    // Counted without the account, so the count outlives the guest's purge (JOB-069).
    await recordDailyCount(client, "guest_created");
    const dates = [0, 1, 2].map((offset) => tokyoDate(now, offset + 1));
    await client.query(
      `INSERT INTO trips (id, owner_user_id, name, destination_name, time_zone, default_locale, default_currency,
         starts_on, ends_on, max_members, guest_expires_at)
       VALUES ($1, $2, $3, 'Tokyo, Japan', 'Asia/Tokyo', $4, 'JPY', $5, $6, 1, $7)`,
      [tripId, userId, copy.trip, input.locale, dates[0], dates[2], expiresAt],
    );
    await client.query(
      "INSERT INTO trip_members (trip_id, id, user_id, display_name, role, status) VALUES ($1, $2, $3, $4, 'owner', 'active')",
      [tripId, memberId, userId, copy.guest],
    );
    await client.query(
      `INSERT INTO member_permissions (trip_id, member_id, can_edit_itinerary, itinerary_requires_approval,
         can_edit_expenses, expense_requires_approval, can_sync_calendar, updated_by_member_id)
       VALUES ($1, $2, true, false, true, false, false, $2)`,
      [tripId, memberId],
    );
    // AI is on, but never sponsored: a guest's own key is the only thing that can pay.
    await client.query(
      `INSERT INTO trip_ai_settings (trip_id, enabled, owner_default_model, member_daily_limit, updated_by_member_id, host_subscription_enabled)
       VALUES ($1, true, 'gpt-6.1-sol', 20, $2, false)`,
      [tripId, memberId],
    );
    await client.query(
      `INSERT INTO trip_disruption_settings (trip_id, enabled, interval_minutes, lookahead_hours, next_due_at, updated_by_member_id)
       VALUES ($1, false, 30, 168, CURRENT_TIMESTAMP, $2)`,
      [tripId, memberId],
    );
    const dayIds = dates.map(() => randomUUID());
    await client.query(
      `INSERT INTO trip_days (trip_id, id, day_date, label)
       SELECT $1, generated.id, generated.day_date, NULL FROM unnest($2::uuid[], $3::date[]) AS generated(id, day_date)`,
      [tripId, dayIds, dates],
    );
    await appendAudit(client, { tripId, actorMemberId: memberId, entityType: "trip", entityId: tripId, action: "created",
      metadata: { source: "guest", expiresAt: expiresAt.toISOString() } });
    await client.query("UPDATE app_users SET last_selected_trip_id = $2 WHERE id = $1", [userId, tripId]);
    const grant = await insertSession(client as PoolClient, config, {
      tripId, memberId, userId, role: "owner", absoluteExpiresAt: expiresAt, userAgent: input.userAgent,
    });
    const session: AuthenticatedSession = {
      sessionId: grant.sessionId, tripId, memberId, userId, role: "owner", expiresAt: grant.expiresAt,
      absoluteExpiresAt: grant.absoluteExpiresAt, displayName: copy.guest, issuer: GUEST_ISSUER, subject, generation: 1,
    };
    // The demo itinerary goes through the same validated, audited path as an owner's own edits.
    for (const [index, event] of demoEvents.entries()) {
      const created = await createChangeRequestWithClient(client as PoolClient, session, tripId, {
        entityType: "itinerary_item", operation: "create", reason: "Guest demo trip",
        patch: { tripDayId: dayIds[event.day], title: copy.events[index], itemType: event.type,
          startsAt: new Date(`${dates[event.day]}T${event.time}:00+09:00`).toISOString(), locationName: event.place,
          visibility: "trip", status: "planned" },
      }, randomUUID());
      await applyPermittedChangeRequestWithClient(client as PoolClient, session, tripId, created.id);
    }
    return { grant, tripId };
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
