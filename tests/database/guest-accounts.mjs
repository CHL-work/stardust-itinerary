import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { createGuestSession, GUEST_ISSUER, GuestAddressLimitError, GuestCapacityError, purgeExpiredGuests } from "../../src/lib/app/guest.ts";
import { AppForbiddenError, createTrip, createTripMember, getAiPolicy, getAppOverview, inTransaction } from "../../src/lib/app/repository.ts";
import { saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { issueJoinLink, verifySession } from "../../src/lib/auth/repository.ts";

/**
 * Guest accounts (JOB-064): creation, isolation from real trips, and the guarded purge. Synthetic
 * fixtures only, in the parent suite's guarded disposable database, starting at migration head 0055.
 */
export async function testGuestAccounts(pool, connectionString) {
  assert.deepEqual(await migrate({ connectionString, through: "0056_guest_accounts.sql" }), ["0056_guest_accounts.sql"]);
  await migrate({ connectionString });
  const config = { authSecret: "synthetic-guest-account-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    // A real trip that must survive every purge untouched.
    const realUser = randomUUID(), realTrip = randomUUID(), realMember = randomUUID();
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic real traveler')", [realUser]);
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic real trip','Asia/Tokyo','JPY',CURRENT_DATE+20,CURRENT_DATE+23)`, [realTrip, realUser]);
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic real owner','owner','active')",
      [realTrip, realMember, realUser]);
    await pool.query(`INSERT INTO audit_events(trip_id,id,actor_member_id,entity_type,action) VALUES($1,$2,$3,'trip','created')`,
      [realTrip, randomUUID(), realMember]);
    const realRows = async () => (await pool.query(`SELECT
        (SELECT count(*)::int FROM trips WHERE id=$1) AS trips, (SELECT count(*)::int FROM trip_members WHERE trip_id=$1) AS members,
        (SELECT count(*)::int FROM audit_events WHERE trip_id=$1) AS audits, (SELECT count(*)::int FROM app_users WHERE id=$2) AS users`,
    [realTrip, realUser])).rows[0];
    const realBefore = await realRows();

    // Creating a guest gives a session, a synthetic demo trip, and AI that only the guest's own key can pay for.
    const created = await createGuestSession(pool, config, { userAgent: "Synthetic guest browser", locale: "en", address: "203.0.113.20" });
    const session = await verifySession(pool, config, created.grant.rawToken);
    assert.ok(session);
    assert.equal(session.issuer, GUEST_ISSUER);
    assert.equal(session.tripId, created.tripId);
    const hours = (session.absoluteExpiresAt.getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, "the session ends with the guest account");
    const overview = await getAppOverview(pool, session);
    assert.deepEqual({ isGuest: overview.session.isGuest, owner: overview.session.isOwner, keyRequired: overview.ai.keyRequired },
      { isGuest: true, owner: true, keyRequired: true });
    assert.equal(overview.itinerary.length, 7, "the demo trip comes with a synthetic itinerary");
    assert.equal(overview.trip.maxMembers, 1);
    await assert.rejects(inTransaction(pool, (client) => getAiPolicy(client, session)), { reasonCode: "ai_key_required" });
    await saveAiCredential(pool, session, created.tripId, { provider: "openai", apiKey: `sk-synthetic-${randomUUID()}-GST1` }, async () => true);
    assert.equal((await inTransaction(pool, (client) => getAiPolicy(client, session))).credentialSource, "own");

    // Guests and real trips never mix, in application code and in the database.
    await assert.rejects(createTripMember(pool, session, created.tripId, { displayName: "Synthetic invitee" }), AppForbiddenError);
    await assert.rejects(createTrip(pool, session, { name: "Synthetic second trip", destinationName: "Osaka, Japan", timeZone: "Asia/Tokyo",
      defaultLocale: "en", defaultCurrency: "JPY", startsOn: "2031-01-01", endsOn: "2031-01-02", maxMembers: 2 }), AppForbiddenError);
    await assert.rejects(issueJoinLink(pool, config, { tripId: created.tripId, actorMemberId: session.memberId, actorUserId: session.userId }));
    // With capacity out of the way, the database still refuses guest invitations.
    await pool.query("UPDATE trips SET max_members = 5 WHERE id = $1", [created.tripId]);
    await assert.rejects(pool.query("INSERT INTO trip_join_links(id,trip_id,token_hash,created_by_member_id) VALUES($1,$2,$3,$4)",
      [randomUUID(), created.tripId, randomBytes(32), session.memberId]), /guest trips cannot invite/u);
    await assert.rejects(pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,NULL,'Synthetic slot','editor','invited')",
      [created.tripId, randomUUID()]), /no invited members/u);
    await assert.rejects(pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic guest','editor','active')",
      [realTrip, randomUUID(), session.userId]), /never mix/u);
    await assert.rejects(pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic real','editor','active')",
      [created.tripId, randomUUID(), realUser]), /never mix/u);
    await pool.query("UPDATE trips SET max_members = 1 WHERE id = $1", [created.tripId]);
    await assert.rejects(pool.query("UPDATE app_users SET guest_expires_at=NULL WHERE id=$1", [session.userId]), /cannot become or stop being a guest/u);
    await assert.rejects(pool.query("UPDATE app_users SET guest_expires_at=CURRENT_TIMESTAMP WHERE id=$1", [realUser]), /cannot become or stop being a guest/u);

    // Some of the append-only history a real trip would keep forever.
    const requestId = randomUUID();
    await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,prompt_text,requested_model,status,completed_at,credential_source)
      VALUES($1,$2,$3,$4,'owner','Synthetic guest prompt','gpt-6.1-sol','succeeded',CURRENT_TIMESTAMP,'own')`,
    [created.tripId, requestId, session.memberId, session.userId]);
    await pool.query(`INSERT INTO ai_request_events(trip_id,ai_request_id,sequence,event_type,payload) VALUES($1,$2,1,'request.started','{}'::jsonb)`,
      [created.tripId, requestId]);

    // Nothing is purged before the 24 hours are over.
    assert.deepEqual(await purgeExpiredGuests(pool), { purged: 0, refused: 0 });
    assert.equal((await pool.query("SELECT app_purge_expired_guest($1) AS purged", [session.userId])).rows[0].purged, false);
    assert.equal((await pool.query("SELECT app_purge_expired_guest($1) AS purged", [realUser])).rows[0].purged, false, "a real account is never purged");

    // A second guest that breaks isolation is refused, and nothing of it is deleted.
    const leaky = await createGuestSession(pool, config, { userAgent: "Synthetic guest browser", locale: "ja-JP", address: "203.0.113.21" });
    const leakySession = await verifySession(pool, config, leaky.grant.rawToken);
    await pool.query("ALTER TABLE trip_members DISABLE TRIGGER trip_members_guest_isolation");
    const leakyMember = randomUUID();
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic leak','viewer','active')",
      [realTrip, leakyMember, leakySession.userId]);
    await pool.query("ALTER TABLE trip_members ENABLE TRIGGER trip_members_guest_isolation");

    // The capacity limits count active guests, overall and per address (stored only as a keyed hash).
    await assert.rejects(createGuestSession(pool, config, { userAgent: null, locale: "en", address: "203.0.113.22" }, { GUEST_ACTIVE_LIMIT: "2" }), GuestCapacityError);
    await assert.rejects(createGuestSession(pool, config, { userAgent: null, locale: "en", address: "203.0.113.20" }, { GUEST_PER_ADDRESS_LIMIT: "1" }),
      GuestAddressLimitError);
    const { rows: [origin] } = await pool.query("SELECT octet_length(guest_origin_hash) AS bytes, position($2 in encode(guest_origin_hash, 'escape')) AS plain FROM app_users WHERE id=$1",
      [session.userId, "203.0.113.20"]);
    assert.deepEqual(origin, { bytes: 32, plain: 0 }, "the address itself is never stored");

    // Guest status is fixed for life, so a real trip can never be turned into something the purge would erase.
    await assert.rejects(pool.query("UPDATE trips SET guest_expires_at = CURRENT_TIMESTAMP WHERE id=$1", [realTrip]), /cannot become or stop being a guest trip/u);
    await assert.rejects(pool.query("UPDATE trips SET guest_expires_at = NULL WHERE id=$1", [created.tripId]), /cannot become or stop being a guest trip/u);
    await assert.rejects(pool.query("UPDATE trips SET owner_user_id=$2 WHERE id=$1", [created.tripId, leakySession.userId]), /keeps its guest owner/u);
    await assert.rejects(pool.query("UPDATE trip_members SET user_id=$3 WHERE trip_id=$1 AND id=$2", [created.tripId, session.memberId, leakySession.userId]),
      /never mix/u);
    // Only the guest-purge job may run the purge: the function runs with the caller's rights and no
    // longer belongs to PUBLIC.
    const { rows: [purgeFunction] } = await pool.query(`SELECT prosecdef, has_function_privilege('public', oid, 'EXECUTE') AS public_execute,
        proconfig FROM pg_proc WHERE proname = 'app_purge_expired_guest'`);
    assert.deepEqual({ definer: purgeFunction.prosecdef, publicExecute: purgeFunction.public_execute },
      { definer: false, publicExecute: false });
    assert.ok(purgeFunction.proconfig.some((setting) => /^search_path=pg_catalog, public, pg_temp$/u.test(setting)));
    // A role without the grant, like the web server's runtime role, cannot call it at all.
    await pool.query("CREATE ROLE synthetic_runtime_like NOLOGIN");
    await pool.query("GRANT USAGE ON SCHEMA public TO synthetic_runtime_like");
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE synthetic_runtime_like");
        await assert.rejects(client.query("SELECT app_purge_expired_guest(gen_random_uuid())"), /permission denied for function/u);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    } finally {
      await pool.query("REVOKE USAGE ON SCHEMA public FROM synthetic_runtime_like");
      await pool.query("DROP ROLE synthetic_runtime_like");
    }

    await pool.query("UPDATE app_users SET guest_expires_at = CURRENT_TIMESTAMP - interval '1 minute' WHERE id = ANY($1::uuid[])",
      [[session.userId, leakySession.userId]]);
    assert.deepEqual(await purgeExpiredGuests(pool), { purged: 1, refused: 1 });

    // Every row of the purged guest is gone: account, identity, keys, sessions and all trip data.
    const tripTables = (await pool.query(`SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema='public' AND c.column_name='trip_id' AND t.table_type='BASE TABLE'`)).rows.map((row) => row.table_name);
    assert.ok(tripTables.length >= 40);
    for (const table of tripTables) {
      const { rows: [{ count }] } = await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE trip_id = $1`, [created.tripId]);
      assert.equal(count, 0, `${table} still holds guest rows`);
    }
    const { rows: [left] } = await pool.query(`SELECT
        (SELECT count(*)::int FROM trips WHERE id=$1) AS trips, (SELECT count(*)::int FROM app_users WHERE id=$2) AS users,
        (SELECT count(*)::int FROM oidc_identities WHERE user_id=$2) AS identities, (SELECT count(*)::int FROM user_ai_credentials WHERE user_id=$2) AS keys,
        (SELECT count(*)::int FROM auth_sessions WHERE user_id=$2) AS sessions`, [created.tripId, session.userId]);
    assert.deepEqual(left, { trips: 0, users: 0, identities: 0, keys: 0, sessions: 0 });
    assert.equal(await verifySession(pool, config, created.grant.rawToken), null);

    // The refused guest and the real trip are untouched.
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM trips WHERE id=$1", [leaky.tripId])).rows[0].count, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_users WHERE id=$1", [leakySession.userId])).rows[0].count, 1);
    assert.deepEqual(await realRows(), { ...realBefore, members: realBefore.members + 1 });

    // A refused guest goes to the back of the queue, so it never holds the others back.
    assert.ok((await pool.query("SELECT guest_purge_refused_at FROM app_users WHERE id=$1", [leakySession.userId])).rows[0].guest_purge_refused_at);

    // With the leak repaired, the second guest is purged on the next run.
    await pool.query("DELETE FROM trip_members WHERE trip_id=$1 AND id=$2", [realTrip, leakyMember]);
    assert.deepEqual(await purgeExpiredGuests(pool), { purged: 1, refused: 0 });
    assert.deepEqual(await realRows(), realBefore);

    // An "expired guest" written straight into the table, without the synthetic guest identity, is refused.
    const forged = randomUUID();
    await pool.query("INSERT INTO app_users(id,display_name,guest_expires_at) VALUES($1,'Synthetic forged guest',CURRENT_TIMESTAMP - interval '1 hour')", [forged]);
    await assert.rejects(pool.query("SELECT app_purge_expired_guest($1)", [forged]), /no guest identity/u);
    await pool.query("DELETE FROM app_users WHERE id=$1", [forged]);
  } finally {
    await pool.query("ALTER TABLE trip_members ENABLE TRIGGER trip_members_guest_isolation").catch(() => {});
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
  }
}
