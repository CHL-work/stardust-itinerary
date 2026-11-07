import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getAppOverview } from "../../src/lib/app/repository.ts";
import { insertSession, verifySession } from "../../src/lib/auth/repository.ts";
import { runDueFlightStatusChecks } from "../../src/lib/flights/monitor.ts";

/**
 * Flight status checks (JOB-083, D-095), at migration head with a scripted provider: a delay moves the
 * times and marks the event changed, a gate arrives quietly, a cancellation keeps the event, every
 * slot runs once per departure time, and the checks follow a changed departure. Synthetic data only.
 */
export async function testFlightStatus(pool, connectionString) {
  const config = { authSecret: "synthetic-flight-status-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const tripId = randomUUID(), dayId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic status flyer')", [userId]);
  await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES('https://accounts.google.com',$1,$2,$3)",
    [`synthetic-${randomUUID()}`, userId, `${memberId}@example.test`]);
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic status trip','Asia/Tokyo','JPY','2031-05-01','2031-05-03')`, [tripId, userId]);
  for (const [id, date] of [[dayId, "2031-05-01"], [randomUUID(), "2031-05-02"]]) {
    await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,$3)", [tripId, id, date]);
  }
  await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic status flyer','owner','active')",
    [tripId, memberId, userId]);
  await pool.query("INSERT INTO trip_ai_settings(trip_id,updated_by_member_id,host_subscription_enabled) VALUES($1,$2,true)", [tripId, memberId]);
  await pool.query("INSERT INTO trip_disruption_settings(trip_id,updated_by_member_id) VALUES($1,$2)", [tripId, memberId]);
  const client = await pool.connect();
  let session;
  try {
    const grant = await insertSession(client, config, { tripId, memberId, userId, role: "owner",
      absoluteExpiresAt: new Date(Date.now() + 86_400_000), userAgent: null });
    session = await verifySession(pool, config, grant.rawToken);
  } finally { client.release(); }

  const flight = async (title, startsAt, extra = {}) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO itinerary_items (trip_id, id, trip_day_id, created_by_member_id, title, item_type, starts_at, ends_at,
         departure_location_name, destination_location_name, flight, visibility)
       VALUES ($1,$2,$3,$4,$5,'transport',$6,$7,'Synthetic Airport','Second Synthetic Airport',$8::jsonb,$9)`,
      [tripId, id, dayId, memberId, title, startsAt, new Date(Date.parse(startsAt) + 70 * 60_000).toISOString(),
        JSON.stringify({ flightNumber: extra.flightNumber ?? "ZZ500", departureTerminal: "Terminal 1" }), extra.visibility ?? "trip"]);
    await pool.query(
      `INSERT INTO itinerary_revisions (trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot)
       VALUES ($1,$2,1,$3,'{"title":"Synthetic flight"}'::jsonb)`, [tripId, id, memberId]);
    return id;
  };
  const answers = [];
  const provider = { async check(input) {
    assert.match(input.prompt, /^You check the current status of one flight/u);
    assert.doesNotMatch(input.prompt, /Synthetic status flyer|example\.test/u);
    const answer = answers.shift();
    assert.ok(answer, "an answer was scripted");
    return { rawOutput: JSON.stringify(answer), effectiveModel: "gpt-6.1-sol", inputTokens: 10, outputTokens: 5,
      cachedInputTokens: 0, webSearchCount: 1, webSearchQueries: [] };
  } };
  const answer = (overrides) => ({ flightNumber: "ZZ500", flightDate: "2031-05-01", status: "scheduled",
    scheduledDeparture: "2031-05-01T10:00:00+09:00", estimatedDeparture: null, scheduledArrival: null, estimatedArrival: null,
    departureTerminal: "Terminal 1", departureGate: null, arrivalTerminal: null, confidence: "high",
    sources: ["https://airline.example.test/status/ZZ500"], summary: "Synthetic status.", ...overrides });
  const run = (now) => runDueFlightStatusChecks(pool, { now: new Date(now), provider, maxChecks: 10 });
  const item = async (id) => (await pool.query(
    "SELECT starts_at, ends_at, status, flight, current_revision, trip_day_id FROM itinerary_items WHERE trip_id = $1 AND id = $2", [tripId, id])).rows[0];

  // Departure 10:00 JST = 01:00Z. Nothing is due more than 24 hours before.
  const delayed = await flight("ZZ500 synthetic flight", "2031-05-01T01:00:00.000Z");
  const privateFlight = await flight("ZZ501 private synthetic flight", "2031-05-01T01:00:00.000Z", { flightNumber: "ZZ501", visibility: "private" });
  assert.deepEqual(await run("2031-04-29T23:00:00Z"), { checked: 0, updated: 0, unchanged: 0, unverified: 0, failed: 0 });

  // The 24-hour check finds the gate: a quiet detail update, no changed marker.
  answers.push(answer({ departureGate: "52" }));
  assert.deepEqual(await run("2031-04-30T01:30:00Z"), { checked: 1, updated: 1, unchanged: 0, unverified: 0, failed: 0 });
  assert.equal((await item(delayed)).flight.departureGate, "52");
  let overview = await getAppOverview(pool, session);
  assert.equal(overview.itinerary.find((entry) => entry.id === delayed)?.flightChange, null);
  // The same slot never runs twice for the same departure.
  assert.deepEqual(await run("2031-04-30T02:00:00Z"), { checked: 0, updated: 0, unchanged: 0, unverified: 0, failed: 0 });

  // The 6-hour check finds a 90-minute delay: new times, a system revision and a changed marker.
  answers.push(answer({ status: "delayed", estimatedDeparture: "2031-05-01T11:30:00+09:00", estimatedArrival: "2031-05-01T12:45:00+09:00", departureGate: "52" }));
  assert.equal((await run("2031-04-30T19:10:00Z")).updated, 1);
  const moved = await item(delayed);
  assert.equal(moved.starts_at.toISOString(), "2031-05-01T02:30:00.000Z");
  assert.equal(moved.ends_at.toISOString(), "2031-05-01T03:45:00.000Z");
  assert.equal(moved.current_revision, 3);
  const revision = await pool.query(
    "SELECT changed_by_member_id, changed_by_source FROM itinerary_revisions WHERE trip_id = $1 AND itinerary_item_id = $2 AND revision = 3", [tripId, delayed]);
  assert.deepEqual(revision.rows[0], { changed_by_member_id: null, changed_by_source: "flight_status" });
  overview = await getAppOverview(pool, session);
  assert.deepEqual(overview.itinerary.find((entry) => entry.id === delayed)?.flightChange, {
    kind: "schedule", previousStartsAt: "2031-05-01T01:00:00.000Z", previousEndsAt: "2031-05-01T02:10:00.000Z",
    startsAt: "2031-05-01T02:30:00.000Z", endsAt: "2031-05-01T03:45:00.000Z", checkedAt: "2031-04-30T19:10:00.000Z",
  });
  // The checks follow the new departure: its current slot is already done, so nothing runs right away.
  assert.equal((await run("2031-04-30T19:20:00Z")).checked, 0);
  answers.push(answer({ status: "delayed", estimatedDeparture: "2031-05-01T11:30:00+09:00", departureGate: "52" }));
  assert.equal((await run("2031-04-30T21:31:00Z")).unchanged, 1);

  // A cancellation keeps the event, marked cancelled with the warning marker; later checks stop.
  answers.push(answer({ status: "cancelled", estimatedDeparture: null, departureGate: "52" }));
  assert.equal((await run("2031-04-30T23:31:00Z")).updated, 1);
  assert.equal((await item(delayed)).status, "cancelled");
  overview = await getAppOverview(pool, session);
  assert.equal(overview.itinerary.find((entry) => entry.id === delayed)?.flightChange?.kind, "cancelled");
  assert.equal((await run("2031-05-01T00:31:00Z")).checked, 0);

  // Private flights are never looked up; every scripted answer was used.
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM flight_status_checks WHERE trip_id = $1 AND itinerary_item_id = $2",
    [tripId, privateFlight])).rows[0].n, 0);
  assert.equal(answers.length, 0);
  const requests = await pool.query("SELECT count(*)::int AS n FROM ai_requests WHERE trip_id = $1 AND feature = 'flight_status' AND initiator_kind = 'system'", [tripId]);
  assert.equal(requests.rows[0].n, 4);
  await assert.rejects(pool.query("UPDATE flight_status_changes SET kind = 'details' WHERE trip_id = $1", [tripId]), /append-only/iu);
  await assert.rejects(pool.query(
    `INSERT INTO itinerary_revisions (trip_id, itinerary_item_id, revision, changed_by_member_id, changed_by_source, snapshot)
     VALUES ($1, $2, 5, NULL, 'member', '{}'::jsonb)`, [tripId, delayed]), /itinerary_revisions_changed_by_shape_ck/u);
}
