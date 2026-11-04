import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { AppConflictError, AppForbiddenError, AppInvalidInputError, appendAudit, assertTrip, inTransaction } from "@/lib/app/repository";
import { matchesTripName, tripDeletionInputSchema, type TripDeletionInput, type TripDeletionPreview } from "@/lib/app/trip-deletion-contract";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { AuthConfig } from "@/lib/auth/config";
import { insertSession, type AuthenticatedSession, type SessionGrant } from "@/lib/auth/repository";
import { readCurrentSessionCeiling } from "@/lib/auth/session-lifetime";

type Client = Pick<PoolClient, "query">;

/** The same preference order as sign-in, so the owner lands where a fresh login would. */
async function rankNextTrip(client: Client, session: AuthenticatedSession) {
  const result = await client.query<{ trip_id: string; name: string }>(
    `SELECT tm.trip_id, t.name
       FROM trip_members tm
       JOIN trips t ON t.id = tm.trip_id
      WHERE tm.user_id = $1 AND tm.status = 'active' AND tm.trip_id <> $2
      ORDER BY
        CASE
          WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date BETWEEN t.starts_on AND t.ends_on THEN 0
          WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date < t.starts_on THEN 1
          ELSE 2
        END,
        CASE WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date < t.starts_on THEN t.starts_on END ASC NULLS LAST,
        CASE WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date >= t.starts_on THEN t.ends_on END DESC NULLS LAST,
        (tm.role = 'owner') DESC,
        t.name
      LIMIT 1`,
    [session.userId, session.tripId],
  );
  return result.rows[0] ?? null;
}

/** Totals only: an owner has no read access to other members' private records, so never name them. */
async function loadCounts(client: Client, session: AuthenticatedSession): Promise<TripDeletionPreview["counts"]> {
  const result = await client.query<{ other_members: number; events: number; expenses: number; repayments: number; pending_requests: number }>(
    `SELECT
       (SELECT count(*)::int FROM trip_members WHERE trip_id = $1 AND id <> $2 AND status IN ('active', 'invited')) AS other_members,
       (SELECT count(*)::int FROM itinerary_items WHERE trip_id = $1 AND removed_at IS NULL AND status <> 'cancelled') AS events,
       (SELECT count(*)::int FROM expenses WHERE trip_id = $1 AND status = 'posted') AS expenses,
       (SELECT count(*)::int FROM member_payments WHERE trip_id = $1 AND status = 'posted') AS repayments,
       (SELECT count(*)::int FROM change_requests WHERE trip_id = $1 AND status = 'pending' AND invalidated_at IS NULL) AS pending_requests`,
    [session.tripId, session.memberId],
  );
  const row = result.rows[0];
  return { otherMembers: row.other_members, events: row.events, expenses: row.expenses, repayments: row.repayments, pendingRequests: row.pending_requests };
}

export async function getTripDeletionPreview(pool: Pool, session: AuthenticatedSession, tripId: string): Promise<TripDeletionPreview> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only an owner can delete this trip.");
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: true });
    const trip = await client.query<{ name: string }>("SELECT name FROM trips WHERE id = $1", [tripId]);
    const next = await rankNextTrip(client, session);
    return {
      trip: { id: tripId, name: trip.rows[0].name },
      blockedReason: next ? null : "last_trip",
      nextTripName: next?.name ?? null,
      counts: await loadCounts(client, session),
    };
  });
}

/**
 * Removes the trip for every member in one transaction and moves the owner to
 * their next trip. History tables are deliberately untouched; see docs/DATABASE.md.
 */
