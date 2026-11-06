import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import {
  adminAccess, adminAccountDetail, adminOverview, listAdminAccounts, setAccountSuspension, setSignupDailyLimit,
} from "../../src/lib/admin/repository.ts";
import { crc32c, resetKmsTokenCache } from "../../src/lib/ai/credential-kms.ts";
import { sealCredential } from "../../src/lib/ai/credential-crypto.ts";
import { readAiCredentialSecret, reencryptAiCredentials, saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { createGuestSession, purgeExpiredGuests } from "../../src/lib/app/guest.ts";
import { AppConflictError, AppForbiddenError, usableAiKeyGrant } from "../../src/lib/app/repository.ts";
import { issueAccountOnboarding, verifyAccountOnboarding } from "../../src/lib/auth/account-session.ts";
import { AccountSuspendedError, RateLimitError, SessionUnavailableError, SignupPausedError } from "../../src/lib/auth/errors.ts";
import { assertIdentityNotSuspended, enforceRateLimit, insertSession, rotateSession, verifySession } from "../../src/lib/auth/repository.ts";

const GOOGLE = "https://accounts.google.com";
const KMS_KEY = "projects/synthetic-project/locations/asia-northeast1/keyRings/stardust/cryptoKeys/ai-credentials";

/** A fake metadata server and Cloud KMS, so KMS sealing runs end to end without Google. */
function fakeKmsFetch() {
  const scramble = (bytes) => Buffer.from(bytes.map((byte) => byte ^ 0x5a));
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("http://169.254.169.254/")) return Response.json({ access_token: "synthetic-token", expires_in: 3599 });
    const body = JSON.parse(String(init.body));
    if (url === `https://cloudkms.googleapis.com/v1/${KMS_KEY}:encrypt`) {
      const ciphertext = scramble(Buffer.concat([Buffer.from(body.additionalAuthenticatedData, "base64"), Buffer.from([0]),
        Buffer.from(body.plaintext, "base64")]));
      return Response.json({ name: `${KMS_KEY}/cryptoKeyVersions/1`, ciphertext: ciphertext.toString("base64"),
        ciphertextCrc32c: String(crc32c(ciphertext)), verifiedPlaintextCrc32c: true, verifiedAdditionalAuthenticatedDataCrc32c: true });
    }
    if (url === `https://cloudkms.googleapis.com/v1/${KMS_KEY}:decrypt`) {
      const opened = scramble(Buffer.from(body.ciphertext, "base64"));
      const split = opened.indexOf(0);
      if (!opened.subarray(0, split).equals(Buffer.from(body.additionalAuthenticatedData, "base64"))) {
        return Response.json({ error: { code: 400 } }, { status: 400 });
      }
      const plaintext = opened.subarray(split + 1);
      return Response.json({ plaintext: plaintext.toString("base64"), plaintextCrc32c: String(crc32c(plaintext)) });
    }
    return new Response("unexpected", { status: 500 });
  };
  return { calls, fetchImpl };
}

/**
 * Platform administration and key protection (JOB-069): migration 0059, the operator-only admin
 * reads, suspension, the daily sign-up cap, refusal counters, KMS-sealed keys and the guest purge
 * of the new tables. Synthetic data only, after every other suite has migrated to head.
 */
