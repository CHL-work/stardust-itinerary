import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { credentialAssociatedData, sealCredential } from "../../src/lib/ai/credential-crypto.ts";
import { crc32c, kmsSeal, resetKmsTokenCache } from "../../src/lib/ai/credential-kms.ts";
import { resetSecretManagerTokenCache } from "../../src/lib/ai/credential-secret-manager.ts";
import { cleanupCredentialSecrets } from "../../src/lib/ai/credential-secret-lifecycle.ts";
import { deleteAiCredential, listAiCredentials, readAiCredentialSecret, saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { createGuestSession } from "../../src/lib/app/guest.ts";
import { AppConflictError, AppForbiddenError } from "../../src/lib/app/repository.ts";
import { revokeSession, signInExistingIdentity, verifySession } from "../../src/lib/auth/repository.ts";

const PROJECT = "synthetic-project";
const KMS_KEY = `projects/${PROJECT}/locations/asia-northeast1/keyRings/stardust/cryptoKeys/ai-credentials`;
const manager = { project: PROJECT, serviceAccount: null };

/** Entirely fake Google endpoints: all values, tokens, ciphertext and accounts are synthetic. */
function fakeGoogle() {
  const calls = [], resources = new Map(), removed = [];
  const scramble = (bytes) => Buffer.from(bytes.map((byte) => byte ^ 0x5a));
  const controls = { failAdd: false, failDelete: false, onAccess: null };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method });
    assert.equal(init.redirect, "error", "cloud credentials are never forwarded to redirects");
    if (url.startsWith("http://169.254.169.254/")) return Response.json({ access_token: "synthetic-token-only", expires_in: 3599 });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (url === `https://cloudkms.googleapis.com/v1/${KMS_KEY}:encrypt`) {
      const ciphertext = scramble(Buffer.concat([Buffer.from(body.additionalAuthenticatedData, "base64"), Buffer.from([0]), Buffer.from(body.plaintext, "base64")]));
      return Response.json({ name: `${KMS_KEY}/cryptoKeyVersions/1`, ciphertext: ciphertext.toString("base64"),
        ciphertextCrc32c: String(crc32c(ciphertext)), verifiedPlaintextCrc32c: true, verifiedAdditionalAuthenticatedDataCrc32c: true });
    }
    if (url === `https://cloudkms.googleapis.com/v1/${KMS_KEY}:decrypt`) {
      const opened = scramble(Buffer.from(body.ciphertext, "base64")), split = opened.indexOf(0);
      if (!opened.subarray(0, split).equals(Buffer.from(body.additionalAuthenticatedData, "base64"))) return new Response("denied", { status: 400 });
      const plaintext = opened.subarray(split + 1);
      return Response.json({ plaintext: plaintext.toString("base64"), plaintextCrc32c: String(crc32c(plaintext)) });
    }
    assert.ok(url.startsWith("https://secretmanager.googleapis.com/v1/"), "tests never make a real provider request");
    const parsed = new URL(url), path = parsed.pathname.slice("/v1/".length);
    if (init.method === "DELETE") {
      if (controls.failDelete) return new Response("synthetic cleanup unavailable", { status: 503 });
      removed.push(path);
      const existed = resources.delete(path);
      return existed ? Response.json({}) : new Response("gone", { status: 404 });
    }
    if (parsed.searchParams.has("secretId")) {
      const name = `${path}/${parsed.searchParams.get("secretId")}`;
      assert.ok(!resources.has(name), "every replacement gets a unique cloud resource");
      resources.set(name, { ciphertext: null, expireTime: body.expireTime ?? null });
      return Response.json({ name, ...(body.expireTime ? { expireTime: body.expireTime } : {}) });
    }
    if (path.endsWith(":addVersion")) {
      if (controls.failAdd) return new Response("synthetic add unavailable", { status: 503 });
      const name = path.replace(/:addVersion$/u, "");
      const resource = resources.get(name);
      assert.ok(resource);
      resource.ciphertext = Buffer.from(body.payload.data, "base64");
      assert.equal(body.payload.dataCrc32c, String(crc32c(resource.ciphertext)));
      return Response.json({ name: `${name}/versions/1`, state: "ENABLED", clientSpecifiedPayloadChecksum: true });
    }
    if (path.endsWith(":access")) {
      const name = path.replace(/\/versions\/1:access$/u, "");
      if (controls.onAccess) await controls.onAccess(name);
      const ciphertext = resources.get(name)?.ciphertext;
      if (!ciphertext) return new Response("missing", { status: 404 });
      return Response.json({ name: `${name}/versions/1`, payload: { data: ciphertext.toString("base64"), dataCrc32c: String(crc32c(ciphertext)) } });
    }
    throw new Error("Unexpected synthetic cloud operation");
  };
  return { calls, resources, removed, controls, fetchImpl };
}

