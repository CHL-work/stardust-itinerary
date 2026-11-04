import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import {
  AppForbiddenError, AppNotFoundError, applyPermittedChangeRequest, createChangeRequest,
  getAppOverview, getPendingItineraryRequestForEdit, removeCancelledItineraryItem,
  reviewChangeRequest, updateMemberPermissions, updateTripMember,
} from "../../src/lib/app/repository.ts";
import { getTripMemberRemovalPreview, removeTripMemberSafely } from "../../src/lib/app/member-removal.ts";
import { listCalendarState } from "../../src/lib/calendar/repository.ts";
import { encryptCalendarToken } from "../../src/lib/calendar/tokens.ts";
import { createCalendarLocationToken } from "../../src/lib/calendar/location-search-token.ts";
import { readCalendarLocationSearch } from "../../src/lib/calendar/location-search.ts";
import { AiConversationBusyError, assertBoundUserAiIdle } from "../../src/lib/ai/conversation.ts";
import { readAiRequestRecovery } from "../../src/lib/ai/request-recovery.ts";

async function testCalendarLookupActiveWindow(pool, config, owner, sameUserOtherTrip, otherUser) {
  const lookupId = randomUUID(), lookupClientId = randomUUID();
  await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,
    feature,prompt_text,requested_model,client_request_id,request_payload_hash,created_at)
    VALUES($1,$2,$3,$4,'owner','calendar_location','Synthetic public museum lookup',
      'gpt-6.1-sol',$5,$6,CURRENT_TIMESTAMP-interval '3 minutes')`,
  [owner.tripId, lookupId, owner.memberId, owner.userId, lookupClientId, "a".repeat(64)]);

  // Recovery and admission must agree: an orphaned lookup expires after two minutes,
  // even when the same bound account is using a different trip/member identity.
  assert.equal((await readCalendarLocationSearch(pool, config, owner, lookupClientId)).status, "unavailable");
  await assert.doesNotReject(() => assertBoundUserAiIdle(pool, sameUserOtherTrip.userId));
  assert.deepEqual(await readAiRequestRecovery(pool, sameUserOtherTrip, sameUserOtherTrip.tripId),
    { request: null, busyElsewhere: false, activeConversationId: null });
  assert.equal((await pool.query("SELECT status FROM ai_requests WHERE trip_id=$1 AND id=$2", [owner.tripId, lookupId])).rows[0].status,
    "started", "Read-only stale recovery must not rewrite an audit record");

  await pool.query("UPDATE ai_requests SET created_at=CURRENT_TIMESTAMP-interval '30 seconds' WHERE trip_id=$1 AND id=$2",
    [owner.tripId, lookupId]);
  assert.equal((await readCalendarLocationSearch(pool, config, owner, lookupClientId)).status, "running");
  await assert.rejects(() => assertBoundUserAiIdle(pool, sameUserOtherTrip.userId), AiConversationBusyError);
  assert.deepEqual(await readAiRequestRecovery(pool, sameUserOtherTrip, sameUserOtherTrip.tripId),
    { request: null, busyElsewhere: true, activeConversationId: null });
  await assert.doesNotReject(() => assertBoundUserAiIdle(pool, otherUser.userId));
  await pool.query("UPDATE ai_requests SET status='failed',completed_at=CURRENT_TIMESTAMP WHERE trip_id=$1 AND id=$2",
    [owner.tripId, lookupId]);

  const conversationId = randomUUID(), planningId = randomUUID();
  await pool.query("INSERT INTO ai_conversations(trip_id,id,actor_member_id,actor_user_id) VALUES($1,$2,$3,$4)",
    [owner.tripId, conversationId, owner.memberId, owner.userId]);
  await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
    feature,prompt_text,requested_model,client_request_id,request_payload_hash,created_at)
    VALUES($1,$2,$3,$4,$5,'owner','planning','Synthetic private planning fixture',
      'gpt-6.1-sol',$6,$7,CURRENT_TIMESTAMP-interval '3 minutes')`,
  [owner.tripId, planningId, owner.memberId, owner.userId, conversationId, randomUUID(), "b".repeat(64)]);
  assert.equal((await readAiRequestRecovery(pool, owner, owner.tripId)).request.status, "running");
  await assert.rejects(() => assertBoundUserAiIdle(pool, sameUserOtherTrip.userId), AiConversationBusyError);
  const elsewhere = await readAiRequestRecovery(pool, sameUserOtherTrip, sameUserOtherTrip.tripId);
  assert.deepEqual(elsewhere, { request: null, busyElsewhere: true, activeConversationId: null });
  assert.doesNotMatch(JSON.stringify(elsewhere), new RegExp(`${planningId}|Synthetic private planning fixture`, "u"));
  await assert.doesNotReject(() => assertBoundUserAiIdle(pool, otherUser.userId));
  await pool.query("UPDATE ai_requests SET status='failed',completed_at=CURRENT_TIMESTAMP WHERE trip_id=$1 AND id=$2",
    [owner.tripId, planningId]);
  await assert.doesNotReject(() => assertBoundUserAiIdle(pool, owner.userId));
}

