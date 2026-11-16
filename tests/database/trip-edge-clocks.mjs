import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { issueAccountOnboarding, verifyAccountOnboarding } from "../../src/lib/auth/account-session.ts";
import { verifySession } from "../../src/lib/auth/repository.ts";
import {
  AppConflictError, applyPermittedChangeRequest, createChangeRequest, createTrip, getAppOverview, updatePendingItineraryRequest,
} from "../../src/lib/app/repository.ts";

/**
 * An event's own clock at the trip's edges (JOB-100, D-112): a flight home that lands on the trip's last day
 * where it lands is inside the trip, on trips with one destination or several, through a new event, an
 * update, a pending edit and approval. Later than that stays outside. Synthetic account, trips and flights only.
 */
export async function testTripEdgeClocks(pool, connectionString) {
  await migrate({ connectionString });
  const previousSignup = process.env.PUBLIC_SIGNUP_ENABLED;
  process.env.PUBLIC_SIGNUP_ENABLED = "true";
  const config = { authSecret: "synthetic-edge-clock-test-secret-only", tripGraceDays: 2 };
  try {
    const outsideTrip = (error) => error instanceof AppConflictError && error.code === "TRIP_DATES_OUTSIDE";
    // Each trip is created by its own synthetic account: an onboarding grant creates one trip.
    const open = async (input) => {
      const identity = { issuer: "https://accounts.google.com", subject: `synthetic-edge-clock-${randomUUID()}`,
        displayNameHint: "Synthetic edge traveller", emailHint: "edge-traveller@example.test" };
      const account = await verifyAccountOnboarding(pool, config, (await issueAccountOnboarding(pool, config, identity)).rawToken);
      assert.ok(account);
      const created = await createTrip(pool, account, input, { config, userAgent: "Synthetic browser" });
      const session = await verifySession(pool, config, created.sessionGrant.rawToken);
      assert.ok(session);
      const overview = await getAppOverview(pool, session);
      return { session, tripId: created.tripId, dayId: (date) => overview.days.find((day) => day.date === date).id };
    };
    const flight = (dayId, number, startsAt, endsAt, from, to, zones) => ({
      tripDayId: dayId, title: `${number} synthetic flight`, itemType: "transport", startsAt, endsAt,
      departureLocationName: from, destinationLocationName: to,
      flight: { flightNumber: number, airline: "Synthetic Air", ...zones }, visibility: "trip", viewerMemberIds: [] });
    const create = (trip, patch) => createChangeRequest(pool, trip.session, trip.tripId,
      { entityType: "itinerary_item", operation: "create", reason: "Synthetic booking", patch });
    const homeZones = { departureTimeZone: "Australia/Sydney", arrivalTimeZone: "America/Los_Angeles" };

    // Singapore, then Sydney, flying from and back to Los Angeles: the trip opens on Singapore's clock and closes on Sydney's.
    const twoCity = await open({ name: "Synthetic Singapore and Sydney", destinationName: "Singapore", timeZone: "Asia/Singapore",
      defaultLocale: "en", defaultCurrency: "SGD", startsOn: "2031-11-18", endsOn: "2031-12-06", maxMembers: 4, destinations: [
        { name: "Singapore", timeZone: "Asia/Singapore", startsOn: "2031-11-20", endsOn: "2031-11-29" },
        { name: "Sydney", timeZone: "Australia/Sydney", startsOn: "2031-11-29", endsOn: "2031-12-06" },
      ] });
    // Out late on 18 November in Los Angeles, landing in Singapore on the 20th: inside, as before.
    const outbound = await create(twoCity, flight(twoCity.dayId("2031-11-19"), "ZZ701", "2031-11-19T06:40:00.000Z",
      "2031-11-19T22:00:00.000Z", "Los Angeles (LAX)", "Singapore Changi (SIN)",
      { departureTimeZone: "America/Los_Angeles", arrivalTimeZone: "Asia/Singapore" }));
    await applyPermittedChangeRequest(pool, twoCity.session, twoCity.tripId, outbound.id);
    // Home on the last day: 10:30 in Sydney, landing at 06:15 the same day in Los Angeles, when Sydney has passed midnight.
    const home = await create(twoCity, flight(twoCity.dayId("2031-12-06"), "ZZ702", "2031-12-05T23:30:00.000Z",
      "2031-12-06T14:15:00.000Z", "Sydney Kingsford Smith (SYD)", "Los Angeles (LAX)", homeZones));
    const applied = await applyPermittedChangeRequest(pool, twoCity.session, twoCity.tripId, home.id);
    const stored = await pool.query("SELECT ends_at FROM itinerary_items WHERE trip_id = $1 AND id = $2", [twoCity.tripId, applied.entityId]);
    assert.equal(stored.rows[0].ends_at.toISOString(), "2031-12-06T14:15:00.000Z");
    // A later landing in Los Angeles the same day is an update that stays inside; landing the next day is outside.
    const delayed = await createChangeRequest(pool, twoCity.session, twoCity.tripId, { entityType: "itinerary_item",
      entityId: applied.entityId, operation: "update", baseRevision: 1, reason: "Synthetic delay", patch: { endsAt: "2031-12-07T07:45:00.000Z" } });
    await applyPermittedChangeRequest(pool, twoCity.session, twoCity.tripId, delayed.id);
    await assert.rejects(createChangeRequest(pool, twoCity.session, twoCity.tripId, { entityType: "itinerary_item",
      entityId: applied.entityId, operation: "update", baseRevision: 2, reason: "Synthetic next day", patch: { endsAt: "2031-12-07T08:30:00.000Z" } }),
    outsideTrip);
    await assert.rejects(create(twoCity, flight(twoCity.dayId("2031-12-06"), "ZZ703", "2031-12-05T23:30:00.000Z",
      "2031-12-07T16:00:00.000Z", "Sydney Kingsford Smith (SYD)", "Los Angeles (LAX)", homeZones)), outsideTrip);
    // The airport codes alone give the arrival clock.
    const byCode = await create(twoCity, flight(twoCity.dayId("2031-12-06"), "ZZ704", "2031-12-06T00:30:00.000Z",
      "2031-12-06T15:15:00.000Z", "Sydney Kingsford Smith (SYD)", "Los Angeles (LAX)", {}));
    // A pending flight keeps the rule through an edit and through approval.
    await updatePendingItineraryRequest(pool, twoCity.session, twoCity.tripId, byCode.id,
      { proposalRevision: 1, patch: { endsAt: "2031-12-06T16:15:00.000Z" } });
    await assert.rejects(updatePendingItineraryRequest(pool, twoCity.session, twoCity.tripId, byCode.id,
      { proposalRevision: 2, patch: { endsAt: "2031-12-07T08:30:00.000Z" } }), outsideTrip);
    await applyPermittedChangeRequest(pool, twoCity.session, twoCity.tripId, byCode.id);
    // An event with no place of its own still closes at midnight on the last day's clock.
    await assert.rejects(create(twoCity, { tripDayId: twoCity.dayId("2031-12-06"), title: "Synthetic late snack", itemType: "meal",
      startsAt: "2031-12-06T12:00:00.000Z", endsAt: "2031-12-06T13:30:00.000Z", locationName: "Synthetic stall",
      visibility: "trip", viewerMemberIds: [] }), outsideTrip);

    // One destination: the same flight home lands inside the trip too.
    const oneCity = await open({ name: "Synthetic Sydney", destinationName: "Sydney", timeZone: "Australia/Sydney", defaultLocale: "en",
      defaultCurrency: "AUD", startsOn: "2031-11-29", endsOn: "2031-12-06", maxMembers: 4 });
    const single = await create(oneCity, flight(oneCity.dayId("2031-12-06"), "ZZ705", "2031-12-05T23:30:00.000Z",
      "2031-12-06T14:15:00.000Z", "Sydney Kingsford Smith (SYD)", "Los Angeles (LAX)", homeZones));
    await applyPermittedChangeRequest(pool, oneCity.session, oneCity.tripId, single.id);
    await assert.rejects(create(oneCity, flight(oneCity.dayId("2031-12-06"), "ZZ706", "2031-12-05T23:30:00.000Z",
      "2031-12-07T16:00:00.000Z", "Sydney Kingsford Smith (SYD)", "Los Angeles (LAX)", homeZones)), outsideTrip);
    const count = await pool.query("SELECT count(*)::int AS n FROM itinerary_items WHERE trip_id = ANY($1)", [[twoCity.tripId, oneCity.tripId]]);
    assert.equal(count.rows[0].n, 4);
  } finally {
    if (previousSignup === undefined) delete process.env.PUBLIC_SIGNUP_ENABLED;
    else process.env.PUBLIC_SIGNUP_ENABLED = previousSignup;
  }
}