export async function deleteTrip(
  pool: Pool,
  config: AuthConfig,
  session: AuthenticatedSession,
  tripId: string,
  input: TripDeletionInput,
  userAgent: string | null,
): Promise<{ deleted: true; nextTripId: string; grant: SessionGrant }> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only an owner can delete this trip.");
  const { confirmationName } = tripDeletionInputSchema.parse(input);
  return inTransaction(pool, async (client) => {
    // Rank before locking, then lock both trips in the order trip switching uses
    // so a concurrent switch cannot deadlock against this deletion.
    const candidate = await rankNextTrip(client, session);
    if (!candidate) throw new AppConflictError("This is your only trip. Create another trip before deleting it.");
    for (const id of [tripId, candidate.trip_id].sort()) {
      await client.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE", [id]);
    }
    await lockCurrentTripActor(client, session, { owner: true });
    const trip = await client.query<{ name: string }>("SELECT name FROM trips WHERE id = $1", [tripId]);
    if (!matchesTripName(confirmationName, trip.rows[0].name)) {
      throw new AppInvalidInputError("The trip name you typed does not match this trip.");
    }
    const next = await client.query<{ id: string; role: SessionGrant["role"] }>(
      `SELECT id, role FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
      [candidate.trip_id, session.userId],
    );
    const nextMember = next.rows[0];
    if (!nextMember) throw new AppConflictError("Your other trips changed. Review the deletion again.");
    const authenticationCeiling = await readCurrentSessionCeiling(client, session);
    const counts = await loadCounts(client, session);
    const disruption = await client.query<{ enabled: boolean }>(
      "SELECT enabled FROM trip_disruption_settings WHERE trip_id = $1 FOR UPDATE", [tripId]);

    // clock_timestamp(), not the transaction start: rows created while this transaction waited
    // for the trip lock must still satisfy "revoked/completed at or after created" checks.

    await client.query(`UPDATE trips SET deleted_at = clock_timestamp(), deleted_by_member_id = $2 WHERE id = $1`, [tripId, session.memberId]);
    const members = await client.query(
      `UPDATE trip_members SET status_before_trip_deletion = status, status = 'trip_deleted', current_revision = current_revision + 1
        WHERE trip_id = $1 AND status IN ('invited', 'active', 'revoked')`, [tripId],
    );
    const sessions = await client.query(
      `UPDATE auth_sessions SET revoked_at = clock_timestamp(), revoke_reason = 'trip_deleted' WHERE trip_id = $1 AND revoked_at IS NULL`, [tripId],
    );
    await client.query(`UPDATE member_claim_links SET revoked_at = clock_timestamp() WHERE trip_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, [tripId]);
    await client.query(`UPDATE trip_join_links SET revoked_at = clock_timestamp() WHERE trip_id = $1 AND revoked_at IS NULL AND exhausted_at IS NULL`, [tripId]);
    // Drops stored Google credentials. Copies already in members' calendars stay, as with member removal.
    await client.query(`DELETE FROM calendar_connections WHERE trip_id = $1`, [tripId]);
    await client.query(`DELETE FROM calendar_event_links WHERE trip_id = $1`, [tripId]);
    await client.query(`DELETE FROM weather_refresh_leases WHERE trip_id = $1`, [tripId]);
    await client.query(`UPDATE ai_requests SET status = 'failed', error_code = 'AiRequestInterruptedError', completed_at = clock_timestamp()
      WHERE trip_id = $1 AND status = 'started'`, [tripId]);
    await client.query(`UPDATE trip_disruption_settings SET enabled = false, updated_by_member_id = $2, updated_at = clock_timestamp() WHERE trip_id = $1`, [tripId, session.memberId]);
    await client.query(`UPDATE app_users SET last_selected_trip_id = NULL WHERE last_selected_trip_id = $1`, [tripId]);
    await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "trip", entityId: tripId, action: "deleted",
      metadata: { tripName: trip.rows[0].name, retainedHistory: true, ...counts, closedMemberships: members.rowCount, revokedSessions: sessions.rowCount,
        disruptionChecksEnabled: disruption.rows[0]?.enabled ?? null } });

    const grant = await insertSession(client as PoolClient, config, {
      tripId: candidate.trip_id, memberId: nextMember.id, userId: session.userId, role: nextMember.role,
      absoluteExpiresAt: authenticationCeiling, userAgent,
    });
    await client.query(
      `INSERT INTO audit_events (trip_id, id, actor_member_id, entity_type, entity_id, action, metadata)
       VALUES ($1,$2,$3,'auth_session',$4,'trip_switched_in',$5::jsonb)`,
      [candidate.trip_id, randomUUID(), nextMember.id, grant.sessionId, JSON.stringify({ previousTripId: tripId, cause: "trip_deleted" })],
    );
    return { deleted: true, nextTripId: candidate.trip_id, grant };
  });
}