/** Synthetic records and mocked Google reads only; the parent owns exact DB cleanup. */
export async function testCalendarImports(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(databaseName, /^stardust_test_[a-z0-9_]+$/);
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, databaseName);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, databaseName);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM app_schema_migrations")).rows[0].total, 41);

  const config = {
    appBaseUrl: new URL("http://localhost:3100"), allowedOrigins: new Set(["http://localhost:3100"]),
    authSecret: "synthetic-calendar-import-integration-secret-only", databaseUrl: connectionString,
    googleClientId: "synthetic-calendar-client", googleClientSecret: "synthetic-calendar-secret", tripGraceDays: 2,
  };
  const tripId = randomUUID(), foreignTripId = randomUUID();
  const owner = { ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role: "owner" };
  const member = { ...owner, memberId: randomUUID(), userId: randomUUID(), role: "editor" };
  const direct = { ...member, memberId: randomUUID(), userId: randomUUID() };
  const observer = { ...member, memberId: randomUUID(), userId: randomUUID(), role: "viewer" };
  const removable = { ...member, memberId: randomUUID(), userId: randomUUID() };
  const foreign = { ...owner, tripId: foreignTripId, memberId: randomUUID() };
  const actors = [owner, member, direct, observer, removable];
  for (const actor of actors) await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic Calendar import user')", [actor.userId]);
  for (const id of [tripId, foreignTripId]) await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic Calendar import trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`, [id, owner.userId]);
  for (const actor of [...actors, foreign]) await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
    VALUES($1,$2,$3,'Synthetic Calendar import member',$4,'active')`, [actor.tripId, actor.memberId, actor.userId, actor.role]);
  const dayIds = new Map();
  for (let day = 1; day <= 5; day++) {
    const date = `2030-04-0${day}`, id = randomUUID(); dayIds.set(date, id);
    await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,$3)", [tripId, id, date]);
  }
  const permission = (review, edit = true, calendar = true) => ({ canEditItinerary: edit, itineraryRequiresApproval: review,
    canEditExpenses: edit, expenseRequiresApproval: review, canSyncCalendar: calendar });
  await updateMemberPermissions(pool, owner, tripId, member.memberId, permission(true));
  await updateMemberPermissions(pool, owner, tripId, direct.memberId, permission(false));
  await updateMemberPermissions(pool, owner, tripId, removable.memberId, permission(true));
  await updateMemberPermissions(pool, owner, tripId, observer.memberId, permission(true, false));

  // Upgrade an actual pre0042 connection/link without inventing verified identities.
  const legacyRequest = await createChangeRequest(pool, owner, tripId, {
    entityType: "itinerary_item", operation: "create", source: "owner", reason: "Synthetic legacy Calendar link",
    patch: { tripDayId: dayIds.get("2030-04-01"), title: "Synthetic legacy event", itemType: "activity",
      startsAt: "2030-04-01T01:00:00.000Z", endsAt: "2030-04-01T02:00:00.000Z", visibility: "trip", viewerMemberIds: [] },
  });
  const legacyItem = await applyPermittedChangeRequest(pool, owner, tripId, legacyRequest.id);
  await pool.query(`INSERT INTO calendar_connections(trip_id,member_id,access_token_encrypted,token_expires_at,scopes)
    VALUES($1,$2,$3,CURRENT_TIMESTAMP+interval '1 hour',$4::text[])`,
  [tripId, owner.memberId, encryptCalendarToken(config.authSecret, "synthetic-owner-token"), ["https://www.googleapis.com/auth/calendar.events"]]);
  await pool.query(`INSERT INTO calendar_event_links(trip_id,itinerary_item_id,member_id,provider_event_id,last_synced_item_revision)
    VALUES($1,$2,$3,'synthetic-legacy-source',1)`, [tripId, legacyItem.entityId, owner.memberId]);
  const legacyConnection = (await pool.query("SELECT to_jsonb(row) AS value FROM calendar_connections row WHERE trip_id=$1 AND member_id=$2", [tripId, owner.memberId])).rows[0].value;
  const legacyLink = (await pool.query("SELECT to_jsonb(row) AS value FROM calendar_event_links row WHERE trip_id=$1 AND itinerary_item_id=$2", [tripId, legacyItem.entityId])).rows[0].value;
  assert.deepEqual(await migrate({ connectionString, through: "0042_calendar_imports.sql" }), ["0042_calendar_imports.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0042_calendar_imports.sql" }), []);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM app_schema_migrations")).rows[0].total, 42);
  const upgradedConnection = (await pool.query("SELECT to_jsonb(row) AS value FROM calendar_connections row WHERE trip_id=$1 AND member_id=$2", [tripId, owner.memberId])).rows[0].value;
  assert.deepEqual(upgradedConnection, { ...legacyConnection, account_subject: null, connection_generation: null });
  assert.deepEqual((await pool.query("SELECT to_jsonb(row) AS value FROM calendar_event_links row WHERE trip_id=$1 AND itinerary_item_id=$2", [tripId, legacyItem.entityId])).rows[0].value,
    { ...legacyLink, account_subject: null });

  await testCalendarLookupActiveWindow(pool, config, owner, foreign, member);

  const { previewCalendarImport, commitCalendarImport } = await import("../../src/lib/calendar/import-repository.ts");
  const sources = new Map(), tokenActors = new Map(), accountSubjects = new Map();
  let remoteReads = 0;
  let beforeNextSourceResponse = null;
  const originalFetch = globalThis.fetch;
  const connection = async (actor, account = `synthetic-account-${actor.memberId}`, generation = randomUUID()) => {
    const token = `synthetic-token-${actor.memberId}`; tokenActors.set(token, actor); accountSubjects.set(actor.memberId, account);
    await pool.query(`INSERT INTO calendar_connections(trip_id,member_id,access_token_encrypted,refresh_token_encrypted,token_expires_at,scopes,account_subject,connection_generation)
      VALUES($1,$2,$3,NULL,CURRENT_TIMESTAMP+interval '1 hour',$4::text[],$5,$6)
      ON CONFLICT(trip_id,member_id,provider) DO UPDATE SET access_token_encrypted=EXCLUDED.access_token_encrypted,
        refresh_token_encrypted=NULL,token_expires_at=EXCLUDED.token_expires_at,scopes=EXCLUDED.scopes,
        account_subject=EXCLUDED.account_subject,connection_generation=EXCLUDED.connection_generation`,
    [actor.tripId, actor.memberId, encryptCalendarToken(config.authSecret, token), ["openid", "https://www.googleapis.com/auth/calendar.events"], account, generation]);
    return generation;
  };
  const source = (id, overrides = {}) => {
    const event = { id, summary: `Synthetic Calendar event ${id}`, status: "confirmed", etag: `"${id}-v1"`,
      description: "SYNTHETIC_PRIVATE_DESCRIPTION_MUST_NOT_PERSIST", attendees: [{ email: "synthetic-private-attendee@example.test" }],
      location: "Synthetic Museum", htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
      start: { dateTime: "2030-04-02T10:00:00+09:00" }, end: { dateTime: "2030-04-02T11:00:00+09:00" }, ...overrides };
    sources.set(id, event); return event;
  };
  const stateTables = ["itinerary_items", "itinerary_revisions", "itinerary_item_viewers", "expenses", "expense_splits", "expense_revisions", "change_requests", "calendar_import_receipts", "calendar_event_links"];
  const snapshot = async () => {
    const result = {};
    for (const table of stateTables) result[table] = (await pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) AS rows
      FROM ${table} row WHERE trip_id=$1`, [tripId])).rows[0].rows;
    return result;
  };
  const rejectsUnchanged = async (action, error) => {
    const before = await snapshot(); await assert.rejects(action, error); assert.deepEqual(await snapshot(), before);
  };
  const receipt = async (requestId) => (await pool.query("SELECT * FROM calendar_import_receipts WHERE trip_id=$1 AND change_request_id=$2", [tripId, requestId])).rows[0];
  const requestRow = async (requestId) => (await pool.query("SELECT * FROM change_requests WHERE trip_id=$1 AND id=$2", [tripId, requestId])).rows[0];
  const itemRow = async (itemId) => (await pool.query("SELECT * FROM itinerary_items WHERE trip_id=$1 AND id=$2", [tripId, itemId])).rows[0];
  const preview = (actor, id) => previewCalendarImport(pool, config, actor, actor.tripId, id);
  const commit = (actor, view, options = {}) => commitCalendarImport(pool, config, actor, actor.tripId, { previewToken: view.previewToken, ...options });
  const visibleItem = async (actor, itemId) => (await pool.query("SELECT app_member_can_view_itinerary_item($1,$2,$3) AS visible", [tripId, itemId, actor.memberId])).rows[0].visible;

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    assert.equal(init?.method ?? "GET", "GET", "Calendar import never writes to Google");
    const headers = new Headers(init?.headers);
    const actor = tokenActors.get((headers.get("authorization") ?? "").replace(/^Bearer /u, ""));
    assert.ok(actor, "Only synthetic encrypted Calendar credentials may reach the mocked fetch");
    remoteReads++;
    if (url.origin === "https://openidconnect.googleapis.com" && url.pathname === "/v1/userinfo") {
      return Response.json({ sub: accountSubjects.get(actor.memberId) });
    }
    assert.equal(url.origin, "https://www.googleapis.com", "No provider or other network calls are allowed");
    assert.ok(url.pathname.startsWith("/calendar/v3/calendars/primary/events"));
    const id = decodeURIComponent(url.pathname.slice("/calendar/v3/calendars/primary/events".length).replace(/^\//u, ""));
    if (!id) return Response.json({ items: [...sources.values()] });
    if (beforeNextSourceResponse) {
      const callback = beforeNextSourceResponse; beforeNextSourceResponse = null;
      await callback();
    }
    const event = sources.get(id);
    return event ? Response.json(event) : Response.json({ error: { message: "Synthetic unavailable source" } }, { status: 404 });
  };

  try {
    source("synthetic-needs-reconnect");
    await rejectsUnchanged(() => preview(owner, "synthetic-needs-reconnect"));
    for (const actor of [...actors, foreign]) await connection(actor);

    // At most one request exists even when separately previewed double submissions race.
    source("synthetic-private-pending");
    const [viewA, viewB] = await Promise.all([preview(member, "synthetic-private-pending"), preview(member, "synthetic-private-pending")]);
    assert.equal(viewA.existing, null);
    assert.equal(viewA.source.startsAt, "2030-04-02T01:00:00.000Z");
    assert.doesNotMatch(JSON.stringify(viewA), /SYNTHETIC_PRIVATE_DESCRIPTION|synthetic-private-attendee/u);
    const parallel = await Promise.all([commit(member, viewA), commit(member, viewB)]);
    assert.equal(new Set(parallel.map((result) => result.requestId)).size, 1);
    assert.deepEqual(parallel.map((result) => result.replayed).sort(), [false, true]);
    const pending = parallel[0]; assert.equal(pending.status, "pending"); assert.equal(pending.itemId, null);
    const savedPending = await requestRow(pending.requestId);
    assert.equal(savedPending.proposed_patch.visibility, "private");
    assert.deepEqual(savedPending.proposed_patch.viewerMemberIds, []);
    assert.equal(savedPending.requested_by_member_id, member.memberId);
    assert.equal((await receipt(pending.requestId)).itinerary_item_id, null);
    assert.doesNotMatch(JSON.stringify(await receipt(pending.requestId)), /SYNTHETIC_PRIVATE_DESCRIPTION|synthetic-private-attendee/u);
    assert.equal((await getPendingItineraryRequestForEdit(pool, owner, tripId, pending.requestId)).requestId, pending.requestId);
    const [pendingOwnerOverview, pendingMemberOverview, pendingObserverOverview] = await Promise.all(
      [owner, member, observer].map((actor) => getAppOverview(pool, actor)));
    assert.ok(pendingOwnerOverview.pendingItinerary.some((row) => row.requestId === pending.requestId));
    assert.equal(pendingMemberOverview.pendingItinerary.find((row) => row.requestId === pending.requestId).sourceCalendar.allDay, false);
    assert.equal(pendingObserverOverview.pendingItinerary.some((row) => row.requestId === pending.requestId), false);
    await rejectsUnchanged(() => getPendingItineraryRequestForEdit(pool, observer, tripId, pending.requestId), AppNotFoundError);
    await rejectsUnchanged(() => applyPermittedChangeRequest(pool, member, tripId, pending.requestId), AppForbiddenError);
    assert.equal((await listCalendarState(pool, config, member)).events.some((row) => row.id === "synthetic-private-pending"), false);

    // Rejection retains identity; retry cannot bypass review or manufacture another proposal.
    await reviewChangeRequest(pool, owner, tripId, pending.requestId, "reject", "Synthetic review rejection", pending.proposalRevision);
    const rejectedReplay = await commit(member, viewA);
    assert.equal(rejectedReplay.requestId, pending.requestId); assert.equal(rejectedReplay.status, "rejected"); assert.equal(rejectedReplay.replayed, true);
    const rejectedSource = (await listCalendarState(pool, config, member)).events.find((row) => row.id === "synthetic-private-pending");
    assert.equal(rejectedSource.importState.status, "rejected");
    assert.equal(rejectedSource.importState.canImport, false);
    const approved = await reviewChangeRequest(pool, owner, tripId, pending.requestId, "approve", "Synthetic reapproval", pending.proposalRevision);
    assert.equal((await receipt(pending.requestId)).itinerary_item_id, approved.entityId);
    assert.equal((await itemRow(approved.entityId)).created_by_member_id, member.memberId);
    assert.equal(await visibleItem(member, approved.entityId), true);
    assert.equal(await visibleItem(owner, approved.entityId), false, "Proposal review must not grant ongoing private event visibility");
    assert.equal(await visibleItem(observer, approved.entityId), false);
    assert.equal((await getAppOverview(pool, owner)).itinerary.some((row) => row.id === approved.entityId), false);
    const approvedReplay = await commit(member, viewA);
    assert.deepEqual({ id: approvedReplay.requestId, item: approvedReplay.itemId, status: approvedReplay.status, replayed: approvedReplay.replayed },
      { id: pending.requestId, item: approved.entityId, status: "approved", replayed: true });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM itinerary_revisions WHERE trip_id=$1 AND itinerary_item_id=$2", [tripId, approved.entityId])).rows[0].count, 1);
    const privateApprovalAudit = await pool.query(`SELECT count(*)::int AS count FROM audit_events
      WHERE trip_id=$1 AND entity_type='itinerary_item' AND entity_id=$2 AND metadata->>'changeRequestId'=$3`,
    [tripId, approved.entityId, pending.requestId]);
    assert.equal(privateApprovalAudit.rows[0].count, 1);

    // The direct-apply path and deliberate private sharing preserve the importer, too.
    source("synthetic-direct-shared");
    const directResult = await commit(direct, await preview(direct, "synthetic-direct-shared"), { viewerMemberIds: [owner.memberId], itemType: "meal" });
    assert.equal(directResult.status, "approved");
    assert.equal((await receipt(directResult.requestId)).itinerary_item_id, directResult.itemId);
    assert.equal((await itemRow(directResult.itemId)).created_by_member_id, direct.memberId);
    assert.equal(await visibleItem(owner, directResult.itemId), true);
    assert.equal(await visibleItem(observer, directResult.itemId), false);
    source("synthetic-owner-public");
    const publicView = await preview(owner, "synthetic-owner-public");
    const publicImport = await commit(owner, publicView, { visibility: "trip" });
    assert.equal(publicImport.status, "approved"); assert.equal(await visibleItem(observer, publicImport.itemId), true);

    // A signed synthetic AI location receipt keeps even the owner on explicit review.
    source("synthetic-ai-assisted");
    const aiView = await preview(owner, "synthetic-ai-assisted");
    const aiLocation = { requestId: randomUUID(), locationName: "Synthetic Museum",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic%20Museum" };
    const aiToken = createCalendarLocationToken(config.authSecret, owner, aiLocation);
    const aiImport = await commit(owner, aiView, { locationName: aiLocation.locationName, mapUrl: aiLocation.mapUrl, aiReceiptToken: aiToken });
    assert.equal(aiImport.status, "pending"); assert.equal(aiImport.itemId, null);
    assert.equal((await requestRow(aiImport.requestId)).source, "ai");
    await rejectsUnchanged(() => applyPermittedChangeRequest(pool, owner, tripId, aiImport.requestId), AppForbiddenError);
    // The database rejects a pretend approval before its receipt is linked, even
    // when the supplied target is a real same-trip canonical item.
    await rejectsUnchanged(() => pool.query(`UPDATE change_requests SET status='approved',entity_id=$3,
      reviewed_by_member_id=$4,reviewed_at=CURRENT_TIMESTAMP,applied_revision=1 WHERE trip_id=$1 AND id=$2`,
    [tripId, aiImport.requestId, legacyItem.entityId, owner.memberId]));
    const aiApproved = await reviewChangeRequest(pool, owner, tripId, aiImport.requestId, "approve", "Synthetic AI import review", 1);
    assert.equal((await receipt(aiImport.requestId)).itinerary_item_id, aiApproved.entityId);

    // Distinct occurrence IDs and different importers remain independently source-bound.
    source("synthetic-occurrence-a"); source("synthetic-occurrence-b");
    const occurrenceA = await commit(owner, await preview(owner, "synthetic-occurrence-a"));
    const occurrenceB = await commit(owner, await preview(owner, "synthetic-occurrence-b"));
    assert.notEqual(occurrenceA.requestId, occurrenceB.requestId);
    const otherImporter = await commit(direct, await preview(direct, "synthetic-occurrence-a"));
    assert.notEqual(otherImporter.requestId, occurrenceA.requestId);

    // Preview/source/account/generation facts cannot be forged or silently refreshed.
    source("synthetic-stale-source");
    const staleSource = await preview(owner, "synthetic-stale-source");
    source("synthetic-stale-source", { summary: "Synthetic changed source", etag: '"changed"' });
    await rejectsUnchanged(() => commit(owner, staleSource));
    source("synthetic-stale-generation");
    const staleGeneration = await preview(owner, "synthetic-stale-generation");
    await connection(owner);
    await rejectsUnchanged(() => commit(owner, staleGeneration));
    source("synthetic-connection-race");
    const connectionRace = await preview(owner, "synthetic-connection-race");
    beforeNextSourceResponse = () => connection(owner, "synthetic-raced-google-account");
    await rejectsUnchanged(() => commit(owner, connectionRace));
    await connection(owner);
    source("synthetic-preview-race");
    beforeNextSourceResponse = () => connection(owner);
    await rejectsUnchanged(() => preview(owner, "synthetic-preview-race"));
    await rejectsUnchanged(() => commit(owner, { ...publicView, previewToken: `${publicView.previewToken}invalid` }));
    await rejectsUnchanged(() => commit(member, publicView));
    await rejectsUnchanged(() => commit(foreign, publicView));
    source("synthetic-cross-audience");
    const audienceView = await preview(owner, "synthetic-cross-audience");
    await rejectsUnchanged(() => commit(owner, audienceView, { viewerMemberIds: [foreign.memberId] }));
    await rejectsUnchanged(() => commit(owner, audienceView, { startsAt: "2030-04-04T01:00:00.000Z" }));
    await rejectsUnchanged(() => preview(observer, "synthetic-cross-audience"), AppForbiddenError);

    // Same account reconnection cannot resurrect a second request; another account can own the same event ID.
    const beforeReconnect = await receipt(publicImport.requestId);
    await pool.query("DELETE FROM calendar_connections WHERE trip_id=$1 AND member_id=$2", [tripId, owner.memberId]);
    await connection(owner);
    const reconnected = await preview(owner, "synthetic-owner-public");
    assert.equal(reconnected.existing.requestId, publicImport.requestId);
    assert.equal((await commit(owner, reconnected)).replayed, true);
    assert.deepEqual(await receipt(publicImport.requestId), beforeReconnect);
    assert.equal((await commit(owner, publicView)).requestId, publicImport.requestId,
      "A same-account uncertain submit can replay across connection generations");
    await connection(owner, "synthetic-different-google-account");
    const differentAccount = await preview(owner, "synthetic-owner-public");
    assert.equal(differentAccount.existing, null);
    const differentImport = await commit(owner, differentAccount);
    assert.notEqual(differentImport.requestId, publicImport.requestId);
    await connection(owner);

    // Google date-only exclusive ends are preserved as exact trip-zone instants, not UTC midnights.
    source("synthetic-all-day", { start: { date: "2030-04-02" }, end: { date: "2030-04-04" } });
    const allDay = await preview(owner, "synthetic-all-day");
    assert.equal(allDay.source.allDay, true); assert.equal(allDay.source.startDate, "2030-04-02");
    assert.equal(allDay.source.endDateExclusive, "2030-04-04");
    assert.equal(allDay.source.startsAt, "2030-04-01T15:00:00.000Z");
    assert.equal(allDay.source.endsAt, "2030-04-03T15:00:00.000Z");
    const allDayImport = await commit(owner, allDay);
    assert.equal((await itemRow(allDayImport.itemId)).trip_day_id, dayIds.get("2030-04-02"));
    assert.deepEqual((await getAppOverview(pool, owner)).itinerary.find((row) => row.id === allDayImport.itemId).sourceCalendar,
      { allDay: true, startDate: "2030-04-02", endDateExclusive: "2030-04-04",
        sourceStartsAt: "2030-04-01T15:00:00.000Z", sourceEndsAt: "2030-04-03T15:00:00.000Z" });
    source("synthetic-overnight", { start: { dateTime: "2030-04-02T23:00:00+09:00" }, end: { dateTime: "2030-04-03T02:00:00+09:00" } });
    const overnight = await commit(owner, await preview(owner, "synthetic-overnight"));
    assert.equal((await itemRow(overnight.itemId)).starts_at.toISOString(), "2030-04-02T14:00:00.000Z");
    assert.equal((await itemRow(overnight.itemId)).ends_at.toISOString(), "2030-04-02T17:00:00.000Z");
    for (const [id, overrides] of [
      ["synthetic-cancelled-source", { status: "cancelled" }],
      ["synthetic-invalid-times", { end: { dateTime: "2030-04-01T01:00:00Z" } }],
      ["synthetic-outside-trip", { start: { date: "2030-05-01" }, end: { date: "2030-05-02" } }],
    ]) { source(id, overrides); await rejectsUnchanged(() => preview(owner, id)); }

    // Cancel/removal retains the source receipt, immutable revisions and no re-import opportunity.
    const cancelRequest = await createChangeRequest(pool, owner, tripId, {
      entityType: "itinerary_item", entityId: publicImport.itemId, operation: "cancel", baseRevision: 1,
      source: "owner", reason: "Synthetic Calendar import cancel", patch: {},
    });
    const cancelled = await applyPermittedChangeRequest(pool, owner, tripId, cancelRequest.id);
    assert.equal((await commit(owner, await preview(owner, "synthetic-owner-public"))).requestId, publicImport.requestId);
    await removeCancelledItineraryItem(pool, owner, tripId, publicImport.itemId, { expectedRevision: cancelled.revision, confirm: true });
    const removedReplay = await commit(owner, await preview(owner, "synthetic-owner-public"));
    assert.equal(removedReplay.requestId, publicImport.requestId); assert.equal(removedReplay.itemId, publicImport.itemId);
    assert.ok((await itemRow(publicImport.itemId)).removed_at);
    assert.equal((await receipt(publicImport.requestId)).itinerary_item_id, publicImport.itemId);
    assert.equal((await listCalendarState(pool, config, owner)).events.some((row) => row.id === "synthetic-owner-public"), false);

    // Receipt rows are durable facts; request/foreign-item rewrites cannot break exact identity.
    const immutable = await receipt(publicImport.requestId);
    for (const sql of [
      "DELETE FROM calendar_import_receipts WHERE id=$1",
      "UPDATE calendar_import_receipts SET provider_event_id='synthetic-forged-source' WHERE id=$1",
      "UPDATE calendar_import_receipts SET source_snapshot='{}'::jsonb WHERE id=$1",
      "UPDATE calendar_import_receipts SET itinerary_item_id=NULL WHERE id=$1",
    ]) await assert.rejects(() => pool.query(sql, [immutable.id]));
    assert.deepEqual(await receipt(publicImport.requestId), immutable);
    await rejectsUnchanged(() => pool.query(`INSERT INTO calendar_import_receipts(id,trip_id,member_id,app_user_id,
      account_subject,calendar_id,provider_event_id,connection_generation,change_request_id,source_digest,source_snapshot)
      SELECT $1,$2,$3,app_user_id,account_subject,calendar_id,'synthetic-foreign-receipt',connection_generation,
        change_request_id,source_digest,source_snapshot FROM calendar_import_receipts WHERE id=$4`,
    [randomUUID(), foreignTripId, foreign.memberId, immutable.id]));

    // Removal invalidates both pending and rejected source requests, without deleting their receipts.
    source("synthetic-removal-pending"); source("synthetic-removal-rejected");
    const removalPendingView = await preview(removable, "synthetic-removal-pending");
    const removalPending = await commit(removable, removalPendingView);
    const removalRejected = await commit(removable, await preview(removable, "synthetic-removal-rejected"));
    await reviewChangeRequest(pool, owner, tripId, removalRejected.requestId, "reject", "Synthetic removed requester", 1);
    const removalPreview = await getTripMemberRemovalPreview(pool, owner, tripId, removable.memberId);
    await removeTripMemberSafely(pool, owner, tripId, removable.memberId, {
      confirmation: true, expectedRevision: removalPreview.member.revision, previewDigest: removalPreview.previewDigest, expenseReassignments: [],
    });
    for (const result of [removalPending, removalRejected]) {
      assert.equal((await requestRow(result.requestId)).invalidated_reason, "member_removed");
      assert.ok(await receipt(result.requestId));
      await rejectsUnchanged(() => reviewChangeRequest(pool, owner, tripId, result.requestId, "approve", "Synthetic invalidated retry", 1), AppNotFoundError);
    }
    await rejectsUnchanged(() => commit(removable, removalPendingView), AppForbiddenError);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM calendar_connections WHERE trip_id=$1 AND member_id=$2", [tripId, removable.memberId])).rows[0].count, 0);

    // A disabled or newly rebound member cannot use an earlier source-bound preview.
    source("synthetic-disabled-preview");
    const disabledView = await preview(direct, "synthetic-disabled-preview");
    await updateTripMember(pool, owner, tripId, direct.memberId, { disabled: true });
    await rejectsUnchanged(() => commit(direct, disabledView), AppForbiddenError);
    await updateTripMember(pool, owner, tripId, direct.memberId, { disabled: false });
    const replacementUser = randomUUID();
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic replacement Calendar user')", [replacementUser]);
    await pool.query("UPDATE trip_members SET user_id=$3 WHERE trip_id=$1 AND id=$2", [tripId, direct.memberId, replacementUser]);
    await rejectsUnchanged(() => commit(direct, disabledView), AppForbiddenError);

    // Read models may retain truthful import status, but never make linked rows importable again.
    const listed = await listCalendarState(pool, config, owner);
    const importedIds = new Set(["synthetic-owner-public", "synthetic-occurrence-a", "synthetic-occurrence-b", "synthetic-all-day", "synthetic-overnight"]);
    for (const row of listed.events ?? []) {
      if (!importedIds.has(row.id)) continue;
      assert.ok(row.linkedItineraryItemId || row.importState?.canImport === false || row.imported === true,
        "A receipt-backed source must not become an addable unlinked Calendar row");
    }
    const ownerOverview = await getAppOverview(pool, owner);
    assert.doesNotMatch(JSON.stringify(ownerOverview), /SYNTHETIC_PRIVATE_DESCRIPTION|synthetic-private-attendee/u);
    assert.ok(remoteReads > 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM expenses WHERE trip_id=$1", [tripId])).rows[0].count, 0,
      "Calendar import does not fabricate expenses");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
