import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  consumeClaim, consumeJoinLink, issueClaim, issueJoinLink, previewJoinLink,
  revokeSession, rotateSession, signInExistingIdentity, switchSessionTrip, verifySession,
} from "../../src/lib/auth/repository.ts";
import { ClaimUnavailableError, JoinUnavailableError, MembershipDisabledError, SessionUnavailableError } from "../../src/lib/auth/errors.ts";
import { createTrip, getAppOverview, updateTripSettings } from "../../src/lib/app/repository.ts";

const DAY_MS = 86_400_000;
const hour = 3_600_000;

/** Auth behavior only, with synthetic identities in the guarded disposable database. */
export async function testCompletedTripAccess(pool, connectionString) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(databaseName, /^stardust_test_[a-z0-9_]+$/u);
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, databaseName);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, databaseName);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_schema_migrations")).rows[0].count, 42);
  const config = { authSecret: "synthetic-completed-trip-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };

  const makeUser = async () => {
    const userId = randomUUID();
    const identity = { issuer: "https://accounts.google.com", subject: `synthetic-completed-${randomUUID()}`,
      emailHint: "synthetic-traveler@example.test", displayNameHint: "Synthetic traveler" };
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic completed-trip traveler')", [userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)",
      [identity.issuer, identity.subject, userId, identity.emailHint]);
    return { userId, identity };
  };
  const owner = await makeUser(), member = await makeUser(), stranger = await makeUser();
  const addMember = async (tripId, user, role = "editor") => {
    const memberId = randomUUID();
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic traveler',$4,'active')",
      [tripId, memberId, user.userId, role]);
    return memberId;
  };
  const makeTrip = async (user, startOffset, endOffset) => {
    const tripId = randomUUID();
    const dates = (await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic completed-trip fixture','Asia/Tokyo','JPY',CURRENT_DATE+$3::integer,CURRENT_DATE+$4::integer)
      RETURNING starts_on::text,ends_on::text`, [tripId, user.userId, startOffset, endOffset])).rows[0];
    const memberId = await addMember(tripId, user, "owner");
    await pool.query(`INSERT INTO trip_days(trip_id,id,day_date)
      SELECT $1,gen_random_uuid(),day::date FROM generate_series($2::date,$3::date,interval '1 day') day`,
      [tripId, dates.starts_on, dates.ends_on]);
    return { tripId, memberId, ...dates };
  };
  const login = (user) => signInExistingIdentity(pool, config, { identity: user.identity, userAgent: "Synthetic auth regression browser" });
  const session = async (grant) => {
    const value = await verifySession(pool, config, grant.rawToken);
    assert.ok(value);
    return value;
  };
  const sessionRow = async (id) => (await pool.query("SELECT * FROM auth_sessions WHERE id=$1", [id])).rows[0];
  const currentSelection = async (user) => (await pool.query("SELECT last_selected_trip_id FROM app_users WHERE id=$1", [user.userId])).rows[0].last_selected_trip_id;
  const select = (user, tripId) => pool.query("UPDATE app_users SET last_selected_trip_id=$2 WHERE id=$1", [user.userId, tripId]);
  const snapshot = async () => (await pool.query(`SELECT
    (SELECT count(*)::int FROM trips) AS trips,(SELECT count(*)::int FROM auth_sessions) AS sessions,
    (SELECT count(*)::int FROM audit_events) AS audits,(SELECT count(*)::int FROM account_trip_creations) AS creations,
    (SELECT count(*)::int FROM app_users) AS users,(SELECT count(*)::int FROM oidc_identities) AS identities,
    (SELECT count(*)::int FROM trip_members) AS members`)).rows[0];
  const denyUnchanged = async (action, error = SessionUnavailableError) => {
    const before = await snapshot();
    await assert.rejects(action, error);
    assert.deepEqual(await snapshot(), before, "Rejected auth transitions must not leave sessions, trips, or audits behind");
  };
  const newTripInput = { name: "Synthetic authenticated creation", destinationName: "Tokyo, Japan", timeZone: "Asia/Tokyo",
    defaultLocale: "en", defaultCurrency: "JPY", startsOn: "2090-01-01", endsOn: "2090-01-02", maxMembers: 10 };
  const createOptions = { config, userAgent: "Synthetic authenticated creation" };

  // An ended trip is the only membership: returning Google sign-in must work for both roles.
  const past = await makeTrip(owner, -90, -80);
  const pastMemberId = await addMember(past.tripId, member);
  const beforeFresh = Date.now();
  const ownerGrant = await login(owner), memberGrant = await login(member);
  const afterFresh = Date.now();
  for (const grant of [ownerGrant, memberGrant]) {
    assert.equal(grant.tripId, past.tripId);
    assert.ok(grant.absoluteExpiresAt.getTime() >= beforeFresh + 30 * DAY_MS - 1000);
    assert.ok(grant.absoluteExpiresAt.getTime() <= afterFresh + 30 * DAY_MS + 1000);
    assert.ok(grant.expiresAt.getTime() >= beforeFresh + DAY_MS - 1000);
    assert.ok(grant.expiresAt.getTime() <= afterFresh + DAY_MS + 1000);
    assert.ok(await session(grant));
  }
  assert.equal(ownerGrant.role, "owner");
  assert.equal(memberGrant.role, "editor");
  assert.equal(memberGrant.memberId, pastMemberId);

  const current = await makeTrip(owner, -1, 1), future = await makeTrip(owner, 30, 35);
  const currentMemberId = await addMember(current.tripId, member);
  const foreign = await makeTrip(stranger, -5, 5);
  const initialOwnerSession = await session(ownerGrant);
  assert.deepEqual(new Set((await getAppOverview(pool, initialOwnerSession)).availableTrips.map((trip) => trip.id)),
    new Set([past.tripId, current.tripId, future.tripId]));
  await select(owner, null);
  assert.equal((await login(owner)).tripId, current.tripId, "Without a preference, the current trip still ranks first");

  // Explicitly returning to an old trip persists across sign-out and a fresh Google callback.
  const currentGrant = await login(owner);
  const currentSession = await session(currentGrant);
  const persistedCap = new Date(Date.now() + 6 * hour);
  await pool.query("UPDATE auth_sessions SET expires_at=$2,absolute_expires_at=$2 WHERE id=$1", [currentGrant.sessionId, persistedCap]);
  const forgedCeiling = { ...currentSession, absoluteExpiresAt: new Date("2099-01-01T00:00:00Z") };
  const switched = await switchSessionTrip(pool, config, forgedCeiling, past.tripId, null);
  assert.equal(switched.absoluteExpiresAt.toISOString(), persistedCap.toISOString(), "A browser/session DTO cannot extend the stored ceiling");
  assert.equal(switched.expiresAt.toISOString(), persistedCap.toISOString());
  assert.equal(await verifySession(pool, config, currentGrant.rawToken), null);
  assert.equal((await sessionRow(currentGrant.sessionId)).revoke_reason, "trip_switch");
  assert.equal(await currentSelection(owner), past.tripId);
  const switchedAgain = await switchSessionTrip(pool, config, await session(switched), future.tripId, null);
  assert.equal(switchedAgain.absoluteExpiresAt.toISOString(), persistedCap.toISOString());
  const switchedBack = await switchSessionTrip(pool, config, await session(switchedAgain), past.tripId, null);
  await revokeSession(pool, switchedBack.sessionId, owner.userId);
  const returned = await login(owner);
  assert.equal(returned.tripId, past.tripId);
  assert.equal(await currentSelection(owner), past.tripId);
  assert.ok(returned.absoluteExpiresAt.getTime() > persistedCap.getTime(), "Only fresh Google authentication renews the ceiling");

  // Invalid saved choices heal to an eligible membership, never another identity's trip.
  await select(member, past.tripId);
  await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [past.tripId, pastMemberId]);
  assert.equal((await login(member)).memberId, currentMemberId);
  assert.equal(await currentSelection(member), current.tripId);
  await select(member, past.tripId);
  await pool.query("UPDATE trip_members SET status='removed' WHERE trip_id=$1 AND id=$2", [past.tripId, pastMemberId]);
  assert.equal((await login(member)).tripId, current.tripId);
  await select(member, foreign.tripId);
  assert.equal((await login(member)).tripId, current.tripId);
  assert.equal(await currentSelection(member), current.tripId);
  const activeOwner = await session(returned);
  await denyUnchanged(() => switchSessionTrip(pool, config, activeOwner, foreign.tripId, null));
  await denyUnchanged(() => switchSessionTrip(pool, config, { ...activeOwner, memberId: pastMemberId }, current.tripId, null));
  await denyUnchanged(() => switchSessionTrip(pool, config, { ...activeOwner, generation: activeOwner.generation + 1 }, current.tripId, null));
  const activeMember = await session(await login(member));
  await denyUnchanged(() => switchSessionTrip(pool, config, activeMember, past.tripId, null));
  await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [current.tripId, currentMemberId]);
  await assert.rejects(() => login(member), MembershipDisabledError);
  await assert.rejects(() => login({ identity: { ...stranger.identity, subject: `synthetic-unbound-${randomUUID()}` } }), SessionUnavailableError);

  // Activity and rotation remain rolling, finite, and replay protected after travel ends.
  const activityGrant = await login(owner);
  const originalCap = activityGrant.absoluteExpiresAt;
  await pool.query("UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP+interval '1 hour' WHERE id=$1", [activityGrant.sessionId]);
  const shorterExpiry = (await sessionRow(activityGrant.sessionId)).expires_at;
  const beforeActivity = Date.now();
  const active = await session(activityGrant);
  assert.equal(active.absoluteExpiresAt.toISOString(), originalCap.toISOString());
  assert.equal(active.expiresAt.toISOString(), shorterExpiry.toISOString(), "Read verification does not itself rotate the activity credential");
  const rotated = await rotateSession(pool, config, activityGrant.rawToken);
  assert.equal(rotated.absoluteExpiresAt.toISOString(), originalCap.toISOString());
  assert.ok(rotated.expiresAt.getTime() >= beforeActivity + DAY_MS - 1000);
  assert.ok(rotated.expiresAt.getTime() <= Date.now() + DAY_MS + 1000);
  await assert.rejects(() => rotateSession(pool, config, activityGrant.rawToken), /refresh replay detected/u);
  assert.equal(await verifySession(pool, config, rotated.rawToken), null);

  // Creation inherits server state too; its distant trip dates cannot become a new ceiling.
  const creatorGrant = await login(owner), creator = await session(creatorGrant);
  const creationCap = new Date(Date.now() + 8 * hour);
  await pool.query("UPDATE auth_sessions SET expires_at=$2,absolute_expires_at=$2 WHERE id=$1", [creator.sessionId, creationCap]);
  const created = await createTrip(pool, { ...creator, absoluteExpiresAt: new Date("2099-01-01T00:00:00Z") }, newTripInput, createOptions);
  assert.equal(created.sessionGrant.absoluteExpiresAt.toISOString(), creationCap.toISOString());
  assert.equal(created.sessionGrant.expiresAt.toISOString(), creationCap.toISOString());
  assert.equal((await sessionRow(creator.sessionId)).revoke_reason, "trip_created");
  assert.equal(await verifySession(pool, config, creatorGrant.rawToken), null);

  // Rolling expiry, absolute expiry, revocation and rotated generations must not be revived.
  for (const cause of ["rolling", "absolute", "revoked", "generation"]) {
    await select(owner, past.tripId);
    const grant = await login(owner), stale = await session(grant);
    if (cause === "rolling") await pool.query(`UPDATE auth_sessions SET created_at=CURRENT_TIMESTAMP-interval '2 days',
      expires_at=CURRENT_TIMESTAMP-interval '1 minute' WHERE id=$1`, [grant.sessionId]);
    if (cause === "absolute") await pool.query(`UPDATE auth_sessions SET created_at=CURRENT_TIMESTAMP-interval '2 days',
      expires_at=CURRENT_TIMESTAMP-interval '2 minutes',absolute_expires_at=CURRENT_TIMESTAMP-interval '1 minute' WHERE id=$1`, [grant.sessionId]);
    if (cause === "revoked") await revokeSession(pool, grant.sessionId, owner.userId);
    if (cause === "generation") await rotateSession(pool, config, grant.rawToken);
    await denyUnchanged(() => switchSessionTrip(pool, config, stale, current.tripId, null));
    await denyUnchanged(() => createTrip(pool, stale, newTripInput, createOptions));
    await denyUnchanged(() => createTrip(pool, stale, newTripInput));
    if (cause !== "generation") assert.equal(await verifySession(pool, config, grant.rawToken), null);
  }

  // Recheck the persisted ceiling after waiting on a session-row lock, not only
  // against the transaction's earlier CURRENT_TIMESTAMP or an earlier snapshot.
  for (const operation of ["switch", "create"]) {
    await select(owner, past.tripId);
    const grant = await login(owner), stale = await session(grant);
    const blocker = await pool.connect();
    let signalRead;
    const enteredRead = new Promise((resolve) => { signalRead = resolve; });
    const waitingPool = { connect: async () => {
      const client = await pool.connect();
      return { query: (sql, ...args) => {
        if (sql.includes("locked_session")) signalRead();
        return client.query(sql, ...args);
      }, release: () => client.release() };
    } };
    let work, timeout;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM auth_sessions WHERE id=$1 FOR UPDATE", [grant.sessionId]);
      const before = await snapshot();
      work = (operation === "switch"
        ? switchSessionTrip(waitingPool, config, stale, current.tripId, null)
        : createTrip(waitingPool, stale, newTripInput, createOptions))
        .then(() => ({ allowed: true }), (error) => ({ allowed: false, error }));
      await Promise.race([enteredRead, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Auth transition did not reach its persisted session lock")), 3000);
      })]);
      clearTimeout(timeout);
      await blocker.query(`UPDATE auth_sessions SET created_at=CURRENT_TIMESTAMP-interval '2 days',
        expires_at=CURRENT_TIMESTAMP-interval '2 minutes',absolute_expires_at=CURRENT_TIMESTAMP-interval '1 minute' WHERE id=$1`, [grant.sessionId]);
      await blocker.query("COMMIT");
      const outcome = await work;
      assert.equal(outcome.allowed, false, `${operation} must not revive a credential expired during the lock wait`);
      assert.ok(outcome.error instanceof SessionUnavailableError);
      assert.deepEqual(await snapshot(), before);
    } finally {
      clearTimeout(timeout);
      await blocker.query("ROLLBACK");
      blocker.release();
      if (work) await work;
    }
  }

  // The per-user creation lock can also wait. Lock both here so source validation
  // cannot accidentally run before that wait and carry an earlier eligible state.
  await select(owner, past.tripId);
  const queuedGrant = await login(owner), queuedSession = await session(queuedGrant);
  const creationBlocker = await pool.connect();
  const creationKey = JSON.stringify([owner.userId, "trip-creation"]);
  let signalCreationLock;
  const enteredCreationLock = new Promise((resolve) => { signalCreationLock = resolve; });
  const queuedPool = { connect: async () => {
    const client = await pool.connect();
    return { query: (sql, ...args) => {
      if (sql.includes("pg_advisory_xact_lock") && args[0]?.[0] === creationKey) signalCreationLock();
      return client.query(sql, ...args);
    }, release: () => client.release() };
  } };
  let queuedCreation, creationTimeout;
  try {
    await creationBlocker.query("BEGIN");
    await creationBlocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [creationKey]);
    await creationBlocker.query("SELECT id FROM auth_sessions WHERE id=$1 FOR UPDATE", [queuedGrant.sessionId]);
    const before = await snapshot();
    queuedCreation = createTrip(queuedPool, queuedSession, newTripInput, createOptions)
      .then(() => ({ allowed: true }), (error) => ({ allowed: false, error }));
    await Promise.race([enteredCreationLock, new Promise((_, reject) => {
      creationTimeout = setTimeout(() => reject(new Error("Trip creation read its source before reaching the account advisory lock")), 3000);
    })]);
    clearTimeout(creationTimeout);
    await creationBlocker.query(`UPDATE auth_sessions SET created_at=CURRENT_TIMESTAMP-interval '2 days',
      expires_at=CURRENT_TIMESTAMP-interval '1 minute' WHERE id=$1`, [queuedGrant.sessionId]);
    await creationBlocker.query("COMMIT");
    const outcome = await queuedCreation;
    assert.equal(outcome.allowed, false, "A source expired during the account creation lock wait cannot create a trip");
    assert.ok(outcome.error instanceof SessionUnavailableError);
    assert.deepEqual(await snapshot(), before);
  } finally {
    clearTimeout(creationTimeout);
    await creationBlocker.query("ROLLBACK");
    creationBlocker.release();
    if (queuedCreation) await queuedCreation;
  }

  // Travel changes are independent of all live/expired/revoked authentication deadlines.
  await select(owner, past.tripId);
  const settingsSession = await session(await login(owner));
  const sessionSnapshot = async () => (await pool.query(`SELECT id,expires_at,absolute_expires_at,revoked_at,revoke_reason
    FROM auth_sessions WHERE trip_id=$1 ORDER BY id`, [past.tripId])).rows;
  const beforeSettings = await sessionSnapshot();
  const extendedEnd = new Date(`${past.ends_on}T00:00:00Z`);
  extendedEnd.setUTCDate(extendedEnd.getUTCDate() + 2);
  await updateTripSettings(pool, settingsSession, past.tripId, { endsOn: extendedEnd.toISOString().slice(0, 10), timeZone: "Pacific/Auckland" });
  assert.deepEqual(await sessionSnapshot(), beforeSettings);
  await updateTripSettings(pool, settingsSession, past.tripId, { timeZone: "Pacific/Honolulu" });
  assert.deepEqual(await sessionSnapshot(), beforeSettings);

  // Existing members may return, but new claims/reusable invitations do not reopen an ended trip.
  const invitedId = randomUUID();
  await pool.query("INSERT INTO trip_members(trip_id,id,display_name,role,status) VALUES($1,$2,'Synthetic expired invite','editor','invited')", [past.tripId, invitedId]);
  const actor = { tripId: past.tripId, actorMemberId: past.memberId, actorUserId: owner.userId };
  const claim = await issueClaim(pool, config, { ...actor, memberId: invitedId });
  const join = await issueJoinLink(pool, config, actor);
  assert.equal(await previewJoinLink(pool, config, join.rawToken), null);
  const newcomer = { issuer: "https://accounts.google.com", subject: `synthetic-newcomer-${randomUUID()}`, emailHint: null, displayNameHint: "Synthetic newcomer" };
  await denyUnchanged(() => consumeClaim(pool, config, { rawToken: claim.rawToken, identity: newcomer, userAgent: null }), ClaimUnavailableError);
  await denyUnchanged(() => consumeJoinLink(pool, config, { rawToken: join.rawToken, identity: newcomer, userAgent: null }), JoinUnavailableError);
  assert.deepEqual((await pool.query("SELECT status,user_id FROM trip_members WHERE trip_id=$1 AND id=$2", [past.tripId, invitedId])).rows[0],
    { status: "invited", user_id: null });
  assert.equal((await pool.query("SELECT consumed_at FROM member_claim_links WHERE trip_id=$1 AND member_id=$2", [past.tripId, invitedId])).rows[0].consumed_at, null);
  assert.equal((await login(owner)).tripId, past.tripId, "Failed new invitations must not lock out an already bound member");
}
