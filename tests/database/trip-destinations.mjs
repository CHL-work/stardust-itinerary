import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { issueAccountOnboarding, verifyAccountOnboarding } from "../../src/lib/auth/account-session.ts";
import { verifySession } from "../../src/lib/auth/repository.ts";
import {
  AppConflictError, applyPermittedChangeRequest, createChangeRequest, createTrip, getAppOverview, updateTripSettings,
} from "../../src/lib/app/repository.ts";

/**
 * A trip with several destinations (JOB-098, D-110) at migration head: creation, the overview, settings edits,
 * the destination date guards, and the trip window measured on the first and last days' own clocks.
 * Synthetic account and trip only.
 */
export async function testTripDestinations(pool, connectionString) {
  await migrate({ connectionString });
  const previousSignup = process.env.PUBLIC_SIGNUP_ENABLED;
  process.env.PUBLIC_SIGNUP_ENABLED = "true";
  const config = { authSecret: "synthetic-destinations-test-secret-only", tripGraceDays: 2 };
  try {
    const identity = { issuer: "https://accounts.google.com", subject: `synthetic-destinations-${randomUUID()}`,
      displayNameHint: "Synthetic destinations traveller", emailHint: "destinations-traveller@example.test" };
    const account = await verifyAccountOnboarding(pool, config, (await issueAccountOnboarding(pool, config, identity)).rawToken);
    assert.ok(account);
    const tokyo = { name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: "2031-05-01", endsOn: "2031-05-04" };
    const newYork = { name: "New York", timeZone: "America/New_York", startsOn: "2031-05-04", endsOn: "2031-05-07" };
    const input = { name: "Synthetic two-city trip", destinationName: "Tokyo", timeZone: "Asia/Tokyo", defaultLocale: "en",
      defaultCurrency: "JPY", startsOn: "2031-05-01", endsOn: "2031-05-07", maxMembers: 4, destinations: [tokyo, newYork] };
    const created = await createTrip(pool, account, input, { config, userAgent: "Synthetic browser" });
    const session = await verifySession(pool, config, created.sessionGrant.rawToken);
    assert.ok(session);
    const tripId = created.tripId;

    // Stored in order; the first destination stays the trip's own name and zone.
    const stored = await pool.query("SELECT position, name, time_zone, starts_on::text, ends_on::text FROM trip_destinations WHERE trip_id=$1 ORDER BY position", [tripId]);
    assert.deepEqual(stored.rows, [
      { position: 0, name: "Tokyo", time_zone: "Asia/Tokyo", starts_on: "2031-05-01", ends_on: "2031-05-04" },
      { position: 1, name: "New York", time_zone: "America/New_York", starts_on: "2031-05-04", ends_on: "2031-05-07" },
    ]);
    let overview = await getAppOverview(pool, session);
    assert.deepEqual(overview.trip.destinations, [tokyo, newYork]);
    assert.deepEqual([overview.trip.destinationName, overview.trip.timeZone], ["Tokyo", "Asia/Tokyo"]);
    await assert.rejects(pool.query("INSERT INTO trip_destinations(trip_id,id,position,name,time_zone,starts_on) VALUES($1,$2,5,'Half','Asia/Tokyo','2031-05-02')",
      [tripId, randomUUID()]), (error) => error.code === "23514");

    // An 8 PM dinner in New York on the last day is inside the trip: the window closes at midnight there.
    const lastDay = overview.days.find((day) => day.date === "2031-05-07");
    const request = await createChangeRequest(pool, session, tripId, { entityType: "itinerary_item", operation: "create", source: "owner",
      reason: "Synthetic last dinner", patch: { tripDayId: lastDay.id, title: "Synthetic dinner", itemType: "meal",
        startsAt: "2031-05-08T00:00:00.000Z", endsAt: "2031-05-08T01:30:00.000Z", locationName: "Synthetic pizza place",
        timeZones: { start: "America/New_York" }, visibility: "trip", viewerMemberIds: [] } });
    await applyPermittedChangeRequest(pool, session, tripId, request.id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM itinerary_items WHERE trip_id=$1 AND title='Synthetic dinner'", [tripId])).rows[0].n, 1);
    // Past midnight in New York it is outside, as before.
    await assert.rejects(createChangeRequest(pool, session, tripId, { entityType: "itinerary_item", operation: "create", source: "owner",
      reason: "Synthetic too late", patch: { tripDayId: lastDay.id, title: "Synthetic too late", itemType: "meal",
        startsAt: "2031-05-08T05:30:00.000Z", locationName: "Synthetic diner", visibility: "trip", viewerMemberIds: [] } }), AppConflictError);

    // Settings: a lone name renames the first destination; a list replaces all; dates must stay inside the trip.
    await updateTripSettings(pool, session, tripId, { destinationName: "Tokyo, Japan" });
    overview = await getAppOverview(pool, session);
    assert.deepEqual(overview.trip.destinations.map((destination) => destination.name), ["Tokyo, Japan", "New York"]);
    const osaka = { name: "Osaka", timeZone: "Asia/Tokyo", startsOn: null, endsOn: null };
    await updateTripSettings(pool, session, tripId, { destinations: [{ ...tokyo, name: "Tokyo, Japan" }, osaka, newYork] });
    overview = await getAppOverview(pool, session);
    assert.deepEqual(overview.trip.destinations, [{ ...tokyo, name: "Tokyo, Japan" }, osaka, newYork]);
    await assert.rejects(updateTripSettings(pool, session, tripId, { destinations: [{ ...tokyo, startsOn: "2031-04-30" }] }), AppConflictError);
    // Moving the trip's start past Tokyo's first day would strand its dates.
    await assert.rejects(updateTripSettings(pool, session, tripId, { startsOn: "2031-05-02", expectedStartsOn: "2031-05-01", expectedEndsOn: "2031-05-07" }),
      (error) => error instanceof AppConflictError && error.message === "Each destination's dates must be within the trip dates.");
    // Moving New York first makes it the trip's name and zone.
    await updateTripSettings(pool, session, tripId, { destinations: [newYork, tokyo] });
    const trip = (await pool.query("SELECT destination_name, time_zone FROM trips WHERE id=$1", [tripId])).rows[0];
    assert.deepEqual(trip, { destination_name: "New York", time_zone: "America/New_York" });
    const audit = (await pool.query(`SELECT after_state FROM audit_events WHERE trip_id=$1 AND entity_type='trip' AND action='settings_updated'
      ORDER BY created_at DESC, id DESC LIMIT 1`, [tripId])).rows[0].after_state;
    assert.deepEqual(audit.destinations.map((destination) => destination.name), ["New York", "Tokyo"]);
  } finally {
    if (previousSignup === undefined) delete process.env.PUBLIC_SIGNUP_ENABLED;
    else process.env.PUBLIC_SIGNUP_ENABLED = previousSignup;
  }
}
