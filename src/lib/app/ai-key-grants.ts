import { randomUUID } from "node:crypto";

type Queryable = { query: <R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> };

/**
 * Remove key grants when the people behind them change (JOB-063). A grant belongs to the person
 * who held a member slot when the owner shared, so it never passes to a new identity bound to that
 * slot. It also ends for good when its sponsor stops being an active owner, rather than waiting to
 * resume if they become one again. Each removal is audited without key material.
 * `roles: "member"` covers grants the member holds and grants they sponsor; `"sponsor"` only the latter.
 */
export async function revokeAiKeyGrants(
  client: Queryable,
  input: { tripId: string; memberId: string; actorMemberId: string; cause: string; roles: "member" | "sponsor" },
): Promise<void> {
  // Tolerate a database from before migration 0055, as the other schema-aware reads do.
  const table = await client.query<{ present: boolean }>("SELECT to_regclass('public.trip_ai_key_grants') IS NOT NULL AS present");
  if (!table.rows[0]?.present) return;
  const removed = await client.query<{ member_id: string; sponsor_member_id: string }>(
    input.roles === "member"
      ? `DELETE FROM trip_ai_key_grants WHERE trip_id = $1 AND (member_id = $2 OR sponsor_member_id = $2)
         RETURNING member_id, sponsor_member_id`
      : `DELETE FROM trip_ai_key_grants WHERE trip_id = $1 AND sponsor_member_id = $2 RETURNING member_id, sponsor_member_id`,
    [input.tripId, input.memberId],
  );
  for (const row of removed.rows) {
    await client.query(
      `INSERT INTO audit_events (trip_id, id, actor_member_id, entity_type, entity_id, action, metadata)
       VALUES ($1, $2, $3, 'trip_member', $4, 'ai_keys_unshared', $5)`,
      [input.tripId, randomUUID(), input.actorMemberId, row.member_id,
        JSON.stringify({ source: input.cause, sponsorMemberId: row.sponsor_member_id })],
    );
  }
}
