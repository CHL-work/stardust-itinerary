import type { PoolClient } from "pg";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppForbiddenError, AppNotFoundError } from "@/lib/app/repository";

/** Short database mutations serialize with role changes/removal on the trip row.
 * Never hold this lock across provider or external network work. */
export async function lockCurrentTripActor(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  options: { owner?: boolean } = {},
): Promise<void> {
  const trip = await client.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE", [session.tripId]);
  if (trip.rowCount !== 1) throw new AppNotFoundError("Trip not found.");
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    JSON.stringify([session.userId, "ai-bound-user"]),
  ]);
  const actor = await client.query<{ role: string }>(
    `SELECT role FROM trip_members
      WHERE trip_id = $1 AND id = $2 AND user_id = $3 AND status = 'active'
      FOR UPDATE`, [session.tripId, session.memberId, session.userId],
  );
  if (!actor.rows[0] || actor.rows[0].role !== session.role
    || (options.owner && actor.rows[0].role !== "owner")) {
    throw new AppForbiddenError("Your trip access or role has changed. Refresh and try again.");
  }
}

export async function requireAnotherBoundOwner(client: Pick<PoolClient, "query">, tripId: string, memberId: string): Promise<void> {
  const owners = await client.query(
    `SELECT 1 FROM trip_members WHERE trip_id = $1 AND id <> $2
      AND role = 'owner' AND status = 'active' AND user_id IS NOT NULL LIMIT 1`, [tripId, memberId],
  );
  if (owners.rowCount !== 1) throw new AppForbiddenError("Assign another active, signed-in owner before removing the last owner.");
}
