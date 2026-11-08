import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { insertSession, verifySession } from "../../src/lib/auth/repository.ts";
import { createChangeRequest, applyPermittedChangeRequest, getAppOverview, getPendingItineraryRequestForEdit,
  updatePendingItineraryRequest, reviewChangeRequest } from "../../src/lib/app/repository.ts";

/** Synthetic-only end-to-end JSON, revision, proposal and privacy checks at migration head. */
export async function testEventTimeZones(pool, connectionString) {
  await migrate({ connectionString, through: "0067_event_time_zones.sql" });
  const config = { authSecret: "synthetic-event-zones-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const tripId = randomUUID(), dayId = randomUUID(), ownerId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic zone owner')", [ownerId]);
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic two-zone trip','America/Chicago','USD','2031-04-01','2031-04-03')`, [tripId, ownerId]);
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2031-04-01')", [tripId, dayId]);
  const sessionFor = async (role, userId = randomUUID()) => {
    const memberId = randomUUID();
    if (userId !== ownerId) await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic zone member')", [userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES('https://accounts.google.com',$1,$2,$3)",
      [`synthetic-${randomUUID()}`, userId, `${memberId}@example.test`]);
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic zone member',$4,'active')",
      [tripId, memberId, userId, role]);
    const client = await pool.connect();
    try {
      const grant = await insertSession(client, config, { tripId, memberId, userId, role,
        absoluteExpiresAt: new Date(Date.now() + 86_400_000), userAgent: null });
      return await verifySession(pool, config, grant.rawToken);
    } finally { client.release(); }
  };
  const owner = await sessionFor("owner", ownerId), editor = await sessionFor("editor"), outsider = await sessionFor("viewer");
  const create = await createChangeRequest(pool, owner, tripId, {
    entityType: "itinerary_item", operation: "create", reason: "Synthetic local hotel",
    patch: { tripDayId: dayId, title: "Synthetic hotel check-in", itemType: "lodging", locationName: "Synthetic hotel, Salt Lake City",
      startsAt: "2031-04-01T21:00:00Z", endsAt: "2031-04-02T17:00:00Z", timeZones: { start: "America/Denver" } },
  });
  const created = await applyPermittedChangeRequest(pool, owner, tripId, create.id);
  const record = async () => (await pool.query("SELECT starts_at, ends_at, time_zones, current_revision FROM itinerary_items WHERE trip_id=$1 AND id=$2", [tripId, created.entityId])).rows[0];
  const initial = await record();
  assert.deepEqual(initial.time_zones, { start: "America/Denver" });
  assert.deepEqual((await getAppOverview(pool, editor)).itinerary.find(item => item.id === created.entityId).timeZones, initial.time_zones);
  const revision = (await pool.query("SELECT snapshot FROM itinerary_revisions WHERE trip_id=$1 AND itinerary_item_id=$2 AND revision=1", [tripId, created.entityId])).rows[0].snapshot;
  assert.deepEqual(revision.timeZones, initial.time_zones);
  const proposal = await createChangeRequest(pool, editor, tripId, { entityType: "itinerary_item", entityId: created.entityId,
    operation: "update", baseRevision: 1, reason: "Synthetic zone correction", patch: { timeZones: { start: "America/Chicago" } } });
  const visible = (await getAppOverview(pool, outsider)).pendingItinerary.find(item => item.requestId === proposal.id);
  assert.deepEqual(visible.timeZones, { start: "America/Chicago" });
  assert.deepEqual(await record(), initial, "pending correction must not retime or rewrite canonical data");
  const pending = await getPendingItineraryRequestForEdit(pool, editor, tripId, proposal.id);
  assert.deepEqual(pending.patch.timeZones, { start: "America/Chicago" });
  const edited = await updatePendingItineraryRequest(pool, editor, tripId, proposal.id, { proposalRevision: 1,
    patch: { timeZones: { start: "America/Denver" }, title: "Synthetic hotel amended" } });
  assert.equal(edited.proposalRevision, 2);
  await assert.rejects(reviewChangeRequest(pool, owner, tripId, proposal.id, "approve", undefined, 1));
  await assert.rejects(reviewChangeRequest(pool, editor, tripId, proposal.id, "approve", undefined, 2));
  await reviewChangeRequest(pool, owner, tripId, proposal.id, "approve", undefined, 2);
  const updated = await record();
  assert.equal(updated.current_revision, 2);
  assert.deepEqual(updated.starts_at, initial.starts_at);
  assert.deepEqual(updated.ends_at, initial.ends_at);
  assert.deepEqual(updated.time_zones, initial.time_zones);
  const sparse = await createChangeRequest(pool, owner, tripId, { entityType: "itinerary_item", entityId: created.entityId,
    operation: "update", baseRevision: 2, reason: "Unrelated change", patch: { notes: "Synthetic unrelated note" } });
  await applyPermittedChangeRequest(pool, owner, tripId, sparse.id);
  assert.deepEqual((await record()).time_zones, initial.time_zones);
  const moved = await createChangeRequest(pool, owner, tripId, { entityType: "itinerary_item", entityId: created.entityId,
    operation: "update", baseRevision: 3, reason: "Different venue", patch: { locationName: "Synthetic hotel, Dallas" } });
  await applyPermittedChangeRequest(pool, owner, tripId, moved.id);
  assert.equal((await record()).time_zones, null, "moving the venue clears the stale explicit zone, without changing instants");
  assert.deepEqual((await record()).starts_at, initial.starts_at);
  const privateRequest = await createChangeRequest(pool, editor, tripId, { entityType: "itinerary_item", operation: "create",
    reason: "Synthetic private meal", patch: { tripDayId: dayId, title: "Synthetic private meal", itemType: "meal", visibility: "private",
      viewerMemberIds: [], startsAt: "2031-04-01T23:00:00Z", locationName: "Synthetic kitchen, Salt Lake City", timeZones: { start: "America/Denver" } } });
  assert.equal((await getAppOverview(pool, outsider)).pendingItinerary.some(item => item.requestId === privateRequest.id), false);
  assert.deepEqual((await getAppOverview(pool, editor)).pendingItinerary.find(item => item.requestId === privateRequest.id).timeZones, { start: "America/Denver" });
  for (const timeZones of [{ start: "MST" }, { start: "Not/AZone" }, { start: "America/Denver", secret: "extra" }]) {
    await assert.rejects(updatePendingItineraryRequest(pool, editor, tripId, privateRequest.id, { proposalRevision: 1, patch: { timeZones } }));
  }
  for (const timeZones of [[], { start: 1 }, { hidden: "extra" }, { end: "x".repeat(81) }]) {
    await assert.rejects(pool.query("UPDATE itinerary_items SET time_zones=$3::jsonb WHERE trip_id=$1 AND id=$2", [tripId, created.entityId, JSON.stringify(timeZones)]), /itinerary_items_time_zones_ck/u);
  }
  const flightRequest = await createChangeRequest(pool, owner, tripId, { entityType: "itinerary_item", operation: "create",
    reason: "Synthetic legacy flight", patch: { tripDayId: dayId, title: "Synthetic flight", itemType: "transport",
      startsAt: "2031-04-01T18:00:00Z", endsAt: "2031-04-01T20:00:00Z", departureLocationName: "DFW", destinationLocationName: "SLC",
      flight: { flightNumber: "ZZ123", departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" } } });
  const flightCreated = await applyPermittedChangeRequest(pool, owner, tripId, flightRequest.id);
  const moveFlight = await createChangeRequest(pool, editor, tripId, { entityType: "itinerary_item", entityId: flightCreated.entityId,
    operation: "update", baseRevision: 1, reason: "Synthetic departure correction", patch: { departureLocationName: "JFK" } });
  const movedFlight = await getPendingItineraryRequestForEdit(pool, editor, tripId, moveFlight.id);
  assert.equal(movedFlight.patch.flight.departureTimeZone, null, "pending airport correction clears old flight clock");
  assert.equal(movedFlight.patch.flight.arrivalTimeZone, "America/Denver");
  await updatePendingItineraryRequest(pool, editor, tripId, moveFlight.id, { proposalRevision: 1,
    patch: { destinationLocationName: "LAX" } });
  const editedFlight = await getPendingItineraryRequestForEdit(pool, editor, tripId, moveFlight.id);
  assert.equal(editedFlight.patch.flight.arrivalTimeZone, null, "pending destination correction clears old flight clock");
  await reviewChangeRequest(pool, owner, tripId, moveFlight.id, "approve", undefined, 2);
  const canonicalFlight = (await getAppOverview(pool, owner)).itinerary.find(item => item.id === flightCreated.entityId);
  assert.equal(canonicalFlight.flight.departureTimeZone, null);
  assert.equal(canonicalFlight.flight.arrivalTimeZone, null);
  assert.equal(canonicalFlight.startsAt, "2031-04-01T18:00:00.000Z");
}
