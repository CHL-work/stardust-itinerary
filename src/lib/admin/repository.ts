import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import {
  ADMIN_PAGE_SIZE, type AdminAccount, type AdminAccountDetail, type AdminAccountFilter, type AdminAccountPage, type AdminAiCounts,
  type AdminOverview,
} from "@/lib/admin/contracts";
import { AppConflictError, AppForbiddenError, AppNotFoundError, inTransaction } from "@/lib/app/repository";
import { publicSignupEnabled } from "@/lib/auth/account-session";
import { isPlatformOperator } from "@/lib/auth/operator-access";
import type { AuthenticatedSession } from "@/lib/auth/repository";

/**
 * The operator's admin page (JOB-069, D-084). Every function first checks that the session belongs
 * to the platform operator (`OWNER_GOOGLE_EMAIL`, verified through Google), inside the same
 * transaction as its reads or writes. Reads return account metadata and counts only.
 */
type Queryable = Pick<PoolClient, "query">;
const GOOGLE_ISSUER = "https://accounts.google.com";

async function assertOperator(client: Queryable, session: AuthenticatedSession): Promise<void> {
  if (!(await isPlatformOperator(client, session.userId))) throw new AppForbiddenError("Only the platform operator can use the admin page.");
}

/** Whether this session may open the admin page; never throws for an ordinary account. */
export async function adminAccess(pool: Pool, session: AuthenticatedSession): Promise<boolean> {
  return isPlatformOperator(pool, session.userId);
}

function operatorEmail(): string {
  return process.env.OWNER_GOOGLE_EMAIL?.trim().toLowerCase() ?? "";
}

const TODAY_START = "date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";

function counts(row: { own: number; shared: number; operator: number } | undefined): AdminAiCounts {
  return { own: row?.own ?? 0, shared: row?.shared ?? 0, operator: row?.operator ?? 0 };
}

