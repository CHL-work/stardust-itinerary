import type { Pool, PoolClient } from "pg";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { projectActivityEntry, type ActivityRow } from "./activity-presentation";
import type { ActivityEntry } from "./activity-types";

/** Bounded owner feed: historical values, arbitrary metadata and private targets never leave this query. */
export async function loadActivityEntries(
  client: Pick<Pool | PoolClient, "query">,
  session: AuthenticatedSession,
  options: { activityId?: string } = {},
): Promise<ActivityEntry[]> {
  if (session.role !== "owner") return [];
  const result = await client.query<ActivityRow>(
    `WITH visible_activity AS (
       SELECT ae.* FROM audit_events ae
        WHERE ae.trip_id = $1 AND ($4::uuid IS NULL OR ae.id = $4)
          AND EXISTS (SELECT 1 FROM trip_members actor WHERE actor.trip_id=$1 AND actor.id=$2
            AND actor.user_id=$3 AND actor.status='active' AND actor.role='owner')
          AND CASE
            WHEN ae.entity_type IN ('itinerary_item','calendar_event_link') THEN
              ae.entity_id IS NOT NULL AND app_member_can_view_itinerary_item(ae.trip_id,ae.entity_id,$2)
            WHEN ae.entity_type='expense' THEN
              ae.entity_id IS NOT NULL AND app_member_can_view_expense(ae.trip_id,ae.entity_id,$2)
            WHEN ae.entity_type='change_request' THEN
              ae.entity_id IS NOT NULL AND app_member_can_view_change_request(ae.trip_id,ae.entity_id,$2)
            ELSE true END
        ORDER BY ae.created_at DESC, ae.id DESC LIMIT 50
     )
     SELECT ae.id,ae.entity_type,ae.action,actor.display_name AS actor_name,ae.created_at,
       CASE WHEN i.id IS NOT NULL THEN i.id WHEN e.id IS NOT NULL THEN e.id WHEN cr.id IS NOT NULL THEN cr.id END AS target_id,
       CASE WHEN i.id IS NOT NULL THEN 'itinerary' WHEN e.id IS NOT NULL THEN 'expense' WHEN cr.id IS NOT NULL THEN 'request' END AS target_kind,
       COALESCE(to_jsonb(i)->>'removed_at','') <> '' AS target_removed,
       CASE WHEN i.id IS NOT NULL THEN i.title WHEN e.id IS NOT NULL THEN e.description
         WHEN cr.entity_type='itinerary_item' THEN cr.proposed_patch->>'title'
         WHEN cr.entity_type='expense' THEN cr.proposed_patch->>'description' END AS target_title,
       CASE WHEN i.id IS NOT NULL THEN i.starts_at::text WHEN e.id IS NOT NULL THEN e.occurred_at::text
         WHEN cr.entity_type='itinerary_item' THEN cr.proposed_patch->>'startsAt'
         WHEN cr.entity_type='expense' THEN cr.proposed_patch->>'occurredAt' END AS target_starts_at,
       CASE WHEN i.id IS NOT NULL THEN i.ends_at::text WHEN cr.entity_type='itinerary_item' THEN cr.proposed_patch->>'endsAt' END AS target_ends_at,
       CASE WHEN e.id IS NOT NULL THEN e.amount_minor::text WHEN cr.entity_type='expense' THEN cr.proposed_patch->>'amountMinor' END AS target_amount_minor,
       CASE WHEN e.id IS NOT NULL THEN e.currency WHEN cr.entity_type='expense' THEN cr.proposed_patch->>'currency' END AS target_currency,
       CASE WHEN i.id IS NOT NULL THEN i.status WHEN e.id IS NOT NULL THEN e.status ELSE cr.status END AS target_status,
       ARRAY(SELECT key FROM jsonb_object_keys(CASE WHEN jsonb_typeof(ae.after_state)='object' THEN ae.after_state ELSE '{}'::jsonb END) AS fields(key)
         WHERE ae.before_state IS NOT NULL AND ae.before_state->key IS DISTINCT FROM ae.after_state->key) AS changed_keys
     FROM visible_activity ae
     LEFT JOIN trip_members actor ON actor.trip_id=ae.trip_id AND actor.id=ae.actor_member_id
     LEFT JOIN itinerary_items i ON ae.entity_type IN ('itinerary_item','calendar_event_link') AND i.trip_id=ae.trip_id AND i.id=ae.entity_id
     LEFT JOIN expenses e ON ae.entity_type='expense' AND e.trip_id=ae.trip_id AND e.id=ae.entity_id
     LEFT JOIN change_requests cr ON ae.entity_type='change_request' AND cr.trip_id=ae.trip_id AND cr.id=ae.entity_id
     ORDER BY ae.created_at DESC,ae.id DESC`,
    [session.tripId, session.memberId, session.userId, options.activityId ?? null],
  );
  return result.rows.map(projectActivityEntry);
}
