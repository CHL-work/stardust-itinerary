import type { Pool, PoolClient } from "pg";
import type { AccountPrincipal } from "@/lib/auth/account-session";
import type { GoogleIdentity } from "@/lib/auth/google";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { isLocale, type Locale } from "@/lib/i18n";

type Queryable = Pick<PoolClient, "query"> | Pick<Pool, "query">;

export async function readAccountLocale(client: Queryable, userId: string): Promise<Locale | null> {
  const result = await client.query<{ preferred_locale: unknown }>(
    "SELECT preferred_locale FROM app_users WHERE id=$1 AND suspended_at IS NULL", [userId],
  );
  const value = result.rows[0]?.preferred_locale;
  return typeof value === "string" && isLocale(value) ? value : null;
}

/** Read only after verified Google authentication; never import a guest/browser preference into this identity. */
export async function readGoogleSignInLocale(client: Queryable, identity: GoogleIdentity): Promise<Locale> {
  const result = await client.query<{ preferred_locale: unknown }>(
    `SELECT au.preferred_locale FROM app_users au JOIN oidc_identities oi ON oi.user_id=au.id
     WHERE oi.issuer=$1 AND oi.subject=$2 AND au.suspended_at IS NULL`, [identity.issuer, identity.subject],
  );
  const value = result.rows[0]?.preferred_locale;
  return typeof value === "string" && isLocale(value) ? value : "en";
}

/** The authenticated principal comes from server cookies, never an account ID supplied by a browser. */
export async function saveAccountLocale(client: Queryable, principal: AccountPrincipal | AuthenticatedSession, locale: Locale): Promise<void> {
  if (!isLocale(locale)) throw new Error("Unsupported language.");
  const account = "accountSessionId" in principal;
  const result = account ? await client.query(
    `UPDATE app_users au SET preferred_locale=$1 WHERE au.id=$2 AND au.suspended_at IS NULL
      AND (au.guest_expires_at IS NULL OR au.guest_expires_at>clock_timestamp())
      AND EXISTS (SELECT 1 FROM auth_account_sessions s JOIN oidc_identities oi
        ON oi.issuer=s.issuer AND oi.subject=s.subject AND oi.user_id=s.user_id
        WHERE s.id=$3 AND s.user_id=au.id AND s.issuer=$4 AND s.subject=$5
          AND s.consumed_at IS NULL AND s.expires_at>clock_timestamp())`,
    [locale, principal.userId, principal.accountSessionId, principal.issuer, principal.subject],
  ) : await client.query(
    `UPDATE app_users au SET preferred_locale=$1 WHERE au.id=$2 AND au.suspended_at IS NULL
      AND (au.guest_expires_at IS NULL OR au.guest_expires_at>clock_timestamp())
      AND EXISTS (SELECT 1 FROM auth_sessions s JOIN trip_members tm
        ON tm.trip_id=s.trip_id AND tm.id=s.member_id AND tm.user_id=s.user_id AND tm.status='active'
        JOIN oidc_identities oi ON oi.user_id=s.user_id AND oi.issuer=$6 AND oi.subject=$7
        WHERE s.id=$3 AND s.user_id=au.id AND s.trip_id=$4 AND s.member_id=$5
          AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp())`,
    [locale, principal.userId, principal.sessionId, principal.tripId, principal.memberId, principal.issuer, principal.subject],
  );
  if (result.rowCount !== 1) throw new SessionUnavailableError();
}
