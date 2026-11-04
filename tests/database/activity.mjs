import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  inTransaction, applyPermittedChangeRequest, createChangeRequest,
  reviewChangeRequest, removeCancelledItineraryItem,
} from "../../src/lib/app/repository.ts";
import { loadActivityEntries } from "../../src/lib/app/activity-repository.ts";

/** Unrelated Activity privacy coverage retained after preference retirement. */
export async function testActivityPrivacy(pool, baseSession) {
  const tripId = randomUUID(), foreignTripId = randomUUID(), dayId = randomUUID();
  const actor = (role) => ({ ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role });
  const owner = actor("owner"), editor = actor("editor"), other = actor("editor");
  const foreign = { ...actor("owner"), tripId: foreignTripId };
  for (const member of [owner, editor, other, foreign]) {
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic preference traveler')", [member.userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES('https://accounts.google.com',$1,$2,$3)",
      [`synthetic-preferences-${member.userId}`, member.userId, `${member.userId}@example.test`]);
  }
  for (const member of [owner, foreign]) {
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic preferences and Activity','Asia/Tokyo','JPY','2030-04-01','2030-04-02')`, [member.tripId, member.userId]);
  }
  for (const member of [owner, editor, other, foreign]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic preference traveler',$4,'active')`, [member.tripId, member.memberId, member.userId, member.role]);
  }
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')", [tripId, dayId]);
  await pool.query(`INSERT INTO member_permissions(trip_id,member_id,can_edit_itinerary,itinerary_requires_approval,
    can_edit_expenses,expense_requires_approval,updated_by_member_id) VALUES($1,$2,true,false,true,false,$3)`,
  [tripId, editor.memberId, owner.memberId]);
  await testCurrentActivityPrivacy(pool, { tripId, dayId, owner, editor, other, foreign });
}

