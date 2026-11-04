import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { OWN_KEY_DAILY_LIMIT, getAiPolicy, getAppOverview, inTransaction } from "../../src/lib/app/repository.ts";
import { deleteAiCredential, listAiCredentials, readAiCredentialSecret, reencryptAiCredentials, saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { openCredential, sealCredential } from "../../src/lib/ai/credential-crypto.ts";
import { signInExistingIdentity, verifySession } from "../../src/lib/auth/repository.ts";

/**
 * Migration 0054 turns AI on for unsponsored trips, which could not turn it on before, unless an
 * owner's recorded settings change turned it off. Called at migration head 0053.
 */
async function testAiEnabledMigration(pool, connectionString) {
  const userId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic migration owner')", [userId]);
  const makeTrip = async (sponsored) => {
    const tripId = randomUUID(), memberId = randomUUID();
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic AI switch trip','Asia/Tokyo','JPY',CURRENT_DATE+20,CURRENT_DATE+23)`, [tripId, userId]);
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic owner','owner','active')",
      [tripId, memberId, userId]);
    await pool.query(`INSERT INTO trip_ai_settings(trip_id,enabled,updated_by_member_id,host_subscription_enabled)
      VALUES($1,false,$2,$3)`, [tripId, memberId, sponsored]);
    return { tripId, memberId };
  };
  const unsponsored = await makeTrip(false);
  const turnedOff = await makeTrip(false);
  await pool.query(`INSERT INTO audit_events(trip_id,id,actor_member_id,entity_type,action,after_state)
    VALUES($1,$2,$3,'ai_settings','updated','{"enabled":false}')`, [turnedOff.tripId, randomUUID(), turnedOff.memberId]);
  const sponsored = await makeTrip(true);

  assert.deepEqual(await migrate({ connectionString, through: "0054_user_ai_credentials.sql" }), ["0054_user_ai_credentials.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0054_user_ai_credentials.sql" }), []);
  const enabled = async ({ tripId }) => (await pool.query("SELECT enabled FROM trip_ai_settings WHERE trip_id=$1", [tripId])).rows[0].enabled;
  assert.equal(await enabled(unsponsored), true, "an unsponsored trip's AI switch starts on");
  assert.equal(await enabled(turnedOff), false, "an owner's own choice to turn AI off is kept");
  assert.equal(await enabled(sponsored), false, "a sponsored trip's setting is untouched");
}

/**
 * Key rotation (JOB-065): re-encryption moves every readable key to the current version without
 * touching its owner's last change, skips nothing it can read, and leaves an unreadable row in place.
 */
