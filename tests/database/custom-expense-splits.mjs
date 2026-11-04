import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AppConflictError, AppForbiddenError, AppNotFoundError,
  applyPermittedChangeRequest, createChangeRequest, getAppOverview,
  reviewChangeRequest, updateMemberPermissions, updatePendingItineraryRequest,
} from "../../src/lib/app/repository.ts";
import { createMemberPayment } from "../../src/lib/app/member-payments.ts";
import { getTripMemberRemovalPreview, removeTripMemberSafely } from "../../src/lib/app/member-removal.ts";

const sortShares = (shares) => [...shares].sort((a, b) => a.memberId.localeCompare(b.memberId));

/** Synthetic only. The caller owns migration setup and exact disposable database cleanup. */
export async function testCustomExpenseSplits(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(databaseName, /^stardust_test_[a-z0-9_]+$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, databaseName);
  for (const variable of ["DATABASE_URL", "DATABASE_DIRECT_URL"]) {
    if (process.env[variable]) {
      const configured = new URL(process.env[variable]);
      assert.notEqual(decodeURIComponent(configured.pathname.slice(1)), databaseName,
        "Custom split fixtures must not use any configured data-bearing database");
    }
  }
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, databaseName);

  const tripId = randomUUID(), foreignTripId = randomUUID(), dayId = randomUUID();
  const actor = (role) => ({ ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role });
  const owner = actor("owner"), editor = actor("editor"), reviewer = actor("editor"), outsider = actor("editor");
  const foreign = { ...actor("owner"), tripId: foreignTripId };
  for (const member of [owner, editor, reviewer, outsider, foreign]) {
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic exact-share user')", [member.userId]);
  }
  for (const [id, member] of [[tripId, owner], [foreignTripId, foreign]]) {
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic exact-share trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`, [id, member.userId]);
  }
  for (const member of [owner, editor, reviewer, outsider, foreign]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic exact-share member',$4,'active')`,
    [member.tripId, member.memberId, member.userId, member.role]);
  }
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')", [tripId, dayId]);
  for (const member of [editor, reviewer, outsider]) {
    await updateMemberPermissions(pool, owner, tripId, member.memberId, {
      canEditItinerary: true, itineraryRequiresApproval: false,
      canEditExpenses: true, expenseRequiresApproval: member === reviewer, canSyncCalendar: true,
    });
  }

  const participants = [owner, editor, reviewer];
  const amounts = (values, members = participants) => members.map((member, index) => ({ memberId: member.memberId, amountMinor: values[index] }));
  const expected = (values, members = participants) => amounts(values, members).map(({ memberId, amountMinor }) => ({ memberId, shareMinor: amountMinor }));
  const billPatch = (patch = {}) => ({
    description: "Synthetic exact-share bill", amountMinor: 101, currency: "JPY", payerMemberId: owner.memberId,
    splitMemberIds: participants.map((member) => member.memberId), splitAmounts: amounts([71, 30, 0]),
    occurredAt: "2030-04-01T10:00:00.000Z", status: "posted", ...patch,
  });
  const submit = (member, patch, options = {}) => createChangeRequest(pool, member, tripId, {
    entityType: "expense", operation: "create", source: member.role === "owner" ? "owner" : "member",
    reason: "Synthetic custom share regression", patch, ...options,
  });
  const update = (member, bill, patch) => submit(member, patch, {
    operation: "update", entityId: bill.entityId, baseRevision: bill.revision,
  });
  const apply = (member, request) => applyPermittedChangeRequest(pool, member, tripId, request.id);
  const review = (request, decision = "approve", revision = 1) => reviewChangeRequest(
    pool, owner, tripId, request.id, decision, "Synthetic explicit financial review", revision,
  );
  const eventPatch = {
    tripDayId: dayId, title: "Synthetic exact-share dinner", itemType: "meal",
    startsAt: "2030-04-01T10:00:00.000Z", endsAt: "2030-04-01T11:00:00.000Z",
    locationName: "Synthetic restaurant", visibility: "trip", viewerMemberIds: [],
  };
  const eventRequest = (member, patch = {}) => createChangeRequest(pool, member, tripId, {
    entityType: "itinerary_item", operation: "create", source: member.role === "owner" ? "owner" : "member",
    reason: "Synthetic linked custom share regression", patch: { ...eventPatch, ...patch },
  });
  const canonicalTables = ["expenses", "expense_splits", "expense_revisions", "itinerary_items", "itinerary_revisions", "itinerary_item_viewers"];
  async function snapshot(tables = [...canonicalTables, "change_requests", "audit_events", "member_payments", "member_payment_revisions", "member_payment_actions"]) {
    const state = {};
    // These fixed table names are not supplied by a request or model.
    for (const table of tables) {
      state[table] = (await pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows
        FROM ${table} r WHERE trip_id=$1`, [tripId])).rows[0].rows;
    }
    return state;
  }
  async function rejectsUnchanged(run, expectedError) {
    const before = await snapshot();
    await assert.rejects(run, expectedError);
    assert.deepEqual(await snapshot(), before, "invalid input must not leave canonical, proposal, revision, audit or payment writes");
  }
  async function assertBill(bill, shares, total = 101) {
    const row = (await pool.query("SELECT amount_minor::text,current_revision FROM expenses WHERE trip_id=$1 AND id=$2", [tripId, bill.entityId])).rows[0];
    assert.deepEqual(row, { amount_minor: String(total), current_revision: bill.revision });
    const actual = (await pool.query(`SELECT member_id AS "memberId",share_minor::text AS share
      FROM expense_splits WHERE trip_id=$1 AND expense_id=$2`, [tripId, bill.entityId])).rows
      .map(({ memberId, share }) => ({ memberId, shareMinor: Number(share) }));
    assert.deepEqual(sortShares(actual), sortShares(shares));
    assert.equal(actual.reduce((sum, share) => sum + BigInt(share.shareMinor), 0n), BigInt(total));
    const revisions = (await pool.query(`SELECT revision,snapshot FROM expense_revisions
      WHERE trip_id=$1 AND expense_id=$2 ORDER BY revision`, [tripId, bill.entityId])).rows;
    assert.equal(revisions.length, bill.revision);
    const latest = revisions.at(-1).snapshot;
    assert.equal(latest.amountMinor, total);
    assert.deepEqual(sortShares(latest.splits), sortShares(shares));
    const audits = (await pool.query(`SELECT after_state FROM audit_events WHERE trip_id=$1
      AND entity_type='expense' AND entity_id=$2 AND action IN ('created','update') ORDER BY created_at,id`,
    [tripId, bill.entityId])).rows;
    assert.equal(audits.length, bill.revision);
    assert.ok(audits.some((audit) => JSON.stringify(audit.after_state) === JSON.stringify(latest)), "exact saved shares must be audited");
  }

  // Owner and an allowed editor use the identical exact allocation path, including a zero participant.
  const ownerRequest = await submit(owner, billPatch());
  let ownerBill = await apply(owner, ownerRequest);
  await assertBill(ownerBill, expected([71, 30, 0]));
  const memberBill = await apply(editor, await submit(editor, billPatch({ payerMemberId: editor.memberId })));
  await assertBill(memberBill, expected([71, 30, 0]));
  const ownerOverview = await getAppOverview(pool, owner);
  assert.equal(ownerOverview.expenses.find((expense) => expense.id === memberBill.entityId).currentMemberShareMinor, 71);
  assert.equal((await getAppOverview(pool, reviewer)).expenses.find((expense) => expense.id === ownerBill.entityId).currentMemberShareMinor, 0);

  // Review-required custom bills project exact shares but do not count in the ledger before approval.
  const ledgerBeforePending = (await getAppOverview(pool, owner)).expenseLedger;
  const canonicalBeforePending = await snapshot(canonicalTables);
  const pending = await submit(reviewer, billPatch({ splitAmounts: amounts([9, 80, 12]) }));
  assert.deepEqual(await snapshot(canonicalTables), canonicalBeforePending);
  for (const member of participants) {
    const projection = (await getAppOverview(pool, member)).pendingExpenses.find((item) => item.requestId === pending.id);
    assert.ok(projection, "involved members must see the pending expense");
    assert.deepEqual(sortShares(projection.splits.map(({ memberId, shareMinor }) => ({ memberId, shareMinor }))), sortShares(expected([9, 80, 12])));
  }
  assert.deepEqual((await getAppOverview(pool, owner)).expenseLedger, ledgerBeforePending);
  await rejectsUnchanged(() => apply(reviewer, pending), AppForbiddenError);
  await review(pending, "reject");
  assert.deepEqual(await snapshot(canonicalTables), canonicalBeforePending);
  assert.equal((await getAppOverview(pool, reviewer)).pendingExpenses.some((item) => item.requestId === pending.id), false);
  const reviewedBill = await review(pending);
  await assertBill(reviewedBill, expected([9, 80, 12]));
  await rejectsUnchanged(() => review(pending, "reject"), AppConflictError);

  // Sparse edits retain allocations. An explicit custom map may use the saved participant set.
  const firstRevision = (await pool.query("SELECT snapshot FROM expense_revisions WHERE trip_id=$1 AND expense_id=$2 AND revision=1", [tripId, ownerBill.entityId])).rows[0].snapshot;
  ownerBill = await apply(owner, await update(owner, ownerBill, {
    description: "Synthetic sparse correction", payerMemberId: editor.memberId, occurredAt: "2030-04-02T10:00:00.000Z",
  }));
  await assertBill(ownerBill, expected([71, 30, 0]));
  assert.deepEqual((await pool.query("SELECT snapshot FROM expense_revisions WHERE trip_id=$1 AND expense_id=$2 AND revision=1", [tripId, ownerBill.entityId])).rows[0].snapshot, firstRevision);
  await rejectsUnchanged(() => update(owner, ownerBill, { amountMinor: 102 }));
  await rejectsUnchanged(() => update(owner, ownerBill, { amountMinor: 102, splitAmounts: amounts([71, 30, 0]) }));
  ownerBill = await apply(owner, await update(owner, ownerBill, { amountMinor: 102, splitAmounts: amounts([72, 30, 0]) }));
  await assertBill(ownerBill, expected([72, 30, 0]), 102);
  const pendingEdit = await update(reviewer, ownerBill, { amountMinor: 109, splitAmounts: amounts([79, 30, 0]) });
  await review(pendingEdit, "reject");
  await assertBill(ownerBill, expected([72, 30, 0]), 102);
  ownerBill = await review(pendingEdit);
  await assertBill(ownerBill, expected([79, 30, 0]), 109);

  // Legacy create/default and an explicit participant-only edit still mean equal shares.
  const equalBill = await apply(owner, await submit(owner, billPatch({ splitAmounts: undefined })));
  await assertBill(equalBill, expected([34, 34, 33]));
  const equalEdited = await apply(owner, await update(owner, equalBill, { amountMinor: 103 }));
  await assertBill(equalEdited, expected([35, 34, 34], [...participants].sort((a, b) => a.memberId.localeCompare(b.memberId))), 103);
  ownerBill = await apply(owner, await update(owner, ownerBill, { amountMinor: 101, splitMemberIds: participants.map((member) => member.memberId) }));
  await assertBill(ownerBill, expected([34, 34, 33]));

  // Invalid maps are rejected before either standalone or atomic event+expense submission writes.
  const invalidPatches = [
    { splitAmounts: amounts([-1, 102, 0]) },
    { splitAmounts: amounts([70.5, 30.5, 0]) },
    { splitAmounts: amounts([Number.MAX_SAFE_INTEGER + 1, 0, 0]) },
    { splitAmounts: amounts([71, 29, 0]) },
    { splitAmounts: amounts([71, 31, 0]) },
    { splitAmounts: amounts([71, 30, 0]).slice(0, 2) },
    { splitAmounts: [] },
    { splitAmounts: [amounts([71, 30, 0])[0], amounts([71, 30, 0])[0], amounts([71, 30, 0])[2]] },
    { splitAmounts: amounts([71, 30, 0], [owner, editor, outsider]) },
    { splitMemberIds: [owner.memberId, owner.memberId, reviewer.memberId] },
    { amountMinor: Number.MAX_SAFE_INTEGER, splitAmounts: amounts([Number.MAX_SAFE_INTEGER, 1, 0]) },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1, splitAmounts: amounts([Number.MAX_SAFE_INTEGER, 1, 0]) },
  ];
  for (const patch of invalidPatches) {
    await rejectsUnchanged(() => submit(owner, billPatch(patch)));
    await rejectsUnchanged(() => eventRequest(owner, { linkedExpense: billPatch(patch) }));
  }
  await rejectsUnchanged(() => submit(owner, billPatch({
    splitMemberIds: [owner.memberId, foreign.memberId], splitAmounts: amounts([71, 30], [owner, foreign]),
  })), AppNotFoundError);

  // Linked create is one audited transaction. Custom shares survive pending-event edits and approval.
  const linkedPending = await eventRequest(reviewer, { linkedExpense: billPatch({ splitAmounts: amounts([11, 90, 0]) }) });
  const beforeLinkedApproval = await snapshot(canonicalTables);
  await rejectsUnchanged(() => apply(reviewer, linkedPending), AppForbiddenError);
  const linkedEdited = await updatePendingItineraryRequest(pool, reviewer, tripId, linkedPending.id, {
    proposalRevision: 1, patch: { linkedExpense: billPatch({ splitAmounts: amounts([15, 86, 0]) }) },
  });
  assert.equal(linkedEdited.proposalRevision, 2);
  assert.deepEqual(linkedEdited.patch.linkedExpense.splitAmounts, amounts([15, 86, 0]));
  assert.deepEqual(await snapshot(canonicalTables), beforeLinkedApproval);
  const linkedEvent = await review(linkedPending, "approve", 2);
  const linkedRows = (await pool.query("SELECT id,current_revision FROM expenses WHERE trip_id=$1 AND itinerary_item_id=$2", [tripId, linkedEvent.entityId])).rows;
  assert.equal(linkedRows.length, 1);
  await assertBill({ entityId: linkedRows[0].id, revision: linkedRows[0].current_revision }, expected([15, 86, 0]));
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM itinerary_revisions WHERE trip_id=$1 AND itinerary_item_id=$2", [tripId, linkedEvent.entityId])).rows[0].total, 1);

  // An invalid linked pending correction cannot partially replace its valid expense.
  const guardedPending = await eventRequest(owner, { linkedExpense: billPatch() });
  await rejectsUnchanged(() => updatePendingItineraryRequest(pool, owner, tripId, guardedPending.id, {
    proposalRevision: 1, patch: { linkedExpense: billPatch({ splitAmounts: amounts([1, 1, 1]) }) },
  }));

  // Custom maps cannot widen a private event or its linked bill's audience, even for an owner.
  const privateRequest = await eventRequest(editor, { visibility: "private", viewerMemberIds: [reviewer.memberId] });
  const privateEvent = await apply(editor, privateRequest);
  const privateCharge = billPatch({ itineraryItemId: privateEvent.entityId, payerMemberId: editor.memberId,
    splitMemberIds: [editor.memberId, reviewer.memberId], splitAmounts: amounts([100, 1], [editor, reviewer]) });
  const privateBill = await apply(editor, await submit(editor, privateCharge));
  await assertBill(privateBill, expected([100, 1], [editor, reviewer]));
  for (const member of [owner, outsider]) {
    const overview = await getAppOverview(pool, member);
    assert.equal(overview.expenses.some((expense) => expense.id === privateBill.entityId), false);
    await rejectsUnchanged(() => submit(member, privateCharge), AppNotFoundError);
  }
  await rejectsUnchanged(() => submit(editor, { ...privateCharge,
    splitMemberIds: [editor.memberId, outsider.memberId], splitAmounts: amounts([100, 1], [editor, outsider]),
  }), AppForbiddenError);
  await rejectsUnchanged(() => update(editor, privateBill, {
    splitMemberIds: [editor.memberId, owner.memberId], splitAmounts: amounts([100, 1], [editor, owner]),
  }), AppForbiddenError);
  await rejectsUnchanged(() => submit(reviewer, privateCharge), AppForbiddenError);
  const privatePending = await submit(reviewer, privateCharge, { source: "ai" });
  for (const member of [editor, reviewer]) {
    assert.ok((await getAppOverview(pool, member)).pendingExpenses.some((expense) => expense.requestId === privatePending.id));
  }
  assert.equal((await getAppOverview(pool, outsider)).pendingExpenses.some((expense) => expense.requestId === privatePending.id), false);

  // Exact unequal consumption and repayment are separate accounting legs (isolated currency).
  const repaymentBill = await apply(owner, await submit(owner, billPatch({ currency: "EUR", amountMinor: 1000,
    splitMemberIds: [owner.memberId, editor.memberId], splitAmounts: amounts([200, 800], [owner, editor]) })));
  await assertBill(repaymentBill, expected([200, 800], [owner, editor]), 1000);
  const ledger = async () => (await getAppOverview(pool, owner)).expenseLedger.balances
    .filter((balance) => balance.currency === "EUR")
    .map(({ memberId, paidMinor, shareMinor, netMinor }) => ({ memberId, paidMinor, shareMinor, netMinor }))
    .sort((a, b) => a.memberId.localeCompare(b.memberId));
  const financial = (net) => [
    { memberId: owner.memberId, paidMinor: 1000, shareMinor: 200, netMinor: net },
    { memberId: editor.memberId, paidMinor: 0, shareMinor: 800, netMinor: -net },
  ].sort((a, b) => a.memberId.localeCompare(b.memberId));
  assert.deepEqual(await ledger(), financial(800));
  const payment = await createMemberPayment(pool, owner, tripId, {
    fromMemberId: editor.memberId, toMemberId: owner.memberId, currency: "EUR", amountMinor: 300,
    occurredAt: "2020-04-01T12:00:00Z", note: "Synthetic partial repayment after exact allocation",
    clientRequestId: randomUUID(), confirmation: true,
  });
  assert.equal(payment.status, "posted");
  assert.deepEqual(await ledger(), financial(500));
  await assertBill(repaymentBill, expected([200, 800], [owner, editor]), 1000);
  assert.deepEqual((await getAppOverview(pool, owner)).expenseLedger.settlements.filter((entry) => entry.currency === "EUR")
    .map(({ fromMemberId, toMemberId, amountMinor, currency }) => ({ fromMemberId, toMemberId, amountMinor, currency })),
  [{ fromMemberId: editor.memberId, toMemberId: owner.memberId, amountMinor: 500, currency: "EUR" }]);
  await testRemovedCustomShareReference(pool, owner, reviewer);
}

/** A void bill retains historical members, so only the sparse JSON reference identifies these proposals. */
async function testRemovedCustomShareReference(pool, sourceOwner, sourceMember) {
  const tripId = randomUUID();
  const owner = { ...sourceOwner, tripId, memberId: randomUUID() };
  const member = { ...sourceMember, tripId, memberId: randomUUID() };
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic custom-share removal trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`, [tripId, owner.userId]);
  for (const actor of [owner, member]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic custom-share removal member',$4,'active')`,
    [tripId, actor.memberId, actor.userId, actor.role]);
  }
  const submit = (patch, options = {}) => createChangeRequest(pool, owner, tripId, {
    entityType: "expense", operation: "create", source: "owner", reason: "Synthetic structured removal regression", patch, ...options,
  });
  const creation = await submit({ description: "Synthetic retained void bill", amountMinor: 101, currency: "JPY",
    payerMemberId: owner.memberId, splitMemberIds: [owner.memberId, member.memberId],
    splitAmounts: [{ memberId: owner.memberId, amountMinor: 80 }, { memberId: member.memberId, amountMinor: 21 }],
    occurredAt: "2030-04-01T10:00:00.000Z", status: "posted" });
  const bill = await applyPermittedChangeRequest(pool, owner, tripId, creation.id);
  const voidRequest = await submit({}, { operation: "void", entityId: bill.entityId, baseRevision: bill.revision });
  const voided = await applyPermittedChangeRequest(pool, owner, tripId, voidRequest.id);
  const requests = [];
  for (const status of ["pending", "rejected"]) {
    const patch = { splitAmounts: [{ memberId: owner.memberId, amountMinor: 81 }, { memberId: member.memberId, amountMinor: 20 }] };
    const request = await submit(patch, { operation: "update", entityId: bill.entityId, baseRevision: voided.revision });
    if (status === "rejected") await reviewChangeRequest(pool, owner, tripId, request.id, "reject", "Synthetic retained rejection", 1);
    const saved = (await pool.query("SELECT proposed_patch FROM change_requests WHERE trip_id=$1 AND id=$2", [tripId, request.id])).rows[0].proposed_patch;
    assert.equal(saved.splitMemberIds, undefined);
    assert.equal(saved.payerMemberId, undefined);
    requests.push({ ...request, status, saved });
  }
  async function financialHistory() {
    const result = {};
    for (const table of ["expenses", "expense_splits", "expense_revisions"]) {
      result[table] = (await pool.query(`SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) AS rows
        FROM ${table} r WHERE trip_id=$1`, [tripId])).rows[0].rows;
    }
    return result;
  }
  const before = await financialHistory();
  const preview = await getTripMemberRemovalPreview(pool, owner, tripId, member.memberId);
  assert.equal(preview.canRemove, true);
  assert.equal(preview.counts.expenses, 0);
  assert.equal(preview.counts.actionableProposals, 2);
  const removed = await removeTripMemberSafely(pool, owner, tripId, member.memberId, {
    confirmation: true, expectedRevision: preview.member.revision, previewDigest: preview.previewDigest,
  });
  assert.equal(removed.invalidatedProposalCount, 2);
  assert.deepEqual(await financialHistory(), before, "void canonical shares and immutable revisions are retained without rewriting money");
  for (const request of requests) {
    const row = (await pool.query(`SELECT status,proposed_patch,invalidated_reason,invalidated_member_id,
      invalidated_at IS NOT NULL AS invalidated FROM change_requests WHERE trip_id=$1 AND id=$2`, [tripId, request.id])).rows[0];
    assert.deepEqual(row, { status: request.status, proposed_patch: request.saved,
      invalidated_reason: "member_removed", invalidated_member_id: member.memberId, invalidated: true });
    for (const decision of ["approve", "reject"]) {
      await assert.rejects(() => reviewChangeRequest(pool, owner, tripId, request.id, decision, "Synthetic invalidated retry", 1), AppNotFoundError);
    }
    await assert.rejects(() => applyPermittedChangeRequest(pool, owner, tripId, request.id), AppNotFoundError);
    assert.equal((await pool.query(`SELECT count(*)::int AS total FROM audit_events
      WHERE trip_id=$1 AND entity_id=$2 AND action='invalidated'`, [tripId, request.id])).rows[0].total, 1);
  }
  assert.deepEqual(await financialHistory(), before);
}
