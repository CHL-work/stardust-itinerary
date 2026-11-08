import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createGuestTripFixture as createGuestSession } from "./guest-fixture.mjs";
import { getAiPolicy, getAppOverview, inTransaction, setAiKeyGrant } from "../../src/lib/app/repository.ts";
import { signInExistingIdentity, verifySession } from "../../src/lib/auth/repository.ts";
import { saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { freeAiSettings, freeModelLabel } from "../../src/lib/ai/free-model.ts";
import { runAiPlanner } from "../../src/lib/ai/planner.ts";

/**
 * JOB-086: free AI for guests and registered owners/editors/viewers, independently of paid funding.
 * Synthetic fixtures only, at head, in the parent suite's disposable database.
 */
export async function testGuestFreeAi(pool, connectionString) {
  const config = { authSecret: "synthetic-guest-free-ai-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const saved = Object.fromEntries(["GUEST_FREE_AI_ENABLED", "GUEST_FREE_AI_PER_GUEST_DAILY", "GUEST_FREE_AI_HOURLY", "GUEST_ACTIVE_LIMIT",
    "FREE_AI_ENABLED", "FREE_AI_MODELS", "FREE_AI_PER_USER_DAILY", "FREE_AI_HOURLY", "FREE_AI_DAILY", "CREDENTIAL_ENCRYPTION_KEY"]
    .map((name) => [name, process.env[name]]));
  process.env.GUEST_ACTIVE_LIMIT = "1000";
  for (const name of ["FREE_AI_ENABLED", "FREE_AI_MODELS", "FREE_AI_PER_USER_DAILY", "FREE_AI_HOURLY", "FREE_AI_DAILY"]) delete process.env[name];
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const guest = async (address) => {
      const created = await createGuestSession(pool, config, { userAgent: "Synthetic guest browser", locale: "en", address });
      return verifySession(pool, config, created.grant.rawToken);
    };
    const policy = (session, model) => inTransaction(pool, (client) => getAiPolicy(client, session, model, { serializeMemberQuota: true }));
    const spend = (session, count) => Promise.all(Array.from({ length: count }, () => pool.query(
      `INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_role,prompt_text,requested_model,provider,transport,authentication_mode,
         billing_basis,status,actor_user_id,credential_source)
       VALUES($1,$2,$3,$5,'Synthetic free prompt','guest-free','kilo','kilo_gateway','anonymous','free','succeeded',$4,'free')`,
      [session.tripId, randomUUID(), session.memberId, session.userId, session.role])));

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
      { enabled: true, keyRequired: false, freeAi: { model: freeModelLabel(freeAiSettings().models[0]), limit: 2, remainingToday: 2, isDefault: true }, remaining: 2 });
    // The browser learns only that free AI is on, never the gateway settings behind it.
    assert.doesNotMatch(JSON.stringify(overview), /ai-gateway\.kilo\.ai|nemotron-3\.5-super-vl:free/u);

    // The per-guest cap, then the instance-wide hourly cap for everyone else.
    await spend(first, 2);
    await assert.rejects(policy(first), (error) => error.reasonCode === "daily_limit_reached" && /free AI requests/u.test(error.message));
    assert.equal((await getAppOverview(pool, first)).ai.freeAi.remainingToday, 0);
    const second = await guest("203.0.113.92");
    assert.equal((await policy(second)).credentialSource, "free");
    await spend(second, 1);
    await assert.rejects(policy(second), (error) => error.reasonCode === "daily_limit_reached" && /busy/u.test(error.message));

    // The column only accepts known funding sources.
    await assert.rejects(pool.query("UPDATE ai_requests SET credential_source = 'gift' WHERE actor_user_id = $1", [second.userId]),
      /ai_requests_credential_source_ck/u);

    // Canonical settings supersede legacy guest names, without turning free off for guests.
    process.env.FREE_AI_ENABLED = "true";
    process.env.FREE_AI_PER_USER_DAILY = "10";
    process.env.FREE_AI_HOURLY = "60";
    process.env.FREE_AI_DAILY = "500";
    const makeUser = async () => {
      const userId = randomUUID();
      const identity = { issuer: "https://accounts.google.com", subject: `synthetic-free-${randomUUID()}`,
        emailHint: "synthetic-free@example.test", displayNameHint: "Synthetic free traveler" };
      await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic free traveler')", [userId]);
      await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)",
        [identity.issuer, identity.subject, userId, identity.emailHint]);
      return { userId, identity };
    };
    const owner = await makeUser(), editor = await makeUser(), viewer = await makeUser();
    const tripId = randomUUID();
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic free planning trip','Asia/Tokyo','JPY',CURRENT_DATE+20,CURRENT_DATE+23)`, [tripId, owner.userId]);
    const sessions = [];
    for (const [user, role] of [[owner, "owner"], [editor, "editor"], [viewer, "viewer"]]) {
      await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic traveler',$4,'active')",
        [tripId, randomUUID(), user.userId, role]);
      const grant = await signInExistingIdentity(pool, config, { identity: user.identity, userAgent: "Synthetic free browser" });
      const session = await verifySession(pool, config, grant.rawToken);
      assert.ok(session);
      sessions.push({ session, token: grant.rawToken });
    }
    const [ownerSession, editorSession, viewerSession] = sessions.map(({ session }) => session);
    await pool.query(`INSERT INTO trip_ai_settings(trip_id,enabled,updated_by_member_id,host_subscription_enabled)
      VALUES($1,true,$2,false)`, [tripId, ownerSession.memberId]);
    for (const session of [ownerSession, editorSession, viewerSession]) {
      assert.equal((await policy(session)).credentialSource, "free", "any unfunded registered role can use free AI");
      const ai = (await getAppOverview(pool, session)).ai;
      assert.equal(ai.keyRequired, false);
      assert.equal(ai.freeAi.isDefault, true);
      await assert.rejects(policy(session, "claude-opus-5-5"), { reasonCode: "ai_key_required" }, "explicit paid choice is not replaced by free");
    }

    // Own/shared/operator funding is still the default; free is a distinct selectable route.
    await saveAiCredential(pool, ownerSession, tripId, { provider: "openai", apiKey: `sk-synthetic-${randomUUID()}-FREE` }, async () => true);
    await setAiKeyGrant(pool, ownerSession, tripId, editorSession.memberId, true);
    assert.equal((await policy(ownerSession)).credentialSource, "own");
    assert.equal((await policy(editorSession)).credentialSource, "shared");
    for (const session of [ownerSession, editorSession]) {
      assert.equal((await policy(session, "guest-free")).credentialSource, "free");
      assert.equal((await getAppOverview(pool, session)).ai.freeAi.isDefault, false);
    }
    await pool.query("UPDATE trip_ai_settings SET host_subscription_enabled=true WHERE trip_id=$1", [tripId]);
    assert.equal((await policy(viewerSession)).credentialSource, "operator");
    assert.equal((await policy(viewerSession, "guest-free")).credentialSource, "free");
    assert.equal((await getAppOverview(pool, viewerSession)).ai.freeAi.isDefault, false);
    await spend(editorSession, 1);
    assert.equal((await policy(editorSession)).usedToday, 0, "free use cannot consume a shared-key allowance");
    assert.equal((await getAppOverview(pool, editorSession)).ai.usedToday, 0);
    assert.equal((await policy(editorSession, "guest-free")).usedToday, 1);

    // This is a real planner short-circuit, never a provider call. Its audit row must consume
    // the chosen free allowance rather than the member's existing shared-key allowance.
    const offTopic = await runAiPlanner(pool, editorSession, "Write me a Python function to sort a linked list", "guest-free", "en");
    assert.equal(offTopic.proposalCount, 0);
    assert.equal((await policy(editorSession, "guest-free")).usedToday, 2);
    assert.equal((await policy(editorSession)).usedToday, 0);
    assert.equal((await getAppOverview(pool, editorSession)).ai.usedToday, 0);
    const gateAudit = (await pool.query("SELECT credential_source,billing_basis,provider FROM ai_requests WHERE trip_id=$1 AND id=$2",
      [tripId, offTopic.requestId])).rows[0];
    assert.deepEqual(gateAudit, { credential_source: "free", billing_basis: "none", provider: "local" });

    process.env.FREE_AI_ENABLED = "false";
    await assert.rejects(policy(ownerSession, "guest-free"), { reasonCode: "ai_key_required" }, "disabled free must not charge a paid key");
    assert.equal((await getAppOverview(pool, ownerSession)).ai.freeAi, null);
    process.env.FREE_AI_ENABLED = "true";
    await pool.query("UPDATE trip_ai_settings SET enabled=false WHERE trip_id=$1", [tripId]);
    await assert.rejects(policy(viewerSession, "guest-free"), { reasonCode: "ai_disabled" });
    assert.equal((await getAppOverview(pool, viewerSession)).ai.freeAi, null);
    await pool.query("UPDATE trip_ai_settings SET enabled=true WHERE trip_id=$1", [tripId]);

    // Admission and the write share the lock: just one of two simultaneous users takes the last slot.
    const currentHour = (await pool.query(`SELECT count(*)::int AS count FROM ai_requests
      WHERE credential_source='free' AND status<>'rejected' AND created_at>=CURRENT_TIMESTAMP-interval '1 hour'`)).rows[0].count;
    process.env.FREE_AI_HOURLY = String(currentHour + 1);
    const admit = (session) => inTransaction(pool, async (client) => {
      await getAiPolicy(client, session, "guest-free", { serializeMemberQuota: true });
      await client.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_role,prompt_text,requested_model,provider,transport,
        authentication_mode,billing_basis,status,actor_user_id,credential_source)
        VALUES($1,$2,$3,$4,'Synthetic free admission','guest-free','kilo','kilo_gateway','anonymous','free','started',$5,'free')`,
        [session.tripId, randomUUID(), session.memberId, session.role, session.userId]);
    });
    const races = await Promise.allSettled([admit(ownerSession), admit(viewerSession)]);
    assert.equal(races.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(races.filter((result) => result.status === "rejected" && result.reason.reasonCode === "daily_limit_reached").length, 1);

    // Free availability never revives an expired/disabled/suspended identity.
    await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [tripId, editorSession.memberId]);
    assert.equal(await verifySession(pool, config, sessions[1].token), null);
    await pool.query("UPDATE app_users SET suspended_at=CURRENT_TIMESTAMP WHERE id=$1", [viewerSession.userId]);
    assert.equal(await verifySession(pool, config, sessions[2].token), null);
    assert.equal((await pool.query("SELECT guest_expires_at FROM app_users WHERE id=$1", [ownerSession.userId])).rows[0].guest_expires_at, null,
      "free eligibility does not turn a registered account into a purgeable guest");
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
