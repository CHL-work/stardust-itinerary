import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { NextResponse } from "next/server";

import { recordDailyCount } from "@/lib/admin/daily-counts";
import type { AuthConfig } from "@/lib/auth/config";
import { SessionUnavailableError, SignupPausedError } from "@/lib/auth/errors";
import type { GoogleIdentity } from "@/lib/auth/google";
import type { SessionGrant } from "@/lib/auth/repository";
import { rollingSessionExpiry } from "@/lib/auth/session-lifetime";
import { createDeviceLabel, createOpaqueToken, hashOpaqueToken, isOpaqueToken } from "@/lib/auth/tokens";
import { GUEST_ISSUER } from "@/lib/auth/guest-identity";

export const accountCookieName = "stardust.account-onboarding";
export type AccountPrincipal = {
  kind: "account"; accountSessionId: string; userId: string;
  issuer: string; subject: string; displayName: string;
  guestExpiresAt?: Date;
};
export type AccountGrant = { rawToken: string; expiresAt: Date };
export function publicSignupEnabled(): boolean { return process.env.PUBLIC_SIGNUP_ENABLED === "true"; }

export function setAccountCookie(response: NextResponse, config: AuthConfig, grant: AccountGrant): void {
  response.cookies.set(accountCookieName,grant.rawToken,{ httpOnly:true,secure:config.appBaseUrl.protocol === "https:",
    sameSite:"lax",path:"/",expires:grant.expiresAt,priority:"high" });
}
export function clearAccountCookie(response: NextResponse, config: AuthConfig): void {
  response.cookies.set(accountCookieName,"",{ httpOnly:true,secure:config.appBaseUrl.protocol === "https:",
    sameSite:"lax",path:"/",maxAge:0 });
}

/**
 * The operator's daily cap on new public sign-ups (JOB-069): NULL means no cap and 0 pauses them.
 * One lock serializes new sign-ups, so the count is exact. Databases from before migration 0059
 * have no cap.
 */
async function assertSignupAllowed(client: Pick<PoolClient,"query">): Promise<void> {
  const table = await client.query<{present:boolean}>("SELECT to_regclass('public.platform_settings') IS NOT NULL AS present");
  if (!table.rows[0]?.present) return;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('stardust-public-signup',0))");
  const result = await client.query<{daily_limit:number|null;today:number}>(
    `SELECT settings.signup_daily_limit AS daily_limit,
            COALESCE((SELECT sum(counts.count) FROM platform_daily_counts counts
                       WHERE counts.metric='public_signup' AND counts.user_id IS NULL
                         AND counts.day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date),0)::integer AS today
       FROM platform_settings settings WHERE settings.singleton`,
  );
  const row = result.rows[0];
  if (row && row.daily_limit !== null && row.today >= row.daily_limit) throw new SignupPausedError();
}

