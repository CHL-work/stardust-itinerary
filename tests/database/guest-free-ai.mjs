import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createGuestSession } from "../../src/lib/app/guest.ts";
import { getAiPolicy, getAppOverview, inTransaction } from "../../src/lib/app/repository.ts";
import { verifySession } from "../../src/lib/auth/repository.ts";

/**
 * Free guest AI (JOB-071): guests without a key get the free model within a per-guest daily cap and
 * instance-wide hourly and daily caps; it is off unless enabled. Synthetic guests only, at head.
 */
export async function testGuestFreeAi(pool, connectionString) {
  const config = { authSecret: "synthetic-guest-free-ai-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const saved = Object.fromEntries(["GUEST_FREE_AI_ENABLED", "GUEST_FREE_AI_PER_GUEST_DAILY", "GUEST_FREE_AI_HOURLY", "GUEST_ACTIVE_LIMIT"]
    .map((name) => [name, process.env[name]]));
  process.env.GUEST_ACTIVE_LIMIT = "1000";
  try {
    const guest = async (address) => {
      const created = await createGuestSession(pool, config, { userAgent: "Synthetic guest browser", locale: "en", address });
      return verifySession(pool, config, created.grant.rawToken);
    };
    const policy = (session) => inTransaction(pool, (client) => getAiPolicy(client, session, undefined, { serializeMemberQuota: true }));
    const spend = (session, count) => Promise.all(Array.from({ length: count }, () => pool.query(
      `INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_role,prompt_text,requested_model,provider,transport,authentication_mode,
         billing_basis,status,actor_user_id,credential_source)
       VALUES($1,$2,$3,'owner','Synthetic free prompt','guest-free','kilo','kilo_gateway','anonymous','free','succeeded',$4,'free')`,
      [session.tripId, randomUUID(), session.memberId, session.userId])));

    const first = await guest("203.0.113.91");
    // Off unless enabled: a guest without a key is asked for one.
    delete process.env.GUEST_FREE_AI_ENABLED;
    await assert.rejects(policy(first), { reasonCode: "ai_key_required" });
    // The guest notice mentions the key only when this says so (JOB-077).
    assert.equal((await getAppOverview(pool, first)).ai.keyRequired, true);

    process.env.GUEST_FREE_AI_ENABLED = "true";
    process.env.GUEST_FREE_AI_PER_GUEST_DAILY = "2";
    process.env.GUEST_FREE_AI_HOURLY = "3";
    assert.deepEqual(await policy(first), { enabled: true, model: "guest-free", usedToday: 0, limit: 2, credentialSource: "free" });
    const overview = await getAppOverview(pool, first);
    assert.deepEqual({ enabled: overview.ai.enabled, keyRequired: overview.ai.keyRequired, freeAi: overview.ai.freeAi, remaining: overview.ai.remainingToday },
      { enabled: true, keyRequired: false, freeAi: { model: "NVIDIA Nemotron 3.5 Super", limit: 2, remainingToday: 2 }, remaining: 2 });
    // The browser learns only that free AI is on, never the gateway settings behind it.
    assert.doesNotMatch(JSON.stringify(overview), /ai-gateway\.kilo\.ai|nemotron-3\.5-super-vl:free/u);

    // The per-guest cap, then the instance-wide hourly cap for everyone else.
    await spend(first, 2);
    await assert.rejects(policy(first), (error) => error.reasonCode === "daily_limit_reached" && /free guest AI requests/u.test(error.message));
    assert.equal((await getAppOverview(pool, first)).ai.freeAi.remainingToday, 0);
    const second = await guest("203.0.113.92");
    assert.equal((await policy(second)).credentialSource, "free");
    await spend(second, 1);
    await assert.rejects(policy(second), (error) => error.reasonCode === "daily_limit_reached" && /busy/u.test(error.message));

    // The column only accepts known funding sources.
    await assert.rejects(pool.query("UPDATE ai_requests SET credential_source = 'gift' WHERE actor_user_id = $1", [second.userId]),
      /ai_requests_credential_source_ck/u);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
