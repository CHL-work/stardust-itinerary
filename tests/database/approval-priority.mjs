import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AppForbiddenError, AppInvalidInputError, AppNotFoundError,
  applyPermittedChangeRequest, approvalHistoryPageSize, createChangeRequest,
  getApprovalHistory, parseApprovalHistoryCursor, reviewChangeRequest, updateMemberPermissions,
} from "../../src/lib/app/repository.ts";

/** Current-schema synthetic fixtures; the parent guards migration setup and exact DB cleanup. */
export async function testApprovalPriority(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(databaseName, /^stardust_test_[a-z0-9_]+$/);
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, databaseName);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, databaseName);
  const tripId = randomUUID(), foreignTripId = randomUUID();
  const owner = { ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role: "owner" };
  const member = { ...owner, memberId: randomUUID(), userId: randomUUID(), role: "editor" };
  const foreign = { ...owner, tripId: foreignTripId, memberId: randomUUID() };
  for (const actor of [owner, member]) {
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic approval-order user')", [actor.userId]);
  }
  for (const id of [tripId, foreignTripId]) {
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic approval-order trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`, [id, owner.userId]);
  }
  for (const actor of [owner, member, foreign]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic approval-order member',$4,'active')`, [actor.tripId, actor.memberId, actor.userId, actor.role]);
  }
  await updateMemberPermissions(pool, owner, tripId, member.memberId, {
    canEditItinerary: true, itineraryRequiresApproval: false, canEditExpenses: true,
    expenseRequiresApproval: false, canSyncCalendar: false,
  });

  // A private cancel is deliberately not review-visible to this unselected owner.
  const dayId = randomUUID();
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')", [tripId, dayId]);
  const privateCreate = await createChangeRequest(pool, member, tripId, {
    entityType: "itinerary_item", operation: "create", source: "member", reason: "Synthetic private pagination decoy",
    patch: { tripDayId: dayId, title: "Synthetic hidden event", itemType: "meal", startsAt: "2030-04-01T10:00:00.000Z",
      endsAt: "2030-04-01T11:00:00.000Z", visibility: "private", viewerMemberIds: [] },
  });
  const privateItem = await applyPermittedChangeRequest(pool, member, tripId, privateCreate.id);
  const privateCancel = await createChangeRequest(pool, member, tripId, {
    entityType: "itinerary_item", operation: "cancel", entityId: privateItem.entityId, baseRevision: privateItem.revision,
    source: "member", reason: "Synthetic hidden pending cancel", patch: {},
  });
  assert.equal((await pool.query("SELECT app_member_can_view_change_request($1,$2,$3) AS visible",
    [tripId, privateCancel.id, owner.memberId])).rows[0].visible, false);

  const idPrefix = randomUUID().slice(0, 24);
  const id = (sequence) => `${idPrefix}${String(sequence).padStart(12, "0")}`;
  const expected = [];
  async function insert({ sequence, status, createdAt, invalidated = false, actor = owner }) {
    const requestId = id(sequence);
    // Synthetic history rows need no canonical bill: this test exercises order/privacy, not approval writes.
    const patch = { description: `Synthetic ordered bill ${sequence}`, amountMinor: 1, currency: "JPY",
      payerMemberId: actor.memberId, splitMemberIds: [actor.memberId], occurredAt: "2030-04-01T10:00:00.000Z" };
    await pool.query(`INSERT INTO change_requests(trip_id,id,requested_by_member_id,source,entity_type,operation,
      proposed_patch,reason,status,created_at,reviewed_by_member_id,reviewed_at,applied_revision,
      invalidated_at,invalidated_reason,invalidated_by_member_id,invalidated_member_id)
      VALUES($1,$2,$3,'member','expense','create',$4::jsonb,'Synthetic pagination fixture',$5,$6,
        CASE WHEN $5='pending' THEN NULL ELSE $3::uuid END,
        CASE WHEN $5='pending' THEN NULL ELSE $6::timestamptz END,
        CASE WHEN $5='approved' THEN 1 ELSE NULL END,
        CASE WHEN $7 THEN $6::timestamptz ELSE NULL END,
        CASE WHEN $7 THEN 'member_removed' ELSE NULL END,
        CASE WHEN $7 THEN $3::uuid ELSE NULL END, CASE WHEN $7 THEN $3::uuid ELSE NULL END)`,
    [actor.tripId, requestId, actor.memberId, JSON.stringify(patch), status, createdAt, invalidated]);
    if (actor.tripId === tripId) expected.push({ id: requestId, status, createdAt, priority: status === "pending" && !invalidated ? 1 : 0, invalidated });
    return requestId;
  }
  // Identical timestamps with ordered UUIDs force an exact same-bucket page boundary.
  for (let sequence = 1; sequence <= 27; sequence++) {
    await insert({ sequence, status: "pending", createdAt: "2020-01-01T00:00:00.123456Z" });
  }
  // Newer history cannot push old pending work onto a later page. Timestamp pairs
  // exercise UUID ties, while sub-millisecond differences cross the history boundary.
  for (let sequence = 0; sequence < 27; sequence++) {
    await insert({ sequence: 100 + sequence, status: ["approved", "rejected", "superseded"][sequence % 3],
      createdAt: `2099-01-01T00:00:00.${String(900000 - Math.floor(sequence / 2)).padStart(6, "0")}Z` });
  }
  for (const sequence of [200, 201]) await insert({ sequence, status: "pending", invalidated: true, createdAt: "2100-01-01T00:00:00.123456Z" });
  const foreignRequest = await insert({ sequence: 300, status: "pending", createdAt: "2100-01-01T00:00:00.123456Z", actor: foreign });
  expected.sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

  const pages = [], cursors = new Set(), all = [];
  let cursor = null;
  do {
    const page = await getApprovalHistory(pool, owner, tripId, cursor);
    assert.ok(page.requests.length > 0 && page.requests.length <= approvalHistoryPageSize);
    all.push(...page.requests);
    pages.push(page);
    assert.ok(pages.length <= 4, "pagination must reach a terminal cursor");
    if (page.nextCursor) {
      assert.equal(page.requests.length, approvalHistoryPageSize);
      assert.ok(!cursors.has(page.nextCursor), "cursor must advance");
      cursors.add(page.nextCursor);
      const boundary = expected[all.length - 1];
      assert.deepEqual(parseApprovalHistoryCursor(page.nextCursor, tripId), {
        priority: boundary.priority, createdAt: boundary.createdAt, id: boundary.id,
      });
      const wire = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString("utf8"));
      assert.equal(wire.version, 2);
      assert.equal(wire.tripId, tripId);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((page) => page.requests.length), [25, 25, 6]);
  assert.ok(pages[0].requests.every((request) => request.status === "pending" && !request.reviewBlockedReason));
  assert.deepEqual(pages[1].requests.slice(0, 2).map((request) => request.id), expected.slice(25, 27).map((request) => request.id));
  assert.ok(pages[1].requests.slice(2).every((request) => request.status !== "pending" || request.reviewBlockedReason === "member_removed"));
  assert.equal(new Set(all.map((request) => request.id)).size, expected.length);
  assert.deepEqual(all.map((request) => request.id), expected.map((request) => request.id));
  assert.equal(all.some((request) => [privateCreate.id, privateCancel.id, foreignRequest].includes(request.id)), false);
  assert.deepEqual(all.filter((request) => request.reviewBlockedReason).map((request) => request.id), [id(201), id(200)]);
  for (const sequence of [200, 201]) {
    await assert.rejects(() => reviewChangeRequest(pool, owner, tripId, id(sequence), "approve", "Synthetic invalidated review", 1), AppNotFoundError);
  }
  await assert.rejects(() => getApprovalHistory(pool, member, tripId), AppForbiddenError);
  await assert.rejects(() => getApprovalHistory(pool, foreign, tripId), AppForbiddenError);
  await assert.rejects(() => getApprovalHistory(pool, foreign, foreignTripId, pages[0].nextCursor), AppInvalidInputError);
  const beforeRefresh = all.map((request) => request.id);
  const firstRefresh = await getApprovalHistory(pool, owner, tripId);
  assert.deepEqual(firstRefresh.requests.map((request) => request.id), beforeRefresh.slice(0, 25));
}