export async function testPlatformAdmin(pool, connectionString) {
  await migrate({ connectionString });
  assert.deepEqual(await migrate({ connectionString }), []);
  const config = { authSecret: "synthetic-platform-admin-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const saved = { owner: process.env.OWNER_GOOGLE_EMAIL, signup: process.env.PUBLIC_SIGNUP_ENABLED, kms: process.env.CREDENTIAL_KMS_KEY,
    local: process.env.CREDENTIAL_ENCRYPTION_KEY, fetch: globalThis.fetch };
  process.env.OWNER_GOOGLE_EMAIL = "operator@example.test";
  try {
    const settings = await pool.query("SELECT signup_daily_limit FROM platform_settings");
    assert.deepEqual(settings.rows, [{ signup_daily_limit: 50 }], "one settings row, capped at 50 sign-ups a day");
    await assert.rejects(pool.query("INSERT INTO platform_settings(singleton) VALUES(false)"), /check constraint/u);

    const makeAccount = async (name, email, role = "owner", tripId = randomUUID()) => {
      const userId = randomUUID(), memberId = randomUUID(), subject = `synthetic-${randomUUID()}`;
      await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,$2)", [userId, name]);
      await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint,display_name_hint) VALUES($1,$2,$3,$4,$5)",
        [GOOGLE, subject, userId, email, name]);
      if (role === "owner") {
        await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
          VALUES($1,$2,'Synthetic admin trip','Asia/Tokyo','JPY',CURRENT_DATE+20,CURRENT_DATE+23)`, [tripId, userId]);
      }
      await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,$4,$5,'active')",
        [tripId, memberId, userId, name, role]);
      return { userId, memberId, tripId, subject, name };
    };
    const signIn = async (account, role = "owner") => {
      const client = await pool.connect();
      try {
        const grant = await insertSession(client, config, { tripId: account.tripId, memberId: account.memberId, userId: account.userId, role,
          absoluteExpiresAt: new Date(Date.now() + 86_400_000), userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Safari/537.36" });
        return { grant, session: await verifySession(pool, config, grant.rawToken) };
      } finally { client.release(); }
    };

    const operator = await makeAccount("Synthetic operator", "Operator@Example.test");
    const member = await makeAccount("Synthetic member", "member.100%@example.test");
    const editor = await makeAccount("Synthetic editor", "editor@example.test", "editor", member.tripId);
    const { session: operatorSession } = await signIn(operator);
    const memberSignIn = await signIn(member);
    const memberSession = memberSignIn.session;
    assert.ok(operatorSession && memberSession);

    // Only the operator, identified by OWNER_GOOGLE_EMAIL through a Google identity, can read or act.
    assert.equal(await adminAccess(pool, operatorSession), true);
    assert.equal(await adminAccess(pool, memberSession), false);
    await assert.rejects(adminOverview(pool, memberSession), AppForbiddenError);
    await assert.rejects(listAdminAccounts(pool, memberSession, { filter: "all", q: "", offset: 0 }), AppForbiddenError);
    await assert.rejects(adminAccountDetail(pool, memberSession, operator.userId), AppForbiddenError);
    await assert.rejects(setAccountSuspension(pool, memberSession, operator.userId, true), AppForbiddenError);
    await assert.rejects(setSignupDailyLimit(pool, memberSession, 0), AppForbiddenError);

    // Refusals are counted per scope and day, with the account when there is one.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(enforceRateLimit(pool, config, { scope: "synthetic-scope", key: member.userId, userId: member.userId,
        maximum: 0, windowSeconds: 60 }), RateLimitError);
    }
    await assert.rejects(enforceRateLimit(pool, config, { scope: "synthetic-address", key: "198.51.100.7", maximum: 0, windowSeconds: 60 }), RateLimitError);
    const counters = await pool.query(`SELECT metric, user_id, count FROM platform_daily_counts
      WHERE metric IN ('rate_limited:synthetic-scope', 'rate_limited:synthetic-address') ORDER BY metric`);
    assert.deepEqual(counters.rows, [
      { metric: "rate_limited:synthetic-address", user_id: null, count: 1 },
      { metric: "rate_limited:synthetic-scope", user_id: member.userId, count: 2 },
    ]);

    // Account list: search is literal, the operator is marked, keys show as providers only.
    const local = sealCredential(`sk-synthetic-${randomUUID()}`, { userId: member.userId, provider: "openai" },
      { CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
    await pool.query(`INSERT INTO user_ai_credentials(user_id,provider,ciphertext,nonce,key_version,key_hint,validated_at)
      VALUES($1,'openai',$2,$3,$4,'WXYZ',CURRENT_TIMESTAMP)`, [member.userId, local.ciphertext, local.nonce, local.keyVersion]);
    const all = await listAdminAccounts(pool, operatorSession, { filter: "google", q: "", offset: 0 });
    assert.ok(all.total >= 3);
    const listedMember = all.accounts.find((row) => row.userId === member.userId);
    assert.deepEqual({ email: listedMember.email, keys: listedMember.keys, refused: listedMember.refusedWeek, operator: listedMember.isOperator,
      owned: listedMember.tripsOwned }, { email: "member.100%@example.test", keys: ["openai"], refused: 2, operator: false, owned: 1 });
    assert.equal(JSON.stringify(all).includes("WXYZ"), false, "not even a key's last characters");
    assert.equal(all.accounts.find((row) => row.userId === operator.userId).isOperator, true);
    assert.equal(all.accounts.find((row) => row.userId === editor.userId).tripsJoined, 1);
    const searched = await listAdminAccounts(pool, operatorSession, { filter: "all", q: "100%", offset: 0 });
    assert.deepEqual(searched.accounts.map((row) => row.userId), [member.userId]);
    assert.equal((await listAdminAccounts(pool, operatorSession, { filter: "all", q: "1_0", offset: 0 })).total, 0, "_ matches only itself");
    const overview = await adminOverview(pool, operatorSession);
    assert.equal(overview.days.length, 14);
    assert.equal(overview.signup.dailyLimit, 50);
    assert.ok(overview.accounts.google >= 3);
    assert.ok(overview.refusalsWeek.some((row) => row.scope === "synthetic-scope" && row.count === 2));

    // Suspension: sessions end at once, sign-in is refused, shared keys stop paying, and it is recorded.
    await pool.query("INSERT INTO trip_ai_key_grants(trip_id,member_id,sponsor_member_id) VALUES($1,$2,$3)",
      [member.tripId, editor.memberId, member.memberId]);
    assert.ok(await usableAiKeyGrant(pool, member.tripId, editor.memberId), "the owner's key is shared with the editor");
    await assert.rejects(setAccountSuspension(pool, operatorSession, operator.userId, true), AppConflictError);
    const suspended = await setAccountSuspension(pool, operatorSession, member.userId, true);
    assert.ok(suspended.suspendedAt);
    assert.equal(await verifySession(pool, config, memberSignIn.grant.rawToken), null);
    await assert.rejects(rotateSession(pool, config, memberSignIn.grant.rawToken), SessionUnavailableError);
    const revoked = await pool.query("SELECT DISTINCT revoke_reason FROM auth_sessions WHERE user_id = $1", [member.userId]);
    assert.deepEqual(revoked.rows, [{ revoke_reason: "account_suspended" }]);
    await assert.rejects(assertIdentityNotSuspended(pool, { issuer: GOOGLE, subject: member.subject }), AccountSuspendedError);
    await assertIdentityNotSuspended(pool, { issuer: GOOGLE, subject: "synthetic-new-identity" });
    assert.equal((await signIn(member)).session, null, "a session issued anyway does not work");
    assert.equal(await usableAiKeyGrant(pool, member.tripId, editor.memberId), null, "a suspended owner's key pays for no one");
    // Suspending twice changes nothing and records nothing more.
    await setAccountSuspension(pool, operatorSession, member.userId, true);
    const restored = await setAccountSuspension(pool, operatorSession, member.userId, false);
    assert.equal(restored.suspendedAt, null);
    assert.ok((await signIn(member)).session, "a restored account can sign in again");
    assert.equal(await verifySession(pool, config, memberSignIn.grant.rawToken), null, "old sessions stay revoked");
    assert.ok(await usableAiKeyGrant(pool, member.tripId, editor.memberId));
    const detail = await adminAccountDetail(pool, operatorSession, member.userId);
    assert.deepEqual(detail.operatorActions.map((row) => row.action), ["account.unsuspended", "account.suspended"]);
    assert.ok(detail.sessions.some((row) => row.state === "revoked") && detail.sessions.some((row) => row.state === "active"));
    assert.deepEqual(detail.trips.map((row) => ({ role: row.role, members: row.members })), [{ role: "owner", members: 2 }]);
    assert.equal(JSON.stringify(detail).includes("Synthetic admin trip"), false, "no trip names");

    // The daily cap counts only new public sign-ups; 0 pauses them and null removes the cap.
    process.env.PUBLIC_SIGNUP_ENABLED = "true";
    const today = Number((await pool.query(`SELECT COALESCE(sum(count),0)::int AS count FROM platform_daily_counts
      WHERE metric = 'public_signup' AND user_id IS NULL AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`)).rows[0].count);
    assert.deepEqual(await setSignupDailyLimit(pool, operatorSession, today + 1), { dailyLimit: today + 1 });
    const identity = (label) => ({ issuer: GOOGLE, subject: `synthetic-signup-${label}-${randomUUID()}`, emailHint: `${label}@example.test`, displayNameHint: `Synthetic ${label}` });
    const first = identity("first"), second = identity("second"), third = identity("third");
    const firstGrant = await issueAccountOnboarding(pool, config, first);
    await assert.rejects(issueAccountOnboarding(pool, config, second), SignupPausedError);
    assert.equal((await pool.query("SELECT 1 FROM oidc_identities WHERE subject = $1", [second.subject])).rowCount, 0, "no account is created");
    await issueAccountOnboarding(pool, config, first);
    await setSignupDailyLimit(pool, operatorSession, null);
    await issueAccountOnboarding(pool, config, second);
    await setSignupDailyLimit(pool, operatorSession, 0);
    await assert.rejects(issueAccountOnboarding(pool, config, third), SignupPausedError);
    await setSignupDailyLimit(pool, operatorSession, 50);
    const counted = await pool.query(`SELECT count FROM platform_daily_counts WHERE metric = 'public_signup' AND user_id IS NULL
      AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`);
    assert.equal(counted.rows[0].count, today + 2);
    const changes = await pool.query("SELECT details FROM operator_audit_events WHERE action = 'signup_limit.changed' ORDER BY created_at");
    assert.deepEqual(changes.rows.slice(-4).map((row) => row.details), [{ dailyLimit: today + 1 }, { dailyLimit: null }, { dailyLimit: 0 }, { dailyLimit: 50 }]);
    // A suspended account's unused onboarding grant stops working.
    const firstUser = (await pool.query("SELECT user_id FROM oidc_identities WHERE subject = $1", [first.subject])).rows[0].user_id;
    const fresh = await issueAccountOnboarding(pool, config, first);
    assert.ok(await verifyAccountOnboarding(pool, config, fresh.rawToken));
    await setAccountSuspension(pool, operatorSession, firstUser, true);
    assert.equal(await verifyAccountOnboarding(pool, config, fresh.rawToken), null);
    assert.equal(await verifyAccountOnboarding(pool, config, firstGrant.rawToken), null);

    // Keys sealed by Cloud KMS: saved, read back, moved from the local ring, and unreadable without KMS.
    const kms = fakeKmsFetch();
    globalThis.fetch = kms.fetchImpl;
    resetKmsTokenCache();
    const localKey = randomBytes(32).toString("base64");
    process.env.CREDENTIAL_ENCRYPTION_KEY = localKey;
    process.env.CREDENTIAL_KMS_KEY = KMS_KEY;
    const kmsSecret = `sk-ant-synthetic-${randomUUID()}`;
    await saveAiCredential(pool, (await signIn(member)).session, member.tripId, { provider: "anthropic", apiKey: kmsSecret }, async () => true);
    const kmsRow = (await pool.query("SELECT sealed_with, nonce, key_version, ciphertext FROM user_ai_credentials WHERE user_id = $1 AND provider = 'anthropic'",
      [member.userId])).rows[0];
    assert.deepEqual({ sealedWith: kmsRow.sealed_with, nonce: kmsRow.nonce, keyVersion: kmsRow.key_version }, { sealedWith: "kms", nonce: null, keyVersion: null });
    assert.equal(kmsRow.ciphertext.toString("utf8").includes(kmsSecret), false);
    assert.equal((await readAiCredentialSecret(pool, member.userId, "anthropic"))?.apiKey, kmsSecret);
    await assert.rejects(pool.query("UPDATE user_ai_credentials SET nonce = $2 WHERE user_id = $1 AND provider = 'anthropic'",
      [member.userId, randomBytes(12)]), /user_ai_credentials_sealing_check/u);

    const movedSecret = `AIza-synthetic-${randomUUID()}`;
    const movable = sealCredential(movedSecret, { userId: editor.userId, provider: "google" }, { CREDENTIAL_ENCRYPTION_KEY: localKey });
    await pool.query(`INSERT INTO user_ai_credentials(user_id,provider,ciphertext,nonce,key_version,key_hint,validated_at)
      VALUES($1,'google',$2,$3,$4,'ABCD',CURRENT_TIMESTAMP)`, [editor.userId, movable.ciphertext, movable.nonce, movable.keyVersion]);
    const moved = await reencryptAiCredentials(pool, { CREDENTIAL_ENCRYPTION_KEY: localKey, CREDENTIAL_KMS_KEY: KMS_KEY });
    assert.equal(moved.sealer, "kms");
    assert.ok(moved.reencrypted >= 1);
    assert.equal((await pool.query("SELECT sealed_with FROM user_ai_credentials WHERE user_id = $1 AND provider = 'google'", [editor.userId])).rows[0].sealed_with, "kms");
    assert.equal((await readAiCredentialSecret(pool, editor.userId, "google"))?.apiKey, movedSecret);
    assert.ok(kms.calls.some((url) => url.endsWith(":decrypt")), "the run proved that KMS rows open");
    const withoutKms = await reencryptAiCredentials(pool, { CREDENTIAL_ENCRYPTION_KEY: localKey });
    assert.equal(withoutKms.sealer, "local");
    assert.ok(withoutKms.unreadable >= 2, "KMS-sealed keys cannot be opened without KMS");

    // The guest purge removes a guest's counters and admin records with the guest; anonymous counts stay.
    process.env.GUEST_ACTIVE_LIMIT = "1000";
    const guest = await createGuestSession(pool, config, { userAgent: "Synthetic guest browser", locale: "en", address: "203.0.113.77" });
    const guestUser = (await verifySession(pool, config, guest.grant.rawToken)).userId;
    await assert.rejects(enforceRateLimit(pool, config, { scope: "guest-map", key: guestUser, userId: guestUser, maximum: 0, windowSeconds: 60 }), RateLimitError);
    await setAccountSuspension(pool, operatorSession, guestUser, true);
    const guestCounts = await pool.query("SELECT COALESCE(sum(count),0)::int AS count FROM platform_daily_counts WHERE metric = 'guest_created'");
    assert.ok(guestCounts.rows[0].count >= 1);
    await pool.query("UPDATE app_users SET guest_expires_at = CURRENT_TIMESTAMP - interval '1 minute' WHERE id = $1", [guestUser]);
    const purge = await purgeExpiredGuests(pool);
    assert.ok(purge.purged >= 1);
    const leftovers = await pool.query(`SELECT (SELECT count(*)::int FROM platform_daily_counts WHERE user_id = $1) AS counts,
      (SELECT count(*)::int FROM operator_audit_events WHERE target_user_id = $1) AS actions`, [guestUser]);
    assert.deepEqual(leftovers.rows[0], { counts: 0, actions: 0 });
    assert.equal((await pool.query("SELECT COALESCE(sum(count),0)::int AS count FROM platform_daily_counts WHERE metric = 'guest_created'")).rows[0].count,
      guestCounts.rows[0].count);
  } finally {
    for (const [name, value] of [["OWNER_GOOGLE_EMAIL", saved.owner], ["PUBLIC_SIGNUP_ENABLED", saved.signup], ["CREDENTIAL_KMS_KEY", saved.kms],
      ["CREDENTIAL_ENCRYPTION_KEY", saved.local]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    delete process.env.GUEST_ACTIVE_LIMIT;
    globalThis.fetch = saved.fetch;
    resetKmsTokenCache();
  }
}
