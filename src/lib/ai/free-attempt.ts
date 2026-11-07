import type { Pool } from "pg";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppConflictError, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import { freeAiSettings } from "@/lib/ai/free-model";
import { requireAiCredential } from "@/lib/ai/credential-context";
import { AiProviderFailureError } from "@/lib/ai/provider-failure";

/** Count actual upstream attempts (fallback and repair included), across every web replica. */
export async function reserveFreeAiAttempt(pool: Pool, session: AuthenticatedSession, requestId: string, sequence: number): Promise<void> {
  if (requireAiCredential().source !== "free") throw new AiProviderFailureError({ code: "AI_PROVIDER_AUTH_REQUIRED", provider: "kilo" });
  const settings = freeAiSettings();
  if (!settings.enabled) throw new AiProviderFailureError({ code: "AI_PROVIDER_UNAVAILABLE", provider: "kilo" });
  await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('stardust-guest-free-ai', 0))");
    const active = await client.query(`SELECT 1 FROM ai_requests WHERE trip_id = $1 AND id = $2
      AND actor_user_id = $3 AND actor_member_id = $4 AND credential_source = 'free' AND status = 'started'`,
    [session.tripId, requestId, session.userId, session.memberId]);
    if (!active.rows.length) throw new AppConflictError("The free AI request is no longer active.");
    const usage = await client.query<{ hour: number; day: number }>(
      `SELECT count(*) FILTER (WHERE created_at >= CURRENT_TIMESTAMP - interval '1 hour')::int AS hour,
              count(*) FILTER (WHERE created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS day
         FROM ai_request_events WHERE event_type = 'provider.free.attempt.started'
           AND created_at >= CURRENT_TIMESTAMP - interval '1 day'`);
    if ((usage.rows[0]?.hour ?? 0) >= settings.hourly || (usage.rows[0]?.day ?? 0) >= settings.daily) {
      throw new AiProviderFailureError({ code: "AI_PROVIDER_RATE_LIMITED", provider: "kilo" });
    }
    await client.query(`INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
      VALUES ($1,$2,$3,'provider.free.attempt.started','{}'::jsonb)`, [session.tripId, requestId, sequence]);
  }); // No lock/transaction survives into provider I/O.
}
