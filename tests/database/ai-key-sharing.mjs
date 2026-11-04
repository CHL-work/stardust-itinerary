import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import {
  AppForbiddenError, AppInvalidInputError, AppNotFoundError, createTripMember, getAiPolicy, getAppOverview, inTransaction, setAiKeyGrant,
  updateAiSettings, updateTripMember,
} from "../../src/lib/app/repository.ts";
import { aiKeyUsage, deleteAiCredential, readAiCredentialSecret, saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { consumeJoinLink, issueJoinLink, signInExistingIdentity, unbindMemberIdentity, verifySession } from "../../src/lib/auth/repository.ts";

/**
 * Trip owners sharing their own AI keys with chosen members (JOB-063). Synthetic fixtures only, in
 * the parent suite's guarded disposable database, starting at migration head 0054.
 */
export async function testAiKeySharing(pool, connectionString) {
  // Through 0055 only: the guest-account test that follows checks migration 0056.
  assert.deepEqual(await migrate({ connectionString, through: "0055_ai_key_sharing.sql" }), ["0055_ai_key_sharing.sql"]);
  const config = { authSecret: "synthetic-ai-key-sharing-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const userAgent = "Synthetic key sharing browser";
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const identityFor = (label) => ({ issuer: "https://accounts.google.com", subject: `synthetic-sharing-${label}-${randomUUID()}`,
      emailHint: `synthetic-${label}@example.test`, displayNameHint: `Synthetic ${label}` });
    const makeUser = async (label) => {
      const userId = randomUUID();
      const identity = identityFor(label);
      await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,$2)", [userId, `Synthetic ${label}`]);
      await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)",
        [identity.issuer, identity.subject, userId, identity.emailHint]);
      return { userId, identity };
    };
    const tripId = randomUUID();
    const owner = await makeUser("sponsor");
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic shared key trip','Asia/Tokyo','JPY',CURRENT_DATE+20,CURRENT_DATE+23)`, [tripId, owner.userId]);
    const addMember = async (user, displayName, role) => {
      const memberId = randomUUID();
      await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,$4,$5,'active')",
        [tripId, memberId, user.userId, displayName, role]);
      return memberId;
    };
    const ownerMemberId = await addMember(owner, "Synthetic sponsor", "owner");
    const coOwner = await makeUser("co-owner");
    await addMember(coOwner, "Synthetic co-owner", "owner");
    const member = await makeUser("member");
    const memberMemberId = await addMember(member, "Synthetic member", "editor");
    const outsider = await makeUser("outsider");
    const outsiderMemberId = await addMember(outsider, "Synthetic other member", "editor");
    // Not operator-sponsored: only a member's own key or an owner's shared key can pay here.
    await pool.query("INSERT INTO trip_ai_settings(trip_id,updated_by_member_id,host_subscription_enabled) VALUES($1,$2,false)", [tripId, ownerMemberId]);

    const sessionOf = async (user) => {
      const session = await verifySession(pool, config, (await signInExistingIdentity(pool, config, { identity: user.identity, userAgent })).rawToken);
      assert.ok(session);
      return session;
    };
    const ownerSession = await sessionOf(owner);
    const coOwnerSession = await sessionOf(coOwner);
    const memberSession = await sessionOf(member);
    const outsiderSession = await sessionOf(outsider);
    const policy = (session) => inTransaction(pool, (client) => getAiPolicy(client, session));
    const sponsorKey = `sk-synthetic-${randomUUID()}-SHAR`;
    await saveAiCredential(pool, ownerSession, tripId, { provider: "anthropic", apiKey: sponsorKey }, async () => true);

    await assert.rejects(policy(memberSession), { reasonCode: "ai_key_required" });

    // Only owners grant, never to themselves, and only keys they hold.
    await assert.rejects(setAiKeyGrant(pool, memberSession, tripId, outsiderMemberId, true), AppForbiddenError);
    await assert.rejects(setAiKeyGrant(pool, ownerSession, tripId, ownerMemberId, true), AppInvalidInputError);
    await assert.rejects(setAiKeyGrant(pool, coOwnerSession, tripId, memberMemberId, true), AppInvalidInputError,
      "an owner without a key cannot share one");
    await assert.rejects(setAiKeyGrant(pool, ownerSession, tripId, randomUUID(), true), AppNotFoundError);

    await setAiKeyGrant(pool, ownerSession, tripId, memberMemberId, true);
    const shared = await policy(memberSession);
    assert.deepEqual({ source: shared.credentialSource, model: shared.model, limit: shared.limit, sponsor: shared.sponsor },
      { source: "shared", model: "claude-sonnet-5-5", limit: 20, sponsor: { memberId: ownerMemberId, userId: owner.userId } },
      "the trip model's provider has no shared key, so the sponsor's provider default runs");
    await assert.rejects(policy(outsiderSession), { reasonCode: "ai_key_required" }, "a grant is per member");
    assert.equal(await readAiCredentialSecret(pool, member.userId, "anthropic"), null, "the member holds no copy of the key");

    // Owners pick the trip model in an unsponsored trip; the member cannot choose another.
    await updateAiSettings(pool, ownerSession, tripId, { ownerDefaultModel: "claude-opus-5-5" });
    assert.equal((await inTransaction(pool, (client) => getAiPolicy(client, memberSession, "claude-haiku-5-5"))).model, "claude-opus-5-5");

    // The overview names who shares and which model runs, never the key; members do not see others' grants.
    const ownerView = await getAppOverview(pool, ownerSession);
    assert.deepEqual(ownerView.members.find((entry) => entry.id === memberMemberId).aiKeyGrant,
      { sponsorMemberId: ownerMemberId, sponsorName: "Synthetic sponsor" });
    assert.equal(ownerView.members.find((entry) => entry.id === outsiderMemberId).aiKeyGrant, null);
    const memberView = await getAppOverview(pool, memberSession);
    assert.deepEqual({ enabled: memberView.ai.enabled, keyRequired: memberView.ai.keyRequired, sharedKey: memberView.ai.sharedKey },
      { enabled: true, keyRequired: false, sharedKey: { sponsorName: "Synthetic sponsor", model: "claude-opus-5-5" } });
    assert.equal(memberView.members.some((entry) => "aiKeyGrant" in entry), false);
    assert.equal(JSON.stringify(memberView).includes(sponsorKey) || JSON.stringify(ownerView).includes(sponsorKey), false);

    // Shared requests record their sponsor, and count against the trip's daily limit.
    await assert.rejects(pool.query(`INSERT INTO ai_requests (trip_id,id,actor_member_id,actor_user_id,actor_role,prompt_text,requested_model,status,completed_at,credential_source)
      VALUES ($1,$2,$3,$4,'editor','Synthetic shared fixture','claude-opus-5-5','failed',CURRENT_TIMESTAMP,'shared')`,
    [tripId, randomUUID(), memberMemberId, member.userId]), /credential_sponsor_ck/u);
    for (let index = 0; index < 20; index += 1) await pool.query(
      `INSERT INTO ai_requests (trip_id,id,actor_member_id,actor_user_id,actor_role,prompt_text,requested_model,status,completed_at,credential_source,credential_sponsor_member_id)
       VALUES ($1,$2,$3,$4,'editor','Synthetic shared fixture','claude-opus-5-5','failed',CURRENT_TIMESTAMP,'shared',$5)`,
      [tripId, randomUUID(), memberMemberId, member.userId, ownerMemberId]);
    await assert.rejects(policy(memberSession), { reasonCode: "daily_limit_reached" });
    // The sponsor sees how much members used the shared key; the member sees none of it as their own.
    await pool.query("UPDATE ai_requests SET provider='anthropic' WHERE trip_id=$1 AND credential_source='shared'", [tripId]);
    const sponsorUsage = await aiKeyUsage(pool, ownerSession, tripId);
    assert.deepEqual(sponsorUsage.anthropic, { today: 0, last30Days: 0, sharedToday: 20, sharedLast30Days: 20 });
    assert.deepEqual((await aiKeyUsage(pool, memberSession, tripId)).anthropic, { today: 0, last30Days: 0, sharedToday: 0, sharedLast30Days: 0 });
    await pool.query("DELETE FROM ai_requests WHERE trip_id=$1 AND credential_source='shared'", [tripId]);

    // Turning sharing off, or the sponsor deleting the key, stops it at the next request.
    await setAiKeyGrant(pool, ownerSession, tripId, memberMemberId, false);
    await assert.rejects(policy(memberSession), { reasonCode: "ai_key_required" });
    await setAiKeyGrant(pool, coOwnerSession, tripId, memberMemberId, false);
    await setAiKeyGrant(pool, ownerSession, tripId, memberMemberId, true);
    await deleteAiCredential(pool, ownerSession, tripId, "anthropic");
    await assert.rejects(policy(memberSession), { reasonCode: "ai_key_required" });
    assert.equal((await getAppOverview(pool, memberSession)).ai.sharedKey, null);
    await saveAiCredential(pool, ownerSession, tripId, { provider: "anthropic", apiKey: sponsorKey }, async () => true);
    assert.equal((await policy(memberSession)).credentialSource, "shared");

    // The invite checkbox: a member added with it can use the adding owner's keys.
    const invited = await createTripMember(pool, ownerSession, tripId, { displayName: "Synthetic invitee", shareAiKeys: true });
    assert.deepEqual((await pool.query("SELECT sponsor_member_id FROM trip_ai_key_grants WHERE trip_id=$1 AND member_id=$2",
      [tripId, invited.id])).rows, [{ sponsor_member_id: ownerMemberId }]);
    const membersBefore = (await pool.query("SELECT count(*)::int AS count FROM trip_members WHERE trip_id=$1", [tripId])).rows[0].count;
    await assert.rejects(createTripMember(pool, coOwnerSession, tripId, { displayName: "Synthetic unshared invitee", shareAiKeys: true }),
      AppInvalidInputError);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM trip_members WHERE trip_id=$1", [tripId])).rows[0].count,
      membersBefore, "a refused share adds no member");

    // The join-link checkbox: people joining through it get a grant from the link's owner, others do not.
    const sharingLink = await issueJoinLink(pool, config, { tripId, actorMemberId: ownerMemberId, actorUserId: owner.userId, sharesAiKeys: true });
    const joinedSession = await verifySession(pool, config,
      (await consumeJoinLink(pool, config, { rawToken: sharingLink.rawToken, identity: identityFor("joiner"), userAgent })).rawToken);
    assert.equal((await policy(joinedSession)).credentialSource, "shared");
    const plainLink = await issueJoinLink(pool, config, { tripId, actorMemberId: ownerMemberId, actorUserId: owner.userId });
    const plainSession = await verifySession(pool, config,
      (await consumeJoinLink(pool, config, { rawToken: plainLink.rawToken, identity: identityFor("plain-joiner"), userAgent })).rawToken);
    await assert.rejects(policy(plainSession), { reasonCode: "ai_key_required" });

    // Audit records who shares with whom and never any key material.
    const audits = (await pool.query(`SELECT action, metadata::text AS metadata FROM audit_events
      WHERE trip_id=$1 AND action IN ('ai_keys_shared','ai_keys_unshared') ORDER BY created_at`, [tripId])).rows;
    assert.ok(audits.length >= 5);
    assert.ok(audits.some((row) => row.metadata.includes("join_link")) && audits.some((row) => row.metadata.includes("member_added")));
    assert.equal(audits.some((row) => row.metadata.includes(sponsorKey) || row.metadata.includes("SHAR")), false);

    // A grant belongs to the person: unbinding the member's identity removes it, so whoever claims
    // the slot next starts without the owner's key.
    await setAiKeyGrant(pool, ownerSession, tripId, outsiderMemberId, true);
    await unbindMemberIdentity(pool, { tripId, memberId: outsiderMemberId, actorMemberId: ownerMemberId, actorUserId: owner.userId });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM trip_ai_key_grants WHERE trip_id=$1 AND member_id=$2",
      [tripId, outsiderMemberId])).rows[0].count, 0);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM audit_events WHERE trip_id=$1 AND entity_id=$2
      AND action='ai_keys_unshared' AND metadata->>'source'='identity_unbound'`, [tripId, outsiderMemberId])).rows[0].count, 1);

    // A sponsor who stops being an owner stops sharing, without anyone else's action.
    const revision = (await pool.query("SELECT current_revision FROM trip_members WHERE trip_id=$1 AND id=$2", [tripId, ownerMemberId])).rows[0].current_revision;
    await updateTripMember(pool, coOwnerSession, tripId, ownerMemberId, { role: "editor", expectedRevision: revision });
    await assert.rejects(policy(memberSession), { reasonCode: "ai_key_required" });
    await assert.rejects(policy(joinedSession), { reasonCode: "ai_key_required" });
    assert.equal((await getAppOverview(pool, coOwnerSession)).members.find((entry) => entry.id === memberMemberId).aiKeyGrant, null);
    // The grants are gone rather than dormant, so promoting the sponsor again does not revive them.
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM trip_ai_key_grants WHERE trip_id=$1 AND sponsor_member_id=$2",
      [tripId, ownerMemberId])).rows[0].count, 0);
  } finally {
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
  }
}
