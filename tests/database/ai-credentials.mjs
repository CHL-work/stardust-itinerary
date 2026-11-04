import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { getAiPolicy, inTransaction } from "../../src/lib/app/repository.ts";
import { deleteAiCredential, listAiCredentials, readAiCredentialSecret, saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { signInExistingIdentity, verifySession } from "../../src/lib/auth/repository.ts";

/** Synthetic fixtures only, in the parent suite's guarded disposable database. */
export async function testAiCredentials(pool, connectionString) {
  await migrate({ connectionString });
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
  } finally {
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
  }
}