export async function adminOverview(pool: Pool, session: AuthenticatedSession): Promise<AdminOverview> {
  return inTransaction(pool, async (client) => {
    await assertOperator(client, session);
    const accounts = await client.query<AdminOverview["accounts"]>(
      `SELECT count(*) FILTER (WHERE guest_expires_at IS NULL)::int AS google,
              count(*) FILTER (WHERE guest_expires_at > CURRENT_TIMESTAMP)::int AS "guestsActive",
              count(*) FILTER (WHERE suspended_at IS NOT NULL)::int AS suspended,
              count(*) FILTER (WHERE guest_expires_at IS NULL AND created_at >= ${TODAY_START})::int AS "newToday",
              count(*) FILTER (WHERE guest_expires_at IS NULL AND created_at >= CURRENT_TIMESTAMP - interval '7 days')::int AS "new7d",
              count(*) FILTER (WHERE guest_expires_at IS NULL AND created_at >= CURRENT_TIMESTAMP - interval '30 days')::int AS "new30d"
         FROM app_users`);
    const active = await client.query<AdminOverview["active"]>(
      `SELECT count(DISTINCT user_id) FILTER (WHERE last_seen_at >= CURRENT_TIMESTAMP - interval '1 day')::int AS day,
              count(DISTINCT user_id) FILTER (WHERE last_seen_at >= CURRENT_TIMESTAMP - interval '7 days')::int AS week,
              count(DISTINCT user_id)::int AS month
         FROM auth_sessions WHERE last_seen_at >= CURRENT_TIMESTAMP - interval '30 days'`);
    const trips = await client.query<AdminOverview["trips"]>(
      `SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS active,
              count(*) FILTER (WHERE created_at >= CURRENT_TIMESTAMP - interval '7 days')::int AS "created7d"
         FROM trips WHERE guest_expires_at IS NULL`);
    // Requests from before JOB-061 have no credential source; the operator paid for all of them.
    const ai = await client.query<{ source: "own" | "shared" | "operator"; today: number; week: number; month: number; refused: number; failed: number }>(
      `SELECT COALESCE(credential_source, 'operator') AS source,
              count(*) FILTER (WHERE status <> 'rejected' AND created_at >= ${TODAY_START})::int AS today,
              count(*) FILTER (WHERE status <> 'rejected' AND created_at >= CURRENT_TIMESTAMP - interval '7 days')::int AS week,
              count(*) FILTER (WHERE status <> 'rejected')::int AS month,
              count(*) FILTER (WHERE status = 'rejected' AND created_at >= CURRENT_TIMESTAMP - interval '7 days')::int AS refused,
              count(*) FILTER (WHERE status = 'failed' AND created_at >= CURRENT_TIMESTAMP - interval '7 days')::int AS failed
         FROM ai_requests WHERE created_at >= CURRENT_TIMESTAMP - interval '30 days'
        GROUP BY 1`);
    const window = (key: "today" | "week" | "month") => counts(Object.fromEntries(
      (["own", "shared", "operator"] as const).map((source) => [source, ai.rows.find((row) => row.source === source)?.[key] ?? 0]),
    ) as AdminAiCounts);
    const providers = await client.query<{ provider: string; count: number }>(
      `SELECT provider, count(*)::int AS count FROM ai_requests
        WHERE status <> 'rejected' AND created_at >= CURRENT_TIMESTAMP - interval '7 days'
        GROUP BY provider ORDER BY count DESC, provider`);
    const refusals = await client.query<{ scope: string; count: number }>(
      `SELECT substr(metric, length('rate_limited:') + 1) AS scope, sum(count)::int AS count
         FROM platform_daily_counts
        WHERE metric LIKE 'rate_limited:%' AND day >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 6
        GROUP BY metric ORDER BY count DESC, scope`);
    const signup = await client.query<{ daily_limit: number | null; today: number }>(
      `SELECT settings.signup_daily_limit AS daily_limit,
              COALESCE((SELECT sum(count) FROM platform_daily_counts
                         WHERE metric = 'public_signup' AND user_id IS NULL
                           AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date), 0)::int AS today
         FROM platform_settings settings WHERE settings.singleton`);
    const days = await client.query<AdminOverview["days"][number]>(
      `WITH days AS (
         SELECT day::date AS day, day::date::timestamp AT TIME ZONE 'UTC' AS starts, (day::date + 1)::timestamp AT TIME ZONE 'UTC' AS ends
           FROM generate_series((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 13, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, interval '1 day') AS day
       )
       SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
              (SELECT count(*) FROM app_users account WHERE account.guest_expires_at IS NULL
                 AND account.created_at >= days.starts AND account.created_at < days.ends)::int AS signups,
              COALESCE((SELECT sum(counter.count) FROM platform_daily_counts counter
                         WHERE counter.metric = 'guest_created' AND counter.day = days.day), 0)::int AS guests,
              (SELECT count(*) FROM trips trip WHERE trip.guest_expires_at IS NULL
                 AND trip.created_at >= days.starts AND trip.created_at < days.ends)::int AS trips,
              (SELECT count(*) FROM ai_requests request WHERE request.status <> 'rejected'
                 AND request.created_at >= days.starts AND request.created_at < days.ends)::int AS ai,
              (SELECT count(*) FROM ai_requests request WHERE request.status = 'rejected'
                 AND request.created_at >= days.starts AND request.created_at < days.ends)::int AS "aiRefused",
              COALESCE((SELECT sum(counter.count) FROM platform_daily_counts counter
                         WHERE counter.metric LIKE 'rate_limited:%' AND counter.day = days.day), 0)::int AS refused
         FROM days ORDER BY days.day`);
    return {
      accounts: accounts.rows[0]!,
      active: active.rows[0]!,
      trips: trips.rows[0]!,
      ai: { today: window("today"), week: window("week"), month: window("month"),
        refusedWeek: ai.rows.reduce((sum, row) => sum + row.refused, 0), failedWeek: ai.rows.reduce((sum, row) => sum + row.failed, 0),
        providersWeek: providers.rows },
      refusalsWeek: refusals.rows,
      signup: { enabled: publicSignupEnabled(), dailyLimit: signup.rows[0]?.daily_limit ?? null, today: signup.rows[0]?.today ?? 0 },
      days: days.rows,
    };
  });
}

type AccountRow = {
  id: string; display_name: string; email: string | null; created_at: Date; last_active_at: Date | null; suspended_at: Date | null;
  guest_expires_at: Date | null; is_operator: boolean; trips_owned: number; trips_joined: number; keys: string[];
  ai_own: number; ai_shared: number; ai_operator: number; refused_week: number; total?: string;
};

