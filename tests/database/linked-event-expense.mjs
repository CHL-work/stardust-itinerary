import assert from "node:assert/strict";
import {
  AppConflictError,
  AppForbiddenError,
  AppNotFoundError,
  applyPermittedChangeRequest,
  createChangeRequest,
  getPendingItineraryRequestForEdit,
  reviewChangeRequest,
  updatePendingItineraryRequest,
} from "../../src/lib/app/repository.ts";

const id = (group, number) => `eb${group}0000-0000-4000-8000-${String(number).padStart(12, "0")}`;

/** Synthetic fixtures only; the parent owns the guarded disposable database and migrations. */
export async function testLinkedEventExpense(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(databaseName, /^stardust_test_[a-z0-9_]+$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, databaseName);

  const tripId = id("10", 1), foreignTripId = id("10", 2), dayId = id("30", 1);
  const owner = { ...baseSession, tripId, memberId: id("20", 1), userId: id("00", 1), role: "owner" };
  const editor = { ...owner, memberId: id("20", 2), userId: id("00", 2), role: "editor" };
  const creator = { ...editor, memberId: id("20", 3), userId: id("00", 3) };
  const outsider = { ...editor, memberId: id("20", 4), userId: id("00", 4) };
  const removed = { ...editor, memberId: id("20", 5), userId: id("00", 5) };
  const staleParticipant = { ...editor, memberId: id("20", 6), userId: id("00", 6) };
  const foreign = { ...editor, tripId: foreignTripId, memberId: id("20", 7) };
  for (const actor of [owner, editor, creator, outsider, removed, staleParticipant]) {
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic linked expense user')", [actor.userId]);
  }
  for (const currentTrip of [tripId, foreignTripId]) {
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic linked expense trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`, [currentTrip, owner.userId]);
  }
  for (const actor of [owner, editor, creator, outsider, removed, staleParticipant, foreign]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic linked expense member',$4,$5)`,
    [actor.tripId, actor.memberId, actor.userId, actor.role, actor === removed ? "removed" : "active"]);
  }
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')", [tripId, dayId]);
  for (const actor of [editor, creator, outsider]) {
    await pool.query(`INSERT INTO member_permissions(trip_id,member_id,can_edit_itinerary,itinerary_requires_approval,
      can_edit_expenses,expense_requires_approval,updated_by_member_id) VALUES($1,$2,true,false,true,false,$3)`,
    [tripId, actor.memberId, owner.memberId]);
  }

  const eventPatch = {
    tripDayId: dayId, title: "Synthetic linked expense event", itemType: "meal",
    startsAt: "2030-04-01T10:00:00.000Z", endsAt: "2030-04-01T11:00:00.000Z",
    locationName: "Synthetic restaurant", notes: "Preserve synthetic original notes",
    visibility: "trip", viewerMemberIds: [],
  };
  const expense = (payer, participants, description) => ({
    description, amountMinor: 101, currency: "JPY", payerMemberId: payer.memberId,
    splitMemberIds: participants.map((actor) => actor.memberId),
    occurredAt: "2030-04-01T10:00:00.000Z", status: "posted",
  });
  const create = (actor, patch = {}, options = {}) => createChangeRequest(pool, actor, tripId, {
    entityType: "itinerary_item", operation: "create", source: actor.role === "owner" ? "owner" : "member",
    reason: "Synthetic linked expense regression", patch: { ...eventPatch, ...patch }, ...options,
  });
  const createCanonical = async (actor, patch) => {
    const request = await create(actor, patch);
    return applyPermittedChangeRequest(pool, actor, tripId, request.id);
  };
  const update = (actor, item, patch) => create(actor, {}, {
    operation: "update", entityId: item.entityId, baseRevision: item.revision, patch,
  });
  const edit = (actor, request, patch, proposalRevision = 1) => updatePendingItineraryRequest(
    pool, actor, tripId, request.id, { proposalRevision, patch },
  );
  const canonicalTables = ["itinerary_items", "itinerary_item_viewers", "itinerary_revisions", "expenses", "expense_splits", "expense_revisions"];
  async function snapshot(tables = [...canonicalTables, "change_requests", "audit_events"]) {
    const state = {};
    // Fixed table allowlist; every snapshot is restricted to this small synthetic trip.
    for (const table of tables) {
      state[table] = (await pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(state) ORDER BY to_jsonb(state)::text), '[]'::jsonb) AS rows
        FROM ${table} state WHERE trip_id=$1`, [tripId])).rows[0].rows;
    }
    return state;
  }
  async function rejectsUnchanged(run, expectedError) {
    const before = await snapshot();
    await assert.rejects(run, expectedError);
    assert.deepEqual(await snapshot(), before);
  }
  async function assertLinked(request, applied, originalCreator, audience, charge, actor, expectedSplits) {
    const item = (await pool.query(`SELECT created_by_member_id,visibility,current_revision,notes
      FROM itinerary_items WHERE trip_id=$1 AND id=$2`, [tripId, applied.entityId])).rows[0];
    assert.deepEqual(item, {
      created_by_member_id: originalCreator.memberId, visibility: audience === null ? "trip" : "private",
      current_revision: applied.revision, notes: eventPatch.notes,
    });
    assert.deepEqual((await pool.query(`SELECT member_id FROM itinerary_item_viewers
      WHERE trip_id=$1 AND itinerary_item_id=$2 ORDER BY member_id`, [tripId, applied.entityId])).rows.map((row) => row.member_id),
    (audience ?? []).map((member) => member.memberId).sort());
    const rows = (await pool.query(`SELECT id,itinerary_item_id,description,amount_minor::text,currency,
      payer_member_id,current_revision,status,occurred_at FROM expenses WHERE trip_id=$1 AND itinerary_item_id=$2`,
    [tripId, applied.entityId])).rows;
    assert.equal(rows.length, 1);
    const bill = rows[0];
    assert.deepEqual({ ...bill, occurred_at: bill.occurred_at.toISOString() }, {
      id: bill.id, itinerary_item_id: applied.entityId, description: charge.description, amount_minor: "101",
      currency: "JPY", payer_member_id: charge.payerMemberId, current_revision: 1,
      status: "posted", occurred_at: charge.occurredAt,
    });
    const splits = expectedSplits.map(([member, share]) => ({ memberId: member.memberId, shareMinor: share }));
    assert.equal(splits.reduce((sum, split) => sum + split.shareMinor, 0), 101);
    assert.deepEqual((await pool.query(`SELECT member_id AS "memberId",share_minor::int AS "shareMinor"
      FROM expense_splits WHERE trip_id=$1 AND expense_id=$2 ORDER BY member_id`, [tripId, bill.id])).rows,
    [...splits].sort((left, right) => left.memberId.localeCompare(right.memberId)));
    const expenseRevision = (await pool.query(`SELECT revision,changed_by_member_id,snapshot FROM expense_revisions
      WHERE trip_id=$1 AND expense_id=$2 ORDER BY revision`, [tripId, bill.id])).rows;
    assert.equal(expenseRevision.length, 1);
    assert.equal(expenseRevision[0].revision, 1);
    assert.equal(expenseRevision[0].changed_by_member_id, actor.memberId);
    assert.equal(expenseRevision[0].snapshot.itineraryItemId, applied.entityId);
    assert.deepEqual(expenseRevision[0].snapshot.splits, splits);
    const itemRevisions = (await pool.query(`SELECT revision,snapshot FROM itinerary_revisions
      WHERE trip_id=$1 AND itinerary_item_id=$2 ORDER BY revision`, [tripId, applied.entityId])).rows;
    assert.equal(itemRevisions.length, applied.revision);
    assert.equal(itemRevisions.at(-1).snapshot.createdByMemberId, originalCreator.memberId);
    const savedRequest = (await pool.query(`SELECT status,entity_id,applied_revision,requested_by_member_id
      FROM change_requests WHERE trip_id=$1 AND id=$2`, [tripId, request.id])).rows[0];
    assert.equal(savedRequest.status, "approved");
    assert.equal(savedRequest.entity_id, applied.entityId);
    assert.equal(savedRequest.applied_revision, applied.revision);
    const audit = (await pool.query(`SELECT actor_member_id,before_state,after_state,metadata FROM audit_events
      WHERE trip_id=$1 AND entity_type='expense' AND entity_id=$2 AND action='created'`, [tripId, bill.id])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_member_id, actor.memberId);
    assert.equal(audit[0].before_state, null);
    assert.deepEqual(audit[0].after_state, expenseRevision[0].snapshot);
    assert.deepEqual(audit[0].metadata, {
      changeRequestId: request.id, requestedByMemberId: savedRequest.requested_by_member_id,
      linkedItineraryItemId: applied.entityId, source: "itinerary_editor",
    });
    assert.equal((await pool.query(`SELECT count(*)::int AS total FROM audit_events
      WHERE trip_id=$1 AND entity_type='itinerary_item' AND entity_id=$2 AND metadata->>'changeRequestId'=$3`,
    [tripId, applied.entityId, request.id])).rows[0].total, 1);
    await rejectsUnchanged(() => applyPermittedChangeRequest(pool, actor, tripId, request.id), AppConflictError);
  }

  // Existing private event: both creator-owner and selected editor can add a bill.
  for (const actor of [owner, editor]) {
    const item = await createCanonical(owner, { visibility: "private", viewerMemberIds: [editor.memberId] });
    const charge = expense(owner, [owner, editor], `Synthetic private ${actor.role} bill`);
    const request = await update(actor, item, { linkedExpense: charge });
    const applied = await applyPermittedChangeRequest(pool, actor, tripId, request.id);
    assert.equal(applied.entityId, item.entityId);
    assert.equal(applied.revision, 2);
    await assertLinked(request, applied, owner, [editor], charge, actor, [[owner, 51], [editor, 50]]);
  }

  // A public event permits eligible trip members who were not private viewers.
  const publicItem = await createCanonical(creator, {});
  const publicCharge = expense(outsider, [outsider, editor, creator], "Synthetic public bill");
  const publicRequest = await update(editor, publicItem, { linkedExpense: publicCharge });
  const publicApplied = await applyPermittedChangeRequest(pool, editor, tripId, publicRequest.id);
  await assertLinked(publicRequest, publicApplied, creator, null, publicCharge, editor,
    [[outsider, 34], [editor, 34], [creator, 33]]);

  // An owner editing a private pending create is a reviewer, not its creator/viewer.
  const pendingCreate = await create(editor, { visibility: "private", viewerMemberIds: [creator.memberId] });
  const pendingCreateCharge = expense(editor, [editor, creator], "Synthetic pending-create bill");
  const beforeCreateEdit = await snapshot(canonicalTables);
  const editedCreate = await edit(owner, pendingCreate, { linkedExpense: pendingCreateCharge });
  assert.equal(editedCreate.createdByMemberId, editor.memberId);
  assert.equal(editedCreate.requestedByMemberId, editor.memberId);
  assert.equal(editedCreate.proposalRevision, 2);
  assert.deepEqual(editedCreate.patch.linkedExpense, pendingCreateCharge);
  assert.deepEqual(await snapshot(canonicalTables), beforeCreateEdit);
  await rejectsUnchanged(() => applyPermittedChangeRequest(pool, editor, tripId, pendingCreate.id), AppForbiddenError);
  await rejectsUnchanged(() => reviewChangeRequest(pool, owner, tripId, pendingCreate.id, "approve", undefined, 1), AppConflictError);
  const approvedCreate = await reviewChangeRequest(pool, owner, tripId, pendingCreate.id, "approve", "Synthetic explicit review", 2);
  await assertLinked(pendingCreate, approvedCreate, editor, [creator], pendingCreateCharge, owner, [[editor, 51], [creator, 50]]);

  // Pending update: requester differs from the immutable canonical creator.
  const privateItem = await createCanonical(creator, { visibility: "private", viewerMemberIds: [editor.memberId] });
  const pendingUpdate = await update(editor, privateItem, { title: "Synthetic proposed correction" });
  const detail = await getPendingItineraryRequestForEdit(pool, owner, tripId, pendingUpdate.id);
  assert.equal(detail.createdByMemberId, creator.memberId);
  assert.equal(detail.requestedByMemberId, editor.memberId);
  const pendingUpdateCharge = expense(creator, [creator, editor], "Synthetic pending-update bill");
  const beforeUpdateEdit = await snapshot(canonicalTables);
  const editedUpdate = await edit(owner, pendingUpdate, { linkedExpense: pendingUpdateCharge });
  assert.equal(editedUpdate.createdByMemberId, creator.memberId);
  assert.equal(editedUpdate.requestedByMemberId, editor.memberId);
  assert.equal(editedUpdate.targetItemId, privateItem.entityId);
  assert.deepEqual(editedUpdate.patch.viewerMemberIds, [editor.memberId]);
  assert.deepEqual(await snapshot(canonicalTables), beforeUpdateEdit);
  const proposalAudit = (await pool.query(`SELECT before_state,after_state,metadata FROM audit_events
    WHERE trip_id=$1 AND entity_id=$2 AND action='proposal_updated'`, [tripId, pendingUpdate.id])).rows;
  assert.equal(proposalAudit.length, 1);
  assert.equal(proposalAudit[0].before_state.proposalRevision, 1);
  assert.equal(proposalAudit[0].after_state.proposalRevision, 2);
  assert.deepEqual(proposalAudit[0].after_state.patch.linkedExpense, pendingUpdateCharge);
  assert.deepEqual(proposalAudit[0].metadata, { requestedByMemberId: editor.memberId, source: "member" });
  await rejectsUnchanged(() => applyPermittedChangeRequest(pool, editor, tripId, pendingUpdate.id), AppForbiddenError);
  const approvedUpdate = await reviewChangeRequest(pool, owner, tripId, pendingUpdate.id, "approve", "Synthetic explicit review", 2);
  assert.equal(approvedUpdate.entityId, privateItem.entityId);
  assert.equal(approvedUpdate.revision, 2);
  await assertLinked(pendingUpdate, approvedUpdate, creator, [editor], pendingUpdateCharge, owner, [[creator, 51], [editor, 50]]);
  assert.equal((await pool.query("SELECT app_member_can_view_itinerary_item($1,$2,$3) AS visible",
    [tripId, privateItem.entityId, owner.memberId])).rows[0].visible, false);

  // The same requester may directly apply their own manual pending edit when both policies allow it.
  const selfEditedItem = await createCanonical(owner, { visibility: "private", viewerMemberIds: [editor.memberId] });
  const selfEditedRequest = await update(editor, selfEditedItem, { title: "Synthetic self-edited pending update" });
  const selfEditedCharge = expense(owner, [owner, editor], "Synthetic self-edited pending bill");
  const selfEditedDetail = await edit(editor, selfEditedRequest, { linkedExpense: selfEditedCharge });
  assert.equal(selfEditedDetail.createdByMemberId, owner.memberId);
  assert.equal(selfEditedDetail.requestedByMemberId, editor.memberId);
  const selfEditedApplied = await applyPermittedChangeRequest(pool, editor, tripId, selfEditedRequest.id);
  assert.equal(selfEditedApplied.entityId, selfEditedItem.entityId);
  await assertLinked(selfEditedRequest, selfEditedApplied, owner, [editor], selfEditedCharge, editor, [[owner, 51], [editor, 50]]);

  // Financial approval policy still gates a self-edited draft's direct apply.
  await pool.query(`UPDATE member_permissions SET expense_requires_approval=true WHERE trip_id=$1 AND member_id=$2`, [tripId, editor.memberId]);
  const policyRequest = await create(editor);
  const policyCharge = expense(editor, [editor, owner], "Synthetic review-required bill");
  await edit(editor, policyRequest, { linkedExpense: policyCharge });
  await rejectsUnchanged(() => applyPermittedChangeRequest(pool, editor, tripId, policyRequest.id), AppForbiddenError);
  const policyApplied = await reviewChangeRequest(pool, owner, tripId, policyRequest.id, "approve", "Synthetic financial review", 2);
  await assertLinked(policyRequest, policyApplied, editor, null, policyCharge, owner, [[editor, 51], [owner, 50]]);
  await pool.query(`UPDATE member_permissions SET expense_requires_approval=false WHERE trip_id=$1 AND member_id=$2`, [tripId, editor.memberId]);

  // Hidden, cross-trip and removed selections fail before persisting any partial change.
  const guardedItem = await createCanonical(owner, { visibility: "private", viewerMemberIds: [editor.memberId] });
  const guardedDraft = await create(owner, { visibility: "private", viewerMemberIds: [editor.memberId] });
  for (const [participant, ErrorClass] of [[outsider, AppForbiddenError], [foreign, AppNotFoundError], [removed, AppNotFoundError]]) {
    for (const charge of [
      expense(participant, [owner, editor], "Synthetic invalid payer"),
      expense(owner, [owner, participant], "Synthetic invalid split"),
    ]) {
      await rejectsUnchanged(() => update(owner, guardedItem, { linkedExpense: charge }), ErrorClass);
      await rejectsUnchanged(() => edit(owner, guardedDraft, { linkedExpense: charge }), ErrorClass);
    }
  }
  await rejectsUnchanged(() => update(outsider, guardedItem, { linkedExpense: expense(outsider, [outsider], "Synthetic hidden event attempt") }), AppNotFoundError);
  await rejectsUnchanged(() => edit(outsider, guardedDraft, { linkedExpense: expense(outsider, [outsider], "Synthetic hidden draft attempt") }), AppNotFoundError);

  // A member removed after submission cannot be applied by review or direct permission.
  const staleCharge = expense(staleParticipant, [editor, staleParticipant], "Synthetic stale participant bill");
  const staleCreate = await create(editor, { linkedExpense: staleCharge });
  const staleItem = await createCanonical(editor, {});
  const staleUpdate = await update(editor, staleItem, { linkedExpense: staleCharge });
  await pool.query("UPDATE trip_members SET status='removed' WHERE trip_id=$1 AND id=$2", [tripId, staleParticipant.memberId]);
  for (const request of [staleCreate, staleUpdate]) {
    await rejectsUnchanged(() => applyPermittedChangeRequest(pool, editor, tripId, request.id), AppNotFoundError);
    await rejectsUnchanged(() => reviewChangeRequest(pool, owner, tripId, request.id, "approve", undefined, 1), AppNotFoundError);
    await rejectsUnchanged(() => edit(editor, request, { title: "Synthetic stale participant edit" }), AppNotFoundError);
  }
}
