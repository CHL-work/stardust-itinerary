import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { listAiCredentials, readAiCredentialSecret, saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { withUserAiCredential } from "../../src/lib/ai/credential-context.ts";
import { geminiEndpoint } from "../../src/lib/ai/gemini.ts";
import { signInExistingIdentity, verifySession } from "../../src/lib/auth/repository.ts";

/** Synthetic keys only, in the parent's disposable and destruction-confirmed database. */
export async function testGoogleKeyModes(pool, connectionString) {
  await migrate({ connectionString, through: "0066_vertex_express_credentials.sql" });
  const names = ["CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_VERSION", "CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS",
    "CREDENTIAL_KMS_KEY", "CREDENTIAL_KMS_SERVICE_ACCOUNT", "CREDENTIAL_SECRET_MANAGER_PROJECT", "CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const userId = randomUUID(), tripId = randomUUID(), memberId = randomUUID();
  try {
    const identity = { issuer: "https://accounts.google.com", subject: `synthetic-google-mode-${randomUUID()}`,
      emailHint: "synthetic-google-mode@example.test", displayNameHint: "Synthetic Google key holder" };
    const config = { authSecret: "synthetic-google-key-modes-only", tripGraceDays: 2,
      appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic Google key holder')", [userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)", [identity.issuer, identity.subject, userId, identity.emailHint]);
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic key modes','UTC','USD',CURRENT_DATE,CURRENT_DATE+2)`, [tripId, userId]);
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic key holder','owner','active')`, [tripId, memberId, userId]);
    const grant = await signInExistingIdentity(pool, config, { identity, userAgent: "Synthetic mode browser" });
    const session = await verifySession(pool, config, grant.rawToken);
    assert.ok(session);
    const syntheticKey = `synthetic-google-api-${randomUUID()}-MODE`;
    const save = (mode) => saveAiCredential(pool, session, tripId, { provider: "google", apiKey: syntheticKey, ...mode }, async () => true);
    const row = async () => (await pool.query("SELECT * FROM user_ai_credentials WHERE user_id=$1 AND provider='google'", [userId])).rows[0];
    const check = async (mode, path) => {
      const summary = await save(mode);
      const stored = await row();
      assert.equal(stored.vertex_express, mode.vertexExpress === true);
      assert.equal(stored.vertex_project, mode.vertexProject ?? null);
      assert.equal(summary.vertex, Boolean(mode.vertexExpress || mode.vertexProject));
      assert.equal(summary.vertexExpress ?? false, mode.vertexExpress === true);
      const secret = await readAiCredentialSecret(pool, userId, "google");
      assert.ok(secret);
      await withUserAiCredential({ source: "own", provider: "google", ...secret }, async () => {
        assert.equal(new URL(geminiEndpoint()?.url("gemini-3.8-flash")).pathname, path);
      });
      const visible = JSON.stringify(await listAiCredentials(pool, session, tripId));
      assert.ok(!visible.includes(syntheticKey) && !visible.includes("synthetic-project"), "only safe mode flags and key hint leave storage");
      assert.ok(!stored.ciphertext.includes(Buffer.from(syntheticKey)));
    };
    const expressPath = "/v1/publishers/google/models/gemini-3.8-flash:generateContent";
    const standardPath = "/v1/projects/synthetic-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent";
    await check({ vertexExpress: true }, expressPath);
    await check({ vertexProject: "synthetic-project" }, standardPath);
    await check({ vertexExpress: true }, expressPath);
    const before = await row();
    await assert.rejects(saveAiCredential(pool, session, tripId, { provider: "google", apiKey: "synthetic-refused-key", vertexProject: "synthetic-project" }, async () => false));
    assert.deepEqual(await row(), before, "a failed replacement preserves the prior key and routing");
    await assert.rejects(pool.query("UPDATE user_ai_credentials SET vertex_project='synthetic-project',vertex_location='global' WHERE user_id=$1", [userId]), { code: "23514" });
    await assert.rejects(pool.query("UPDATE user_ai_credentials SET provider='openai' WHERE user_id=$1", [userId]), { code: "23514" });
    await check({}, "/v1beta/models/gemini-3.8-flash:generateContent");
    assert.equal((await row()).vertex_location, null);
  } finally {
    await pool.query("DELETE FROM user_ai_credentials WHERE user_id=$1", [userId]);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