function gate() {
  let release, reached;
  return { release: () => release(), reached: new Promise((resolve) => { reached = resolve; }),
    wait: () => { reached(); return new Promise((resolve) => { release = resolve; }); } };
}

/** JOB-087 runs only at migration head in the suite's explicitly guarded disposable database. */
export async function testSecretManagerCredentials(pool, connectionString) {
  await migrate({ connectionString });
  assert.deepEqual(await migrate({ connectionString }), []);
  const config = { authSecret: "synthetic-secret-manager-tests-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const savedEnv = Object.fromEntries(["CREDENTIAL_SECRET_MANAGER_PROJECT", "CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT", "CREDENTIAL_KMS_KEY",
    "CREDENTIAL_KMS_SERVICE_ACCOUNT", "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_VERSION", "CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS"].map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  const google = fakeGoogle();
  const userIds = [];
  const restoreManager = () => { process.env.CREDENTIAL_SECRET_MANAGER_PROJECT = PROJECT; process.env.CREDENTIAL_KMS_KEY = KMS_KEY; };
  for (const name of Object.keys(savedEnv)) delete process.env[name];
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  restoreManager();
  globalThis.fetch = google.fetchImpl;
  resetKmsTokenCache(); resetSecretManagerTokenCache();
  const currentRow = async (userId, provider = "openai") => (await pool.query("SELECT * FROM user_ai_credentials WHERE user_id=$1 AND provider=$2", [userId, provider])).rows[0];
  const secretName = (row) => row.secret_version.split("/versions/")[0];
  const due = async (names) => {
    if (names.length) await pool.query("UPDATE ai_credential_secret_resources SET cleanup_after = CURRENT_TIMESTAMP - interval '1 second' WHERE secret_name = ANY($1::text[])", [names]);
  };
  const save = (session, key, provider = "openai", validate = async () => true) => saveAiCredential(pool, session, session.tripId, { provider, apiKey: key }, validate);
  const registryCount = async () => Number((await pool.query("SELECT count(*) FROM ai_credential_secret_resources")).rows[0].count);
  try {
    const makeAccount = async (tripId = null) => {
      const userId = randomUUID(), memberId = randomUUID();
      userIds.push(userId);
      const identity = { issuer: "https://accounts.google.com", subject: `synthetic-secret-${randomUUID()}`,
        emailHint: "synthetic-secret@example.test", displayNameHint: "Synthetic credential holder" };
      await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic credential holder')", [userId]);
      await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)", [identity.issuer, identity.subject, userId, identity.emailHint]);
      const role = tripId ? "editor" : "owner";
      if (!tripId) {
        tripId = randomUUID();
        await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
          VALUES($1,$2,'Synthetic Secret Manager trip','Asia/Tokyo','JPY',CURRENT_DATE+20,CURRENT_DATE+23)`, [tripId, userId]);
      }
      await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic traveler',$4,'active')", [tripId, memberId, userId, role]);
      const grant = await signInExistingIdentity(pool, config, { identity, userAgent: "Synthetic credential browser" });
      const session = await verifySession(pool, config, grant.rawToken);
      assert.ok(session);
      return session;
    };
    const owner = await makeAccount();
    const member = await makeAccount(owner.tripId);

    const beforeRejected = google.calls.length, beforeRegistry = await registryCount();
    await assert.rejects(save(member, "sk-synthetic-rejected-0000", "openai", async () => false), { name: "AI_KEY_REJECTED" });
    assert.equal(google.calls.length, beforeRejected, "provider refusal happens before KMS or Secret Manager");
    assert.equal(await registryCount(), beforeRegistry);

    const key = "sk-synthetic-secret-manager-KEY1";
    const returned = await save(member, key);
    assert.deepEqual(Object.keys(returned).sort(), ["hint", "provider", "updatedAt", "validatedAt", "vertex"]);
    const first = await currentRow(member.userId);
    assert.equal(first.sealed_with, "secret_manager");
    assert.equal(first.ciphertext, null);
    assert.equal(first.nonce, null);
    assert.equal(first.key_version, null);
    assert.match(first.secret_version, /^projects\/synthetic-project\/secrets\/stardust-user-key-[a-f0-9]{32}-[a-f0-9]{32}\/versions\/1$/u);
    assert.equal(JSON.stringify(first).includes(key), false, "neither plaintext nor ciphertext remains in PostgreSQL");
    assert.equal(google.resources.get(secretName(first)).ciphertext.includes(Buffer.from(key)), false, "Secret Manager receives only KMS ciphertext");
    assert.deepEqual(await readAiCredentialSecret(pool, member.userId, "openai"), { apiKey: key, vertex: null });
    const listed = await listAiCredentials(pool, member, member.tripId);
    assert.deepEqual(listed, [returned]);
    assert.equal(JSON.stringify(listed).includes(first.secret_version), false, "browser responses do not reveal cloud references");
    assert.deepEqual(await listAiCredentials(pool, owner, owner.tripId), []);
    assert.equal(await readAiCredentialSecret(pool, owner.userId, "openai"), null);
    const audits = (await pool.query("SELECT metadata::text AS metadata FROM audit_events WHERE trip_id=$1 AND action='ai.credential.saved'", [member.tripId])).rows;
    assert.ok(audits.every((row) => !row.metadata.includes(key) && !row.metadata.includes(first.secret_version) && !row.metadata.includes("KEY1")));

    // Tampering with the bound account/provider is rejected even when the DB reference is valid.
    await pool.query("UPDATE user_ai_credentials SET user_id=$2 WHERE user_id=$1 AND provider='openai'", [member.userId, owner.userId]);
    const beforeWrongOwner = google.calls.length;
    assert.equal(await readAiCredentialSecret(pool, owner.userId, "openai"), null);
    assert.equal(google.calls.length, beforeWrongOwner, "wrong owner cannot trigger cloud access");
    await pool.query("UPDATE user_ai_credentials SET user_id=$2,provider='google' WHERE user_id=$1 AND provider='openai'", [owner.userId, member.userId]);
    assert.equal(await readAiCredentialSecret(pool, member.userId, "google"), null);
    await pool.query("UPDATE user_ai_credentials SET provider='openai' WHERE user_id=$1 AND provider='google'", [member.userId]);

    // Existing local/KMS rows are readable after enabling the new backend.
    const localKey = "sk-synthetic-legacy-local-LOC1", kmsKey = "sk-synthetic-legacy-kms-KMS1";
    const local = sealCredential(localKey, { userId: member.userId, provider: "anthropic" });
    await pool.query(`INSERT INTO user_ai_credentials(user_id,provider,sealed_with,ciphertext,nonce,key_version,key_hint,validated_at)
      VALUES($1,'anthropic','local',$2,$3,$4,'LOC1',CURRENT_TIMESTAMP)`, [member.userId, local.ciphertext, local.nonce, local.keyVersion]);
    const legacyCipher = await kmsSeal(kmsKey, credentialAssociatedData(member.userId, "google"), { keyName: KMS_KEY, serviceAccount: null });
    await pool.query(`INSERT INTO user_ai_credentials(user_id,provider,sealed_with,ciphertext,key_hint,validated_at)
      VALUES($1,'google','kms',$2,'KMS1',CURRENT_TIMESTAMP)`, [member.userId, legacyCipher]);
    assert.equal((await readAiCredentialSecret(pool, member.userId, "anthropic")).apiKey, localKey);
    assert.equal((await readAiCredentialSecret(pool, member.userId, "google")).apiKey, kmsKey);

    await save(member, "sk-synthetic-secret-manager-KEY2");
    const second = await currentRow(member.userId);
    assert.notEqual(second.secret_version, first.secret_version);
    await due([secretName(first), secretName(second)]);
    const clean = await cleanupCredentialSecrets(pool, { settings: manager });
    assert.equal(clean.deleted, 1);
    assert.ok(google.removed.includes(secretName(first)));
    assert.ok(!google.removed.includes(secretName(second)), "the active pinned secret is never deleted");
    assert.equal((await readAiCredentialSecret(pool, member.userId, "openai")).apiKey, "sk-synthetic-secret-manager-KEY2");

    // A failed save retains the old row; its committed registry entry survives for deferred cleanup.
    google.controls.failAdd = true;
    const priorRegistry = await registryCount();
    await assert.rejects(save(member, "sk-synthetic-never-saved-FAIL"), { step: "add_version_503" });
    google.controls.failAdd = false;
    assert.equal((await currentRow(member.userId)).secret_version, second.secret_version);
    assert.equal(await registryCount(), priorRegistry + 1);
    const failedName = [...google.resources.keys()].find((name) => google.resources.get(name).ciphertext === null);
    await due([failedName]);
    google.controls.failDelete = true;
    assert.equal((await cleanupCredentialSecrets(pool, { settings: manager })).failed, 1);
    assert.ok((await pool.query("SELECT cleanup_after > CURRENT_TIMESTAMP AS delayed FROM ai_credential_secret_resources WHERE secret_name=$1", [failedName])).rows[0].delayed);
    google.controls.failDelete = false;
    await due([failedName]);
    assert.equal((await cleanupCredentialSecrets(pool, { settings: manager })).deleted, 1);

    // Cleanup backoff never renews the original publication lease of an abandoned save.
    google.controls.onAccess = async (name) => {
      await pool.query(`UPDATE ai_credential_secret_resources
        SET publish_by = CURRENT_TIMESTAMP - interval '1 second', cleanup_after = CURRENT_TIMESTAMP + interval '1 hour'
        WHERE secret_name = $1`, [name]);
    };
    await assert.rejects(save(member, "sk-synthetic-expired-publication-EXP1"), AppConflictError);
    google.controls.onAccess = null;
    assert.equal((await currentRow(member.userId)).secret_version, second.secret_version, "retrying cleanup cannot revive an expired save");

    // A slow replacement cannot undo a newer save, including two initially simultaneous requests.
    const paused = gate();
    let pauseOnce = true;
    google.controls.onAccess = async () => { if (pauseOnce) { pauseOnce = false; await paused.wait(); } };
    const staleSave = save(member, "sk-synthetic-stale-replacement-OLD1");
    const staleOutcome = staleSave.then(() => null, (error) => error);
    await paused.reached;
    await save(member, "sk-synthetic-winning-replacement-NEW1");
    paused.release();
    assert.ok(await staleOutcome instanceof AppConflictError);
    google.controls.onAccess = null;
    assert.equal((await readAiCredentialSecret(pool, member.userId, "openai")).apiKey, "sk-synthetic-winning-replacement-NEW1");

    const deleting = gate(); pauseOnce = true;
    google.controls.onAccess = async () => { if (pauseOnce) { pauseOnce = false; await deleting.wait(); } };
    const afterDelete = save(member, "sk-synthetic-stale-after-delete-DEL1").then(() => null, (error) => error);
    await deleting.reached;
    await deleteAiCredential(pool, member, member.tripId, "openai");
    deleting.release();
    assert.ok(await afterDelete instanceof AppConflictError);
    google.controls.onAccess = null;
    assert.equal(await currentRow(member.userId), undefined, "a replacement cannot resurrect a removed key");

    // Access changes during network work are checked again before the reference is published.
    const during = async (session, change) => {
      let hookError;
      google.controls.onAccess = async () => {
        google.controls.onAccess = null;
        try { await change(); } catch (error) { hookError = error; throw error; }
      };
      const outcome = await save(session, "sk-synthetic-access-changed-STOP").then(() => null, (error) => error);
      assert.equal(hookError, undefined, "the synthetic access-state change succeeded");
      assert.ok(outcome instanceof AppForbiddenError);
      assert.equal(await currentRow(session.userId), undefined);
    };
    await during(member, () => pool.query("UPDATE app_users SET suspended_at=CURRENT_TIMESTAMP WHERE id=$1", [member.userId]));
    await pool.query("UPDATE app_users SET suspended_at=NULL WHERE id=$1", [member.userId]);
    await during(member, () => pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [member.tripId, member.memberId]));
    await pool.query("UPDATE trip_members SET status='active' WHERE trip_id=$1 AND id=$2", [member.tripId, member.memberId]);
    const signingOut = await makeAccount(owner.tripId);
    await during(signingOut, () => revokeSession(pool, signingOut.sessionId, signingOut.userId));

    // Suspension locks account before sessions. A saver waiting on that account must not already
    // hold its session lock, or the two transactions deadlock. Observe the actual PostgreSQL wait
    // instead of guessing with a sleep, then revoke under a short lock timeout as the proof.
    const lockOrderSession = await makeAccount(owner.tripId);
    const cloudGate = gate();
    google.controls.onAccess = async () => { google.controls.onAccess = null; await cloudGate.wait(); };
    const lockOrderSave = save(lockOrderSession, "sk-synthetic-lock-order-LOCK").then(() => null, (error) => error);
    await cloudGate.reached;
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL lock_timeout = '1s'");
      const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
      await blocker.query("SELECT id FROM app_users WHERE id=$1 FOR UPDATE", [lockOrderSession.userId]);
      cloudGate.release();
      const deadline = Date.now() + 5_000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        waiting = (await pool.query(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
            AND query LIKE 'SELECT guest_expires_at FROM app_users%'
        ) AS waiting`, [pid])).rows[0].waiting;
      }
      assert.equal(waiting, true, "the saver reached its final account lock after cloud verification");
      await blocker.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP, revoke_reason='synthetic_lock_order_test' WHERE id=$1", [lockOrderSession.sessionId]);
      await blocker.query("COMMIT");
      assert.ok(await lockOrderSave instanceof AppForbiddenError, "revocation completes before the save can publish its key");
      assert.equal(await currentRow(lockOrderSession.userId), undefined);
    } finally {
      cloudGate.release();
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
      await lockOrderSave;
    }

    // Guest expiration is the account's exact deadline, not 24 hours after key save.
    const guest = await createGuestSession(pool, config, { userAgent: "Synthetic guest browser", locale: "en", address: "198.51.100.87" },
      { GUEST_ACTIVE_LIMIT: "1000", GUEST_PER_ADDRESS_LIMIT: "1000" });
    const guestSession = await verifySession(pool, config, guest.grant.rawToken);
    assert.ok(guestSession);
    userIds.push(guestSession.userId);
    await save(guestSession, "sk-synthetic-guest-expiration-GST1");
    const guestRow = await currentRow(guestSession.userId), guestName = secretName(guestRow);
    const expiry = (await pool.query("SELECT guest_expires_at FROM app_users WHERE id=$1", [guestSession.userId])).rows[0].guest_expires_at;
    assert.equal(google.resources.get(guestName).expireTime, expiry.toISOString());
    await deleteAiCredential(pool, guestSession, guestSession.tripId, "openai");
    await during(guestSession, () => pool.query("UPDATE app_users SET guest_expires_at=CURRENT_TIMESTAMP - interval '1 minute' WHERE id=$1", [guestSession.userId]));
    // Restore only this synthetic guest's deadline to exercise purging an active key reference.
    await pool.query("UPDATE app_users SET guest_expires_at=$2 WHERE id=$1", [guestSession.userId, expiry]);
    await save(guestSession, "sk-synthetic-guest-purge-GST2");
    const purgeName = secretName(await currentRow(guestSession.userId));
    await pool.query("UPDATE app_users SET guest_expires_at=CURRENT_TIMESTAMP - interval '1 minute' WHERE id=$1", [guestSession.userId]);
    assert.equal((await pool.query("SELECT app_purge_expired_guest($1) AS purged", [guestSession.userId])).rows[0].purged, true);
    assert.equal(await currentRow(guestSession.userId), undefined);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ai_credential_secret_resources WHERE secret_name=$1", [purgeName])).rows[0].count, 1,
      "the opaque cleanup registry survives guest purge and has no account foreign key");
    await due([...google.resources.keys()]);
    await cleanupCredentialSecrets(pool, { settings: manager, limit: 100 });
    assert.ok(google.removed.includes(purgeName), "the purged guest's resource is removed without reading its key");
  } finally {
    google.controls.onAccess = null; google.controls.failDelete = false;
    await pool.query("DELETE FROM user_ai_credentials WHERE user_id=ANY($1::uuid[])", [userIds]);
    await due([...google.resources.keys()]);
    await cleanupCredentialSecrets(pool, { settings: manager, limit: 100 });
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    resetKmsTokenCache(); resetSecretManagerTokenCache();
  }
}