async function testCredentialReencryption(pool) {
  const oldKey = randomBytes(32).toString("base64"), newKey = randomBytes(32).toString("base64");
  const v1 = { CREDENTIAL_ENCRYPTION_KEY: oldKey };
  const rotated = { CREDENTIAL_ENCRYPTION_KEY: newKey, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2", CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: `1:${oldKey}` };
  const retired = { CREDENTIAL_ENCRYPTION_KEY: newKey, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" };
  const rows = [];
  for (const [index, provider] of ["openai", "anthropic", "google", "openai"].entries()) {
    const userId = randomUUID();
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic rotation holder')", [userId]);
    const secret = `sk-synthetic-rotation-${index}-${randomUUID()}`;
    // The last row was sealed under a key the ring no longer knows.
    const sealed = sealCredential(secret, { userId, provider }, index === 3 ? { CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") } : v1);
    await pool.query(`INSERT INTO user_ai_credentials(user_id,provider,ciphertext,nonce,key_version,key_hint,validated_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'WXYZ',CURRENT_TIMESTAMP,TIMESTAMPTZ '2030-01-02 03:04:05+00')`, [userId, provider, sealed.ciphertext, sealed.nonce, sealed.keyVersion]);
    rows.push({ userId, provider, secret });
  }
  const userIds = rows.map((row) => row.userId);
  const stored = async () => (await pool.query(
    `SELECT user_id, provider, ciphertext, nonce, key_version, updated_at FROM user_ai_credentials WHERE user_id = ANY($1::uuid[])`,
    [userIds])).rows;

  // Small batches, so the loop has to continue past the first one.
  assert.deepEqual(await reencryptAiCredentials(pool, rotated, 2), { currentVersion: 2, reencrypted: 3, unreadable: 1, remaining: 1 });
  const after = await stored();
  for (const row of rows.slice(0, 3)) {
    const record = after.find((candidate) => candidate.user_id === row.userId);
    assert.equal(record.key_version, 2);
    assert.equal(record.updated_at.toISOString(), "2030-01-02T03:04:05.000Z", "re-encryption is not the owner's change");
    const sealed = { ciphertext: record.ciphertext, nonce: record.nonce, keyVersion: record.key_version };
    assert.equal(openCredential(sealed, { userId: row.userId, provider: row.provider }, retired), row.secret, "opens without the old key");
  }
  assert.equal(after.find((candidate) => candidate.user_id === rows[3].userId).key_version, 1, "an unreadable key is left in place");
  assert.deepEqual(await reencryptAiCredentials(pool, rotated), { currentVersion: 2, reencrypted: 0, unreadable: 1, remaining: 1 }, "a second run has nothing to move");
  await assert.rejects(reencryptAiCredentials(pool, {}), { name: "CREDENTIAL_ENCRYPTION_UNAVAILABLE" });
  await pool.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [userIds]);
}

/** Synthetic fixtures only, in the parent suite's guarded disposable database. */
export async function testAiCredentials(pool, connectionString) {
  await testAiEnabledMigration(pool, connectionString);
  // Through 0054 only: the key-sharing test that follows checks migration 0055.
  await migrate({ connectionString, through: "0054_user_ai_credentials.sql" });
  const config = { authSecret: "synthetic-ai-credentials-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const makeUser = async () => {
      const userId = randomUUID();
      const identity = { issuer: "https://accounts.google.com", subject: `synthetic-keys-${randomUUID()}`,
        emailHint: "synthetic-keys@example.test", displayNameHint: "Synthetic key holder" };
      await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic key holder')", [userId]);
      await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)",
        [identity.issuer, identity.subject, userId, identity.emailHint]);
      return { userId, identity };
    };
    const owner = await makeUser();
    const member = await makeUser();
    const tripId = randomUUID();
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic key trip','Asia/Tokyo','JPY',CURRENT_DATE+20,CURRENT_DATE+23)`, [tripId, owner.userId]);
    const ownerMemberId = randomUUID();
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic owner','owner','active')",
      [tripId, ownerMemberId, owner.userId]);
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic member','editor','active')",
      [tripId, randomUUID(), member.userId]);
    // Not operator-sponsored: only a member's own key can fund AI here.
    await pool.query("INSERT INTO trip_ai_settings(trip_id,updated_by_member_id,host_subscription_enabled) VALUES($1,$2,false)", [tripId, ownerMemberId]);

    const sessionOf = async (user) => {
      const grant = await signInExistingIdentity(pool, config, { identity: user.identity, userAgent: "Synthetic key browser" });
      const session = await verifySession(pool, config, grant.rawToken);
      assert.ok(session);
      return session;
    };
    const memberSession = await sessionOf(member);
    const ownerSession = await sessionOf(owner);
    const secret = `sk-synthetic-${randomUUID()}-KEY9`;

    await assert.rejects(inTransaction(pool, (client) => getAiPolicy(client, memberSession)), { reasonCode: "ai_key_required" });
    const aiOverview = async (session) => {
      const { ai } = await getAppOverview(pool, session);
      return { enabled: ai.enabled, keyRequired: ai.keyRequired, ownKeyProviders: ai.ownKeyProviders };
    };
    assert.deepEqual(await aiOverview(memberSession), { enabled: false, keyRequired: true, ownKeyProviders: [] });

    // A rejected key is never stored.
    await assert.rejects(saveAiCredential(pool, memberSession, tripId, { provider: "anthropic", apiKey: secret }, async () => false),
      { name: "AI_KEY_REJECTED" });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM user_ai_credentials")).rows[0].count, 0);

    const saved = await saveAiCredential(pool, memberSession, tripId, { provider: "anthropic", apiKey: secret }, async () => true);
    assert.deepEqual(Object.keys(saved).sort(), ["hint", "provider", "updatedAt", "validatedAt", "vertex"]);
    assert.equal(saved.hint, "KEY9");
    assert.equal(JSON.stringify(await listAiCredentials(pool, memberSession, tripId)).includes(secret), false);
    const stored = (await pool.query("SELECT ciphertext FROM user_ai_credentials WHERE user_id=$1", [member.userId])).rows[0];
    assert.equal(stored.ciphertext.includes(Buffer.from(secret)), false, "only ciphertext is stored");
    const audit = (await pool.query("SELECT metadata::text AS metadata FROM audit_events WHERE action='ai.credential.saved'")).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].metadata.includes(secret) || audit[0].metadata.includes("KEY9"), false, "audit holds no key material");

    assert.deepEqual(await readAiCredentialSecret(pool, member.userId, "anthropic"), { apiKey: secret, vertex: null });
    assert.equal(await readAiCredentialSecret(pool, owner.userId, "anthropic"), null, "another user's key is never read");
    assert.deepEqual(await listAiCredentials(pool, ownerSession, tripId), []);

    const policy = await inTransaction(pool, (client) => getAiPolicy(client, memberSession));
    assert.deepEqual({ model: policy.model, source: policy.credentialSource, limit: policy.limit },
      { model: "claude-sonnet-5-5", source: "own", limit: null });
    // The overview tells the browser only which providers have a key, and opens AI for this member alone.
    assert.deepEqual(await aiOverview(memberSession), { enabled: true, keyRequired: false, ownKeyProviders: ["anthropic"] });
    assert.deepEqual(await aiOverview(ownerSession), { enabled: false, keyRequired: true, ownKeyProviders: [] });
    assert.equal(JSON.stringify(await getAppOverview(pool, memberSession)).includes(secret), false);

    // Own-key requests are bounded per account and day, and never use up a sponsored trip's free quota.
    const ownRequests = async (count) => {
      for (let index = 0; index < count; index += 1) await pool.query(
        `INSERT INTO ai_requests (trip_id,id,actor_member_id,actor_user_id,actor_role,prompt_text,requested_model,status,completed_at,credential_source)
         VALUES ($1,$2,$3,$4,'editor','Synthetic own-key fixture','claude-sonnet-5-5','failed',CURRENT_TIMESTAMP,'own')`,
        [tripId, randomUUID(), memberSession.memberId, member.userId]);
    };
    await ownRequests(OWN_KEY_DAILY_LIMIT - 1);
    assert.equal((await inTransaction(pool, (client) => getAiPolicy(client, memberSession))).usedToday, OWN_KEY_DAILY_LIMIT - 1);
    await pool.query("UPDATE trip_ai_settings SET host_subscription_enabled=true WHERE trip_id=$1", [tripId]);
    const sponsored = await inTransaction(pool, (client) => getAiPolicy(client, memberSession));
    assert.deepEqual({ source: sponsored.credentialSource, used: sponsored.usedToday, limit: sponsored.limit },
      { source: "operator", used: 0, limit: 20 }, "own-key requests do not count against the trip's free prompts");
    assert.equal((await getAppOverview(pool, memberSession)).ai.usedToday, 0);
    await pool.query("UPDATE trip_ai_settings SET host_subscription_enabled=false WHERE trip_id=$1", [tripId]);
    await ownRequests(1);
    await assert.rejects(inTransaction(pool, (client) => getAiPolicy(client, memberSession)), { reasonCode: "daily_limit_reached" });
    await pool.query("DELETE FROM ai_requests WHERE trip_id=$1 AND credential_source='own'", [tripId]);
    await assert.rejects(inTransaction(pool, (client) => getAiPolicy(client, ownerSession)), { reasonCode: "ai_key_required" });

    // A ciphertext moved to another account does not open.
    await pool.query(`INSERT INTO user_ai_credentials(user_id,provider,ciphertext,nonce,key_version,key_hint,validated_at)
      SELECT $1, provider, ciphertext, nonce, key_version, key_hint, validated_at FROM user_ai_credentials WHERE user_id=$2`,
    [owner.userId, member.userId]);
    assert.equal(await readAiCredentialSecret(pool, owner.userId, "anthropic"), null);
    await pool.query("DELETE FROM user_ai_credentials WHERE user_id=$1", [owner.userId]);

    await deleteAiCredential(pool, memberSession, tripId, "anthropic");
    assert.deepEqual(await listAiCredentials(pool, memberSession, tripId), []);
    assert.equal(await readAiCredentialSecret(pool, member.userId, "anthropic"), null);

    await testCredentialReencryption(pool);
  } finally {
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
  }
}
