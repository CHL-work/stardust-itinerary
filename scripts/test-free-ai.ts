/** Opt-in integration smoke: synthetic registered and guest accounts, real keyless Kilo calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
// @ts-expect-error The shared JavaScript migration runner has no declaration file.
import { migrate } from "./db/migration-lib.mjs";
import { createGuestSession } from "../src/lib/app/guest";
import { createTrip } from "../src/lib/app/repository";
import { verifyAccountOnboarding } from "../src/lib/auth/account-session";
import { signInExistingIdentity, verifySession } from "../src/lib/auth/repository";
import { runAiPlanner } from "../src/lib/ai/planner";
import { freeAiSettings } from "../src/lib/ai/free-model";
import { aiProviderFailureDetails } from "../src/lib/ai/provider-failure";

async function main() {
  assert.equal(process.env.STARDUST_RUN_FREE_AI_SMOKE, "true", "Set STARDUST_RUN_FREE_AI_SMOKE=true to authorize free upstream calls.");
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, "TEST_DATABASE_URL must name a freshly created disposable database.");
  const target = new URL(connectionString);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  const database = decodeURIComponent(target.pathname.slice(1));
  assert.match(database, /^stardust_test_free_[a-z0-9_]+$/u);
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, database);
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"]) {
    const value = process.env[name];
    if (value) {
      const live = new URL(value);
      assert.notEqual(`${live.hostname}:${live.port || "5432"}${live.pathname}`, `${target.hostname}:${target.port || "5432"}${target.pathname}`);
    }
  }
  const pool = new pg.Pool({ connectionString, max: 4 });
  try {
    assert.equal(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count), 0,
      "Refusing a nonempty database; create a new one for each smoke.");
    process.env.FREE_AI_ENABLED = "true";
    process.env.FREE_AI_PER_USER_DAILY = "10";
    process.env.FREE_AI_HOURLY = "20";
    process.env.FREE_AI_DAILY = "20";
    process.env.GUEST_MODE_ENABLED = "true";
    assert.ok(freeAiSettings().enabled);
    await migrate({ connectionString });
    const userId = randomUUID(), memberId = randomUUID(), tripId = randomUUID(), companionId = randomUUID();
    const identity = { issuer: "https://accounts.google.com", subject: `synthetic-free-${randomUUID()}`,
      emailHint: "synthetic-free@example.test", displayNameHint: "Alex" };
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Alex')", [userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)",
      [identity.issuer, identity.subject, userId, identity.emailHint]);
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic free AI smoke','Asia/Tokyo','JPY',(now() AT TIME ZONE 'Asia/Tokyo')::date,(now() AT TIME ZONE 'Asia/Tokyo')::date+3)`, [tripId, userId]);
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES
      ($1,$2,$3,'Alex','owner','active'),($1,$4,NULL,'Sam','editor','invited')`, [tripId, memberId, userId, companionId]);
    await pool.query(`INSERT INTO trip_days(trip_id,id,day_date,label)
      SELECT $1,gen_random_uuid(),day::date,'Synthetic day' FROM trips t,
        LATERAL generate_series(t.starts_on,t.ends_on,interval '1 day') AS day WHERE t.id=$1`, [tripId]);
    await pool.query("INSERT INTO trip_ai_settings(trip_id,enabled,updated_by_member_id,host_subscription_enabled) VALUES($1,true,$2,false)", [tripId, memberId]);
    const config = { authSecret: "synthetic-free-smoke-not-a-production-secret", tripGraceDays: 2,
      appBaseUrl: new URL("http://127.0.0.1:3196"), databaseUrl: connectionString,
      allowedOrigins: new Set(["http://127.0.0.1:3196"]), googleClientId: "synthetic-client", googleClientSecret: "synthetic-secret" };
    const grant = await signInExistingIdentity(pool, config, { identity, userAgent: "Synthetic smoke" });
    assert.ok(grant);
    const session = await verifySession(pool, config, grant.rawToken);
    assert.ok(session);
    const selectedFreeModel = process.env.STARDUST_FREE_AI_MODEL;
    const result = await runAiPlanner(pool, session,
      "tmrw 7pm dinner at Example Cafe, Tokyo. 1hr. i paid 4200 yen split me n Sam. add dinner + linked bill, dont search", "guest-free", "en",
      undefined, undefined, [], selectedFreeModel);
    assert.ok("proposalCount" in result);
    if (selectedFreeModel) assert.equal(result.model, selectedFreeModel);
    const proposals = (await pool.query("SELECT entity_type,status,proposed_patch FROM change_requests WHERE trip_id=$1 AND source='ai'", [tripId])).rows;
    assert.ok(proposals.length > 0, "The synthetic registered request must create a proposal.");
    assert.ok(proposals.every((proposal) => proposal.status === "pending"), "Free creates must wait for review.");
    const event = proposals.find((proposal) => proposal.entity_type === "itinerary_item");
    assert.ok(event, "Dinner event missing");
    const patch = event.proposed_patch;
    const tomorrow = (await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date+1,'YYYY-MM-DD') AS date")).rows[0].date;
    assert.equal(Date.parse(patch.startsAt), Date.parse(`${tomorrow}T19:00:00+09:00`));
    assert.equal(Date.parse(patch.endsAt) - Date.parse(patch.startsAt), 60 * 60_000);
    const expense = patch.linkedExpense;
    assert.ok(expense, "Linked bill missing");
    assert.equal(expense.amountMinor, 4200);
    assert.equal(expense.currency, "JPY");
    assert.equal(expense.payerMemberId, memberId);
    assert.deepEqual(new Set(expense.splitMemberIds), new Set([memberId, companionId]));
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM expenses WHERE trip_id=$1", [tripId])).rows[0].count, 0);
    console.log(JSON.stringify({ case: "registered-event-linked-expense", passed: true, proposals: result.proposalCount }));

    const guest = await createGuestSession(pool, config, { userAgent: "Synthetic free guest", locale: "en", address: "203.0.113.123" });
    const guestPrincipal = await verifyAccountOnboarding(pool, config, guest.grant.rawToken);
    assert.ok(guestPrincipal);
    assert.equal(await verifySession(pool, config, guest.grant.rawToken), null, "A creation grant is not a trip session.");
    const { rows: [dates] } = await pool.query("SELECT starts_on::text, ends_on::text FROM trips WHERE id=$1", [tripId]);
    const guestTrip = await createTrip(pool, guestPrincipal, {
      name: "Synthetic free guest trip", destinationName: "Tokyo, Japan", timeZone: "Asia/Tokyo",
      defaultLocale: "en", defaultCurrency: "JPY", startsOn: dates.starts_on, endsOn: dates.ends_on, maxMembers: 1,
    }, { config, userAgent: "Synthetic free guest" });
    assert.ok(guestTrip.sessionGrant);
    assert.equal(await verifyAccountOnboarding(pool, config, guest.grant.rawToken), null, "Creation consumes the one-use grant.");
    const guestSession = await verifySession(pool, config, guestTrip.sessionGrant.rawToken);
    assert.ok(guestSession);
    const guestResult = await runAiPlanner(pool, guestSession, "add dinner tmrw at 7pm at Example Cafe in tokyo, dont search", "guest-free", "en",
      undefined, undefined, [], selectedFreeModel);
    assert.ok("proposalCount" in guestResult);
    if (selectedFreeModel) assert.equal(guestResult.model, selectedFreeModel);
    assert.ok(guestResult.proposalCount > 0);
    assert.equal(guestResult.changeStatus, "pending");
    const receipts = (await pool.query("SELECT provider,credential_source FROM ai_requests WHERE status='succeeded'")).rows;
    assert.ok(receipts.every((row) => row.provider === "kilo" && row.credential_source === "free"));
    console.log(JSON.stringify({ case: "guest-event", passed: true, proposals: guestResult.proposalCount,
      attempts: (await pool.query("SELECT count(*)::int AS count FROM ai_request_events WHERE event_type='provider.free.attempt.started'")).rows[0].count }));
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  // Synthetic inputs only, but never publish opaque upstream errors, connection strings or tokens.
  console.error(JSON.stringify({ passed: false, code: aiProviderFailureDetails(error)?.code ?? (error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "SMOKE_FAILED"),
    ...(error instanceof assert.AssertionError ? { check: error.message.slice(0, 180) } : {}),
    // File/line positions only, never the first stack line (which can include provider text).
    ...(error instanceof Error ? { frames: error.stack?.split("\n").slice(1).filter((line) => /\bat .*[\\/]src[\\/]|\bat .*[\\/]scripts[\\/]/u.test(line)).slice(0, 5)
      .map((line) => line.replace(/^.*?((?:src|scripts)[\\/])/u, "$1")) } : {}) }));
  process.exitCode = 1;
});