async function testCurrentActivityPrivacy(pool, { tripId, dayId, owner, editor, other, foreign }) {
  const patch = { tripDayId: dayId, title: "Synthetic current public event", itemType: "activity", startsAt: "2030-04-01T01:00:00.000Z",
    endsAt: "2030-04-01T02:00:00.000Z", locationName: "Synthetic museum", visibility: "trip", viewerMemberIds: [] };
  const create = (actor, change) => createChangeRequest(pool, actor, tripId, { entityType: "itinerary_item", operation: "create",
    source: actor.role === "owner" ? "owner" : "member", reason: "Synthetic Activity privacy", patch: { ...patch, ...change } });
  const canonical = async (actor, change) => {
    const request = await create(actor, change);
    return applyPermittedChangeRequest(pool, actor, tripId, request.id);
  };
  const audit = async (entityType, entityId, action = "updated") => {
    const id = randomUUID();
    await pool.query(`INSERT INTO audit_events(trip_id,id,actor_member_id,entity_type,entity_id,action,before_state,after_state,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`, [tripId, id, editor.memberId, entityType, entityId, action,
      JSON.stringify({ title: "Historical secret value", notes: "Historical confidential note", amountMinor: 1 }),
      JSON.stringify({ title: "Another historical secret", notes: "Still confidential", amountMinor: 2, credential: "Never expose" }),
      JSON.stringify({ secret: "Never expose audit metadata" })]);
    return id;
  };
  const one = (session, id) => loadActivityEntries(pool, session, { activityId: id });
  const publicItem = await canonical(owner);
  const publicAudit = await audit("itinerary_item", publicItem.entityId);
  const visible = (await one(owner, publicAudit))[0];
  assert.deepEqual(visible.target, { kind: "itinerary", id: publicItem.entityId });
  assert.equal(visible.title, patch.title);
  assert.deepEqual(new Set(visible.changedFields), new Set(["title", "notes", "amount"]));
  assert.equal(JSON.stringify(visible).includes("Historical"), false);
  assert.equal(JSON.stringify(visible).includes("Never expose"), false);
  assert.deepEqual(await one(editor, publicAudit), []);
  assert.deepEqual(await one({ ...owner, userId: other.userId }, publicAudit), []);
  assert.deepEqual(await one(foreign, publicAudit), []);
  const privateItem = await canonical(editor, { title: "Synthetic private member event", visibility: "private", viewerMemberIds: [] });
  const privateAudit = await audit("itinerary_item", privateItem.entityId);
  assert.deepEqual(await one(owner, privateAudit), [], "An owner's Activity feed cannot reveal a member's private canonical event");
  const sharedItem = await canonical(editor, { title: "Synthetic shared member event", visibility: "private", viewerMemberIds: [owner.memberId] });
  const sharedAudit = await audit("itinerary_item", sharedItem.entityId);
  assert.equal((await one(owner, sharedAudit))[0].target.id, sharedItem.entityId);
  // The link is re-evaluated against current viewers, never the historical audit snapshot.
  await pool.query("DELETE FROM itinerary_item_viewers WHERE trip_id=$1 AND itinerary_item_id=$2 AND member_id=$3", [tripId, sharedItem.entityId, owner.memberId]);
  assert.deepEqual(await one(owner, sharedAudit), []);

  const pending = await create(editor, { title: "Synthetic private pending review", visibility: "private", viewerMemberIds: [] });
  const requestAudit = await audit("change_request", pending.id, "requested");
  assert.deepEqual((await one(owner, requestAudit))[0].target, { kind: "request", id: pending.id });
  assert.equal((await one(owner, requestAudit))[0].status, "pending");
  await reviewChangeRequest(pool, owner, tripId, pending.id, "approve", "Synthetic private review", 1);
  assert.equal((await one(owner, requestAudit))[0].target.kind, "request", "Review permission must not become a canonical private-event link");
  const appliedPrivate = (await pool.query("SELECT entity_id FROM change_requests WHERE trip_id=$1 AND id=$2", [tripId, pending.id])).rows[0].entity_id;
  assert.deepEqual(await one(owner, await audit("itinerary_item", appliedPrivate)), []);

  const expenseRequest = await createChangeRequest(pool, editor, tripId, { entityType: "expense", operation: "create", source: "member", reason: "Synthetic Activity expense",
    patch: { description: "Synthetic current expense", amountMinor: 101, currency: "JPY", payerMemberId: editor.memberId,
      splitMemberIds: [editor.memberId, owner.memberId], occurredAt: patch.startsAt, status: "posted" } });
  const expense = await applyPermittedChangeRequest(pool, editor, tripId, expenseRequest.id);
  const expenseAudit = await audit("expense", expense.entityId);
  const expenseEntry = (await one(owner, expenseAudit))[0];
  assert.deepEqual(expenseEntry.target, { kind: "expense", id: expense.entityId });
  assert.deepEqual(expenseEntry.amount, { amountMinor: 101, currency: "JPY" });
  const privateExpenseRequest = await createChangeRequest(pool, editor, tripId, { entityType: "expense", operation: "create", source: "member", reason: "Synthetic private Activity expense",
    patch: { description: "Synthetic private linked expense", amountMinor: 50, currency: "JPY", payerMemberId: editor.memberId,
      splitMemberIds: [editor.memberId], itineraryItemId: privateItem.entityId, occurredAt: patch.startsAt, status: "posted" } });
  const privateExpense = await applyPermittedChangeRequest(pool, editor, tripId, privateExpenseRequest.id);
  assert.deepEqual(await one(owner, await audit("expense", privateExpense.entityId)), []);

  const cancelled = await canonical(owner, { title: "Synthetic removed Activity event", status: "cancelled" });
  const removedAudit = await audit("itinerary_item", cancelled.entityId, "removed");
  await removeCancelledItineraryItem(pool, owner, tripId, cancelled.entityId, { expectedRevision: cancelled.revision, confirm: true });
  const removed = (await one(owner, removedAudit))[0];
  assert.equal(removed.targetState, "removed");
  assert.equal(removed.target, null);
  assert.equal(removed.title, null);
  assert.equal(removed.startsAt, null);
  assert.deepEqual(removed.changedFields, []);
  assert.deepEqual(await one(owner, await audit("itinerary_item", randomUUID())), []);
  assert.deepEqual(await one(owner, await audit("expense", randomUUID())), []);
  const foreignEvent = await audit("itinerary_item", foreign.memberId);
  assert.deepEqual(await one(owner, foreignEvent), []);
  await inTransaction(pool, async (client) => {
    await client.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [tripId, owner.memberId]);
    assert.deepEqual(await loadActivityEntries(client, owner), []);
    await client.query("UPDATE trip_members SET status='active',role='editor' WHERE trip_id=$1 AND id=$2", [tripId, owner.memberId]);
    assert.deepEqual(await loadActivityEntries(client, owner), []);
    await client.query("UPDATE trip_members SET role='owner' WHERE trip_id=$1 AND id=$2", [tripId, owner.memberId]);
  });
}
