import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyPermittedChangeRequest, createChangeRequest, getAppOverview } from "../../src/lib/app/repository.ts";
import { insertSession, verifySession } from "../../src/lib/auth/repository.ts";

/**
 * Flight details (JOB-082, D-094): transport events carry an optional flight object that is replaced
 * whole, kept in revisions and the overview, and refused on other events or with a bad flight number.
 * Synthetic data only, at migration head.
 */
export async function testFlightDetails(pool, connectionString) {
  const config = { authSecret: "synthetic-flight-details-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const tripId = randomUUID(), dayId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic flyer')", [userId]);
  await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES('https://accounts.google.com',$1,$2,$3)",
    [`synthetic-${randomUUID()}`, userId, `${memberId}@example.test`]);
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic flight trip','Asia/Tokyo','JPY','2031-04-01','2031-04-03')`, [tripId, userId]);
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2031-04-01')", [tripId, dayId]);
  await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic flyer','owner','active')",
    [tripId, memberId, userId]);
  const client = await pool.connect();
  let session;
  try {
    const grant = await insertSession(client, config, { tripId, memberId, userId, role: "owner",
      absoluteExpiresAt: new Date(Date.now() + 86_400_000), userAgent: null });
    session = await verifySession(pool, config, grant.rawToken);
  } finally { client.release(); }

  const created = await createChangeRequest(pool, session, tripId, {
    entityType: "itinerary_item", operation: "create", reason: "Synthetic flight",
    patch: {
      tripDayId: dayId, title: "ZZ123 synthetic flight", itemType: "transport",
      startsAt: "2031-04-01T05:00:00.000Z", endsAt: "2031-04-01T06:10:00.000Z",
      departureLocationName: "Synthetic Airport", destinationLocationName: "Second Synthetic Airport",
      flight: { flightNumber: "ZZ123", airline: "Synthetic Air", departureTerminal: "Terminal 1" },
    },
  });
  const applied = await applyPermittedChangeRequest(pool, session, tripId, created.id);
  const stored = await pool.query(
    `SELECT i.flight, r.snapshot FROM itinerary_items i
       JOIN itinerary_revisions r ON r.trip_id = i.trip_id AND r.itinerary_item_id = i.id AND r.revision = 1
      WHERE i.trip_id = $1 AND i.id = $2`, [tripId, applied.entityId]);
  assert.deepEqual(stored.rows[0].flight, { flightNumber: "ZZ123", airline: "Synthetic Air", departureTerminal: "Terminal 1" });
  assert.equal(stored.rows[0].snapshot.flight.flightNumber, "ZZ123");

  // A gate arrives later; the whole object is replaced.
  const updated = await createChangeRequest(pool, session, tripId, {
    entityType: "itinerary_item", entityId: applied.entityId, operation: "update", baseRevision: 1, reason: "Gate assigned",
    patch: { flight: { flightNumber: "ZZ123", airline: "Synthetic Air", departureTerminal: "Terminal 2", departureGate: "B7" } },
  });
  await applyPermittedChangeRequest(pool, session, tripId, updated.id);
  const overview = await getAppOverview(pool, session);
  assert.deepEqual(overview.itinerary.find((item) => item.id === applied.entityId)?.flight, {
    flightNumber: "ZZ123", airline: "Synthetic Air", departureTerminal: "Terminal 2", departureGate: "B7", arrivalTerminal: null,
  });

  // Turning the flight into another kind of event drops its flight details.
  const retyped = await createChangeRequest(pool, session, tripId, {
    entityType: "itinerary_item", entityId: applied.entityId, operation: "update", baseRevision: 2, reason: "Not a flight after all",
    patch: { itemType: "activity", locationName: "Synthetic Airport" },
  });
  await applyPermittedChangeRequest(pool, session, tripId, retyped.id);
  const retypedRow = await pool.query("SELECT item_type, flight FROM itinerary_items WHERE trip_id = $1 AND id = $2", [tripId, applied.entityId]);
  assert.deepEqual(retypedRow.rows[0], { item_type: "activity", flight: null });

  await assert.rejects(pool.query(
    `INSERT INTO itinerary_items (trip_id, id, trip_day_id, created_by_member_id, title, item_type, flight)
     VALUES ($1, $2, $3, $4, 'Flight details on an activity', 'activity', '{"flightNumber":"ZZ123"}'::jsonb)`,
    [tripId, randomUUID(), dayId, memberId]), /itinerary_items_flight_ck/u);
  await assert.rejects(pool.query(
    `INSERT INTO itinerary_items (trip_id, id, trip_day_id, created_by_member_id, title, item_type, departure_location_name, flight)
     VALUES ($1, $2, $3, $4, 'Bad flight number', 'transport', 'Synthetic Airport', '{"flightNumber":"12345"}'::jsonb)`,
    [tripId, randomUUID(), dayId, memberId]), /itinerary_items_flight_ck/u);
}
