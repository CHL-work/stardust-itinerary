import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { AppConflictError, AppForbiddenError, AppInvalidInputError, getAppOverview } from "../../src/lib/app/repository.ts";
import { deleteTrip, getTripDeletionPreview } from "../../src/lib/app/trip-deletion.ts";
import { consumeJoinLink, issueJoinLink, previewJoinLink, signInExistingIdentity, switchSessionTrip, verifySession } from "../../src/lib/auth/repository.ts";
import { JoinUnavailableError, SessionUnavailableError } from "../../src/lib/auth/errors.ts";

/** Synthetic fixtures only, in the parent suite's guarded disposable database. */
export async function testTripDeletion(pool, connectionString) {
  await migrate({ connectionString });
  assert.deepEqual(await migrate({ connectionString }), []);
  const config = { authSecret: "synthetic-trip-deletion-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const userAgent = "Synthetic trip deletion browser";

  const makeUser = async () => {
    const userId = randomUUID();
    const identity = { issuer: "https://accounts.google.com", subject: `synthetic-delete-${randomUUID()}`,
      emailHint: "synthetic-traveler@example.test", displayNameHint: "Synthetic traveler" };
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic deletion traveler')", [userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)", [identity.issuer, identity.subject, userId, identity.emailHint]);
    return { userId, identity };
  };
  const addMember = async (tripId, user, role = "editor", status = "active") => {
    const memberId = randomUUID();
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic traveler',$4,$5)",
      [tripId, memberId, user?.userId ?? null, role, status]);
    return memberId;
  };
  const makeTrip = async (owner, name, startOffset = 30) => {
    const tripId = randomUUID();
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,$3,'Asia/Tokyo','JPY',CURRENT_DATE+$4::integer,CURRENT_DATE+$4::integer+3)`, [tripId, owner.userId, name, startOffset]);
    const memberId = await addMember(tripId, owner, "owner");
    await pool.query("INSERT INTO trip_ai_settings(trip_id,updated_by_member_id) VALUES($1,$2)", [tripId, memberId]);
    await pool.query("INSERT INTO trip_disruption_settings(trip_id,updated_by_member_id) VALUES($1,$2)", [tripId, memberId]);
    return { tripId, memberId };
  };
  const login = (user) => signInExistingIdentity(pool, config, { identity: user.identity, userAgent });
  const sessionOf = async (grant) => {
    const session = await verifySession(pool, config, grant.rawToken);
    assert.ok(session);
    return session;
  };
  const tripState = async (tripId) => (await pool.query(
    `SELECT t.deleted_at, t.deleted_by_member_id,
      (SELECT count(*)::int FROM audit_events WHERE trip_id = t.id AND action = 'deleted') AS deleted_audits
     FROM trips t WHERE t.id = $1`, [tripId])).rows[0];

  const owner = await makeUser(), coOwner = await makeUser(), editor = await makeUser(), soleOwner = await makeUser(), joiner = await makeUser(), revokedUser = await makeUser();
  const target = await makeTrip(owner, "Synthetic  trip to delete");
  const other = await makeTrip(owner, "Synthetic trip that stays", 60);
  const sole = await makeTrip(soleOwner, "Synthetic only trip");
  const coOwnerMemberId = await addMember(target.tripId, coOwner, "owner");
  const editorMemberId = await addMember(target.tripId, editor);
  const invitedMemberId = await addMember(target.tripId, null, "editor", "invited");
  const revokedMemberId = await addMember(target.tripId, revokedUser, "editor", "revoked");
  const removedMemberId = await addMember(target.tripId, null, "editor", "removed");
  const dayId = randomUUID();
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,CURRENT_DATE+30)", [target.tripId, dayId]);
  const eventId = randomUUID(), cancelledId = randomUUID(), expenseId = randomUUID();
  await pool.query(`INSERT INTO itinerary_items(trip_id,id,trip_day_id,created_by_member_id,title,visibility,status)
    VALUES($1,$2,$4,$5,'Synthetic event','trip','planned'),($1,$3,$4,$5,'Synthetic cancelled','trip','cancelled')`,
  [target.tripId, eventId, cancelledId, dayId, target.memberId]);
  await pool.query(`INSERT INTO expenses(trip_id,id,payer_member_id,description,amount_minor,currency,occurred_at,status)
    VALUES($1,$2,$3,'Synthetic expense',1000,'JPY',CURRENT_TIMESTAMP,'draft')`, [target.tripId, expenseId, target.memberId]);
  await pool.query("INSERT INTO calendar_connections(trip_id,member_id,access_token_encrypted) VALUES($1,$2,'synthetic-ciphertext')", [target.tripId, editorMemberId]);
  await pool.query(`INSERT INTO weather_refresh_leases(trip_id,member_id,lease_token,acquired_at,leased_until)
    VALUES($1,$2,gen_random_uuid(),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 minute')`, [target.tripId, editorMemberId]);
  await pool.query("UPDATE trip_disruption_settings SET enabled=false WHERE trip_id=$1", [target.tripId]);
  const requestId = randomUUID();
  await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,prompt_text,requested_model,status)
    VALUES($1,$2,$3,$4,'editor','Synthetic in-flight request','gpt-6.1-sol','started')`, [target.tripId, requestId, editorMemberId, editor.userId]);
  const joinLink = await issueJoinLink(pool, config, { tripId: target.tripId, actorMemberId: target.memberId, actorUserId: owner.userId });

  await pool.query("UPDATE app_users SET last_selected_trip_id=$2 WHERE id=$1", [owner.userId, target.tripId]);
  const ownerSession = await sessionOf(await login(owner));
  assert.equal(ownerSession.tripId, target.tripId);
  const coOwnerSession = await sessionOf(await login(coOwner));
  const editorSession = await sessionOf(await login(editor));
  await pool.query("UPDATE app_users SET last_selected_trip_id=$2 WHERE id=$1", [soleOwner.userId, sole.tripId]);
  const soleSession = await sessionOf(await login(soleOwner));

  // Preview: counts, the next trip and no write.
  const preview = await getTripDeletionPreview(pool, ownerSession, target.tripId);
  assert.equal(preview.blockedReason, null);
  assert.equal(preview.nextTripName, "Synthetic trip that stays");
  assert.equal(preview.trip.name, "Synthetic  trip to delete");
  assert.deepEqual(preview.counts, { otherMembers: 3, events: 1, expenses: 0, repayments: 0, pendingRequests: 0 });
  assert.equal((await tripState(target.tripId)).deleted_at, null);

  // Only an owner, only of this trip.
  await assert.rejects(getTripDeletionPreview(pool, editorSession, target.tripId), AppForbiddenError);
  await assert.rejects(deleteTrip(pool, config, editorSession, target.tripId, { confirmationName: preview.trip.name }, userAgent), AppForbiddenError);
  await assert.rejects(deleteTrip(pool, config, ownerSession, sole.tripId, { confirmationName: "Synthetic only trip" }, userAgent));
  assert.equal((await tripState(sole.tripId)).deleted_at, null);

  // A user's only trip stays: with signup off they could not get back in.
  assert.equal((await getTripDeletionPreview(pool, soleSession, sole.tripId)).blockedReason, "last_trip");
  await assert.rejects(deleteTrip(pool, config, soleSession, sole.tripId, { confirmationName: "Synthetic only trip" }, userAgent), AppConflictError);
  assert.equal((await tripState(sole.tripId)).deleted_at, null);

  // A wrong name changes nothing; the transaction also rolls back cleanly.
  await assert.rejects(deleteTrip(pool, config, ownerSession, target.tripId, { confirmationName: "Synthetic trip to keep" }, userAgent), AppInvalidInputError);
  assert.equal((await tripState(target.tripId)).deleted_at, null);
  assert.ok(await verifySession(pool, config, (await login(editor)).rawToken));

  // Success, tolerating invisible spacing differences only.
  const result = await deleteTrip(pool, config, ownerSession, target.tripId, { confirmationName: "  Synthetic trip\u00a0to delete " }, userAgent);
  assert.equal(result.deleted, true);
  assert.equal(result.nextTripId, other.tripId);
  const state = await tripState(target.tripId);
  assert.ok(state.deleted_at);
  assert.equal(state.deleted_by_member_id, target.memberId);
  assert.equal(state.deleted_audits, 1);

  // The owner continues on the next trip with the same authentication ceiling.
  const nextSession = await sessionOf(result.grant);
  assert.equal(nextSession.tripId, other.tripId);
  assert.equal(nextSession.memberId, other.memberId);
  assert.equal(result.grant.absoluteExpiresAt.getTime(), ownerSession.absoluteExpiresAt.getTime());
  assert.equal((await pool.query("SELECT last_selected_trip_id FROM app_users WHERE id=$1", [owner.userId])).rows[0].last_selected_trip_id, other.tripId);
  const overview = await getAppOverview(pool, nextSession);
  assert.deepEqual(overview.availableTrips.map((trip) => trip.id), [other.tripId]);

  // Every membership fails closed; removed tombstones stay as they were.
  const members = new Map((await pool.query("SELECT id,status,status_before_trip_deletion FROM trip_members WHERE trip_id=$1", [target.tripId])).rows.map((row) => [row.id, row]));
  for (const [id, before] of [[target.memberId, "active"], [coOwnerMemberId, "active"], [editorMemberId, "active"], [invitedMemberId, "invited"], [revokedMemberId, "revoked"]]) {
    assert.equal(members.get(id).status, "trip_deleted");
    assert.equal(members.get(id).status_before_trip_deletion, before);
  }
  assert.equal(members.get(removedMemberId).status, "removed");
  assert.equal(members.get(removedMemberId).status_before_trip_deletion, null);

  // No session, sign-in or link reaches the deleted trip.
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM auth_sessions WHERE trip_id=$1 AND revoked_at IS NULL", [target.tripId])).rows[0].count, 0);
  await assert.rejects(login(editor), SessionUnavailableError);
  await assert.rejects(login(coOwner), SessionUnavailableError);
  await assert.rejects(login(revokedUser), SessionUnavailableError);
  assert.equal(await previewJoinLink(pool, config, joinLink.rawToken), null);
  await assert.rejects(consumeJoinLink(pool, config, { rawToken: joinLink.rawToken, identity: joiner.identity, userAgent }), JoinUnavailableError);
  await assert.rejects(switchSessionTrip(pool, config, nextSession, target.tripId, userAgent), SessionUnavailableError);
  await assert.rejects(getTripDeletionPreview(pool, coOwnerSession, target.tripId), AppForbiddenError);
  await assert.rejects(deleteTrip(pool, config, coOwnerSession, target.tripId, { confirmationName: preview.trip.name }, userAgent));

  // Credentials and live work stop.
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM calendar_connections WHERE trip_id=$1", [target.tripId])).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM weather_refresh_leases WHERE trip_id=$1", [target.tripId])).rows[0].count, 0);
  const deletedAudit = (await pool.query("SELECT metadata FROM audit_events WHERE trip_id=$1 AND action='deleted'", [target.tripId])).rows[0].metadata;
  assert.equal(deletedAudit.disruptionChecksEnabled, false);
  assert.equal(deletedAudit.events, 1);
  assert.equal((await pool.query("SELECT status FROM ai_requests WHERE id=$1", [requestId])).rows[0].status, "failed");
  assert.equal((await pool.query("SELECT enabled FROM trip_disruption_settings WHERE trip_id=$1", [target.tripId])).rows[0].enabled, false);
  assert.equal((await pool.query("SELECT last_selected_trip_id FROM app_users WHERE id=$1", [editor.userId])).rows[0].last_selected_trip_id, null);

  // History stays, including the audit trail and money records.
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM itinerary_items WHERE trip_id=$1", [target.tripId])).rows[0].count, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM expenses WHERE trip_id=$1", [target.tripId])).rows[0].count, 1);

  // The database itself refuses to reopen access while the trip is deleted.
  await assert.rejects(pool.query("UPDATE trip_members SET status='active', status_before_trip_deletion=NULL WHERE trip_id=$1 AND id=$2", [target.tripId, editorMemberId]),
    (error) => error.constraint === "trip_members_deleted_trip_ck");
  await assert.rejects(pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic','editor','active')", [target.tripId, randomUUID(), joiner.userId]),
    (error) => error.constraint === "trip_members_deleted_trip_ck");
  await assert.rejects(pool.query("UPDATE trip_members SET status='trip_deleted' WHERE trip_id=$1 AND id=$2", [other.tripId, other.memberId]),
    (error) => error.constraint === "trip_members_trip_deletion_status_ck");

  // The operator restore in docs/DATABASE.md ("Restoring a deleted trip") brings members back exactly as they were.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE trips SET deleted_at=NULL, deleted_by_member_id=NULL WHERE id=$1", [target.tripId]);
    await client.query(`UPDATE trip_members SET status=status_before_trip_deletion, status_before_trip_deletion=NULL, current_revision=current_revision+1
      WHERE trip_id=$1 AND status='trip_deleted'`, [target.tripId]);
    await client.query(`UPDATE trip_disruption_settings SET enabled = (SELECT (metadata->>'disruptionChecksEnabled')::boolean
      FROM audit_events WHERE trip_id = $1 AND action = 'deleted' ORDER BY created_at DESC LIMIT 1) WHERE trip_id = $1`, [target.tripId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  assert.equal((await pool.query("SELECT status FROM trip_members WHERE trip_id=$1 AND id=$2", [target.tripId, revokedMemberId])).rows[0].status, "revoked");
  assert.equal((await pool.query("SELECT enabled FROM trip_disruption_settings WHERE trip_id=$1", [target.tripId])).rows[0].enabled, false);
  assert.equal((await sessionOf(await login(editor))).tripId, target.tripId);
  assert.equal(await verifySession(pool, config, "not-a-real-token"), null);
}
