import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { testModelRefreshMigration } from "./model-refresh.mjs";
import { issueAccountOnboarding, verifyAccountOnboarding } from "../../src/lib/auth/account-session.ts";
import { verifySession } from "../../src/lib/auth/repository.ts";
import { canLookupTripDestination, runTripDestinationLookup } from "../../src/lib/app/trip-destination-service.ts";
import { validateLookupOutput } from "../../src/lib/app/trip-destination-defaults.ts";
import { getTripCreationOptions } from "../../src/lib/app/trip-creation-options.ts";
import { AppConflictError, createTrip } from "../../src/lib/app/repository.ts";

const config = { authSecret: "synthetic-destination-secret-only-for-tests", tripGraceDays: 2 };
const request = (destination = "Japan") => ({ destination, locale: "en", requestId: randomUUID() });
const defaults = validateLookupOutput({ status: "resolved", countryCode: "JP", timeZone: "Asia/Tokyo",
  timeZoneCandidates: [], currency: "JPY", currencyCandidates: [] }, "japan");
const output = { defaults, usage: { inputTokens: 40, outputTokens: 30, cachedInputTokens: 0 }, effectiveModel: "gpt-6.1-sol", latencyMs: 1 };
async function account(pool, label = "ordinary") {
  const grant = await issueAccountOnboarding(pool, config, { issuer: "https://accounts.google.com", subject: `synthetic-destination-${randomUUID()}`,
    emailHint: `${label}-${randomUUID()}@example.test`, displayNameHint: "Synthetic destination test" });
  const principal = await verifyAccountOnboarding(pool, config, grant.rawToken);
  assert.ok(principal);
  return { principal, grant };
}
async function insertAttempt(pool, userId, overrides = {}) {
  const values = { id: randomUUID(), requestId: randomUUID(), status: "failed", createdAgo: "0 seconds", ...overrides };
  await pool.query(`INSERT INTO account_ai_lookups(id,user_id,client_request_id,request_payload_hash,input_hash,destination_text,
      display_locale,prompt_version,entitlement,status,error_code,created_at,completed_at)
    VALUES($1,$2,$3,$4,$4,'Synthetic destination','en',1,'trip_creator',$5,
      CASE WHEN $5='failed' THEN 'PROVIDER_UNAVAILABLE' ELSE NULL END,
      CURRENT_TIMESTAMP-$6::interval,CASE WHEN $5='failed' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
  [values.id, userId, values.requestId, Buffer.alloc(32, 4), values.status, values.createdAgo]);
  return values.id;
}

/** Called only from the guarded disposable PostgreSQL migration suite. Never uses
 * a live model, real account, event, expense, or application database. */
export async function testTripDestinationLookups(pool, connectionString) {
  assert.deepEqual(await migrate({ connectionString, through: "0050_account_ai_lookups.sql" }), ["0050_account_ai_lookups.sql"]);
  await testModelRefreshMigration(pool, connectionString);
  // Pinned to this module's schema stage; later modules (0052 trip deletion) apply their own migrations.
  assert.deepEqual(await migrate({ connectionString, through: "0051_model_refresh.sql" }), []);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_schema_migrations")).rows[0].count, 47);
  const previous = Object.fromEntries(["PUBLIC_SIGNUP_ENABLED", "STARDUST_DESTINATION_LOOKUP", "OWNER_GOOGLE_EMAIL"].map((key) => [key, process.env[key]]));
  const singlePool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
  try {
    process.env.PUBLIC_SIGNUP_ENABLED = "true";
    process.env.STARDUST_DESTINATION_LOOKUP = "creators";
    process.env.OWNER_GOOGLE_EMAIL = "synthetic-no-operator@example.test";
    let calls = 0;
    const provider = async () => { calls++; await singlePool.query("SELECT 1"); return output; };
    const first = await account(pool), other = await account(pool);
    assert.equal(await canLookupTripDestination(pool, config, first.principal.userId), true);
    const input = request();
    const one = await runTripDestinationLookup(singlePool, config, first.principal, input, { provider });
    assert.equal(one.source, "ai");
    assert.equal(one.timeZone, "Asia/Tokyo");
    assert.equal(calls, 1, "even a country name must call the provider; a size-one pool must be released first");
    assert.equal((await runTripDestinationLookup(singlePool, config, first.principal, request(" JAPAN "), { provider })).source, "cache");
    assert.equal((await runTripDestinationLookup(singlePool, config, first.principal, input, { provider })).source, "cache");
    assert.equal(calls, 1);
    await assert.rejects(runTripDestinationLookup(singlePool, config, first.principal, { ...input, destination: "Tokyo" }, { provider }), AppConflictError);
    assert.equal((await runTripDestinationLookup(singlePool, config, other.principal, request(), { provider })).source, "ai");
    assert.equal(calls, 2, "another account cannot reuse or discover a private destination cache");
    assert.ok(await verifyAccountOnboarding(pool, config, first.grant.rawToken), "lookup cannot consume onboarding grants");

    // Immutable successful row; neither a second finish nor deletion is permitted.
    await assert.rejects(pool.query("UPDATE account_ai_lookups SET latency_ms=1 WHERE id=$1", [one.lookupId]), (error) => error.code === "23514");
    await assert.rejects(pool.query("DELETE FROM account_ai_lookups WHERE id=$1", [one.lookupId]), (error) => error.code === "23514");
    const started = await insertAttempt(pool, first.principal.userId, { status: "started" });
    const mutationCases = [
      ["id=$2", randomUUID()], ["user_id=$2", other.principal.userId], ["client_request_id=$2", randomUUID()],
      ["request_payload_hash=$2", Buffer.alloc(32, 1)], ["input_hash=$2", Buffer.alloc(32, 1)],
      ["destination_text=$2", "Kyoto"], ["display_locale=$2", "zh-HK"], ["prompt_version=$2", 2],
      ["entitlement=$2", "platform_operator"], ["created_at=$2", new Date(Date.now() - 60_000)],
    ];
    for (const [set, value] of mutationCases) {
      await assert.rejects(pool.query(`UPDATE account_ai_lookups SET status='failed',completed_at=CURRENT_TIMESTAMP,
        error_code='TIMEOUT',${set} WHERE id=$1`, [started, value]), (error) => error.code === "23514", set);
    }
    for (const [column, value] of [["feature", "planning"], ["requested_model", "gpt-6-astra"], ["provider", "anthropic"],
      ["transport", "api"], ["authentication_mode", "api_key"]]) {
      await assert.rejects(pool.query(`UPDATE account_ai_lookups SET status='failed',completed_at=CURRENT_TIMESTAMP,
        error_code='TIMEOUT',${column}=$2 WHERE id=$1`, [started, value]), (error) => error.code === "23514", column);
    }
    await pool.query("UPDATE account_ai_lookups SET status='failed',completed_at=CURRENT_TIMESTAMP,error_code='TIMEOUT' WHERE id=$1", [started]);
    await assert.rejects(pool.query("UPDATE account_ai_lookups SET error_code='PROVIDER_UNAVAILABLE' WHERE id=$1", [started]), (error) => error.code === "23514");

    const quotaAccount = await account(pool);
    for (let i = 0; i < 9; i++) await insertAttempt(pool, quotaAccount.principal.userId);
    const raced = await Promise.all(["Tokyo", "Osaka"].map((destination) => runTripDestinationLookup(singlePool, config,
      quotaAccount.principal, request(destination), { provider })));
    assert.equal(raced.filter((result) => result.source === "ai").length, 1);
    assert.equal(raced.filter((result) => ["busy", "quota"].includes(result.reason)).length, 1);
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM account_ai_lookups WHERE user_id=$1", [quotaAccount.principal.userId])).rows[0].count, 10);
    assert.equal((await runTripDestinationLookup(singlePool, config, quotaAccount.principal, request("Kyoto"), { provider })).reason, "quota");

    const staleAccount = await account(pool);
    const stale = await insertAttempt(pool, staleAccount.principal.userId, { status: "started", createdAgo: "2 minutes" });
    assert.equal((await runTripDestinationLookup(singlePool, config, staleAccount.principal, request(), { provider })).source, "ai");
    assert.deepEqual((await pool.query("SELECT status,error_code FROM account_ai_lookups WHERE id=$1", [stale])).rows[0], { status: "failed", error_code: "TIMEOUT" });
    const revoked = await account(pool);
    const revokedResult = await runTripDestinationLookup(singlePool, config, revoked.principal, request(), { provider: async () => {
      await pool.query("UPDATE auth_account_sessions SET consumed_at=CURRENT_TIMESTAMP WHERE id=$1", [revoked.principal.accountSessionId]);
      return output;
    } });
    assert.equal(revokedResult.reason, "not_entitled");
    assert.deepEqual((await pool.query("SELECT status,error_code,response_json FROM account_ai_lookups WHERE user_id=$1", [revoked.principal.userId])).rows[0],
      { status: "failed", error_code: "AUTH_CHANGED", response_json: null });

    // Even a large admitted history is not a daily quota for the operator.
    process.env.OWNER_GOOGLE_EMAIL = (await pool.query("SELECT email_hint FROM oidc_identities WHERE user_id=$1", [quotaAccount.principal.userId])).rows[0].email_hint;
    assert.equal((await runTripDestinationLookup(singlePool, config, quotaAccount.principal, request("Kobe"), { provider })).source, "ai");
    process.env.STARDUST_DESTINATION_LOOKUP = "operator";
    assert.equal((await runTripDestinationLookup(singlePool, config, first.principal, request("Kyoto"), { provider })).reason, "not_entitled");
    process.env.STARDUST_DESTINATION_LOOKUP = "creators";

    const baseTrip = { name: "Synthetic lookup provenance", destinationName: "Japan", timeZone: "Asia/Tokyo", defaultLocale: "en",
      defaultCurrency: "JPY", startsOn: "2031-10-01", endsOn: "2031-10-02", maxMembers: 4 };
    await assert.rejects(createTrip(pool, first.principal, { ...baseTrip, timeZone: "EST" }, { config, userAgent: "Synthetic" }));
    const ownTrip = await createTrip(pool, first.principal, { ...baseTrip, destinationLookupId: one.lookupId }, { config, userAgent: "Synthetic" });
    const foreignTrip = await createTrip(pool, other.principal, { ...baseTrip, destinationLookupId: one.lookupId }, { config, userAgent: "Synthetic" });
    const metadata = async (tripId) => (await pool.query("SELECT metadata FROM audit_events WHERE trip_id=$1 AND entity_type='trip' AND action='created'", [tripId])).rows[0].metadata;
    assert.deepEqual((await metadata(ownTrip.tripId)).destinationLookup, { id: one.lookupId, suggestedTimeZone: "Asia/Tokyo", suggestedCurrency: "JPY",
      timeZoneAccepted: true, currencyAccepted: true });
    assert.equal((await metadata(foreignTrip.tripId)).destinationLookup, null, "foreign lookup identifiers cannot disclose another account's planned destination");
    const ownSession = await verifySession(pool, config, ownTrip.sessionGrant.rawToken);
    assert.ok(ownSession);
    const otherDestination = await createTrip(pool, ownSession, { ...baseTrip, destinationName: "Osaka", destinationLookupId: one.lookupId });
    assert.equal((await metadata(otherDestination.tripId)).destinationLookup, null, "an owned lookup for a different destination is not provenance");
    const malformedLookupId = randomUUID();
    await pool.query(`INSERT INTO account_ai_lookups(id,user_id,client_request_id,request_payload_hash,input_hash,destination_text,
      display_locale,prompt_version,entitlement,status,response_json,completed_at)
      VALUES($1,$2,$3,$4,$4,'japan','en',1,'trip_creator','succeeded',$5::jsonb,CURRENT_TIMESTAMP)`,
    [malformedLookupId, ownSession.userId, randomUUID(), Buffer.alloc(32, 9), JSON.stringify({ ...defaults, currency: "private-corrupt-prose" })]);
    const malformedTrip = await createTrip(pool, ownSession, { ...baseTrip, destinationLookupId: malformedLookupId });
    assert.equal((await metadata(malformedTrip.tripId)).destinationLookup, null, "malformed stored codes never enter creation audit provenance");
    assert.equal((await pool.query("SELECT host_subscription_enabled FROM trip_ai_settings WHERE trip_id=$1", [ownTrip.tripId])).rows[0].host_subscription_enabled, false,
      "a pre-trip lookup does not grant in-trip host-funded AI");

    // Existing unsponsored, active Google-bound members remain eligible while
    // public signup is disabled; trip role and sponsorship are irrelevant.
    process.env.PUBLIC_SIGNUP_ENABLED = "false";
    const session = await verifySession(pool, config, ownTrip.sessionGrant.rawToken);
    assert.ok(session);
    await pool.query("UPDATE trip_members SET role='viewer' WHERE trip_id=$1 AND id=$2", [session.tripId, session.memberId]);
    assert.equal(await canLookupTripDestination(pool, config, session.userId), true);
    const viewer = { ...session, role: "viewer" };
    assert.equal((await runTripDestinationLookup(singlePool, config, viewer, request("Osaka"), { provider })).source, "ai");
    await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [viewer.tripId, viewer.memberId]);
    assert.equal((await runTripDestinationLookup(singlePool, config, viewer, request("Kyoto"), { provider })).reason, "not_entitled");

    const timeZones = getTripCreationOptions("en").timeZones.map((option) => option.value);
    const compatible = await pool.query("SELECT z,CURRENT_TIMESTAMP AT TIME ZONE z AS local_time FROM unnest($1::text[]) z", [timeZones]);
    assert.equal(compatible.rowCount, timeZones.length, "all UI time-zone values must be accepted by the production-version PostgreSQL tzdata");
  } finally {
    await singlePool.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