/** One row per account; `$1` is the operator's email (or an empty string), for `is_operator`. */
const ACCOUNT_SELECT = `
  SELECT account.id, account.display_name, google.email_hint AS email, account.created_at, account.suspended_at, account.guest_expires_at,
         (SELECT max(session.last_seen_at) FROM auth_sessions session WHERE session.user_id = account.id) AS last_active_at,
         ($1 <> '' AND lower(google.email_hint) = $1) AS is_operator,
         (SELECT count(*) FROM trips trip WHERE trip.owner_user_id = account.id AND trip.deleted_at IS NULL)::int AS trips_owned,
         (SELECT count(*) FROM trip_members member JOIN trips trip ON trip.id = member.trip_id
           WHERE member.user_id = account.id AND member.status = 'active' AND member.role <> 'owner' AND trip.deleted_at IS NULL)::int AS trips_joined,
         ARRAY(SELECT credential.provider FROM user_ai_credentials credential WHERE credential.user_id = account.id ORDER BY credential.provider) AS keys,
         (SELECT count(*) FROM ai_requests request WHERE request.actor_user_id = account.id AND request.status <> 'rejected'
           AND request.created_at >= CURRENT_TIMESTAMP - interval '7 days' AND request.credential_source = 'own')::int AS ai_own,
         (SELECT count(*) FROM ai_requests request WHERE request.actor_user_id = account.id AND request.status <> 'rejected'
           AND request.created_at >= CURRENT_TIMESTAMP - interval '7 days' AND request.credential_source = 'shared')::int AS ai_shared,
         (SELECT count(*) FROM ai_requests request WHERE request.actor_user_id = account.id AND request.status <> 'rejected'
           AND request.created_at >= CURRENT_TIMESTAMP - interval '7 days'
           AND COALESCE(request.credential_source, 'operator') = 'operator')::int AS ai_operator,
         COALESCE((SELECT sum(counter.count) FROM platform_daily_counts counter WHERE counter.user_id = account.id
           AND counter.metric LIKE 'rate_limited:%' AND counter.day >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 6), 0)::int AS refused_week`;
const ACCOUNT_FROM = `
    FROM app_users account
    LEFT JOIN LATERAL (
      SELECT identity.email_hint FROM oidc_identities identity
       WHERE identity.user_id = account.id AND identity.issuer = '${GOOGLE_ISSUER}'
       ORDER BY identity.last_authenticated_at DESC NULLS LAST LIMIT 1
    ) google ON true`;

function account(row: AccountRow): AdminAccount {
  return {
    userId: row.id, displayName: row.display_name, email: row.guest_expires_at ? null : row.email,
    kind: row.guest_expires_at ? "guest" : "google", createdAt: row.created_at.toISOString(),
    lastActiveAt: row.last_active_at?.toISOString() ?? null, suspendedAt: row.suspended_at?.toISOString() ?? null,
    guestExpiresAt: row.guest_expires_at?.toISOString() ?? null, isOperator: row.is_operator === true,
    tripsOwned: row.trips_owned, tripsJoined: row.trips_joined, keys: row.keys,
    aiWeek: { own: row.ai_own, shared: row.ai_shared, operator: row.ai_operator }, refusedWeek: row.refused_week,
  };
}

