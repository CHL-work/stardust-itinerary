import type { PoolClient } from "pg";

import { SessionUnavailableError } from "@/lib/auth/errors";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const AUTHENTICATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_ROLLING_MS = 24 * 60 * 60 * 1_000;

/** Only a freshly verified Google authentication may establish a new ceiling. */
export function freshAuthenticationCeiling(authenticatedAt = new Date()): Date {
  const ceiling = new Date(authenticatedAt.getTime() + AUTHENTICATION_LIFETIME_MS);
  if (!Number.isFinite(ceiling.getTime())) throw new SessionUnavailableError();
  return ceiling;
}

export function rollingSessionExpiry(absoluteExpiresAt: Date, now = new Date()): Date {
  const expiresAt = new Date(Math.min(now.getTime() + SESSION_ROLLING_MS, absoluteExpiresAt.getTime()));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    throw new SessionUnavailableError("Authentication expired. Sign in with Google again.");
  }
  return expiresAt;
}

/** Caller holds the source trip lock. Never inherit a client/session snapshot's ceiling. */
export async function readCurrentSessionCeiling(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
): Promise<Date> {
  const result = await client.query<{ absolute_expires_at: Date }>(
    `WITH locked_session AS MATERIALIZED (
       SELECT s.absolute_expires_at, s.expires_at
         FROM auth_sessions s
         JOIN trip_members tm ON tm.trip_id = s.trip_id AND tm.id = s.member_id
          AND tm.user_id = s.user_id AND tm.status = 'active' AND tm.role = $6
        WHERE s.id = $1 AND s.trip_id = $2 AND s.member_id = $3 AND s.user_id = $4
          AND s.generation = $5 AND s.revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM oidc_identities oi WHERE oi.user_id = s.user_id
                       AND oi.issuer = $7 AND oi.subject = $8)
        FOR UPDATE OF s
     )
     SELECT absolute_expires_at FROM locked_session
      WHERE expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp()`,
    [session.sessionId, session.tripId, session.memberId, session.userId, session.generation,
      session.role, session.issuer, session.subject],
  );
  const ceiling = result.rows[0]?.absolute_expires_at;
  if (!ceiling || !Number.isFinite(ceiling.getTime())) throw new SessionUnavailableError();
  return ceiling;
}