/** Only a completed Google OIDC callback may issue this narrowly scoped grant. */
export async function issueAccountOnboarding(
  pool: Pool, config: AuthConfig, identity: GoogleIdentity,
): Promise<AccountGrant> {
  if (!publicSignupEnabled() || identity.issuer !== "https://accounts.google.com" || !identity.subject) {
    throw new SessionUnavailableError("Public trip creation is not enabled.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
      JSON.stringify([identity.issuer,identity.subject]),
    ]);
    const found = await client.query<{user_id:string}>(
      "SELECT user_id FROM oidc_identities WHERE issuer=$1 AND subject=$2",[identity.issuer,identity.subject],
    );
    const userId = found.rows[0]?.user_id ?? randomUUID();
    const displayName = identity.displayNameHint?.trim().slice(0,120) || "Traveler";
    if (!found.rows[0]) {
      await assertSignupAllowed(client);
      await client.query("INSERT INTO app_users (id,display_name) VALUES ($1,$2)",[userId,displayName]);
      await recordDailyCount(client,"public_signup");
      await client.query(
        `INSERT INTO oidc_identities (issuer,subject,user_id,email_hint,display_name_hint,last_authenticated_at)
         VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
        [identity.issuer,identity.subject,userId,identity.emailHint,displayName],
      );
    } else {
      await client.query(
        `UPDATE oidc_identities SET email_hint=$3,display_name_hint=$4,last_authenticated_at=CURRENT_TIMESTAMP
         WHERE issuer=$1 AND subject=$2`,[identity.issuer,identity.subject,identity.emailHint,displayName],
      );
    }
    const rawToken = createOpaqueToken();
    const inserted = await client.query<{expires_at:Date}>(
      `INSERT INTO auth_account_sessions (id,user_id,issuer,subject,token_hash,expires_at)
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP + interval '15 minutes') RETURNING expires_at`,
      [randomUUID(),userId,identity.issuer,identity.subject,hashOpaqueToken(config.authSecret,"account-onboarding",rawToken)],
    );
    await client.query("COMMIT");
    return { rawToken,expiresAt:inserted.rows[0].expires_at };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function verifyAccountOnboarding(
  client: Pick<PoolClient,"query">, config: AuthConfig, rawToken?: string,
): Promise<AccountPrincipal|null> {
  const guestsEnabled = process.env.GUEST_MODE_ENABLED === "true";
  if ((!publicSignupEnabled() && !guestsEnabled) || !rawToken || !isOpaqueToken(rawToken)) return null;
  const result = await client.query<{id:string;user_id:string;issuer:string;subject:string;display_name:string;guest_expires_at:Date|null}>(
    `SELECT account_session.id,account_session.user_id,account_session.issuer,account_session.subject,app_user.display_name,
            (to_jsonb(app_user)->>'guest_expires_at')::timestamptz AS guest_expires_at
       FROM auth_account_sessions account_session JOIN app_users app_user ON app_user.id=account_session.user_id
       JOIN oidc_identities identity ON identity.issuer=account_session.issuer AND identity.subject=account_session.subject AND identity.user_id=account_session.user_id
      WHERE account_session.token_hash=$1 AND account_session.consumed_at IS NULL AND account_session.expires_at>CURRENT_TIMESTAMP
        AND (to_jsonb(app_user)->>'suspended_at') IS NULL`,
    [hashOpaqueToken(config.authSecret,"account-onboarding",rawToken)],
  );
  const row = result.rows[0];
  if (row?.issuer === GUEST_ISSUER) {
    if (!guestsEnabled || !row.guest_expires_at || row.guest_expires_at.getTime() <= Date.now()) return null;
  } else if (row && (!publicSignupEnabled() || row.issuer !== "https://accounts.google.com" || row.guest_expires_at)) return null;
  return row ? { kind:"account",accountSessionId:row.id,userId:row.user_id,issuer:row.issuer,
    subject:row.subject,displayName:row.display_name,...(row.guest_expires_at ? {guestExpiresAt:row.guest_expires_at} : {}) } : null;
}

/** Recheck and consume inside the same transaction that creates the trip. */
export async function consumeAccountOnboarding(client: Pick<PoolClient,"query">, principal: AccountPrincipal): Promise<Date> {
  const guest = principal.issuer === GUEST_ISSUER;
  if (guest ? process.env.GUEST_MODE_ENABLED !== "true" : !publicSignupEnabled() || principal.issuer !== "https://accounts.google.com") {
    throw new SessionUnavailableError("Trip creation is not enabled.");
  }
  // The account row serializes guest creation with expiry/purge and suspension. Never trust a
  // browser/principal expiry or convert this identity into a Google account.
  const account = await client.query<{guest_expires_at:Date|null;suspended_at:Date|null}>(
    `SELECT (to_jsonb(app_user)->>'guest_expires_at')::timestamptz AS guest_expires_at,
            (to_jsonb(app_user)->>'suspended_at')::timestamptz AS suspended_at
       FROM app_users app_user WHERE id=$1 FOR UPDATE`, [principal.userId],
  );
  const row = account.rows[0];
  if (!row || row.suspended_at || (guest ? !row.guest_expires_at || row.guest_expires_at.getTime() <= Date.now() : row.guest_expires_at)) {
    throw new SessionUnavailableError("Account sign-in expired. Sign in again.");
  }
  if (guest) {
    const existing = await client.query("SELECT 1 FROM trips WHERE owner_user_id=$1 LIMIT 1", [principal.userId]);
    if (existing.rowCount) throw new SessionUnavailableError("This guest has already created a trip.");
  }
  const result = await client.query<{ absolute_expires_at: Date }>(
    `WITH locked_account AS MATERIALIZED (
       SELECT account_session.id, account_session.expires_at
         FROM auth_account_sessions account_session
        WHERE account_session.id=$1 AND account_session.user_id=$2 AND account_session.issuer=$3 AND account_session.subject=$4
          AND account_session.consumed_at IS NULL
          AND EXISTS (SELECT 1 FROM oidc_identities identity WHERE identity.issuer=account_session.issuer
            AND identity.subject=account_session.subject AND identity.user_id=account_session.user_id)
        FOR UPDATE OF account_session
     )
     UPDATE auth_account_sessions account_session SET consumed_at=CURRENT_TIMESTAMP
       FROM locked_account
      WHERE account_session.id=locked_account.id AND locked_account.expires_at>clock_timestamp()
      RETURNING account_session.created_at + interval '720 hours' AS absolute_expires_at`,[principal.accountSessionId,principal.userId,principal.issuer,principal.subject],
  );
  if (result.rowCount !== 1) throw new SessionUnavailableError("Account sign-in expired. Sign in with Google again.");
  // Other devices authenticating the same account cannot extend this grant.
  return guest ? row.guest_expires_at! : result.rows[0].absolute_expires_at;
}

export async function issueCreatedTripSession(
  client: Pick<PoolClient,"query">, config: AuthConfig,
  input: {tripId:string;memberId:string;userId:string;userAgent:string|null;absoluteExpiresAt:Date},
): Promise<SessionGrant> {
  const expiresAt = rollingSessionExpiry(input.absoluteExpiresAt);
  const rawToken = createOpaqueToken();
  const sessionId = randomUUID();
  await client.query(
    `INSERT INTO auth_sessions (id,family_id,trip_id,member_id,user_id,token_hash,device_label,expires_at,absolute_expires_at)
     VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8)`,
    [sessionId,input.tripId,input.memberId,input.userId,hashOpaqueToken(config.authSecret,"session",rawToken),
      createDeviceLabel(input.userAgent),expiresAt,input.absoluteExpiresAt],
  );
  await client.query("UPDATE app_users SET last_selected_trip_id=$1 WHERE id=$2",[input.tripId,input.userId]);
  return { rawToken,sessionId,tripId:input.tripId,memberId:input.memberId,userId:input.userId,role:"owner",
    expiresAt,absoluteExpiresAt:input.absoluteExpiresAt };
}