/** LIKE pattern for a plain-text search: the user's % and _ match themselves. */
function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/gu, (match) => `\\${match}`)}%`;
}

export async function listAdminAccounts(
  pool: Pool, session: AuthenticatedSession, options: { filter: AdminAccountFilter; q: string; offset: number },
): Promise<AdminAccountPage> {
  return inTransaction(pool, async (client) => {
    await assertOperator(client, session);
    const result = await client.query<AccountRow>(
      `${ACCOUNT_SELECT}, count(*) OVER () AS total
       ${ACCOUNT_FROM}
       WHERE ($2 = 'all' OR ($2 = 'google' AND account.guest_expires_at IS NULL)
              OR ($2 = 'guest' AND account.guest_expires_at IS NOT NULL) OR ($2 = 'suspended' AND account.suspended_at IS NOT NULL))
         AND ($3 = '' OR account.display_name ILIKE $4 ESCAPE '\\' OR google.email_hint ILIKE $4 ESCAPE '\\')
       ORDER BY last_active_at DESC NULLS LAST, account.created_at DESC, account.id
       LIMIT $5 OFFSET $6`,
      [operatorEmail(), options.filter, options.q, containsPattern(options.q), ADMIN_PAGE_SIZE, options.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    const next = options.offset + result.rows.length;
    return { accounts: result.rows.map(account), total, nextOffset: next < total ? next : null };
  });
}

async function loadAccount(client: Queryable, userId: string): Promise<AdminAccount> {
  const result = await client.query<AccountRow>(`${ACCOUNT_SELECT} ${ACCOUNT_FROM} WHERE account.id = $2`, [operatorEmail(), userId]);
  if (!result.rows[0]) throw new AppNotFoundError("Account not found.");
  return account(result.rows[0]);
}

export async function adminAccountDetail(pool: Pool, session: AuthenticatedSession, userId: string): Promise<AdminAccountDetail> {
  return inTransaction(pool, async (client) => {
    await assertOperator(client, session);
    const profile = await loadAccount(client, userId);
    const sessions = await client.query<{ device_label: string; created_at: Date; last_seen_at: Date; state: "active" | "expired" | "revoked" }>(
      `SELECT device_label, created_at, last_seen_at,
              CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                   WHEN expires_at <= CURRENT_TIMESTAMP OR absolute_expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                   ELSE 'active' END AS state
         FROM auth_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 10`, [userId]);
    const trips = await client.query<{ role: string; status: string; guest: boolean; deleted: boolean; created_at: Date; members: number; events: number }>(
      `SELECT member.role, member.status, trip.guest_expires_at IS NOT NULL AS guest, trip.deleted_at IS NOT NULL AS deleted, trip.created_at,
              (SELECT count(*) FROM trip_members other WHERE other.trip_id = trip.id AND other.status = 'active')::int AS members,
              (SELECT count(*) FROM itinerary_items item WHERE item.trip_id = trip.id)::int AS events
         FROM trip_members member JOIN trips trip ON trip.id = member.trip_id
        WHERE member.user_id = $1 ORDER BY trip.created_at DESC LIMIT 50`, [userId]);
    const days = await client.query<{ day: string; own: number; shared: number; operator: number; ai_refused: number; refused: number; trips_created: number }>(
      `WITH days AS (
         SELECT day::date AS day, day::date::timestamp AT TIME ZONE 'UTC' AS starts, (day::date + 1)::timestamp AT TIME ZONE 'UTC' AS ends
           FROM generate_series((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 29, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, interval '1 day') AS day
       ), activity AS (
         SELECT to_char(days.day, 'YYYY-MM-DD') AS day, days.day AS sort_day,
                count(request.id) FILTER (WHERE request.status <> 'rejected' AND request.credential_source = 'own')::int AS own,
                count(request.id) FILTER (WHERE request.status <> 'rejected' AND request.credential_source = 'shared')::int AS shared,
                count(request.id) FILTER (WHERE request.status <> 'rejected' AND COALESCE(request.credential_source, 'operator') = 'operator')::int AS operator,
                count(request.id) FILTER (WHERE request.status = 'rejected')::int AS ai_refused,
                COALESCE((SELECT sum(counter.count) FROM platform_daily_counts counter
                           WHERE counter.user_id = $1 AND counter.metric LIKE 'rate_limited:%' AND counter.day = days.day), 0)::int AS refused,
                (SELECT count(*) FROM trips trip WHERE trip.owner_user_id = $1
                   AND trip.created_at >= days.starts AND trip.created_at < days.ends)::int AS trips_created
           FROM days
           LEFT JOIN ai_requests request ON request.actor_user_id = $1
                AND request.created_at >= days.starts AND request.created_at < days.ends
          GROUP BY days.day, days.starts, days.ends
       )
       SELECT day, own, shared, operator, ai_refused, refused, trips_created FROM activity
        WHERE own + shared + operator + ai_refused + refused + trips_created > 0
        ORDER BY sort_day DESC`, [userId]);
    const actions = await client.query<{ created_at: Date; entity_type: string; action: string }>(
      `SELECT audit.created_at, audit.entity_type, audit.action
         FROM audit_events audit
         JOIN trip_members member ON member.trip_id = audit.trip_id AND member.id = audit.actor_member_id
        WHERE member.user_id = $1 ORDER BY audit.created_at DESC LIMIT 30`, [userId]);
    const operatorActions = await client.query<{ created_at: Date; action: string }>(
      `SELECT created_at, action FROM operator_audit_events WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 10`, [userId]);
    return {
      account: profile,
      sessions: sessions.rows.map((row) => ({ deviceLabel: row.device_label, createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(), state: row.state })),
      trips: trips.rows.map((row) => ({ role: row.role, status: row.status, guest: row.guest, deleted: row.deleted,
        createdAt: row.created_at.toISOString(), members: row.members, events: row.events })),
      days: days.rows.map((row) => ({ day: row.day, ai: { own: row.own, shared: row.shared, operator: row.operator },
        aiRefused: row.ai_refused, refused: row.refused, tripsCreated: row.trips_created })),
      recentActions: actions.rows.map((row) => ({ at: row.created_at.toISOString(), entity: row.entity_type, action: row.action })),
      operatorActions: operatorActions.rows.map((row) => ({ at: row.created_at.toISOString(), action: row.action })),
    };
  });
}

/**
 * Suspend or restore an account. Suspending revokes every session and unused onboarding grant at
 * once; sign-in, sessions and the account's shared keys stay refused until it is restored. The
 * operator's own account cannot be suspended. Both directions are recorded.
 */
export async function setAccountSuspension(
  pool: Pool, session: AuthenticatedSession, userId: string, suspended: boolean,
): Promise<AdminAccount> {
  return inTransaction(pool, async (client) => {
    await assertOperator(client, session);
    const target = await client.query<{ suspended: boolean }>(
      "SELECT suspended_at IS NOT NULL AS suspended FROM app_users WHERE id = $1 FOR UPDATE", [userId]);
    if (!target.rows[0]) throw new AppNotFoundError("Account not found.");
    if (userId === session.userId || await isPlatformOperator(client, userId)) {
      throw new AppConflictError("The operator's own account cannot be suspended.");
    }
    if (suspended && !target.rows[0].suspended) {
      await client.query("UPDATE app_users SET suspended_at = CURRENT_TIMESTAMP WHERE id = $1", [userId]);
      await client.query(
        `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = 'account_suspended'
          WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      await client.query(
        "UPDATE auth_account_sessions SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND consumed_at IS NULL", [userId]);
      await client.query("INSERT INTO operator_audit_events (id, action, target_user_id) VALUES ($1, 'account.suspended', $2)",
        [randomUUID(), userId]);
    } else if (!suspended && target.rows[0].suspended) {
      await client.query("UPDATE app_users SET suspended_at = NULL WHERE id = $1", [userId]);
      await client.query("INSERT INTO operator_audit_events (id, action, target_user_id) VALUES ($1, 'account.unsuspended', $2)",
        [randomUUID(), userId]);
    }
    return loadAccount(client, userId);
  });
}

/** Set the daily cap on new public sign-ups: null removes it, 0 pauses sign-ups. */
export async function setSignupDailyLimit(
  pool: Pool, session: AuthenticatedSession, dailyLimit: number | null,
): Promise<{ dailyLimit: number | null }> {
  return inTransaction(pool, async (client) => {
    await assertOperator(client, session);
    const result = await client.query<{ signup_daily_limit: number | null }>(
      `UPDATE platform_settings SET signup_daily_limit = $1, updated_at = CURRENT_TIMESTAMP
        WHERE singleton RETURNING signup_daily_limit`, [dailyLimit]);
    if (!result.rows[0]) throw new AppNotFoundError("Platform settings are missing; run the migrations.");
    await client.query(
      "INSERT INTO operator_audit_events (id, action, details) VALUES ($1, 'signup_limit.changed', $2::jsonb)",
      [randomUUID(), JSON.stringify({ dailyLimit })]);
    return { dailyLimit: result.rows[0].signup_daily_limit };
  });
}
