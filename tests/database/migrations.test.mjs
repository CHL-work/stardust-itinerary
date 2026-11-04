import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { testAiConversationHistory } from "./ai-conversation-history.mjs";
import { testAiImageInputs } from "./ai-image-inputs.mjs";
import { testAccountOnboarding } from "./account-onboarding.mjs";
import { testMemberRemoval } from "./member-removal.mjs";
import { testTripDeletion } from "./trip-deletion.mjs";
import { testAiCredentials } from "./ai-credentials.mjs";
import { testAiKeySharing } from "./ai-key-sharing.mjs";
import { testGuestAccounts } from "./guest-accounts.mjs";
import { testAiPendingItinerary } from "./ai-pending-itinerary.mjs";
import { testLinkedEventExpense } from "./linked-event-expense.mjs";
import { testCustomExpenseSplits } from "./custom-expense-splits.mjs";
import { testApprovalPriority } from "./approval-priority.mjs";
import { testCalendarImports } from "./calendar-imports.mjs";
import { testCompletedTripAccess } from "./completed-trip-access.mjs";
import { testTripDateSettings } from "./trip-date-settings.mjs";
import { testActivityPrivacy } from "./activity.mjs";
import { testCustomAiInstructions } from "./custom-ai-instructions.mjs";
import { testTripDestinationLookups } from "./trip-destination-lookups.mjs";
import { testFeedbackTriage } from "./feedback-triage.mjs";
import { testFeedbackWorker } from "./feedback-worker.mjs";
import { createMemberPayment, updateMemberPayment, loadMemberPayments, memberPaymentSnapshot } from "../../src/lib/app/member-payments.ts";
import { getTripMemberRemovalPreview, removeTripMemberSafely } from "../../src/lib/app/member-removal.ts";
import {
  consumeClaim,
  consumeJoinLink,
  issueClaim,
  issueJoinLink,
  previewClaim,
  previewJoinLink,
  revokeClaims,
  revokeJoinLink,
  revokeSession,
  rotateSession,
  signInExistingIdentity,
  switchSessionTrip,
  unbindMemberIdentity,
  verifySession,
} from "../../src/lib/auth/repository.ts";
import { MembershipDisabledError } from "../../src/lib/auth/errors.ts";
import {
  createConversationCheckpoint,
  lockBoundUserAi,
  prepareAiConversation,
  resetAiConversation,
} from "../../src/lib/ai/conversation.ts";
import { runAiPlanner } from "../../src/lib/ai/planner.ts";
import {
  AppConflictError,
  AppForbiddenError,
  AppInvalidInputError,
  AppNotFoundError,
  applyPermittedChangeRequest,
  createAiItineraryCreateRequestsWithClient,
  createChangeRequest,
  createChangeRequestsAtomically,
  createTrip,
  createTripMember,
  getApprovalHistory,
  getAiPendingItineraryContext,
  getAppOverview,
  getAiPolicy,
  getPendingItineraryRequestForEdit,
  inTransaction,
  removeCancelledItineraryItem,
  removeTripMember,
  reviewChangeRequest,
  updateAiSettings,
  updateMemberPermissions,
  updatePendingItineraryRequest,
  updateTripMember,
  updateTripSettings,
} from "../../src/lib/app/repository.ts";

const { Client, Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;

function databaseTarget(value, variableName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${variableName} must use the postgres or postgresql protocol.`);
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName) throw new Error(`${variableName} must name a database.`);
  return {
    databaseName,
    host: url.hostname.toLowerCase(),
    key: `${url.hostname.toLowerCase()}:${url.port || "5432"}/${databaseName}`,
  };
}

function requireDisposableDatabaseTarget() {
  const target = databaseTarget(connectionString, "TEST_DATABASE_URL");
  const confirmation = process.env.TEST_DATABASE_CONFIRM_DESTROY?.trim();
  if (confirmation !== target.databaseName) {
    throw new Error(
      `Refusing to destroy ${target.databaseName}: set TEST_DATABASE_CONFIRM_DESTROY to that exact disposable database name.`,
    );
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(target.host)) {
    throw new Error("TEST_DATABASE_URL must point to a disposable loopback PostgreSQL server.");
  }
  if (process.env.CI !== "true" && !/(?:^|[_-])(test|ci|spec|tmp|temporary|disposable)(?:[_-]|$)/i.test(target.databaseName)) {
    throw new Error(
      "Outside CI, the disposable database name must contain a test/ci/spec/tmp/disposable marker.",
    );
  }
  for (const variableName of ["DATABASE_URL", "DATABASE_DIRECT_URL"]) {
    const value = process.env[variableName];
    if (value && databaseTarget(value, variableName).key === target.key) {
      throw new Error(`Refusing to destroy the data-bearing database configured by ${variableName}.`);
    }
  }
}

async function withClient(work) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

// These older upgrade stages intentionally precede0037. Set up their removed
// participant fixture directly; confirmed removal behavior is tested only by
// testMemberRemoval after the actual0037 migration, never a legacy API bypass.
async function retireSyntheticMemberBefore0037(pool,session,tripId,memberId) {
  requireDisposableDatabaseTarget();
  assert.equal(session.tripId,tripId);
  await inTransaction(pool,async(client)=>{
    await client.query("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP),revoke_reason=COALESCE(revoke_reason,'synthetic_member_removed') WHERE trip_id=$1 AND member_id=$2",[tripId,memberId]);
    await client.query("UPDATE member_claim_links SET revoked_at=CURRENT_TIMESTAMP WHERE trip_id=$1 AND member_id=$2 AND consumed_at IS NULL AND revoked_at IS NULL",[tripId,memberId]);
    await client.query("DELETE FROM calendar_connections WHERE trip_id=$1 AND member_id=$2",[tripId,memberId]);
    await client.query("DELETE FROM calendar_event_links WHERE trip_id=$1 AND member_id=$2",[tripId,memberId]);
    const target=await client.query("UPDATE trip_members SET status='removed',current_revision=current_revision+1 WHERE trip_id=$1 AND id=$2 AND role<>'owner' RETURNING id",[tripId,memberId]);
    assert.equal(target.rowCount,1);
    await client.query("INSERT INTO audit_events(trip_id,id,actor_member_id,entity_type,entity_id,action,metadata) VALUES($1,$2,$3,'trip_member',$4,'removed','{\"syntheticLegacyFixture\":true}'::jsonb)",[tripId,randomUUID(),session.memberId,memberId]);
  });
}

async function testProviderFailureRecovery(pool, baseSession) {
  requireDisposableDatabaseTarget();
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
    databaseTarget(connectionString, "TEST_DATABASE_URL").databaseName);
  const { readAiRequestRecovery, findAiRequestReplay } = await import("../../src/lib/ai/request-recovery.ts");
  const { listAiConversationMessages } = await import("../../src/lib/ai/conversation-history.ts");
  const tripId = randomUUID(), otherTripId = randomUUID();
  const owner = { ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role: "owner" };
  const member = { ...owner, memberId: randomUUID(), userId: randomUUID(), role: "editor" };
  const coOwner = { ...owner, memberId: randomUUID(), userId: randomUUID() };
  const otherTripOwner = { ...owner, tripId: otherTripId, memberId: randomUUID() };
  for (const actor of [owner, member, coOwner]) await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic failure recovery user')", [actor.userId]);
  for (const currentTrip of [tripId, otherTripId]) await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic provider failure recovery','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE+5)`, [currentTrip, owner.userId]);
  const conversations = new Map();
  for (const actor of [owner, member, coOwner, otherTripOwner]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic failure recovery member',$4,'active')`, [actor.tripId, actor.memberId, actor.userId, actor.role]);
    const conversationId = randomUUID(); conversations.set(actor.memberId, conversationId);
    await pool.query("INSERT INTO ai_conversations(trip_id,id,actor_member_id,actor_user_id) VALUES($1,$2,$3,$4)",
      [actor.tripId, conversationId, actor.memberId, actor.userId]);
  }
  const details = { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2026-09-09T21:00:00.000Z" };
  const saved = [];
  const saveRequest = async (actor, options = {}) => {
    const id = options.id ?? randomUUID(), clientRequestId = options.clientRequestId ?? randomUUID();
    const status = options.status ?? "failed", code = options.code ?? details.code;
    await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,conversation_id,
      prompt_text,result_text,requested_model,provider,transport,status,error_code,error_message,client_request_id,request_payload_hash,completed_at)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic private failure prompt','SYNTHETIC_RAW_RESULT','claude-opus-5-5','anthropic','claude_agent_sdk',
        $7,$8,'SYNTHETIC_RAW_DIAGNOSTIC',$9,$10,CASE WHEN $7='started' THEN NULL ELSE CURRENT_TIMESTAMP END)`,
    [actor.tripId, id, actor.memberId, actor.userId, actor.role, conversations.get(actor.memberId), status, code, clientRequestId, "a".repeat(64)]);
    const result = { id, clientRequestId, actor, status, code }; saved.push(result); return result;
  };
  const event = (request, sequence, payload, eventType = "request.failed") => pool.query(`INSERT INTO ai_request_events(trip_id,ai_request_id,sequence,event_type,payload)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [request.actor.tripId, request.id, sequence, eventType, JSON.stringify(payload)]);
  const valid = await saveRequest(member);
  await event(valid, 1, { errorCode: details.code, providerFailure: details, otherDiagnostic: "SYNTHETIC_RAW_DIAGNOSTIC" });
  const legacy = await saveRequest(member);
  const malformed = await saveRequest(member);
  await event(malformed, 1, { errorCode: details.code, providerFailure: { ...details, account: "SYNTHETIC_PRIVATE_ACCOUNT" } });
  const mismatchedEvent = await saveRequest(member);
  await event(mismatchedEvent, 1, { errorCode: "AI_PROVIDER_UNAVAILABLE", providerFailure: details });
  const mismatchedDetails = await saveRequest(member);
  await event(mismatchedDetails, 1, { errorCode: details.code, providerFailure: { ...details, code: "AI_PROVIDER_UNAVAILABLE" } });
  const newerInconsistent = await saveRequest(member);
  await event(newerInconsistent, 1, { errorCode: details.code, providerFailure: details });
  await event(newerInconsistent, 2, { errorCode: "AI_PROVIDER_UNAVAILABLE", providerFailure: { code: "AI_PROVIDER_UNAVAILABLE", provider: "anthropic" } });
  const warningOnly = await saveRequest(member);
  await event(warningOnly, 1, { errorCode: details.code, providerFailure: details }, "provider.warning");
  const rejected = await saveRequest(member, { status: "rejected" });
  await event(rejected, 1, { errorCode: details.code, providerFailure: details });
  const unknown = await saveRequest(member, { code: "SYNTHETIC_PRIVATE_ERROR" });
  await event(unknown, 1, { errorCode: "SYNTHETIC_PRIVATE_ERROR", providerFailure: details });
  const ownerRequest = await saveRequest(owner);
  // The request ID is globally random in normal operation; composite trip IDs
  // remain an independently enforced privacy boundary even for synthetic reuse.
  const foreignRequest = await saveRequest(otherTripOwner, { id: ownerRequest.id });
  const foreignDetails = { ...details, retryAt: "2026-09-10T12:00:00.000Z" };
  await event(foreignRequest, 1, { errorCode: details.code, providerFailure: foreignDetails });
  const beforeReads = (await pool.query(`SELECT
    (SELECT count(*)::int FROM ai_requests WHERE trip_id=ANY($1::uuid[])) AS requests,
    (SELECT count(*)::int FROM ai_request_events WHERE trip_id=ANY($1::uuid[])) AS events`, [[tripId, otherTripId]])).rows[0];
  const recovered = await readAiRequestRecovery(pool, member, tripId, valid.clientRequestId);
  assert.equal(recovered.request.errorCode, details.code); assert.deepEqual(recovered.request.providerFailure, details);
  assert.equal(recovered.request.message, null); assert.equal(recovered.request.result, null);
  const replay = await inTransaction(pool, (client) => findAiRequestReplay(client, member, valid.clientRequestId, "a".repeat(64)));
  assert.deepEqual(replay.request, recovered.request, "manual keyed replay returns recorded failure without creating provider work");
  for (const request of [legacy, malformed, mismatchedEvent, mismatchedDetails, newerInconsistent, warningOnly, rejected, unknown]) {
    const current = (await readAiRequestRecovery(pool, member, tripId, request.clientRequestId)).request;
    assert.equal(current.errorCode, "AI_REQUEST_FAILED"); assert.equal(Object.hasOwn(current, "providerFailure"), false);
    assert.equal(current.message, null); assert.equal(current.result, null);
  }
  const ownerFailure = (await readAiRequestRecovery(pool, owner, tripId, ownerRequest.clientRequestId)).request;
  assert.equal(ownerFailure.errorCode, "AI_REQUEST_FAILED"); assert.equal(Object.hasOwn(ownerFailure, "providerFailure"), false);
  assert.deepEqual((await readAiRequestRecovery(pool, otherTripOwner, otherTripId, foreignRequest.clientRequestId)).request.providerFailure, foreignDetails);
  for (const actor of [owner, coOwner]) {
    assert.equal((await readAiRequestRecovery(pool, actor, tripId, valid.clientRequestId)).request, null, "trip ownership never grants another person's request recovery");
    await assert.rejects(listAiConversationMessages(pool, actor, tripId, conversations.get(member.memberId)), AppNotFoundError);
  }
  await assert.rejects(readAiRequestRecovery(pool, member, otherTripId, foreignRequest.clientRequestId), AppForbiddenError);
  const history = await listAiConversationMessages(pool, member, tripId, conversations.get(member.memberId));
  assert.equal(history.messages.length, 9);
  assert.deepEqual(history.messages.find((message) => message.requestId === valid.id).providerFailure, details);
  assert.ok(history.messages.filter((message) => message.requestId !== valid.id).every((message) => !Object.hasOwn(message, "providerFailure")));
  assert.doesNotMatch(JSON.stringify([recovered, replay, history, ownerFailure]), /SYNTHETIC_RAW|SYNTHETIC_PRIVATE/u);
  assert.deepEqual((await pool.query(`SELECT
    (SELECT count(*)::int FROM ai_requests WHERE trip_id=ANY($1::uuid[])) AS requests,
    (SELECT count(*)::int FROM ai_request_events WHERE trip_id=ANY($1::uuid[])) AS events`, [[tripId, otherTripId]])).rows[0], beforeReads);
  await pool.query("UPDATE ai_conversations SET closed_at=CURRENT_TIMESTAMP,closed_reason='user_reset' WHERE trip_id=$1 AND id=$2",
    [tripId, conversations.get(member.memberId)]);
  assert.equal((await readAiRequestRecovery(pool, member, tripId, valid.clientRequestId)).request, null);
  assert.deepEqual((await listAiConversationMessages(pool, member, tripId, conversations.get(member.memberId))).messages.find((message) => message.requestId === valid.id).providerFailure,
    details, "ordinary user archives keep safe failure history without reviving the request");
  await pool.query("UPDATE ai_conversations SET history_revoked_at=CURRENT_TIMESTAMP WHERE trip_id=$1 AND id=$2",
    [tripId, conversations.get(member.memberId)]);
  await assert.rejects(listAiConversationMessages(pool, member, tripId, conversations.get(member.memberId)), AppNotFoundError);
  await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [tripId, member.memberId]);
  await assert.rejects(readAiRequestRecovery(pool, member, tripId, valid.clientRequestId), AppForbiddenError);
  const replacementUserId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic replacement failure user')", [replacementUserId]);
  await pool.query("UPDATE trip_members SET status='active',user_id=$3 WHERE trip_id=$1 AND id=$2", [tripId, member.memberId, replacementUserId]);
  await assert.rejects(readAiRequestRecovery(pool, member, tripId, valid.clientRequestId), AppForbiddenError);
  const replacement = { ...member, userId: replacementUserId };
  assert.equal((await readAiRequestRecovery(pool, replacement, tripId, valid.clientRequestId)).request, null);
  await assert.rejects(listAiConversationMessages(pool, replacement, tripId, conversations.get(member.memberId)), AppNotFoundError);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM ai_requests WHERE trip_id=ANY($1::uuid[])", [[tripId, otherTripId]])).rows[0].total,
    saved.length, "failed records remain retained across revocation");
}

async function testMemberPaymentsAndRemoval(pool, baseSession) {
  requireDisposableDatabaseTarget();
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
    databaseTarget(connectionString, "TEST_DATABASE_URL").databaseName);
  assert.deepEqual(await migrate({ connectionString, through: "0040_member_payments.sql" }), ["0040_member_payments.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0040_member_payments.sql" }), []);
  assert.deepEqual(await migrate({ connectionString, through: "0041_member_payment_removal.sql" }), ["0041_member_payment_removal.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0041_member_payment_removal.sql" }), []);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM app_schema_migrations")).rows[0].total, 41);
  const id = (group, number) => `ef${group}0000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const tripId = id("10", 1), foreignTripId = id("10", 2), dayId = id("30", 1);
  const owner = { ...baseSession, tripId, memberId: id("20", 1), userId: id("00", 1), role: "owner" };
  const sender = { ...owner, memberId: id("20", 2), userId: id("00", 2), role: "editor" };
  const recipient = { ...sender, memberId: id("20", 3), userId: id("00", 3) };
  const unrelated = { ...sender, memberId: id("20", 4), userId: id("00", 4), role: "viewer" };
  const disabled = { ...sender, memberId: id("20", 5), userId: id("00", 5) };
  const foreign = { ...sender, tripId: foreignTripId, memberId: id("20", 6) };
  const actors = [owner, sender, recipient, unrelated, disabled];
  for (const actor of actors) await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic repayment user')", [actor.userId]);
  for (const currentTrip of [tripId, foreignTripId]) await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic repayments trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`, [currentTrip, owner.userId]);
  for (const actor of [...actors, foreign]) await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
    VALUES($1,$2,$3,$4,$5,'active')`, [actor.tripId, actor.memberId, actor.userId, `Synthetic ${actor.memberId.slice(-2)}`, actor.role]);
  const invitedId = id("20", 7);
  await pool.query(`INSERT INTO trip_members(trip_id,id,display_name,role,status)
    VALUES($1,$2,'Synthetic invited repayment member','editor','invited')`, [tripId, invitedId]);
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')", [tripId, dayId]);
  const permission = (approval) => ({ canEditItinerary: true, itineraryRequiresApproval: false,
    canEditExpenses: true, expenseRequiresApproval: approval, canSyncCalendar: true });
  await updateMemberPermissions(pool, owner, tripId, sender.memberId, permission(true));
  await updateMemberPermissions(pool, owner, tripId, recipient.memberId, permission(false));
  await updateTripMember(pool, owner, tripId, disabled.memberId, { disabled: true });
  const input = (from, to, amountMinor = 101, currency = "JPY") => ({ fromMemberId: from, toMemberId: to,
    amountMinor, currency, occurredAt: "2020-04-01T12:00:00.000Z", note: "Synthetic external cash only",
    clientRequestId: randomUUID(), confirmation: true });
  const action = (verb, revision) => ({ action: verb, expectedRevision: revision, confirmation: true, clientRequestId: randomUUID() });
  const load = (actor) => loadMemberPayments(pool, { tripId: actor.tripId, memberId: actor.memberId, isOwner: actor.role === "owner",
    canEditExpenses: actor.role !== "viewer", expenseRequiresApproval: actor.memberId === sender.memberId });
  const snapshot = async (paymentId) => ({
    canonical: (await pool.query("SELECT * FROM member_payments WHERE trip_id=$1 AND id=$2", [tripId, paymentId])).rows[0],
    revisions: (await pool.query("SELECT * FROM member_payment_revisions WHERE trip_id=$1 AND payment_id=$2 ORDER BY revision", [tripId, paymentId])).rows,
    audits: (await pool.query("SELECT * FROM audit_events WHERE trip_id=$1 AND entity_type='member_payment' AND entity_id=$2 ORDER BY created_at,id", [tripId, paymentId])).rows,
    actions: (await pool.query("SELECT * FROM member_payment_actions WHERE trip_id=$1 AND payment_id=$2 ORDER BY created_at,id", [tripId, paymentId])).rows,
  });
  const noPayments = async () => assert.equal((await pool.query("SELECT count(*)::int AS total FROM member_payments WHERE trip_id=$1", [tripId])).rows[0].total, 0);
  await assert.rejects(createMemberPayment(pool, sender, tripId, input(recipient.memberId, sender.memberId)), AppForbiddenError);
  await assert.rejects(createMemberPayment(pool, unrelated, tripId, input(unrelated.memberId, sender.memberId)), AppForbiddenError);
  await assert.rejects(createMemberPayment(pool, sender, foreignTripId, input(sender.memberId, recipient.memberId)), AppForbiddenError);
  for (const target of [foreign.memberId, disabled.memberId]) {
    await assert.rejects(createMemberPayment(pool, owner, tripId, input(sender.memberId, target)), AppInvalidInputError);
  }
  for (const invalid of [{ ...input(sender.memberId, sender.memberId) }, { ...input(sender.memberId, recipient.memberId), amountMinor: 0 },
    { ...input(sender.memberId, recipient.memberId), amountMinor: 1.5 }, { ...input(sender.memberId, recipient.memberId), confirmation: false },
    { ...input(sender.memberId, recipient.memberId), occurredAt: "2999-01-01T00:00:00.000Z" }]) {
    await assert.rejects(createMemberPayment(pool, owner, tripId, invalid));
  }
  await noPayments();

  // Concurrent retries are one record/version/action, and new keys are never
  // inferred for old forms. No expense or cash movement is created by this API.
  const postedInput = input(sender.memberId, recipient.memberId);
  const [posted, replayed] = await Promise.all([createMemberPayment(pool, owner, tripId, postedInput), createMemberPayment(pool, owner, tripId, postedInput)]);
  assert.deepEqual(replayed, posted);
  assert.equal(posted.status, "posted"); assert.equal(posted.revision, 1);
  const postedBefore = await snapshot(posted.id);
  assert.equal(postedBefore.revisions.length, 1); assert.equal(postedBefore.audits.length, 1); assert.equal(postedBefore.actions.length, 1);
  assert.deepEqual(postedBefore.revisions[0].snapshot, memberPaymentSnapshot(postedBefore.canonical));
  assert.equal(postedBefore.audits[0].action, "payment_create");
  assert.equal(postedBefore.audits[0].metadata.recordsExternalPaymentOnly, true);
  await assert.rejects(createMemberPayment(pool, owner, tripId, { ...postedInput, amountMinor: 102 }), AppConflictError);
  assert.deepEqual(await snapshot(posted.id), postedBefore);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM expenses WHERE trip_id=$1", [tripId])).rows[0].total, 0);
  for (const actor of [owner, sender, recipient]) assert.equal((await load(actor)).some((payment) => payment.id === posted.id), true);
  assert.deepEqual(await load(unrelated), []); assert.deepEqual(await load(foreign), []);
  await assert.rejects(updateMemberPayment(pool, unrelated, tripId, posted.id, action("void", 1)), AppNotFoundError);
  await assert.rejects(updateMemberPayment(pool, recipient, tripId, posted.id, action("void", 1)), AppForbiddenError);

  const pendingInput = input(sender.memberId, recipient.memberId, 23);
  const pending = await createMemberPayment(pool, sender, tripId, pendingInput);
  assert.equal(pending.status, "pending"); assert.equal(pending.canReview, false);
  assert.equal((await load(owner)).find((payment) => payment.id === pending.id).canReview, true);
  await assert.rejects(updateMemberPayment(pool, sender, tripId, pending.id, action("approve", 1)), AppForbiddenError);
  const approve = action("approve", 1);
  const [approved, approvedReplay] = await Promise.all([updateMemberPayment(pool, owner, tripId, pending.id, approve), updateMemberPayment(pool, owner, tripId, pending.id, approve)]);
  assert.deepEqual(approved, approvedReplay); assert.equal(approved.status, "posted"); assert.equal(approved.revision, 2);
  await assert.rejects(updateMemberPayment(pool, owner, tripId, pending.id, action("void", 1)), AppConflictError);
  const pendingBefore = await snapshot(pending.id);
  assert.deepEqual(pendingBefore.revisions.map((revision) => revision.action), ["create", "approve"]);
  assert.deepEqual(pendingBefore.audits.map((entry) => entry.action), ["payment_create", "payment_approve"]);

  const rejected = await createMemberPayment(pool, sender, tripId, input(sender.memberId, recipient.memberId, 29));
  assert.equal((await updateMemberPayment(pool, owner, tripId, rejected.id, action("reject", 1))).status, "rejected");
  const unfinishedInput = input(sender.memberId, owner.memberId, 31);
  const unfinished = await createMemberPayment(pool, sender, tripId, unfinishedInput);
  const opposite = await createMemberPayment(pool, recipient, tripId, input(recipient.memberId, sender.memberId, 97, "USD"));
  assert.equal(opposite.status, "posted", "explicit no-approval expense permission permits own payment posting");
  await updateMemberPermissions(pool, owner, tripId, recipient.memberId, permission(true));
  const survivorPendingInput = input(recipient.memberId, sender.memberId, 17);
  const survivorPending = await createMemberPayment(pool, recipient, tripId, survivorPendingInput);
  await updateMemberPermissions(pool, owner, tripId, recipient.memberId, permission(false));
  const otherCurrency = await createMemberPayment(pool, owner, tripId, input(sender.memberId, recipient.memberId, 7, "EUR"));
  const voided = await createMemberPayment(pool, owner, tripId, input(owner.memberId, recipient.memberId, 9));
  const voidInput = action("void", 1);
  assert.equal((await updateMemberPayment(pool, owner, tripId, voided.id, voidInput)).status, "void");
  assert.equal((await updateMemberPayment(pool, owner, tripId, voided.id, voidInput)).status, "void");
  await assert.rejects(updateMemberPayment(pool, owner, tripId, voided.id, action("approve", 2)), AppConflictError);
  const ownerOnBehalf = await createMemberPayment(pool, owner, tripId, input(invitedId, recipient.memberId, 11));
  assert.equal(ownerOnBehalf.status, "posted", "named unbound members can have external cash records");

  // A creator-only unapproved record can exist after a previous role change.
  // It must be permanently invalidated too, although its original parties remain.
  const creatorOnlyId = randomUUID();
  await inTransaction(pool, async (client) => {
    const row = (await client.query(`INSERT INTO member_payments(trip_id,id,from_member_id,to_member_id,accounting_from_member_id,accounting_to_member_id,
      currency,amount_minor,occurred_at,note,status,created_by_member_id,created_by_user_id,client_request_id,request_hash)
      VALUES($1,$2,$3,$4,$3,$4,'JPY',13,'2020-04-01T12:00:00Z','Synthetic creator-only history','pending',$5,$6,$7,$8) RETURNING *`,
    [tripId, creatorOnlyId, recipient.memberId, owner.memberId, sender.memberId, sender.userId, randomUUID(), "a".repeat(64)])).rows[0];
    await client.query(`INSERT INTO member_payment_revisions(trip_id,payment_id,revision,changed_by_member_id,changed_by_user_id,snapshot,action)
      VALUES($1,$2,1,$3,$4,$5::jsonb,'create')`, [tripId, creatorOnlyId, sender.memberId, sender.userId, JSON.stringify(memberPaymentSnapshot(row))]);
  });
  // New/updated records require exact append-only snapshots, real immutable cash
  // facts and same-trip FKs. SQL cannot bypass the UI's irreversible history.
  for (const sql of ["UPDATE member_payments SET amount_minor=102 WHERE trip_id=$1 AND id=$2",
    "UPDATE member_payments SET from_member_id=to_member_id WHERE trip_id=$1 AND id=$2",
    "UPDATE member_payments SET note='rewritten' WHERE trip_id=$1 AND id=$2",
    "DELETE FROM member_payments WHERE trip_id=$1 AND id=$2",
    "UPDATE member_payment_revisions SET snapshot='{}'::jsonb WHERE trip_id=$1 AND payment_id=$2",
    "DELETE FROM member_payment_revisions WHERE trip_id=$1 AND payment_id=$2",
    "UPDATE member_payment_actions SET request_hash=repeat('b',64) WHERE trip_id=$1 AND payment_id=$2"]) {
    await assert.rejects(pool.query(sql, [tripId, posted.id]));
  }
  await assert.rejects(pool.query("UPDATE member_payments SET status='void' WHERE trip_id=$1 AND id=$2", [tripId, posted.id]), /snapshot/u);
  await assert.rejects(inTransaction(pool, async (client) => {
    await client.query("UPDATE member_payments SET status='void' WHERE trip_id=$1 AND id=$2", [tripId, posted.id]);
    await client.query(`INSERT INTO member_payment_revisions(trip_id,payment_id,revision,changed_by_member_id,snapshot,action)
      VALUES($1,$2,2,$3,'{}'::jsonb,'void')`, [tripId, posted.id, owner.memberId]);
  }), /snapshot/u);
  assert.deepEqual(await snapshot(posted.id), postedBefore);
  await assert.rejects(inTransaction(pool, async (client) => {
    const changed = (await client.query(`UPDATE member_payments SET accounting_from_member_id=$3
      WHERE trip_id=$1 AND id=$2 RETURNING *`, [tripId, posted.id, owner.memberId])).rows[0];
    await client.query(`INSERT INTO member_payment_revisions(trip_id,payment_id,revision,changed_by_member_id,snapshot,action)
      VALUES($1,$2,$3,$4,$5::jsonb,'member_reassigned')`, [tripId, posted.id, changed.current_revision, owner.memberId, JSON.stringify(memberPaymentSnapshot(changed))]);
  }), (error) => error.code === "23514" && error.constraint === "member_payments_accounting_removal_only_ck");
  await assert.rejects(pool.query("UPDATE trip_members SET status='removed' WHERE trip_id=$1 AND id=$2", [tripId, sender.memberId]),
    (error) => error.code === "23514" && error.constraint === "member_payments_no_removed_obligations_ck");

  // An owner may read repayment facts, but not the private dinner/bill itself.
  const privateItem = randomUUID(), privateExpense = randomUUID();
  await inTransaction(pool, async (client) => {
    await client.query(`INSERT INTO itinerary_items(trip_id,id,trip_day_id,created_by_member_id,title,visibility)
      VALUES($1,$2,$3,$4,'Synthetic hidden repayment venue','private')`, [tripId, privateItem, dayId, recipient.memberId]);
    await client.query(`INSERT INTO itinerary_item_viewers(trip_id,itinerary_item_id,member_id,added_by_member_id)
      VALUES($1,$2,$3,$4)`, [tripId, privateItem, sender.memberId, recipient.memberId]);
    await client.query(`INSERT INTO itinerary_revisions(trip_id,itinerary_item_id,revision,changed_by_member_id,snapshot,reason)
      VALUES($1,$2,1,$3,$4::jsonb,'Synthetic private repayment fixture')`, [tripId, privateItem, recipient.memberId,
      JSON.stringify({ id: privateItem, tripDayId: dayId, title: "Synthetic hidden repayment venue", itemType: "activity",
        createdByMemberId: recipient.memberId, visibility: "private", viewerMemberIds: [sender.memberId], status: "planned", currentRevision: 1 })]);
    await client.query(`INSERT INTO expenses(trip_id,id,payer_member_id,itinerary_item_id,description,amount_minor,currency,status,occurred_at)
      VALUES($1,$2,$3,$4,'Synthetic hidden repayment bill',19,'JPY','posted',CURRENT_TIMESTAMP)`, [tripId, privateExpense, recipient.memberId, privateItem]);
    await client.query("INSERT INTO expense_splits(trip_id,expense_id,member_id,share_minor) VALUES($1,$2,$3,19)", [tripId, privateExpense, recipient.memberId]);
    await client.query(`INSERT INTO expense_revisions(trip_id,expense_id,revision,changed_by_member_id,snapshot)
      VALUES($1,$2,1,$3,'{"synthetic":true}'::jsonb)`, [tripId, privateExpense, recipient.memberId]);
  });
  const privateBefore = (await pool.query("SELECT to_jsonb(expense) AS row FROM expenses expense WHERE trip_id=$1 AND id=$2", [tripId, privateExpense])).rows[0];
  const ownerOverview = await getAppOverview(pool, owner);
  assert.equal(ownerOverview.expenses.some((expense) => expense.id === privateExpense), false);
  assert.equal(ownerOverview.itinerary.some((item) => item.id === privateItem), false);
  assert.equal(JSON.stringify(ownerOverview).includes("Synthetic hidden repayment"), false);
  assert.equal((await load(owner)).some((payment) => payment.id === opposite.id), true);

  const confirmationFor = (preview, paymentReassignments = []) => ({ confirmation: true, expectedRevision: preview.member.revision,
    previewDigest: preview.previewDigest, paymentReassignments });
  const preview = await getTripMemberRemovalPreview(pool, owner, tripId, sender.memberId);
  assert.equal(preview.counts.payments, 4); assert.equal(preview.counts.pendingPayments, 4);
  assert.equal(preview.expenses.length, 0); assert.equal(preview.hiddenPrivateExpenseCount, 0);
  assert.equal(preview.canRemove, false); assert.equal(preview.canRemoveWithReassignment, true);
  assert.equal((await pool.query("SELECT max(revision)::int AS revision FROM itinerary_revisions WHERE trip_id=$1 AND itinerary_item_id=$2",
    [tripId, privateItem])).rows[0].revision, 1, "removal fixtures must start with a recorded canonical revision");
  assert.ok(preview.payments.every((payment) => payment.eligibleMembers.every((member) => ![sender.memberId, disabled.memberId, invitedId, foreign.memberId].includes(member.id))));
  const choices = preview.payments.map((payment) => ({ paymentId: payment.id, expectedRevision: payment.revision,
    ...(payment.requiresFromReplacement ? { replacementAccountingFromMemberId: owner.memberId } : {}),
    ...(payment.requiresToReplacement ? { replacementAccountingToMemberId: owner.memberId } : {}) }));
  await assert.rejects(removeTripMemberSafely(pool, owner, tripId, sender.memberId, confirmationFor(preview)), AppConflictError);
  for (const candidate of [disabled.memberId, invitedId, foreign.memberId, sender.memberId]) {
    const bad = choices.map((choice) => ({ ...choice }));
    const fromChoice = bad.find((choice) => choice.replacementAccountingFromMemberId);
    fromChoice.replacementAccountingFromMemberId = candidate;
    await assert.rejects(removeTripMemberSafely(pool, owner, tripId, sender.memberId, confirmationFor(preview, bad)), AppConflictError);
  }
  await assert.rejects(removeTripMemberSafely(pool, recipient, tripId, sender.memberId, confirmationFor(preview, choices)), AppForbiddenError);
  await assert.rejects(removeTripMemberSafely(pool, owner, tripId, sender.memberId, confirmationFor(preview, [...choices, choices[0]])), AppConflictError);
  const staleChoices = choices.map((choice, index) => ({ ...choice, expectedRevision: choice.expectedRevision + (index === 0 ? 1 : 0) }));
  await assert.rejects(removeTripMemberSafely(pool, owner, tripId, sender.memberId, confirmationFor(preview, staleChoices)), AppConflictError);
  assert.deepEqual(await snapshot(posted.id), postedBefore, "invalid removal plans must not touch cash, history or audit");
  // Eligibility changes while the owner reviews the dialog invalidate its digest.
  await updateTripMember(pool, owner, tripId, disabled.memberId, { disabled: false });
  await assert.rejects(removeTripMemberSafely(pool, owner, tripId, sender.memberId, confirmationFor(preview, choices)), AppConflictError);
  const fresh = await getTripMemberRemovalPreview(pool, owner, tripId, sender.memberId);
  const allBefore = new Map();
  for (const payment of await load(owner)) allBefore.set(payment.id, await snapshot(payment.id));
  await removeTripMemberSafely(pool, owner, tripId, sender.memberId, confirmationFor(fresh, choices));
  assert.deepEqual((await pool.query("SELECT revision FROM itinerary_revisions WHERE trip_id=$1 AND itinerary_item_id=$2 ORDER BY revision",
    [tripId, privateItem])).rows.map((row) => row.revision), [1, 2], "removing a private viewer appends to the initial history");
  assert.equal((await pool.query("SELECT status FROM trip_members WHERE trip_id=$1 AND id=$2", [tripId, sender.memberId])).rows[0].status, "removed");
  await assert.rejects(getTripMemberRemovalPreview(pool, owner, tripId, sender.memberId), AppNotFoundError);
  await assert.rejects(removeTripMemberSafely(pool, owner, tripId, sender.memberId, confirmationFor(fresh, choices)), AppNotFoundError);
  for (const paymentId of [posted.id, pending.id, opposite.id, otherCurrency.id]) {
    const before = allBefore.get(paymentId), after = await snapshot(paymentId);
    for (const field of ["from_member_id", "to_member_id", "created_by_member_id", "created_by_user_id", "currency", "amount_minor", "occurred_at", "note", "client_request_id", "request_hash"])
      assert.deepEqual(after.canonical[field], before.canonical[field], `removal must preserve original ${field}`);
    assert.equal(after.canonical.status, "posted"); assert.equal(after.canonical.current_revision, before.canonical.current_revision + 1);
    assert.equal(after.canonical.accounting_from_member_id, before.canonical.accounting_from_member_id === sender.memberId ? owner.memberId : before.canonical.accounting_from_member_id);
    assert.equal(after.canonical.accounting_to_member_id, before.canonical.accounting_to_member_id === sender.memberId ? owner.memberId : before.canonical.accounting_to_member_id);
    assert.deepEqual(after.revisions.slice(0, -1), before.revisions); assert.deepEqual(after.actions, before.actions);
    assert.deepEqual(after.revisions.at(-1).snapshot, memberPaymentSnapshot(after.canonical));
    assert.equal(after.revisions.at(-1).action, "member_reassigned");
    assert.equal(after.audits.at(-1).metadata.originalPaymentRetained, true);
    assert.equal(after.audits.at(-1).metadata.accountingOnly, true);
  }
  for (const paymentId of [rejected.id, unfinished.id, survivorPending.id, creatorOnlyId]) {
    const before = allBefore.get(paymentId), after = await snapshot(paymentId);
    assert.equal(after.canonical.status, "void"); assert.equal(after.canonical.current_revision, before.canonical.current_revision + 1);
    assert.equal(after.canonical.amount_minor, before.canonical.amount_minor); assert.equal(after.canonical.from_member_id, before.canonical.from_member_id);
    assert.deepEqual(after.revisions.slice(0, -1), before.revisions); assert.equal(after.revisions.at(-1).action, "void");
    await assert.rejects(updateMemberPayment(pool, owner, tripId, paymentId, action("approve", after.canonical.current_revision)), AppConflictError);
    await assert.rejects(pool.query("UPDATE member_payments SET status='posted' WHERE trip_id=$1 AND id=$2", [tripId, paymentId]), /status transition/u);
  }
  for (const paymentId of [voided.id, ownerOnBehalf.id]) assert.deepEqual(await snapshot(paymentId), allBefore.get(paymentId));
  assert.equal((await createMemberPayment(pool, owner, tripId, postedInput)).revision, 2, "old create replay returns current bookkeeping state without duplicate cash");
  assert.equal((await createMemberPayment(pool, recipient, tripId, survivorPendingInput)).status, "void",
    "a surviving creator retry returns the terminal void, even if current permission would post a new payment");
  await assert.rejects(createMemberPayment(pool, sender, tripId, unfinishedInput), AppForbiddenError);
  assert.equal((await load(sender)).length, 0, "removed members lose repayment read access even though original identity is retained");
  assert.deepEqual((await pool.query("SELECT to_jsonb(expense) AS row FROM expenses expense WHERE trip_id=$1 AND id=$2", [tripId, privateExpense])).rows[0], privateBefore);
  assert.equal((await getAppOverview(pool, owner)).expenses.some((expense) => expense.id === privateExpense), false);
  assert.equal((await getAppOverview(pool, recipient)).expenses.some((expense) => expense.id === privateExpense), true);
  const remaining = await getAppOverview(pool, owner);
  assert.equal(remaining.expenseLedger.balances.some((balance) => balance.memberId === sender.memberId), false);
  for (const currency of ["JPY", "USD", "EUR"]) {
    assert.equal(remaining.expenseLedger.balances.filter((balance) => balance.currency === currency).reduce((sum, balance) => sum + balance.netMinor, 0), 0);
  }
  await assert.rejects(pool.query("DELETE FROM trip_members WHERE trip_id=$1 AND id=$2", [tripId, sender.memberId]));

  // Removing the recipient may explicitly converge both accounting legs onto
  // one remaining owner. The accounting effect becomes neutral, not a refund.
  const recipientPreview = await getTripMemberRemovalPreview(pool, owner, tripId, recipient.memberId);
  assert.equal(recipientPreview.hiddenPrivateExpenseCount, 1, "payment access must not bypass the private expense removal blocker");
  await assert.rejects(removeTripMemberSafely(pool, owner, tripId, recipient.memberId, confirmationFor(recipientPreview,
    recipientPreview.payments.map((payment) => ({ paymentId: payment.id, expectedRevision: payment.revision,
      ...(payment.requiresFromReplacement ? { replacementAccountingFromMemberId: owner.memberId } : {}),
      ...(payment.requiresToReplacement ? { replacementAccountingToMemberId: owner.memberId } : {}) })))), AppConflictError);
  // Resolve that independent private expense through its authorized creator.
  const voidExpenseRequest = await createChangeRequest(pool, recipient, tripId, { entityType: "expense", entityId: privateExpense,
    operation: "update", baseRevision: 1, source: "member", reason: "Synthetic independent private expense resolution", patch: { status: "void" } });
  await applyPermittedChangeRequest(pool, recipient, tripId, voidExpenseRequest.id);
  const readyRecipient = await getTripMemberRemovalPreview(pool, owner, tripId, recipient.memberId);
  await removeTripMemberSafely(pool, owner, tripId, recipient.memberId, confirmationFor(readyRecipient,
    readyRecipient.payments.map((payment) => ({ paymentId: payment.id, expectedRevision: payment.revision,
      ...(payment.requiresFromReplacement ? { replacementAccountingFromMemberId: owner.memberId } : {}),
      ...(payment.requiresToReplacement ? { replacementAccountingToMemberId: owner.memberId } : {}) }))));
  const neutral = (await snapshot(posted.id)).canonical;
  assert.equal(neutral.accounting_from_member_id, owner.memberId); assert.equal(neutral.accounting_to_member_id, owner.memberId);
  assert.equal(neutral.from_member_id, sender.memberId); assert.equal(neutral.to_member_id, recipient.memberId); assert.equal(neutral.amount_minor, "101");
  const finalLedger = (await getAppOverview(pool, owner)).expenseLedger;
  assert.ok(finalLedger.balances.every((balance) => ![sender.memberId, recipient.memberId].includes(balance.memberId)));

  // Prevent valid individual amounts from combining into an unreadable ledger.
  // This synthetic currency is isolated from every preceding expense/payment.
  const maximumInput = input(owner.memberId, unrelated.memberId, Number.MAX_SAFE_INTEGER, "CHF");
  const maximum = await createMemberPayment(pool, owner, tripId, maximumInput);
  const maximumBefore = await snapshot(maximum.id);
  assert.deepEqual(await createMemberPayment(pool, owner, tripId, maximumInput), maximum, "a max-sized record remains retryable without double counting");
  await assert.rejects(createMemberPayment(pool, owner, tripId, input(owner.memberId, unrelated.memberId, 1, "CHF")), AppInvalidInputError);
  assert.deepEqual(await snapshot(maximum.id), maximumBefore);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM member_payments WHERE trip_id=$1 AND currency='CHF'", [tripId])).rows[0].total, 1);
  await updateMemberPermissions(pool, owner, tripId, disabled.memberId, permission(true));
  const overCapacityPending = await createMemberPayment(pool, disabled, tripId, input(disabled.memberId, owner.memberId, 1, "CHF"));
  assert.equal(overCapacityPending.status, "pending");
  const overCapacityBefore = await snapshot(overCapacityPending.id);
  await assert.rejects(updateMemberPayment(pool, owner, tripId, overCapacityPending.id, action("approve", 1)), AppInvalidInputError);
  assert.deepEqual(await snapshot(overCapacityPending.id), overCapacityBefore, "failed approval keeps original pending record, revision and audit unchanged");
  assert.equal((await createMemberPayment(pool, owner, tripId, input(owner.memberId, unrelated.memberId, 1, "GBP"))).status, "posted", "each currency has an independent exact accounting limit");
  const overflowExpenseId = randomUUID();
  await assert.rejects(inTransaction(pool, async (client) => {
    await client.query(`INSERT INTO expenses(trip_id,id,payer_member_id,description,amount_minor,currency,status,occurred_at)
      VALUES($1,$2,$3,'Synthetic overflowing ledger expense',1,'CHF','posted',CURRENT_TIMESTAMP)`, [tripId, overflowExpenseId, owner.memberId]);
    await client.query("INSERT INTO expense_splits(trip_id,expense_id,member_id,share_minor) VALUES($1,$2,$3,1)", [tripId, overflowExpenseId, owner.memberId]);
    await client.query(`INSERT INTO expense_revisions(trip_id,expense_id,revision,changed_by_member_id,snapshot)
      VALUES($1,$2,1,$3,'{"synthetic":true}'::jsonb)`, [tripId, overflowExpenseId, owner.memberId]);
  }), (error) => error.code === "23514" && error.constraint === "member_payment_financial_capacity_ck");
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM expenses WHERE trip_id=$1 AND id=$2", [tripId, overflowExpenseId])).rows[0].total, 0);
  const safeOverview = await getAppOverview(pool, owner);
  assert.equal(safeOverview.expenseLedger.balances.filter((balance) => balance.currency === "CHF").reduce((sum, balance) => sum + balance.netMinor, 0), 0);
}

async function testIndividualEventExpenses(pool, baseSession) {
  requireDisposableDatabaseTarget();
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
    databaseTarget(connectionString, "TEST_DATABASE_URL").databaseName);
  const id = (group, number) => `ec${group}0000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const tripId = id("10", 1), dayId = id("30", 1);
  const owner = { ...baseSession, tripId, memberId: id("20", 1), userId: id("00", 1), role: "owner" };
  const dinerA = { ...owner, memberId: id("20", 2), userId: id("00", 2), role: "editor" };
  const dinerB = { ...dinerA, memberId: id("20", 3), userId: id("00", 3) };
  for (const actor of [owner, dinerA, dinerB]) {
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic individual expense user')", [actor.userId]);
  }
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic individual expense trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`,
  [tripId, owner.userId]);
  for (const actor of [owner, dinerA, dinerB]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic individual expense member',$4,'active')`,
    [tripId, actor.memberId, actor.userId, actor.role]);
  }
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')", [tripId, dayId]);
  for (const actor of [dinerA, dinerB]) {
    await updateMemberPermissions(pool, owner, tripId, actor.memberId, {
      canEditItinerary: true, itineraryRequiresApproval: false,
      canEditExpenses: true, expenseRequiresApproval: false, canSyncCalendar: true,
    });
  }

  // Real change-request/apply paths create one private event and two independent bills.
  // The owner is deliberately outside its audience; totals must not bypass privacy.
  const eventRequest = await createChangeRequest(pool, dinerA, tripId, {
    entityType: "itinerary_item", operation: "create", source: "member",
    reason: "Synthetic individual expense event", patch: {
      tripDayId: dayId, title: "Synthetic separately paid dinner", itemType: "meal",
      startsAt: "2030-04-01T10:00:00.000Z", endsAt: "2030-04-01T11:00:00.000Z",
      locationName: "Synthetic restaurant", visibility: "private", viewerMemberIds: [dinerB.memberId],
    },
  });
  const event = await applyPermittedChangeRequest(pool, dinerA, tripId, eventRequest.id);
  const createBill = (actor, amountMinor, description) => createChangeRequest(pool, actor, tripId, {
    entityType: "expense", operation: "create", source: "member",
    reason: "Synthetic individually paid event bill", patch: {
      itineraryItemId: event.entityId, description, amountMinor, currency: "JPY",
      payerMemberId: actor.memberId, splitMemberIds: [actor.memberId],
      occurredAt: "2030-04-01T10:00:00.000Z", status: "posted",
    },
  });
  const billARequest = await createBill(dinerA, 101, "Synthetic diner A bill");
  const billA = await applyPermittedChangeRequest(pool, dinerA, tripId, billARequest.id);
  const billBRequest = await createBill(dinerB, 203, "Synthetic diner B bill");
  const billB = await applyPermittedChangeRequest(pool, dinerB, tripId, billBRequest.id);
  assert.notEqual(billA.entityId, billB.entityId);
  assert.notEqual(billARequest.id, billBRequest.id);
  assert.equal(billA.revision, 1);
  assert.equal(billB.revision, 1);

  const balances = (overview) => overview.expenseLedger.balances.map((balance) => ({
    memberId: balance.memberId, currency: balance.currency, paidMinor: balance.paidMinor,
    shareMinor: balance.shareMinor, netMinor: balance.netMinor,
  }));
  const expectedBalances = (amountA) => [
    { memberId: dinerA.memberId, currency: "JPY", paidMinor: amountA, shareMinor: amountA, netMinor: 0 },
    { memberId: dinerB.memberId, currency: "JPY", paidMinor: 203, shareMinor: 203, netMinor: 0 },
  ];
  for (const actor of [dinerA, dinerB]) {
    const overview = await getAppOverview(pool, actor);
    assert.equal(overview.expenses.length, 2);
    assert.ok(overview.expenses.every((expense) => expense.itineraryItemId === event.entityId));
    assert.deepEqual(balances(overview), expectedBalances(101));
    assert.deepEqual(overview.expenseLedger.settlements, []);
    assert.equal(overview.expenses.find((expense) => expense.id === billA.entityId).currentMemberShareMinor,
      actor.memberId === dinerA.memberId ? 101 : 0);
    assert.equal(overview.expenses.find((expense) => expense.id === billB.entityId).currentMemberShareMinor,
      actor.memberId === dinerB.memberId ? 203 : 0);
  }

  async function billState(billId) {
    return {
      canonical: (await pool.query(`SELECT id,itinerary_item_id,payer_member_id,amount_minor::int AS amount_minor,
        currency,status,current_revision FROM expenses WHERE trip_id=$1 AND id=$2`, [tripId, billId])).rows,
      splits: (await pool.query(`SELECT member_id,share_minor::int AS share_minor FROM expense_splits
        WHERE trip_id=$1 AND expense_id=$2 ORDER BY member_id`, [tripId, billId])).rows,
      revisions: (await pool.query(`SELECT revision,changed_by_member_id,snapshot FROM expense_revisions
        WHERE trip_id=$1 AND expense_id=$2 ORDER BY revision`, [tripId, billId])).rows,
      audits: (await pool.query(`SELECT id,action,actor_member_id,before_state,after_state,metadata FROM audit_events
        WHERE trip_id=$1 AND entity_type='expense' AND entity_id=$2 ORDER BY created_at,id`, [tripId, billId])).rows,
    };
  }
  const states = [];
  for (const [actor, request, bill, amount] of [[dinerA, billARequest, billA, 101], [dinerB, billBRequest, billB, 203]]) {
    const state = await billState(bill.entityId);
    states.push(state);
    assert.deepEqual(state.canonical, [{ id: bill.entityId, itinerary_item_id: event.entityId,
      payer_member_id: actor.memberId, amount_minor: amount, currency: "JPY", status: "posted", current_revision: 1 }]);
    assert.deepEqual(state.splits, [{ member_id: actor.memberId, share_minor: amount }]);
    assert.equal(state.revisions.length, 1);
    assert.equal(state.revisions[0].revision, 1);
    assert.equal(state.revisions[0].changed_by_member_id, actor.memberId);
    assert.equal(state.revisions[0].snapshot.id, bill.entityId);
    assert.equal(state.revisions[0].snapshot.itineraryItemId, event.entityId);
    assert.deepEqual(state.revisions[0].snapshot.splits, [{ memberId: actor.memberId, shareMinor: amount }]);
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].action, "created");
    assert.equal(state.audits[0].actor_member_id, actor.memberId);
    assert.equal(state.audits[0].before_state, null);
    assert.deepEqual(state.audits[0].after_state, state.revisions[0].snapshot);
    assert.equal(state.audits[0].metadata.changeRequestId, request.id);
  }
  assert.notEqual(states[0].audits[0].id, states[1].audits[0].id);

  const editRequest = await createChangeRequest(pool, dinerA, tripId, {
    entityType: "expense", entityId: billA.entityId, operation: "update", baseRevision: billA.revision,
    source: "member", reason: "Synthetic correction to diner A only", patch: { amountMinor: 107 },
  });
  const editedBill = await applyPermittedChangeRequest(pool, dinerA, tripId, editRequest.id);
  assert.deepEqual(editedBill, { status: "approved", entityId: billA.entityId, revision: 2 });
  assert.deepEqual(await billState(billB.entityId), states[1], "editing one bill must not change its sibling's money, link or history");
  const editedState = await billState(billA.entityId);
  assert.equal(editedState.canonical[0].itinerary_item_id, event.entityId);
  assert.equal(editedState.canonical[0].amount_minor, 107);
  assert.equal(editedState.canonical[0].current_revision, 2);
  assert.deepEqual(editedState.splits, [{ member_id: dinerA.memberId, share_minor: 107 }]);
  assert.equal(editedState.revisions.length, 2);
  assert.deepEqual(editedState.revisions[0], states[0].revisions[0]);
  assert.equal(editedState.revisions[1].snapshot.amountMinor, 107);
  assert.equal(editedState.revisions[1].snapshot.itineraryItemId, event.entityId);
  assert.equal(editedState.audits.length, 2);
  assert.deepEqual(editedState.audits[0], states[0].audits[0]);
  assert.equal(editedState.audits[1].action, "update");
  assert.equal(editedState.audits[1].before_state.amountMinor, 101);
  assert.deepEqual(editedState.audits[1].after_state, editedState.revisions[1].snapshot);
  assert.equal(editedState.audits[1].metadata.changeRequestId, editRequest.id);
  for (const actor of [dinerA, dinerB]) {
    assert.deepEqual(balances(await getAppOverview(pool, actor)), expectedBalances(107));
  }
  assert.equal((await pool.query("SELECT current_revision FROM itinerary_items WHERE trip_id=$1 AND id=$2",
    [tripId, event.entityId])).rows[0].current_revision, 1, "standalone bills must not revise the shared event");

  const ownerOverview = await getAppOverview(pool, owner);
  assert.deepEqual(ownerOverview.itinerary, []);
  assert.deepEqual(ownerOverview.expenses, []);
  assert.deepEqual(ownerOverview.expenseLedger, { balances: [], settlements: [] });
  await assert.rejects(createBill(owner, 999, "Synthetic hidden owner bill attempt"), AppNotFoundError);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM expenses WHERE trip_id=$1", [tripId])).rows[0].total, 2);
  assert.deepEqual(await billState(billB.entityId), states[1]);
}

async function testCancelledEventRemoval(pool, baseSession) {
  requireDisposableDatabaseTarget();
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
    databaseTarget(connectionString, "TEST_DATABASE_URL").databaseName);
  assert.deepEqual(await migrate({ connectionString, through: "0038_cancelled_event_removal.sql" }),
    ["0038_cancelled_event_removal.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0038_cancelled_event_removal.sql" }), []);
  const id = (group, number) => `ed${group}0000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const tripId = id("10", 1), foreignTripId = id("10", 2), dayId = id("30", 1);
  const owner = { ...baseSession, tripId, memberId: id("20", 1), userId: id("00", 1), role: "owner" };
  const editor = { ...owner, memberId: id("20", 2), userId: id("00", 2), role: "editor" };
  const viewer = { ...owner, memberId: id("20", 3), userId: id("00", 3), role: "viewer" };
  const foreignOwner = { ...owner, tripId: foreignTripId, memberId: id("20", 4) };
  for (const actor of [owner, editor, viewer]) {
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic cancelled event user')", [actor.userId]);
  }
  for (const trip of [tripId, foreignTripId]) {
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic cancelled event trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`,
    [trip, owner.userId]);
  }
  for (const actor of [owner, editor, viewer, foreignOwner]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic cancelled event member',$4,'active')`,
    [actor.tripId, actor.memberId, actor.userId, actor.role]);
  }
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')", [tripId, dayId]);
  await updateMemberPermissions(pool, owner, tripId, editor.memberId, {
    canEditItinerary: true, itineraryRequiresApproval: false,
    canEditExpenses: true, expenseRequiresApproval: false, canSyncCalendar: true,
  });

  const newEvent = async (actor, patch = {}) => {
    const request = await createChangeRequest(pool, actor, tripId, {
      entityType: "itinerary_item", operation: "create", source: actor.role === "owner" ? "owner" : "member",
      reason: "Synthetic event removal setup", patch: {
        tripDayId: dayId, title: "Synthetic removable dinner", itemType: "meal",
        startsAt: "2030-04-01T10:00:00.000Z", endsAt: "2030-04-01T11:00:00.000Z",
        locationName: "Synthetic restaurant", visibility: "trip", ...patch,
      },
    });
    return { ...await applyPermittedChangeRequest(pool, actor, tripId, request.id), requestId: request.id };
  };
  const newBillRequest = (actor, itemId, overrides = {}) => createChangeRequest(pool, actor, tripId, {
    entityType: "expense", operation: "create", source: "member",
    reason: "Synthetic retained event bill", patch: {
      itineraryItemId: itemId, description: "Synthetic dinner bill", amountMinor: 101, currency: "JPY",
      payerMemberId: actor.memberId, splitMemberIds: [actor.memberId],
      occurredAt: "2030-04-01T10:00:00.000Z", status: "posted", ...overrides,
    },
  });
  const newBill = async (actor, itemId, overrides = {}) => {
    const request = await newBillRequest(actor, itemId, overrides);
    return applyPermittedChangeRequest(pool, actor, tripId, request.id);
  };
  const eventChange = (actor, event, operation, patch = {}, source = "member") => createChangeRequest(pool, actor, tripId, {
    entityType: "itinerary_item", entityId: event.entityId, operation, baseRevision: event.revision,
    source, reason: "Synthetic event change near removal", patch,
  });
  const remove = (actor, item, overrides = {}) => removeCancelledItineraryItem(pool, actor, actor.tripId, item.entityId,
    { expectedRevision: item.revision, confirm: true, ...overrides });
  const financialState = async () => ({
    expenses: (await pool.query("SELECT * FROM expenses WHERE trip_id=$1 ORDER BY id", [tripId])).rows,
    splits: (await pool.query("SELECT * FROM expense_splits WHERE trip_id=$1 ORDER BY expense_id,member_id", [tripId])).rows,
    revisions: (await pool.query("SELECT * FROM expense_revisions WHERE trip_id=$1 ORDER BY expense_id,revision", [tripId])).rows,
    audits: (await pool.query("SELECT * FROM audit_events WHERE trip_id=$1 AND entity_type='expense' ORDER BY created_at,id", [tripId])).rows,
  });
  const eventState = async (itemId) => ({
    item: (await pool.query("SELECT * FROM itinerary_items WHERE trip_id=$1 AND id=$2", [tripId, itemId])).rows[0],
    viewers: (await pool.query("SELECT * FROM itinerary_item_viewers WHERE trip_id=$1 AND itinerary_item_id=$2 ORDER BY member_id", [tripId, itemId])).rows,
    revisions: (await pool.query("SELECT * FROM itinerary_revisions WHERE trip_id=$1 AND itinerary_item_id=$2 ORDER BY revision", [tripId, itemId])).rows,
    audits: (await pool.query("SELECT * FROM audit_events WHERE trip_id=$1 AND entity_type='itinerary_item' AND entity_id=$2 ORDER BY created_at,id", [tripId, itemId])).rows,
  });

  const event = await newEvent(owner);
  const otherEvent = await newEvent(owner, { title: "Synthetic retained active event" });
  const bill = await newBill(owner, event.entityId, { splitMemberIds: [owner.memberId, editor.memberId] });
  const relinkBill = await newBill(owner, null, { description: "Synthetic unlinked bill", amountMinor: 23 });
  await assert.rejects(remove(owner, event), AppConflictError, "planned events must be cancelled explicitly first");
  assert.equal((await eventState(event.entityId)).item.current_revision, 1);

  const cancellation = await eventChange(owner, event, "cancel");
  const cancelled = await applyPermittedChangeRequest(pool, owner, tripId, cancellation.id);
  assert.equal(cancelled.revision, 2);
  for (const actor of [editor, viewer, { ...editor, role: "owner" }]) {
    await assert.rejects(remove(actor, cancelled), AppForbiddenError, "live trip role governs destructive controls");
  }
  await assert.rejects(remove(foreignOwner, cancelled), AppNotFoundError);
  await assert.rejects(removeCancelledItineraryItem(pool, owner, foreignTripId, cancelled.entityId,
    { expectedRevision: 2, confirm: true }), AppForbiddenError);
  await assert.rejects(remove(owner, cancelled, { expectedRevision: 1 }), AppConflictError);
  await assert.rejects(remove(owner, cancelled, { confirm: false }), AppInvalidInputError);

  const pendingEdit = await eventChange(editor, cancelled, "update", { notes: "Synthetic stale pending edit" });
  const pendingRestore = await eventChange(owner, cancelled, "restore");
  const rejectedRestore = await eventChange(owner, cancelled, "restore");
  await reviewChangeRequest(pool, owner, tripId, rejectedRestore.id, "reject", "Synthetic rejected restore", 1);
  const linkedCreate = await newBillRequest(editor, cancelled.entityId);
  const relinkRequest = await createChangeRequest(pool, editor, tripId, {
    entityType: "expense", entityId: relinkBill.entityId, operation: "update", baseRevision: 1,
    source: "member", reason: "Synthetic stale relink", patch: { itineraryItemId: cancelled.entityId },
  });
  const retainedCorrection = await createChangeRequest(pool, editor, tripId, {
    entityType: "expense", entityId: bill.entityId, operation: "update", baseRevision: 1,
    source: "member", reason: "Synthetic retained financial correction", patch: { description: "Synthetic corrected dinner bill" },
  });
  const unrelatedRequest = await eventChange(editor, otherEvent, "update", { notes: "Synthetic unaffected pending edit" });
  const terminalRequestIds = [pendingEdit.id, pendingRestore.id, rejectedRestore.id, linkedCreate.id, relinkRequest.id];
  const originalRequests = (await pool.query("SELECT * FROM change_requests WHERE trip_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",
    [tripId, terminalRequestIds])).rows;
  await pool.query(`INSERT INTO calendar_event_links(trip_id,itinerary_item_id,member_id,provider_event_id,last_synced_item_revision)
    VALUES($1,$2,$3,'synthetic-cancelled-calendar-copy',2)`, [tripId, cancelled.entityId, owner.memberId]);
  const calendarBefore = (await pool.query("SELECT * FROM calendar_event_links WHERE trip_id=$1 AND itinerary_item_id=$2",
    [tripId, cancelled.entityId])).rows;
  const moneyBefore = await financialState();
  const eventBefore = await eventState(cancelled.entityId);
  const overviewBefore = await getAppOverview(pool, owner);
  assert.ok(overviewBefore.itinerary.some((item) => item.id === cancelled.entityId && item.status === "cancelled"));
  assert.equal(overviewBefore.expenses.find((expense) => expense.id === bill.entityId).itineraryItemRemoved, false);
  assert.ok(overviewBefore.pendingItinerary.some((item) => item.requestId === pendingEdit.id));
  assert.ok((await inTransaction(pool, (client) => getAiPendingItineraryContext(client, owner, tripId)))
    .pendingItinerary.some((item) => item.requestId === pendingEdit.id));

  const result = await remove(owner, cancelled);
  assert.deepEqual(result, { status: "removed", itemId: cancelled.entityId, revision: 3 });
  const state = await eventState(cancelled.entityId);
  assert.equal(state.item.status, "cancelled");
  assert.equal(state.item.current_revision, 3);
  assert.ok(state.item.removed_at instanceof Date);
  assert.equal(state.item.removed_by_member_id, owner.memberId);
  assert.equal(state.item.created_by_member_id, eventBefore.item.created_by_member_id);
  assert.deepEqual(state.viewers, eventBefore.viewers);
  assert.deepEqual(state.revisions.slice(0, 2), eventBefore.revisions);
  assert.equal(state.revisions.length, 3);
  assert.equal(state.revisions[2].changed_by_member_id, owner.memberId);
  assert.equal(state.revisions[2].snapshot.currentRevision, 3);
  assert.ok(state.revisions[2].snapshot.removedAt);
  assert.equal(state.revisions[2].snapshot.removedByMemberId, owner.memberId);
  assert.deepEqual(state.audits.slice(0, 2), eventBefore.audits);
  assert.equal(state.audits.length, 3);
  assert.equal(state.audits[2].action, "removed");
  assert.equal(state.audits[2].actor_member_id, owner.memberId);
  assert.deepEqual(state.audits[2].after_state, state.revisions[2].snapshot);
  assert.deepEqual(await financialState(), moneyBefore, "removal must not erase, unlink or rebalance historical money");
  const calendarAfter = (await pool.query("SELECT * FROM calendar_event_links WHERE trip_id=$1 AND itinerary_item_id=$2",
    [tripId, cancelled.entityId])).rows;
  assert.equal(calendarAfter.length, 1);
  assert.equal(calendarAfter[0].sync_status, "stale");
  const retainedCalendarIdentity = (row) => {
    const identity = { ...row };
    delete identity.sync_status;
    delete identity.updated_at;
    return identity;
  };
  assert.deepEqual(calendarAfter.map(retainedCalendarIdentity), calendarBefore.map(retainedCalendarIdentity),
    "removing a local card does not delete the remote Calendar copy or its retained identity");

  const afterRequests = (await pool.query("SELECT * FROM change_requests WHERE trip_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",
    [tripId, terminalRequestIds])).rows;
  assert.equal(afterRequests.length, originalRequests.length);
  for (const [index, request] of afterRequests.entries()) {
    assert.equal(request.status, "superseded");
    assert.deepEqual(request.proposed_patch, originalRequests[index].proposed_patch);
    assert.equal(request.requested_by_member_id, originalRequests[index].requested_by_member_id);
    assert.equal(request.reviewed_by_member_id, owner.memberId);
    const audit = (await pool.query("SELECT actor_member_id,metadata FROM audit_events WHERE trip_id=$1 AND entity_type='change_request' AND entity_id=$2 AND action='superseded'",
      [tripId, request.id])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_member_id, owner.memberId);
    assert.deepEqual(audit[0].metadata, { reason: "event_removed", itineraryItemId: cancelled.entityId });
    await assert.rejects(reviewChangeRequest(pool, owner, tripId, request.id, "approve", undefined, 1),
      (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
    await assert.rejects(applyPermittedChangeRequest(pool, editor, tripId, request.id),
      (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
  }
  for (const requestId of [retainedCorrection.id, unrelatedRequest.id]) {
    assert.equal((await pool.query("SELECT status FROM change_requests WHERE trip_id=$1 AND id=$2", [tripId, requestId])).rows[0].status, "pending");
  }
  const history = await readAllApprovalHistory(pool, owner);
  assert.ok(history.some((request) => request.id === event.requestId && request.status === "approved"));
  assert.ok(history.some((request) => request.id === cancellation.id && request.status === "approved"));
  assert.ok(history.some((request) => request.id === rejectedRestore.id && request.status === "superseded"));
  for (const actor of [owner, editor, viewer]) {
    const overview = await getAppOverview(pool, actor);
    assert.ok(!overview.itinerary.some((item) => item.id === cancelled.entityId));
    assert.ok(overview.itinerary.some((item) => item.id === otherEvent.entityId));
    assert.ok(!overview.pendingItinerary.some((item) => terminalRequestIds.includes(item.requestId)));
    assert.ok(!overview.pendingExpenses.some((expense) => terminalRequestIds.includes(expense.requestId)));
    const historicalBill = overview.expenses.find((expense) => expense.id === bill.entityId);
    assert.equal(historicalBill.itineraryItemId, cancelled.entityId);
    assert.equal(historicalBill.itineraryItemRemoved, true);
    assert.deepEqual(historicalBill.itineraryItemAudience, {
      createdByMemberId: owner.memberId, visibility: "trip", viewerMemberIds: [],
    });
    const context = await inTransaction(pool, (client) => getAiPendingItineraryContext(client, actor, tripId));
    assert.ok(!context.pendingItinerary.some((item) => terminalRequestIds.includes(item.requestId)));
  }
  // Execute the production canonical-context SELECT without invoking an AI provider.
  const plannerSource = await readFile(path.resolve("src/lib/ai/planner.ts"), "utf8");
  const contextSql = /const contextResult = await pool\.query\(\s*`([\s\S]*?)`,\s*\[session\.tripId, session\.memberId\]/u.exec(plannerSource)?.[1];
  assert.ok(contextSql, "the test must locate the actual planner context query");
  assert.ok(!contextSql.includes("${"), "dynamic planner queries need an explicit test adapter");
  for (const actor of [owner, editor]) {
    const context = (await pool.query(contextSql, [tripId, actor.memberId])).rows[0].context;
    assert.ok(!context.itinerary.some((item) => item.id === cancelled.entityId));
    assert.ok(context.itinerary.some((item) => item.id === otherEvent.entityId));
  }

  await assert.rejects(remove(owner, { ...cancelled, revision: 3 }), AppNotFoundError);
  assert.deepEqual(await eventState(cancelled.entityId), state, "repeated removal must not append a second removal revision or audit");
  for (const mutation of [
    "UPDATE itinerary_items SET removed_at=NULL,removed_by_member_id=NULL WHERE trip_id=$1 AND id=$2",
    "UPDATE itinerary_items SET status='planned' WHERE trip_id=$1 AND id=$2",
    "UPDATE itinerary_items SET removed_by_member_id=created_by_member_id,removed_at=removed_at+interval '1 second' WHERE trip_id=$1 AND id=$2",
    "DELETE FROM itinerary_items WHERE trip_id=$1 AND id=$2",
  ]) {
    await assert.rejects(pool.query(mutation, [tripId, cancelled.entityId]), /removed|tombstone/i);
  }
  await assert.rejects(eventChange(owner, { ...cancelled, revision: 3 }, "restore"), AppNotFoundError);
  await assert.rejects(eventChange(editor, { ...cancelled, revision: 3 }, "update", { title: "Synthetic resurrection attempt" }), AppNotFoundError);
  await assert.rejects(getPendingItineraryRequestForEdit(pool, owner, tripId, pendingEdit.id), AppNotFoundError);
  await assert.rejects(updatePendingItineraryRequest(pool, owner, tripId, pendingEdit.id,
    { proposalRevision: 1, patch: { notes: "Synthetic stale draft resurrection" } }), AppNotFoundError);
  await assert.rejects(newBillRequest(owner, cancelled.entityId), AppNotFoundError);
  await assert.rejects(createChangeRequest(pool, owner, tripId, {
    entityType: "expense", entityId: relinkBill.entityId, operation: "update", baseRevision: 1,
    source: "owner", reason: "Synthetic new relink after removal", patch: { itineraryItemId: cancelled.entityId },
  }), AppNotFoundError);
  await assert.rejects(pool.query(`INSERT INTO expenses(trip_id,id,payer_member_id,itinerary_item_id,description,amount_minor,currency,status,occurred_at)
    VALUES($1,$2,$3,$4,'Synthetic forbidden new link',1,'JPY','draft',CURRENT_TIMESTAMP)`,
  [tripId, id("50", 90), owner.memberId, cancelled.entityId]), /removed/i);
  await assert.rejects(pool.query("UPDATE expenses SET itinerary_item_id=$3 WHERE trip_id=$1 AND id=$2",
    [tripId, relinkBill.entityId, cancelled.entityId]), /removed/i);
  assert.deepEqual(await financialState(), moneyBefore);
  const corrected = await reviewChangeRequest(pool, owner, tripId, retainedCorrection.id, "approve", "Synthetic retained correction", 1);
  assert.equal(corrected.entityId, bill.entityId);
  assert.equal(corrected.revision, 2);
  const expenseAfterCorrection = (await pool.query("SELECT itinerary_item_id,amount_minor::int AS amount_minor,description FROM expenses WHERE trip_id=$1 AND id=$2",
    [tripId, bill.entityId])).rows[0];
  assert.deepEqual(expenseAfterCorrection, { itinerary_item_id: cancelled.entityId, amount_minor: 101, description: "Synthetic corrected dinner bill" });
  const laterCorrection = await createChangeRequest(pool, editor, tripId, {
    entityType: "expense", entityId: bill.entityId, operation: "update", baseRevision: 2,
    source: "member", reason: "Synthetic later historical correction", patch: { description: "Synthetic later corrected bill" },
  });
  await applyPermittedChangeRequest(pool, editor, tripId, laterCorrection.id);
  assert.deepEqual((await pool.query("SELECT member_id,share_minor FROM expense_splits WHERE trip_id=$1 AND expense_id=$2 ORDER BY member_id",
    [tripId, bill.entityId])).rows, moneyBefore.splits.filter((split) => split.expense_id === bill.entityId)
    .map(({ member_id, share_minor }) => ({ member_id, share_minor })));
  assert.deepEqual(await eventState(cancelled.entityId), state);

  // Owners do not inherit another creator's private audience from a remove control.
  const hidden = await newEvent(editor, { title: "Synthetic hidden cancelled event", status: "cancelled", visibility: "private", viewerMemberIds: [viewer.memberId] });
  const hiddenBill = await newBill(editor, hidden.entityId, { amountMinor: 17 });
  await assert.rejects(remove(owner, hidden), (error) => error instanceof AppNotFoundError && !error.message.includes("Synthetic hidden"));
  assert.ok(!(await getAppOverview(pool, owner)).expenses.some((expense) => expense.id === hiddenBill.entityId));
  const privateEvent = await newEvent(owner, { title: "Synthetic private cancelled event", status: "cancelled", visibility: "private", viewerMemberIds: [editor.memberId] });
  const privateBill = await newBill(owner, privateEvent.entityId, { amountMinor: 53, splitMemberIds: [owner.memberId, editor.memberId] });
  const privateBefore = await eventState(privateEvent.entityId);
  const privateMoneyBefore = await financialState();
  const parallelRemovals = await Promise.allSettled([remove(owner, privateEvent), remove(owner, privateEvent)]);
  assert.equal(parallelRemovals.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const duplicateRemoval = parallelRemovals.find((attempt) => attempt.status === "rejected");
  assert.ok(duplicateRemoval.reason instanceof AppNotFoundError);
  const privateAfter = await eventState(privateEvent.entityId);
  assert.equal(privateAfter.revisions.length, 2);
  assert.equal(privateAfter.audits.filter((audit) => audit.action === "removed").length, 1);
  assert.deepEqual(privateAfter.viewers, privateBefore.viewers);
  assert.deepEqual(await financialState(), privateMoneyBefore);
  for (const actor of [owner, editor]) {
    const overview = await getAppOverview(pool, actor);
    assert.ok(!overview.itinerary.some((item) => item.id === privateEvent.entityId));
    const retainedPrivateBill = overview.expenses.find((expense) => expense.id === privateBill.entityId);
    assert.equal(retainedPrivateBill.itineraryItemId, privateEvent.entityId);
    assert.equal(retainedPrivateBill.itineraryItemRemoved, true);
    assert.deepEqual(retainedPrivateBill.itineraryItemAudience, {
      createdByMemberId: owner.memberId, visibility: "private", viewerMemberIds: [editor.memberId],
    });
  }
  const outsider = await getAppOverview(pool, viewer);
  assert.ok(!outsider.expenses.some((expense) => expense.id === privateBill.entityId));
  await assert.rejects(newBillRequest(viewer, privateEvent.entityId),
    (error) => error instanceof AppForbiddenError || error instanceof AppNotFoundError);

  // A canonical draft is visible, but only an owner can promote/void its ledger
  // status. Ordinary editor corrections remain possible without changing status.
  const ledgerBeforeDrafts = (await getAppOverview(pool, owner)).expenseLedger;
  const postedDraft = await newBill(owner, otherEvent.entityId, {
    description: "Synthetic draft awaiting posting", status: "draft", amountMinor: 103,
    splitMemberIds: [owner.memberId, editor.memberId],
  });
  const voidedDraft = await newBill(owner, otherEvent.entityId, {
    description: "Synthetic draft awaiting rejection", status: "draft", amountMinor: 71,
  });
  assert.deepEqual((await getAppOverview(pool, owner)).expenseLedger, ledgerBeforeDrafts);
  const draftEditRequest = await createChangeRequest(pool, editor, tripId, {
    entityType: "expense", entityId: voidedDraft.entityId, operation: "update", baseRevision: 1,
    source: "member", reason: "Synthetic editable draft description", patch: { description: "Synthetic corrected draft" },
  });
  const editedDraft = await applyPermittedChangeRequest(pool, editor, tripId, draftEditRequest.id);
  assert.equal(editedDraft.revision, 2);
  const transition = (expense, status, baseRevision = expense.revision) => createChangeRequest(pool, editor, tripId, {
    entityType: "expense", entityId: expense.entityId, operation: "update", baseRevision,
    source: "member", reason: "Synthetic owner-reviewed draft status", patch: { status },
  });
  const postRequest = await transition(postedDraft, "posted");
  const voidRequest = await transition(editedDraft, "void");
  const staleDraftRequest = await transition(postedDraft, "void");
  const draftSplits = (await pool.query("SELECT * FROM expense_splits WHERE trip_id=$1 AND expense_id=ANY($2::uuid[]) ORDER BY expense_id,member_id",
    [tripId, [postedDraft.entityId, voidedDraft.entityId]])).rows;
  for (const request of [postRequest, voidRequest]) {
    await assert.rejects(applyPermittedChangeRequest(pool, editor, tripId, request.id), AppForbiddenError);
    assert.equal((await pool.query("SELECT status FROM change_requests WHERE trip_id=$1 AND id=$2", [tripId, request.id])).rows[0].status, "pending");
    await assert.rejects(reviewChangeRequest(pool, editor, tripId, request.id, "approve", undefined, 1), AppForbiddenError);
  }
  assert.deepEqual((await getAppOverview(pool, owner)).expenseLedger, ledgerBeforeDrafts);
  for (const [request, expense, nextStatus, expectedRevision] of [
    [postRequest, postedDraft, "posted", 2], [voidRequest, editedDraft, "void", 3],
  ]) {
    const promoted = await reviewChangeRequest(pool, owner, tripId, request.id, "approve", "Synthetic draft owner decision", 1);
    assert.equal(promoted.entityId, expense.entityId);
    assert.equal(promoted.revision, expectedRevision);
    const canonical = (await pool.query("SELECT status,current_revision,itinerary_item_id FROM expenses WHERE trip_id=$1 AND id=$2",
      [tripId, expense.entityId])).rows[0];
    assert.deepEqual(canonical, { status: nextStatus, current_revision: expectedRevision, itinerary_item_id: otherEvent.entityId });
    const revision = (await pool.query("SELECT * FROM expense_revisions WHERE trip_id=$1 AND expense_id=$2 AND revision=$3",
      [tripId, expense.entityId, expectedRevision])).rows[0];
    assert.equal(revision.changed_by_member_id, owner.memberId);
    assert.equal(revision.snapshot.status, nextStatus);
    const audit = (await pool.query("SELECT * FROM audit_events WHERE trip_id=$1 AND entity_type='expense' AND entity_id=$2 AND metadata->>'changeRequestId'=$3",
      [tripId, expense.entityId, request.id])).rows[0];
    assert.equal(audit.actor_member_id, owner.memberId);
    assert.equal(audit.action, "update");
    assert.equal(audit.before_state.status, "draft");
    assert.equal(audit.after_state.status, nextStatus);
    assert.deepEqual(audit.after_state, revision.snapshot);
    await assert.rejects(reviewChangeRequest(pool, owner, tripId, request.id, "approve", undefined, 1), AppConflictError);
    await assert.rejects(reviewChangeRequest(pool, owner, tripId, request.id, "reject", undefined, 1), AppConflictError);
  }
  await assert.rejects(reviewChangeRequest(pool, owner, tripId, staleDraftRequest.id, "approve", undefined, 1), AppConflictError);
  assert.deepEqual((await pool.query("SELECT * FROM expense_splits WHERE trip_id=$1 AND expense_id=ANY($2::uuid[]) ORDER BY expense_id,member_id",
    [tripId, [postedDraft.entityId, voidedDraft.entityId]])).rows, draftSplits, "status-only decisions retain exact original allocations");
  const approvedLedger = (await getAppOverview(pool, owner)).expenseLedger;
  const sumPaid = (ledger) => ledger.balances.reduce((sum, balance) => sum + balance.paidMinor, 0);
  const sumShared = (ledger) => ledger.balances.reduce((sum, balance) => sum + balance.shareMinor, 0);
  assert.equal(sumPaid(approvedLedger) - sumPaid(ledgerBeforeDrafts), 103);
  assert.equal(sumShared(approvedLedger) - sumShared(ledgerBeforeDrafts), 103);
}

async function testDisruptionQualification(pool, baseSession) {
  requireDisposableDatabaseTarget();
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
    databaseTarget(connectionString, "TEST_DATABASE_URL").databaseName);
  const observations = async () => (await pool.query(
    "SELECT to_jsonb(observation) AS data FROM event_disruption_observations observation ORDER BY trip_id,id",
  )).rows.map((row) => row.data);
  const current = async () => (await pool.query("SELECT * FROM event_disruption_current ORDER BY trip_id,itinerary_item_id")).rows;
  const legacyObservations = await observations();
  const legacyCurrent = await current();
  assert.ok(legacyObservations.length > 0, "the upgrade must contain immutable legacy evidence");
  assert.ok(legacyCurrent.length > 0, "the upgrade must contain a legacy current projection");
  assert.ok(legacyObservations.every((row) => !Object.hasOwn(row, "qualification_policy_version")));
  assert.deepEqual(await migrate({ connectionString, through: "0039_disruption_qualification.sql" }),
    ["0039_disruption_qualification.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0039_disruption_qualification.sql" }), []);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM app_schema_migrations")).rows[0].total, 39);
  const migratedObservations = await observations();
  assert.deepEqual(migratedObservations, legacyObservations.map((row) => ({ ...row, qualification_policy_version: 0 })),
    "migration adds only a fail-closed marker; legacy evidence is not rewritten or qualified");
  assert.deepEqual(await current(), legacyCurrent, "migration must not refresh or falsely resolve old current warnings");
  const column = (await pool.query(`SELECT data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='event_disruption_observations' AND column_name='qualification_policy_version'`)).rows[0];
  assert.deepEqual(column, { data_type: "integer", is_nullable: "NO", column_default: "0" });
  assert.equal((await pool.query(`SELECT count(*)::int AS total FROM information_schema.columns
    WHERE table_schema='public' AND table_name='event_disruption_current' AND column_name='qualification_policy_version'`)).rows[0].total, 0,
  "qualification is bound to the immutable observation, not a separately mutable current flag");
  const legacyOverview = await getAppOverview(pool, baseSession);
  for (const warning of legacyCurrent.filter((row) => row.trip_id === baseSession.tripId)) {
    const item = legacyOverview.itinerary.find((entry) => entry.id === warning.itinerary_item_id);
    if (item) assert.equal(item.disruption, null, "unqualified legacy current warnings stay quiet after upgrading");
  }
  const legacy = legacyObservations[0];
  for (const sql of [
    "UPDATE event_disruption_observations SET qualification_policy_version=1 WHERE trip_id=$1 AND id=$2",
    "UPDATE event_disruption_observations SET qualification_policy_version=0 WHERE trip_id=$1 AND id=$2",
    "DELETE FROM event_disruption_observations WHERE trip_id=$1 AND id=$2",
  ]) await assert.rejects(pool.query(sql, [legacy.trip_id, legacy.id]), /append-only/u);
  assert.deepEqual(await observations(), migratedObservations);
  assert.deepEqual(await current(), legacyCurrent);

  const id = (group, number) => `ee${group}0000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const tripId = id("10", 1), dayId = id("30", 1), itemId = id("40", 1), otherItemId = id("40", 2), runId = id("60", 1);
  const owner = { ...baseSession, tripId, memberId: id("20", 1), userId: id("00", 1), role: "owner" };
  const editor = { ...owner, memberId: id("20", 2), userId: id("00", 2), role: "editor" };
  for (const actor of [owner, editor]) await pool.query(
    "INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic qualification user')", [actor.userId]);
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic qualification trip','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE+2)`, [tripId, owner.userId]);
  for (const actor of [owner, editor]) await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
    VALUES($1,$2,$3,'Synthetic qualification member',$4,'active')`, [tripId, actor.memberId, actor.userId, actor.role]);
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,CURRENT_DATE)", [tripId, dayId]);
  for (const eventId of [itemId, otherItemId]) await pool.query(`INSERT INTO itinerary_items(
    trip_id,id,trip_day_id,created_by_member_id,title,item_type,starts_at,ends_at,location_name)
    VALUES($1,$2,$3,$4,'Synthetic venue closure event','activity',CURRENT_TIMESTAMP+interval '1 hour',
      CURRENT_TIMESTAMP+interval '2 hours','Synthetic public venue')`, [tripId, eventId, dayId, owner.memberId]);
  await pool.query(`INSERT INTO disruption_monitor_runs(trip_id,id,scheduled_for,status,candidate_count,web_search_count,started_at,completed_at)
    VALUES($1,$2,CURRENT_TIMESTAMP,'succeeded',2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [tripId, runId]);
  let sequence = 1;
  const appendObservation = async (overrides = {}) => {
    const observationId = id("50", sequence++);
    const row = { itemId, state: "confirmed", severity: "warning", detail: "Synthetic confirmed venue closure",
      revision: 1, fingerprint: String(sequence).padStart(64, "a"), ...overrides };
    const columns = Object.hasOwn(row, "version") ? ",qualification_policy_version" : "";
    const versionValue = Object.hasOwn(row, "version") ? ",$10" : "";
    await pool.query(`INSERT INTO event_disruption_observations(
      trip_id,id,itinerary_item_id,monitor_run_id,item_revision,state,reason_code,severity,detail,source_urls,
      evidence_fingerprint,affected_from,affected_until,observed_at,valid_until${columns})
      VALUES($1,$2,$3,$4,$5,$6,'closure',$7,$8,'["https://status.example.test/official-venue"]'::jsonb,$9,
        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '3 hours',CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP+interval '4 hours'${versionValue}) RETURNING id`,
    [tripId, observationId, row.itemId, runId, row.revision, row.state, row.severity, row.detail, row.fingerprint,
      ...(Object.hasOwn(row, "version") ? [row.version] : [])]);
    return observationId;
  };
  const publish = (observationId) => pool.query(`INSERT INTO event_disruption_current(
    trip_id,itinerary_item_id,observation_id,item_revision,state,reason_code,severity,detail,source_urls,evidence_fingerprint,
    first_seen_at,last_seen_at,checked_at,stale_after)
    SELECT trip_id,itinerary_item_id,id,item_revision,state,reason_code,severity,detail,source_urls,evidence_fingerprint,
      observed_at,observed_at,observed_at,valid_until FROM event_disruption_observations WHERE trip_id=$1 AND id=$2
    ON CONFLICT(trip_id,itinerary_item_id) DO UPDATE SET observation_id=EXCLUDED.observation_id,
      item_revision=EXCLUDED.item_revision,state=EXCLUDED.state,reason_code=EXCLUDED.reason_code,severity=EXCLUDED.severity,
      detail=EXCLUDED.detail,source_urls=EXCLUDED.source_urls,evidence_fingerprint=EXCLUDED.evidence_fingerprint,
      first_seen_at=EXCLUDED.first_seen_at,last_seen_at=EXCLUDED.last_seen_at,checked_at=EXCLUDED.checked_at,stale_after=EXCLUDED.stale_after`,
  [tripId, observationId]);
  const warningFor = async (actor = owner, eventId = itemId) => (await getAppOverview(pool, actor)).itinerary
    .find((item) => item.id === eventId)?.disruption;
  const unqualified = await appendObservation();
  assert.equal((await pool.query("SELECT qualification_policy_version FROM event_disruption_observations WHERE trip_id=$1 AND id=$2",
    [tripId, unqualified])).rows[0].qualification_policy_version, 0, "new unspecified observations also fail closed");
  await publish(unqualified);
  assert.equal(await warningFor(), null);
  for (const version of [-1, 2, 2147483647]) await assert.rejects(appendObservation({ version }),
    (error) => error?.code === "23514" && /qualification/u.test(error.constraint));
  await assert.rejects(appendObservation({ version: null }),
    (error) => error?.code === "23502" && error.column === "qualification_policy_version");
  for (const [state, severity] of [["possible", "warning"], ["confirmed", "info"], ["resolved", "critical"]]) {
    const observationId = await appendObservation({ version: 1, state, severity });
    await publish(observationId);
    assert.equal(await warningFor(), null, `${state}/${severity} must not display solely because its version is one`);
  }
  const qualified = await appendObservation({ version: 1 });
  await publish(qualified);
  for (const actor of [owner, editor]) {
    const warning = await warningFor(actor);
    assert.equal(warning.observationId, qualified);
    assert.equal(warning.state, "confirmed");
    assert.equal(warning.severity, "warning");
    assert.equal(warning.reasonCode, "closure");
    assert.equal(warning.detail, "Synthetic confirmed venue closure");
    assert.deepEqual(warning.sourceUrls, ["https://status.example.test/official-venue"]);
    assert.equal(warning.localizedDetails, null);
  }
  const localization = { en: "Synthetic official venue closure.", "zh-HK": "測試場館正式關閉。", "ja-JP": "テスト施設の正式な休業。" };
  await pool.query(`INSERT INTO event_disruption_localizations(trip_id,observation_id,itinerary_item_id,details,origin)
    VALUES($1,$2,$3,$4::jsonb,'monitor')`, [tripId, qualified, itemId, JSON.stringify(localization)]);
  assert.deepEqual((await warningFor()).localizedDetails, localization);
  const critical = await appendObservation({ version: 1, severity: "critical", detail: "Synthetic updated confirmed venue closure" });
  await publish(critical);
  assert.equal((await warningFor()).observationId, critical);
  assert.equal((await warningFor()).severity, "critical");
  assert.equal((await warningFor()).localizedDetails, null, "another observation's translated text must not attach to current evidence");

  const sourceBefore = (await pool.query("SELECT * FROM event_disruption_observations WHERE trip_id=$1 AND id=$2", [tripId, critical])).rows[0];
  const currentBefore = (await pool.query("SELECT * FROM event_disruption_current WHERE trip_id=$1 AND itinerary_item_id=$2", [tripId, itemId])).rows[0];
  for (const columnChange of ["detail='Synthetic drift'", "severity='warning'", "source_urls='[]'::jsonb", "observation_id=$3"]) {
    await assert.rejects(pool.query(`UPDATE event_disruption_current SET ${columnChange} WHERE trip_id=$1 AND itinerary_item_id=$2`,
      [tripId, itemId, ...(columnChange.includes("$3") ? [qualified] : [])]),
    (error) => error?.code === "23514" && error.constraint === "event_disruption_current_observation_shape_ck");
  }
  await assert.rejects(pool.query(`INSERT INTO event_disruption_current(
    trip_id,itinerary_item_id,observation_id,item_revision,state,reason_code,severity,detail,source_urls,evidence_fingerprint,
    first_seen_at,last_seen_at,checked_at,stale_after)
    SELECT trip_id,$3,observation_id,item_revision,state,reason_code,severity,detail,source_urls,evidence_fingerprint,
      first_seen_at,last_seen_at,checked_at,stale_after FROM event_disruption_current WHERE trip_id=$1 AND itinerary_item_id=$2`,
  [tripId, itemId, otherItemId]),
  (error) => error?.code === "23503" && error.constraint === "event_disruption_current_observation_item_fk");
  for (const sql of [
    "UPDATE event_disruption_observations SET qualification_policy_version=0 WHERE trip_id=$1 AND id=$2",
    "UPDATE event_disruption_observations SET qualification_policy_version=1 WHERE trip_id=$1 AND id=$2",
    "DELETE FROM event_disruption_observations WHERE trip_id=$1 AND id=$2",
  ]) await assert.rejects(pool.query(sql, [tripId, critical]), /append-only/u);
  assert.deepEqual((await pool.query("SELECT * FROM event_disruption_observations WHERE trip_id=$1 AND id=$2", [tripId, critical])).rows[0], sourceBefore);
  assert.deepEqual((await pool.query("SELECT * FROM event_disruption_current WHERE trip_id=$1 AND itinerary_item_id=$2", [tripId, itemId])).rows[0], currentBefore);
  await publish(unqualified);
  assert.equal(await warningFor(), null, "an older qualified observation for the same item cannot bless a different current observation");
  await publish(critical);
  assert.equal((await warningFor()).observationId, critical);
  assert.equal(await warningFor(owner, otherItemId), null, "qualification is not shared between neighboring items");
  const wrongRevision = await appendObservation({ version: 1, revision: 2 });
  await publish(wrongRevision);
  assert.equal(await warningFor(), null, "qualified evidence must still match the current event revision");
  await publish(critical);
  await pool.query(`UPDATE event_disruption_current SET checked_at=CURRENT_TIMESTAMP-interval '2 hours',
    stale_after=CURRENT_TIMESTAMP-interval '1 hour' WHERE trip_id=$1 AND itinerary_item_id=$2`, [tripId, itemId]);
  assert.equal(await warningFor(), null, "qualification never overrides existing freshness expiry");
  await publish(critical);
  await pool.query("UPDATE itinerary_items SET visibility='private' WHERE trip_id=$1 AND id=$2", [tripId, itemId]);
  assert.equal((await warningFor()).observationId, critical);
  assert.equal(await warningFor(editor), undefined, "qualified warnings do not grant access to another member's private event");
}

async function resetDatabase() {
  await withClient(async (client) => {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  });
}

async function loadFixture() {
  const sql = await readFile(path.resolve("database/fixtures/demo.sql"), "utf8");
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function readAllApprovalHistory(pool, session) {
  const requests = [];
  const seenCursors = new Set();
  let cursor = null;
  do {
    const page = await getApprovalHistory(pool, session, session.tripId, cursor);
    requests.push(...page.requests);
    cursor = page.nextCursor;
    if (cursor) {
      assert.ok(!seenCursors.has(cursor), "approval history cursor must advance");
      seenCursors.add(cursor);
    }
  } while (cursor);
  return requests;
}

async function prepareConversation(pool, session) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prepared = await prepareAiConversation(client, session);
    await client.query("COMMIT");
    return prepared;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test(
  "migrations upgrade safely and enforce trip, revision, expense, audit, and outbox invariants",
  { skip: !connectionString && "TEST_DATABASE_URL is not configured" },
  async () => {
    requireDisposableDatabaseTarget();
    await resetDatabase();

    const initial = await migrate({
      connectionString,
      through: "0001_core_trip_data.sql",
    });
    assert.deepEqual(initial, ["0001_core_trip_data.sql"]);

    const initialTables = await withClient((client) =>
      client.query("SELECT to_regclass('public.itinerary_items') AS itinerary"),
    );
    assert.equal(initialTables.rows[0].itinerary, "itinerary_items");

    const upgrade = await migrate({
      connectionString,
      through: "0011_off_topic_ai_attribution.sql",
    });
    assert.deepEqual(upgrade, [
      "0002_audit_and_outbox.sql",
      "0003_identity_and_sessions.sql",
      "0004_collaboration_ai_and_costs.sql",
      "0005_permissions_expense_calendar.sql",
      "0006_trip_context_and_days.sql",
      "0007_member_management_and_quota.sql",
      "0008_private_itinerary_and_claim_lifecycle.sql",
      "0009_trip_capacity_and_reusable_join_links.sql",
      "0010_ai_conversation_memory.sql",
      "0011_off_topic_ai_attribution.sql",
    ]);

    await loadFixture();
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          `UPDATE itinerary_items
              SET visibility = 'private'
            WHERE trip_id = '10000000-0000-4000-8000-000000000001'
              AND id = '40000000-0000-4000-8000-000000000001'`,
        );
        await client.query(
          `INSERT INTO itinerary_item_viewers (
             trip_id, itinerary_item_id, member_id, added_by_member_id
           ) VALUES (
             '10000000-0000-4000-8000-000000000001',
             '40000000-0000-4000-8000-000000000001',
             '20000000-0000-4000-8000-000000000002',
             '20000000-0000-4000-8000-000000000001'
           )`,
        );
        await client.query(
          `INSERT INTO change_requests (
           trip_id, id, requested_by_member_id, source, entity_type, entity_id,
           operation, base_revision, proposed_patch, reason
         ) VALUES
         (
           '10000000-0000-4000-8000-000000000001',
           '8f000000-0000-4000-8000-000000000001',
           '20000000-0000-4000-8000-000000000002',
           'member', 'itinerary_item',
           '40000000-0000-4000-8000-000000000001',
           'update', 1, '{"notes":"Legacy private itinerary patch"}',
           'Migration 0012 itinerary audience backfill regression'
         ),
         (
           '10000000-0000-4000-8000-000000000001',
           '8f000000-0000-4000-8000-000000000002',
           '20000000-0000-4000-8000-000000000002',
           'member', 'expense',
           '50000000-0000-4000-8000-000000000001',
           'update', 1, '{"description":"Legacy private expense patch"}',
             'Migration 0012 expense audience backfill regression'
           )`,
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    assert.deepEqual(await migrate({
      connectionString,
      through: "0015_normalized_preference_catalog.sql",
    }), [
      "0012_change_request_effective_audience.sql",
      "0013_ai_pending_review_audience.sql",
      "0014_ai_memory_and_preferences.sql",
      "0015_normalized_preference_catalog.sql",
    ]);
    assert.deepEqual(await migrate({
      connectionString,
      through: "0015_normalized_preference_catalog.sql",
    }), []);

    const migrationCount = await withClient((client) =>
      client.query("SELECT count(*)::integer AS count FROM app_schema_migrations"),
    );
    assert.equal(migrationCount.rows[0].count, 15);
    // This intentionally staged upgrade test exercises current repository code
    // before historical transport and selected-trip migrations. Stage only the
    // additive columns required by current
    // repository code here; the real 0018 and 0028 migrations still perform
    // their backfills and install every constraint later.
    await withClient((client) => client.query(`
      ALTER TABLE itinerary_items
        ADD COLUMN departure_location_name text,
        ADD COLUMN departure_map_url text,
        ADD COLUMN destination_location_name text,
        ADD COLUMN destination_map_url text;
      ALTER TABLE app_users
        ADD COLUMN last_selected_trip_id uuid
    `));
    const backfilledAudienceSnapshots = await withClient((client) => client.query(
      `SELECT id,
              proposed_patch->>'visibility' AS visibility,
              proposed_patch->'viewerMemberIds' AS viewer_member_ids,
              proposed_patch->>'itineraryItemId' AS itinerary_item_id,
              proposed_patch->'itineraryAudienceSnapshot'->>'createdByMemberId'
                AS expense_creator_member_id,
              proposed_patch->'itineraryAudienceSnapshot'->>'visibility'
                AS expense_visibility,
              proposed_patch->'itineraryAudienceSnapshot'->'viewerMemberIds'
                AS expense_viewer_member_ids
         FROM change_requests
        WHERE trip_id = '10000000-0000-4000-8000-000000000001'
          AND id IN (
            '8f000000-0000-4000-8000-000000000001',
            '8f000000-0000-4000-8000-000000000002'
          )
        ORDER BY id`,
    ));
    assert.deepEqual(backfilledAudienceSnapshots.rows, [
      {
        id: "8f000000-0000-4000-8000-000000000001",
        visibility: "private",
        viewer_member_ids: ["20000000-0000-4000-8000-000000000002"],
        itinerary_item_id: null,
        expense_creator_member_id: null,
        expense_visibility: null,
        expense_viewer_member_ids: null,
      },
      {
        id: "8f000000-0000-4000-8000-000000000002",
        visibility: null,
        viewer_member_ids: null,
        itinerary_item_id: "40000000-0000-4000-8000-000000000001",
        expense_creator_member_id: "20000000-0000-4000-8000-000000000001",
        expense_visibility: "private",
        expense_viewer_member_ids: ["20000000-0000-4000-8000-000000000002"],
      },
    ]);
    await withClient(async (client) => {
      await client.query(
        `UPDATE itinerary_items
            SET visibility = 'trip'
          WHERE trip_id = '10000000-0000-4000-8000-000000000001'
            AND id = '40000000-0000-4000-8000-000000000001'`,
      );
      await client.query(
        `DELETE FROM itinerary_item_viewers
          WHERE trip_id = '10000000-0000-4000-8000-000000000001'
            AND itinerary_item_id = '40000000-0000-4000-8000-000000000001'`,
      );
    });

    const identityPool = new Pool({ connectionString });
    const authConfig = {
      appBaseUrl: new URL("http://localhost:3100"),
      authSecret: "integration-test-auth-secret-value",
      databaseUrl: connectionString,
      googleClientId: "synthetic-client",
      googleClientSecret: "synthetic-secret",
      tripGraceDays: 2,
    };
    let switchSourceSession;
    let switchSourceRawToken;
    try {
      await assert.rejects(
        withClient((client) => client.query(`
          UPDATE trips SET max_members = 1
           WHERE id = '10000000-0000-4000-8000-000000000001'
        `)),
        /cannot be lower than occupied member count/,
      );
      await withClient((client) => client.query(`
        UPDATE trips SET max_members = 2
         WHERE id = '10000000-0000-4000-8000-000000000001'
      `));
      await assert.rejects(
        withClient((client) => client.query(`
          INSERT INTO trip_members (trip_id, id, display_name, role, status)
          VALUES (
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000099',
            'Over capacity', 'editor', 'invited'
          )
        `)),
        /reached its 2 member capacity/,
      );
      await withClient((client) => client.query(`
        UPDATE trips SET max_members = 3
         WHERE id = '10000000-0000-4000-8000-000000000001'
      `));

      const joinLink = await issueJoinLink(identityPool, authConfig, {
        tripId: "10000000-0000-4000-8000-000000000001",
        actorMemberId: "20000000-0000-4000-8000-000000000001",
      });
      const joinPreview = await previewJoinLink(identityPool, authConfig, joinLink.rawToken);
      assert.equal(joinPreview?.remainingSeats, 1);
      const joinIdentities = ["join-race-a", "join-race-b"].map((subject) => ({
        issuer: "https://accounts.google.com",
        subject,
        emailHint: `${subject}@example.test`,
        displayNameHint: `Traveler ${subject.slice(-1).toUpperCase()}`,
      }));
      const joinResults = await Promise.allSettled(joinIdentities.map((identity, index) =>
        consumeJoinLink(identityPool, authConfig, {
          rawToken: joinLink.rawToken,
          identity,
          userAgent: `Join browser ${index + 1}`,
        })));
      assert.equal(joinResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(joinResults.filter((result) => result.status === "rejected").length, 1);
      assert.equal(await previewJoinLink(identityPool, authConfig, joinLink.rawToken), null);

      const winnerIndex = joinResults.findIndex((result) => result.status === "fulfilled");
      const winnerIdentity = joinIdentities[winnerIndex];
      const repeatGrant = await consumeJoinLink(identityPool, authConfig, {
        rawToken: joinLink.rawToken,
        identity: winnerIdentity,
        userAgent: "Idempotent join browser",
      });
      assert.equal(repeatGrant.memberId, joinResults[winnerIndex].value.memberId);
      const joinedMemberId = repeatGrant.memberId;
      const joinedSession = await verifySession(identityPool, authConfig, repeatGrant.rawToken);
      assert.ok(joinedSession);
      assert.equal(joinedSession.tripId, repeatGrant.tripId);
      assert.equal(joinedSession.memberId, repeatGrant.memberId);
      assert.equal(joinedSession.userId, repeatGrant.userId);

      await revokeSession(identityPool, repeatGrant.sessionId, repeatGrant.userId);
      assert.equal(await verifySession(identityPool, authConfig, repeatGrant.rawToken), null);
      assert.ok(
        await verifySession(
          identityPool,
          authConfig,
          joinResults[winnerIndex].value.rawToken,
        ),
      );

      const returningGrant = await signInExistingIdentity(identityPool, authConfig, {
        identity: winnerIdentity,
        userAgent: "Returning member browser",
      });
      assert.equal(returningGrant.tripId, repeatGrant.tripId);
      assert.equal(returningGrant.memberId, repeatGrant.memberId);
      assert.equal(returningGrant.userId, repeatGrant.userId);
      assert.notEqual(returningGrant.sessionId, repeatGrant.sessionId);
      assert.notEqual(returningGrant.rawToken, repeatGrant.rawToken);
      const returningSession = await verifySession(identityPool, authConfig, returningGrant.rawToken);
      assert.ok(returningSession);
      assert.equal(returningSession.memberId, joinedMemberId);

      const ownerAccessSession = {
        sessionId: "synthetic-owner-session",
        tripId: repeatGrant.tripId,
        memberId: "20000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000001",
        role: "owner",
        expiresAt: new Date("2030-04-04T00:00:00.000Z"),
        absoluteExpiresAt: new Date("2030-04-06T00:00:00.000Z"),
        displayName: "Demo Owner",
        issuer: "https://accounts.google.com",
        subject: "synthetic-owner-subject",
        generation: 1,
      };
      await updateTripMember(
        identityPool,
        ownerAccessSession,
        repeatGrant.tripId,
        joinedMemberId,
        { disabled: true },
      );
      assert.equal(await verifySession(identityPool, authConfig, returningGrant.rawToken), null);
      await assert.rejects(
        signInExistingIdentity(identityPool, authConfig, {
          identity: winnerIdentity,
          userAgent: "Disabled returning member browser",
        }),
        (error) => error instanceof MembershipDisabledError,
      );

      await updateTripMember(
        identityPool,
        ownerAccessSession,
        repeatGrant.tripId,
        joinedMemberId,
        { disabled: false },
      );
      const reenabledGrant = await signInExistingIdentity(identityPool, authConfig, {
        identity: winnerIdentity,
        userAgent: "Re-enabled returning member browser",
      });
      assert.equal(reenabledGrant.tripId, repeatGrant.tripId);
      assert.equal(reenabledGrant.memberId, repeatGrant.memberId);
      assert.equal(reenabledGrant.userId, repeatGrant.userId);
      assert.ok(await verifySession(identityPool, authConfig, reenabledGrant.rawToken));

      const exhaustedLink = await withClient((client) => client.query(`
        SELECT exhausted_at IS NOT NULL AS exhausted,
               octet_length(token_hash)::integer AS token_bytes
          FROM trip_join_links
         WHERE trip_id = '10000000-0000-4000-8000-000000000001'
         ORDER BY created_at DESC LIMIT 1
      `));
      assert.deepEqual(exhaustedLink.rows[0], { exhausted: true, token_bytes: 32 });

      await withClient((client) => client.query(
        `UPDATE trip_members SET status = 'revoked' WHERE trip_id = $1 AND id = $2`,
        ["10000000-0000-4000-8000-000000000001", joinedMemberId],
      ));
      await assert.rejects(
        consumeJoinLink(identityPool, authConfig, {
          rawToken: joinLink.rawToken,
          identity: winnerIdentity,
          userAgent: "Disabled join browser",
        }),
        /disabled or removed membership/,
      );
      await withClient((client) => client.query(
        `UPDATE trip_members SET status = 'removed' WHERE trip_id = $1 AND id = $2`,
        ["10000000-0000-4000-8000-000000000001", joinedMemberId],
      ));
      await assert.rejects(
        consumeJoinLink(identityPool, authConfig, {
          rawToken: joinLink.rawToken,
          identity: winnerIdentity,
          userAgent: "Removed join browser",
        }),
        /disabled or removed membership/,
      );

      const revocableLink = await issueJoinLink(identityPool, authConfig, {
        tripId: "10000000-0000-4000-8000-000000000001",
        actorMemberId: "20000000-0000-4000-8000-000000000001",
      });
      assert.ok(await previewJoinLink(identityPool, authConfig, revocableLink.rawToken));
      await revokeJoinLink(identityPool, {
        tripId: "10000000-0000-4000-8000-000000000001",
        actorMemberId: "20000000-0000-4000-8000-000000000001",
      });
      assert.equal(await previewJoinLink(identityPool, authConfig, revocableLink.rawToken), null);
      await withClient((client) => client.query(`
        UPDATE trips SET max_members = 20
         WHERE id = '10000000-0000-4000-8000-000000000001'
      `));

      await withClient((client) =>
        client.query(`
          INSERT INTO trip_members (trip_id, id, display_name, role, status)
          VALUES
            (
              '10000000-0000-4000-8000-000000000001',
              '20000000-0000-4000-8000-000000000004',
              'Concurrent Claim Member', 'editor', 'invited'
            ),
            (
              '10000000-0000-4000-8000-000000000001',
              '20000000-0000-4000-8000-000000000005',
              'Reissue Race Member', 'viewer', 'invited'
            )
        `),
      );

      const claim = await issueClaim(identityPool, authConfig, {
        tripId: "10000000-0000-4000-8000-000000000001",
        memberId: "20000000-0000-4000-8000-000000000004",
        actorMemberId: "20000000-0000-4000-8000-000000000001",
      });
      assert.equal((await previewClaim(identityPool, authConfig, claim.rawToken))?.role, "editor");

      const identity = {
        issuer: "https://accounts.google.com",
        subject: "synthetic-concurrent-subject",
        emailHint: null,
        displayNameHint: "Synthetic Claim User",
      };
      const consumeResults = await Promise.allSettled([
        consumeClaim(identityPool, authConfig, {
          rawToken: claim.rawToken,
          identity,
          userAgent: "Integration browser A",
        }),
        consumeClaim(identityPool, authConfig, {
          rawToken: claim.rawToken,
          identity,
          userAgent: "Integration browser B",
        }),
      ]);
      assert.equal(
        consumeResults.filter((result) => result.status === "fulfilled").length,
        1,
        consumeResults
          .map((result) =>
            result.status === "fulfilled"
              ? "fulfilled"
              : `${result.reason?.name ?? "Error"}: ${result.reason?.message ?? "unknown"}`,
          )
          .join(" | "),
      );
      assert.equal(consumeResults.filter((result) => result.status === "rejected").length, 1);
      const consumedGrant = consumeResults.find((result) => result.status === "fulfilled").value;
      assert.ok(await verifySession(identityPool, authConfig, consumedGrant.rawToken));

      const rotatedGrant = await rotateSession(identityPool, authConfig, consumedGrant.rawToken);
      assert.ok(await verifySession(identityPool, authConfig, rotatedGrant.rawToken));
      await assert.rejects(
        rotateSession(identityPool, authConfig, consumedGrant.rawToken),
        /refresh replay detected/,
      );
      assert.equal(await verifySession(identityPool, authConfig, rotatedGrant.rawToken), null);

      const firstRaceClaim = await issueClaim(identityPool, authConfig, {
        tripId: "10000000-0000-4000-8000-000000000001",
        memberId: "20000000-0000-4000-8000-000000000005",
        actorMemberId: "20000000-0000-4000-8000-000000000001",
      });
      const raceInput = {
        tripId: "10000000-0000-4000-8000-000000000001",
        memberId: "20000000-0000-4000-8000-000000000005",
        actorMemberId: "20000000-0000-4000-8000-000000000001",
      };
      await Promise.allSettled([
        revokeClaims(identityPool, raceInput),
        issueClaim(identityPool, authConfig, raceInput),
      ]);
      assert.equal(await previewClaim(identityPool, authConfig, firstRaceClaim.rawToken), null);
      const activeRaceClaims = await withClient((client) =>
        client.query(`
          SELECT count(*)::integer AS count
            FROM member_claim_links
           WHERE trip_id = '10000000-0000-4000-8000-000000000001'
             AND member_id = '20000000-0000-4000-8000-000000000005'
             AND consumed_at IS NULL AND revoked_at IS NULL
        `),
      );
      assert.ok(activeRaceClaims.rows[0].count <= 1);

      const ownerConfig = {
        ...authConfig,
        ownerGoogleEmail: "owner@example.test",
      };
      const ownerClaim = await issueClaim(identityPool, ownerConfig, {
        tripId: "10000000-0000-4000-8000-000000000001",
        memberId: "20000000-0000-4000-8000-000000000001",
        actorMemberId: null,
      });
      await assert.rejects(
        consumeClaim(identityPool, ownerConfig, {
          rawToken: ownerClaim.rawToken,
          identity: {
            issuer: "https://accounts.google.com",
            subject: "wrong-owner-subject",
            emailHint: "someone-else@example.test",
            displayNameHint: "Wrong Owner",
          },
          userAgent: "Owner bootstrap browser",
        }),
        /claim link is unavailable/i,
      );
      assert.ok(await previewClaim(identityPool, ownerConfig, ownerClaim.rawToken));
      const ownerGrant = await consumeClaim(identityPool, ownerConfig, {
        rawToken: ownerClaim.rawToken,
        identity: {
          issuer: "https://accounts.google.com",
          subject: "verified-owner-subject",
          emailHint: "OWNER@example.test",
          displayNameHint: "Verified Owner",
        },
        userAgent: "Owner bootstrap browser",
      });
      assert.equal(ownerGrant.role, "owner");
      switchSourceRawToken = ownerGrant.rawToken;
      switchSourceSession = await verifySession(identityPool, authConfig, switchSourceRawToken);
      assert.ok(switchSourceSession);

      const storedSecrets = await withClient((client) =>
        client.query(`
          SELECT octet_length(token_hash)::integer AS bytes
            FROM member_claim_links
        `),
      );
      assert.ok(storedSecrets.rows.every((row) => row.bytes === 32));
    } finally {
      await identityPool.end();
    }

    await withClient(async (client) => {
      await client.query(`
        INSERT INTO trips (
          id, owner_user_id, name, time_zone, default_currency, starts_on, ends_on
        ) VALUES (
          '10000000-0000-4000-8000-000000000002',
          $1,
          'Second example', 'Etc/UTC', 'USD', '2030-05-01', '2030-05-02'
        )
      `, [switchSourceSession.userId]);
      await client.query(`
        INSERT INTO trip_members (trip_id, id, user_id, display_name, role, status)
        VALUES (
          '10000000-0000-4000-8000-000000000002',
          '20000000-0000-4000-8000-000000000003',
          $1,
          'Second Demo Owner', 'owner', 'active'
        )
      `, [switchSourceSession.userId]);
      await client.query(`
        INSERT INTO trip_days (trip_id, id, day_date)
        VALUES (
          '10000000-0000-4000-8000-000000000002',
          '30000000-0000-4000-8000-000000000099',
          '2030-05-01'
        )
      `);

      await assert.rejects(
        client.query(`
          INSERT INTO itinerary_items (
            trip_id, id, trip_day_id, created_by_member_id, title
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000099',
            '30000000-0000-4000-8000-000000000099',
            '20000000-0000-4000-8000-000000000001',
            'Cross-trip item'
          )
        `),
        (error) => error.code === "23503",
      );

      await assert.rejects(
        client.query(`
          INSERT INTO itinerary_revisions (
            trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            3,
            '20000000-0000-4000-8000-000000000001',
            '{"title":"Skipped revision"}'
          )
        `),
        /itinerary revision must follow current revision/,
      );
    });

    const switchPool = new Pool({ connectionString });
    try {
      const switchOverview = await getAppOverview(switchPool, switchSourceSession);
      assert.deepEqual(
        switchOverview.availableTrips.map((trip) => ({ id: trip.id, current: trip.current })),
        [
          { id: "10000000-0000-4000-8000-000000000001", current: true },
          { id: "10000000-0000-4000-8000-000000000002", current: false },
        ],
      );
      const switchedGrant = await switchSessionTrip(
        switchPool,
        authConfig,
        switchSourceSession,
        "10000000-0000-4000-8000-000000000002",
        "Integration trip switch browser",
      );
      assert.equal(switchedGrant.tripId, "10000000-0000-4000-8000-000000000002");
      assert.equal(await verifySession(switchPool, authConfig, switchSourceRawToken), null);
      const switchedSession = await verifySession(switchPool, authConfig, switchedGrant.rawToken);
      assert.equal(switchedSession?.memberId, "20000000-0000-4000-8000-000000000003");
      const switchAudits = await withClient((client) =>
        client.query(`
          SELECT action, count(*)::integer AS count
            FROM audit_events
           WHERE action IN ('trip_switched_out', 'trip_switched_in')
           GROUP BY action
           ORDER BY action
        `),
      );
      assert.deepEqual(switchAudits.rows, [
        { action: "trip_switched_in", count: 1 },
        { action: "trip_switched_out", count: 1 },
      ]);
    } finally {
      await switchPool.end();
    }

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`
          INSERT INTO expenses (
            trip_id, id, payer_member_id, description, amount_minor,
            currency, status, occurred_at
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000099',
            '20000000-0000-4000-8000-000000000001',
            'Invalid allocation', 100, 'JPY', 'posted', CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          INSERT INTO expense_splits (trip_id, expense_id, member_id, share_minor)
          VALUES (
            '10000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000099',
            '20000000-0000-4000-8000-000000000001',
            40
          )
        `);
        await assert.rejects(
          client.query("COMMIT"),
          /posted expense allocation 40 does not equal amount 100/,
        );
      } finally {
        await client.query("ROLLBACK");
      }
    });

    await withClient(async (client) => {
      await client.query("BEGIN");
      await client.query(`
        UPDATE itinerary_items
           SET title = 'Committed sample lunch'
         WHERE trip_id = '10000000-0000-4000-8000-000000000001'
           AND id = '40000000-0000-4000-8000-000000000001'
      `);
      await client.query(`
        INSERT INTO itinerary_revisions (
          trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot
        ) VALUES (
          '10000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000001',
          2,
          '20000000-0000-4000-8000-000000000001',
          '{"title":"Committed sample lunch"}'
        )
      `);
      await client.query(`
        INSERT INTO audit_events (
          trip_id, id, actor_member_id, entity_type, entity_id, action, after_state
        ) VALUES (
          '10000000-0000-4000-8000-000000000001',
          '60000000-0000-4000-8000-000000000002',
          '20000000-0000-4000-8000-000000000001',
          'itinerary_item',
          '40000000-0000-4000-8000-000000000001',
          'updated',
          '{"revision":2}'
        )
      `);
      await client.query(`
        INSERT INTO outbox_events (
          trip_id, id, topic, aggregate_type, aggregate_id, payload, idempotency_key
        ) VALUES (
          '10000000-0000-4000-8000-000000000001',
          '70000000-0000-4000-8000-000000000002',
          'itinerary.item.changed',
          'itinerary_item',
          '40000000-0000-4000-8000-000000000001',
          '{"revision":2}',
          'test-itinerary-item-1-revision-2'
        )
      `);
      await client.query("COMMIT");
    });

    const committed = await withClient((client) =>
      client.query(`
        SELECT i.title, i.current_revision,
               EXISTS (
                 SELECT 1 FROM outbox_events o
                  WHERE o.trip_id = i.trip_id
                    AND o.idempotency_key = 'test-itinerary-item-1-revision-2'
               ) AS has_outbox
          FROM itinerary_items i
         WHERE i.trip_id = '10000000-0000-4000-8000-000000000001'
           AND i.id = '40000000-0000-4000-8000-000000000001'
      `),
    );
    assert.deepEqual(committed.rows[0], {
      title: "Committed sample lunch",
      current_revision: 2,
      has_outbox: true,
    });

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`
          UPDATE itinerary_items
             SET title = 'Must roll back'
           WHERE trip_id = '10000000-0000-4000-8000-000000000001'
             AND id = '40000000-0000-4000-8000-000000000001'
        `);
        await client.query(`
          INSERT INTO itinerary_revisions (
            trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot
          ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            3,
            '20000000-0000-4000-8000-000000000001',
            '{"title":"Must roll back"}'
          )
        `);
        await assert.rejects(
          client.query(`
            INSERT INTO outbox_events (
              trip_id, id, topic, aggregate_type, aggregate_id, payload, idempotency_key
            ) VALUES (
              '10000000-0000-4000-8000-000000000001',
              '70000000-0000-4000-8000-000000000003',
              'itinerary.item.changed',
              'itinerary_item',
              '40000000-0000-4000-8000-000000000001',
              '{"revision":3}',
              'test-itinerary-item-1-revision-2'
            )
          `),
          (error) => error.code === "23505",
        );
      } finally {
        await client.query("ROLLBACK");
      }
    });

    const rolledBack = await withClient((client) =>
      client.query(`
        SELECT title, current_revision,
               EXISTS (
                 SELECT 1 FROM itinerary_revisions r
                  WHERE r.trip_id = itinerary_items.trip_id
                    AND r.itinerary_item_id = itinerary_items.id
                    AND r.revision = 3
               ) AS has_revision_three
          FROM itinerary_items
         WHERE trip_id = '10000000-0000-4000-8000-000000000001'
           AND id = '40000000-0000-4000-8000-000000000001'
      `),
    );
    assert.deepEqual(rolledBack.rows[0], {
      title: "Committed sample lunch",
      current_revision: 2,
      has_revision_three: false,
    });

    await withClient(async (client) => {
      await assert.rejects(
        client.query(`
          UPDATE audit_events SET action = 'tampered'
           WHERE trip_id = '10000000-0000-4000-8000-000000000001'
             AND id = '60000000-0000-4000-8000-000000000001'
        `),
        /audit_events is append-only/,
      );
    });

    const appPool = new Pool({ connectionString });
    const ownerSession = {
      sessionId: "owner-test-session",
      tripId: "10000000-0000-4000-8000-000000000001",
      memberId: "20000000-0000-4000-8000-000000000001",
      userId: switchSourceSession.userId,
      role: "owner",
      expiresAt: new Date("2030-04-04T00:00:00Z"),
      absoluteExpiresAt: new Date("2030-04-05T00:00:00Z"),
      displayName: "Demo Owner",
      issuer: "https://accounts.example.test",
      subject: "owner-subject",
      generation: 1,
    };
    const memberSession = {
      ...ownerSession,
      sessionId: "member-test-session",
      memberId: "20000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000002",
      role: "editor",
      displayName: "Sample Member",
      subject: "member-subject",
    };

    try {
      const initialTripContext = await appPool.query(
        `SELECT t.destination_name, t.time_zone, t.default_locale,
                count(d.id)::integer AS day_count
           FROM trips t JOIN trip_days d ON d.trip_id = t.id
          WHERE t.id = $1
          GROUP BY t.id`,
        [ownerSession.tripId],
      );
      assert.deepEqual(initialTripContext.rows[0], {
        destination_name: "Japan",
        time_zone: "Asia/Tokyo",
        default_locale: "zh-HK-lihkg",
        day_count: 3,
      });
      await appPool.query(
        `INSERT INTO auth_sessions (
           id, family_id, trip_id, member_id, user_id, token_hash, device_label,
           created_at, expires_at, absolute_expires_at, revoked_at, revoke_reason
         ) VALUES
         (
           '9a000000-0000-4000-8000-000000000001',
           '9b000000-0000-4000-8000-000000000001', $1, $2, $3,
           decode(repeat('a1', 32), 'hex'), 'Live extension session',
           CURRENT_TIMESTAMP, '2030-04-04T00:00:00Z', '2030-04-06T15:00:00Z', NULL, NULL
         ),
         (
           '9a000000-0000-4000-8000-000000000002',
           '9b000000-0000-4000-8000-000000000002', $1, $2, $3,
           decode(repeat('a2', 32), 'hex'), 'Expired rolling session',
           CURRENT_TIMESTAMP - interval '2 days', CURRENT_TIMESTAMP - interval '1 day',
           '2030-04-06T15:00:00Z', NULL, NULL
         ),
         (
           '9a000000-0000-4000-8000-000000000003',
           '9b000000-0000-4000-8000-000000000003', $1, $2, $3,
           decode(repeat('a3', 32), 'hex'), 'Revoked extension session',
           CURRENT_TIMESTAMP - interval '1 day', '2030-04-04T00:00:00Z',
           '2030-04-06T15:00:00Z', CURRENT_TIMESTAMP, 'integration_test'
         )`,
        [ownerSession.tripId, ownerSession.memberId, switchSourceSession.userId],
      );
      await updateTripSettings(appPool, ownerSession, ownerSession.tripId, {
        destinationName: "Tokyo, Japan",
        timeZone: "Asia/Tokyo",
        maxMembers: 10,
        endsOn: "2030-04-05",
      });
      await assert.rejects(
        updateTripSettings(appPool, memberSession, memberSession.tripId, {
          maxMembers: 9,
        }),
        (error) => error instanceof AppForbiddenError && /only the owner/i.test(error.message),
      );
      const updatedTripContext = await appPool.query(
        `SELECT destination_name, time_zone, max_members, ends_on::text,
                (SELECT count(*)::integer FROM trip_days WHERE trip_id = $1) AS day_count,
                EXISTS (
                  SELECT 1 FROM audit_events
                   WHERE trip_id = $1 AND entity_type = 'trip'
                     AND action = 'settings_updated'
                ) AS audited
           FROM trips WHERE id = $1`,
        [ownerSession.tripId],
      );
      assert.deepEqual(updatedTripContext.rows[0], {
        destination_name: "Tokyo, Japan",
        time_zone: "Asia/Tokyo",
        max_members: 10,
        ends_on: "2030-04-05",
        day_count: 5,
        audited: true,
      });
      const extensionSessions = await appPool.query(
        `SELECT id, expires_at, absolute_expires_at
           FROM auth_sessions
          WHERE id = ANY($1::uuid[])
          ORDER BY id`,
        [[
          "9a000000-0000-4000-8000-000000000001",
          "9a000000-0000-4000-8000-000000000002",
          "9a000000-0000-4000-8000-000000000003",
        ]],
      );
      assert.equal(extensionSessions.rows[0].expires_at.toISOString(), "2030-04-04T00:00:00.000Z");
      assert.equal(extensionSessions.rows[0].absolute_expires_at.toISOString(), "2030-04-06T15:00:00.000Z",
        "Extending travel dates must not extend an existing authentication ceiling");
      assert.equal(extensionSessions.rows[1].absolute_expires_at.toISOString(), "2030-04-06T15:00:00.000Z");
      assert.equal(extensionSessions.rows[2].absolute_expires_at.toISOString(), "2030-04-06T15:00:00.000Z");

      const secondTripSession = {
        ...ownerSession,
        tripId: "10000000-0000-4000-8000-000000000002",
        memberId: "20000000-0000-4000-8000-000000000003",
        userId: switchSourceSession.userId,
      };
      await updateTripSettings(appPool, secondTripSession, secondTripSession.tripId, {
        endsOn: "2030-05-02",
      });
      const repairedSecondTripDays = await appPool.query(
        `SELECT day_date::text AS day_date
           FROM trip_days
          WHERE trip_id = $1
          ORDER BY day_date`,
        [secondTripSession.tripId],
      );
      assert.deepEqual(
        repairedSecondTripDays.rows.map((row) => row.day_date),
        ["2030-05-01", "2030-05-02"],
      );
      await updateTripSettings(appPool, ownerSession, ownerSession.tripId, {
        endsOn: "2030-04-04",
      });
      assert.equal((await appPool.query(
        "SELECT count(*)::integer AS count FROM trip_days WHERE trip_id=$1", [ownerSession.tripId],
      )).rows[0].count, 5, "Shortening an unused edge preserves its historical day identity");
      // Keep the older upgrade scenarios on their original date range.
      await updateTripSettings(appPool, ownerSession, ownerSession.tripId, { endsOn: "2030-04-05" });

      const boundOwnerSession = {
        ...ownerSession,
        sessionId: randomUUID(),
        userId: switchSourceSession.userId,
        issuer: switchSourceSession.issuer,
        subject: switchSourceSession.subject,
      };
      const boundMemberSession = { ...memberSession, sessionId: randomUUID() };
      await appPool.query("INSERT INTO oidc_identities(issuer,subject,user_id) VALUES($1,$2,$3)",
        [boundMemberSession.issuer,boundMemberSession.subject,boundMemberSession.userId]);
      for (const creatorSession of [boundOwnerSession, boundMemberSession]) {
        await appPool.query(`INSERT INTO auth_sessions(id,family_id,trip_id,member_id,user_id,token_hash,
          device_label,expires_at,absolute_expires_at)
          VALUES($1,$1,$2,$3,$4,decode($5,'hex'),'Synthetic trip creator',
            CURRENT_TIMESTAMP+interval '24 hours',CURRENT_TIMESTAMP+interval '30 days')`,
        [creatorSession.sessionId,creatorSession.tripId,creatorSession.memberId,creatorSession.userId,
          randomUUID().replaceAll("-", "").repeat(2)]);
      }
      const createdTrip = await createTrip(appPool, boundOwnerSession, {
        name: "Owner-created Kyoto trip",
        destinationName: "Kyoto, Japan",
        timeZone: "Asia/Tokyo",
        defaultLocale: "zh-HK-lihkg",
        defaultCurrency: "JPY",
        startsOn: "2031-06-01",
        endsOn: "2031-06-03",
        maxMembers: 8,
      });
      const memberCreatedTrip = await createTrip(appPool, boundMemberSession, {
          name: "Member-created trip",
          destinationName: "Osaka, Japan",
          timeZone: "Asia/Tokyo",
          defaultLocale: "en",
          defaultCurrency: "JPY",
          startsOn: "2031-07-01",
          endsOn: "2031-07-02",
          maxMembers: 4,
        });
      assert.equal((await appPool.query("SELECT user_id FROM trip_members WHERE trip_id=$1 AND id=$2 AND role='owner'",
        [memberCreatedTrip.tripId,memberCreatedTrip.memberId])).rows[0].user_id,memberSession.userId);
      const createdTripState = await appPool.query(
        `SELECT t.owner_user_id, t.name, t.destination_name, t.time_zone,
                t.default_locale, t.default_currency, t.starts_on::text,
                t.ends_on::text, t.max_members,
                count(DISTINCT d.id)::integer AS day_count,
                bool_and(m.role = 'owner' AND m.status = 'active' AND m.user_id = $2) AS owner_active,
                bool_and(p.can_edit_itinerary AND NOT p.itinerary_requires_approval
                  AND p.can_edit_expenses AND NOT p.expense_requires_approval
                  AND p.can_sync_calendar) AS owner_permissions,
                bool_and(ai.member_daily_limit = 20 AND ai.member_model = 'gpt-5.6-sol') AS ai_defaults,
                bool_or(a.action = 'created' AND a.entity_type = 'trip') AS audited
           FROM trips t
           JOIN trip_days d ON d.trip_id = t.id
           JOIN trip_members m ON m.trip_id = t.id AND m.id = $3
           JOIN member_permissions p ON p.trip_id = t.id AND p.member_id = m.id
           JOIN trip_ai_settings ai ON ai.trip_id = t.id
           JOIN audit_events a ON a.trip_id = t.id AND a.entity_id = t.id
          WHERE t.id = $1
          GROUP BY t.id`,
        [createdTrip.tripId, boundOwnerSession.userId, createdTrip.memberId],
      );
      assert.deepEqual(createdTripState.rows[0], {
        owner_user_id: boundOwnerSession.userId,
        name: "Owner-created Kyoto trip",
        destination_name: "Kyoto, Japan",
        time_zone: "Asia/Tokyo",
        default_locale: "zh-HK-lihkg",
        default_currency: "JPY",
        starts_on: "2031-06-01",
        ends_on: "2031-06-03",
        max_members: 8,
        day_count: 3,
        owner_active: true,
        owner_permissions: true,
        ai_defaults: true,
        audited: true,
      });
      const overviewWithCreatedTrip = await getAppOverview(appPool, boundOwnerSession);
      assert.ok(
        overviewWithCreatedTrip.availableTrips.some((trip) => trip.id === createdTrip.tripId),
        "the owner should be able to switch to a newly created trip",
      );

      await appPool.query(
        `INSERT INTO app_users (id, display_name)
         VALUES ('00000000-0000-4000-8000-000000000003', 'Other trip member')`,
      );
      await appPool.query(
        `INSERT INTO trip_members (trip_id, id, user_id, display_name, role, status)
         VALUES (
           $1,
           '20000000-0000-4000-8000-000000000003',
           '00000000-0000-4000-8000-000000000003',
           'Other trip member',
           'editor',
           'active'
         )`,
        [ownerSession.tripId],
      );
      const otherMemberSession = {
        ...memberSession,
        sessionId: "other-member-test-session",
        memberId: "20000000-0000-4000-8000-000000000003",
        userId: "00000000-0000-4000-8000-000000000003",
        role: "editor",
        displayName: "Other trip member",
        subject: "other-member-subject",
      };

      await appPool.query(
        `INSERT INTO oidc_identities (
           issuer, subject, user_id, email_hint, display_name_hint,
           last_authenticated_at
         ) VALUES
           (
             'https://accounts.google.com', 'member-email-projection-subject',
             $1, 'sample.member@example.test', 'Sample Member',
             '2030-04-01T02:00:00Z'
           ),
           (
             'https://accounts.google.com', 'other-member-email-projection-subject',
             $2, 'other.member@example.test', 'Other trip member',
             '2030-04-01T03:00:00Z'
           )`,
        [memberSession.userId, otherMemberSession.userId],
      );
      const ownerMemberOverview = await getAppOverview(appPool, ownerSession);
      const ordinaryMemberOverview = await getAppOverview(appPool, memberSession);
      assert.equal(
        ownerMemberOverview.members.find((member) => member.id === memberSession.memberId)?.googleEmail,
        "sample.member@example.test",
      );
      assert.equal(
        ownerMemberOverview.members.find((member) => member.id === otherMemberSession.memberId)?.googleEmail,
        "other.member@example.test",
      );
      assert.ok(
        ordinaryMemberOverview.members.every((member) => !Object.hasOwn(member, "googleEmail")),
        "ordinary member overview must omit every Google email field",
      );
      const ordinaryMemberOverviewJson = JSON.stringify(ordinaryMemberOverview);
      assert.doesNotMatch(ordinaryMemberOverviewJson, /sample\.member@example\.test/);
      assert.doesNotMatch(ordinaryMemberOverviewJson, /other\.member@example\.test/);

      const rollbackReasons = [
        "Atomic batch first request must roll back",
        "Atomic batch invalid later request must roll back",
      ];
      await assert.rejects(
        createChangeRequestsAtomically(
          appPool,
          ownerSession,
          ownerSession.tripId,
          [
            {
              entityType: "itinerary_item",
              operation: "create",
              patch: {
                tripDayId: "30000000-0000-4000-8000-000000000002",
                title: "Atomic batch first event",
                startsAt: "2030-04-02T04:00:00.000Z",
              },
              reason: rollbackReasons[0],
              source: "ai",
            },
            {
              entityType: "itinerary_item",
              operation: "create",
              patch: {
                tripDayId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                title: "Atomic batch invalid later event",
                startsAt: "2030-04-02T05:00:00.000Z",
              },
              reason: rollbackReasons[1],
              source: "ai",
            },
          ],
        ),
        (error) => error instanceof AppNotFoundError && /trip day not found/i.test(error.message),
      );
      const rolledBackBatch = await appPool.query(
        `SELECT
           (SELECT count(*)::integer
              FROM change_requests
             WHERE trip_id = $1 AND reason = ANY($2::text[])) AS request_count,
           (SELECT count(*)::integer
              FROM audit_events
             WHERE trip_id = $1
               AND entity_type = 'change_request'
               AND action = 'requested'
               AND after_state->>'reason' = ANY($2::text[])) AS audit_count`,
        [ownerSession.tripId, rollbackReasons],
      );
      assert.deepEqual(rolledBackBatch.rows[0], {
        request_count: 0,
        audit_count: 0,
      });

      const completionFailureReasons = [
        "Atomic completion failure one",
        "Atomic completion failure two",
      ];
      await assert.rejects(
        inTransaction(appPool, async (client) => {
          await createAiItineraryCreateRequestsWithClient(
            client,
            ownerSession,
            ownerSession.tripId,
            completionFailureReasons.map((reason, index) => ({
              entityType: "itinerary_item",
              operation: "create",
              patch: {
                tripDayId: "30000000-0000-4000-8000-000000000002",
                title: `Completion rollback event ${index + 1}`,
              },
              reason,
              source: "ai",
            })),
          );
          throw new Error("Simulated AI completion-log failure");
        }),
        /simulated AI completion-log failure/i,
      );
      const completionRollback = await appPool.query(
        `SELECT
           (SELECT count(*)::integer
              FROM change_requests
             WHERE trip_id = $1 AND reason = ANY($2::text[])) AS request_count,
           (SELECT count(*)::integer
              FROM audit_events
             WHERE trip_id = $1
               AND entity_type = 'change_request'
               AND action = 'requested'
               AND after_state->>'reason' = ANY($2::text[])) AS audit_count`,
        [ownerSession.tripId, completionFailureReasons],
      );
      assert.deepEqual(completionRollback.rows[0], {
        request_count: 0,
        audit_count: 0,
      });

      await assert.rejects(
        createChangeRequestsAtomically(appPool, ownerSession, ownerSession.tripId, []),
        (error) => error instanceof AppInvalidInputError && /between 1 and 20/i.test(error.message),
      );
      await assert.rejects(
        createChangeRequestsAtomically(
          appPool,
          ownerSession,
          ownerSession.tripId,
          [{
            entityType: "itinerary_item",
            operation: "create",
            patch: {
              tripDayId: "30000000-0000-4000-8000-000000000001",
              title: "Unsupported owner batch",
            },
            reason: "Atomic batches are reserved for AI itinerary creates",
            source: "owner",
          }],
        ),
        (error) => error instanceof AppInvalidInputError && /only AI-created itinerary items/i.test(error.message),
      );
      await assert.rejects(
        createChangeRequestsAtomically(
          appPool,
          ownerSession,
          ownerSession.tripId,
          Array.from({ length: 21 }, (_, index) => ({
            entityType: "itinerary_item",
            operation: "create",
            patch: {
              tripDayId: "30000000-0000-4000-8000-000000000001",
              title: `Oversized AI batch event ${index + 1}`,
            },
            reason: `Oversized AI batch ${index + 1}`,
            source: "ai",
          })),
        ),
        (error) => error instanceof AppInvalidInputError && /between 1 and 20/i.test(error.message),
      );

      const successfulBatchReasons = [
        "Atomic AI batch success one",
        "Atomic AI batch success two",
      ];
      const successfulBatch = await createChangeRequestsAtomically(
        appPool,
        ownerSession,
        ownerSession.tripId,
        successfulBatchReasons.map((reason, index) => ({
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: `Atomic AI batch event ${index + 1}`,
            startsAt: `2030-04-02T0${index + 4}:00:00.000Z`,
          },
          reason,
          source: "ai",
        })),
      );
      assert.equal(successfulBatch.length, 2);
      assert.ok(successfulBatch.every((request) => request.status === "pending"));
      const storedSuccessfulBatch = await appPool.query(
        `SELECT
           count(*)::integer AS request_count,
           count(*) FILTER (WHERE source = 'ai' AND status = 'pending')::integer AS pending_ai_count,
           (SELECT count(*)::integer
              FROM audit_events
             WHERE trip_id = $1
               AND entity_type = 'change_request'
               AND action = 'requested'
               AND after_state->>'reason' = ANY($2::text[])) AS audit_count
           FROM change_requests
          WHERE trip_id = $1 AND reason = ANY($2::text[])`,
        [ownerSession.tripId, successfulBatchReasons],
      );
      assert.deepEqual(storedSuccessfulBatch.rows[0], {
        request_count: 2,
        pending_ai_count: 2,
        audit_count: 2,
      });

      const ownerPendingAiCreate = await createChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Owner AI proposal must wait",
            startsAt: "2030-04-02T07:00:00.000Z",
          },
          reason: "Owner asked AI to create an event",
          source: "ai",
        },
      );
      await assert.rejects(
        applyPermittedChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          ownerPendingAiCreate.id,
        ),
        (error) => error instanceof AppForbiddenError && /explicit owner approval/i.test(error.message),
      );
      const ownerAiCreateStillPending = await appPool.query(
        `SELECT cr.status,
                EXISTS (
                  SELECT 1 FROM itinerary_items i
                   WHERE i.trip_id = cr.trip_id
                     AND i.title = 'Owner AI proposal must wait'
                ) AS canonical_exists
           FROM change_requests cr WHERE cr.trip_id = $1 AND cr.id = $2`,
        [ownerSession.tripId, ownerPendingAiCreate.id],
      );
      assert.deepEqual(ownerAiCreateStillPending.rows[0], {
        status: "pending",
        canonical_exists: false,
      });
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        ownerPendingAiCreate.id,
        "reject",
        "Owner auto-apply guard regression cleanup",
      );

      const pendingAiCreate = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Pending AI ramen plan",
            itemType: "meal",
            startsAt: "2030-04-02T09:00:00.000Z",
            endsAt: "2030-04-02T10:00:00.000Z",
            locationName: "Synthetic ramen shop",
            mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic+ramen+shop",
            notes: "AI proposal awaiting owner approval",
          },
          reason: "Member asked AI to add dinner",
          source: "ai",
        },
      );
      const canonicalBeforeAiApproval = await appPool.query(
        `SELECT count(*)::integer AS item_count,
                count(ir.itinerary_item_id)::integer AS revision_count
           FROM itinerary_items i
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
          WHERE i.trip_id = $1 AND i.title = 'Pending AI ramen plan'`,
        [memberSession.tripId],
      );
      assert.deepEqual(canonicalBeforeAiApproval.rows[0], {
        item_count: 0,
        revision_count: 0,
      });

      const pendingOwnerOverview = await getAppOverview(appPool, ownerSession);
      const pendingRequesterOverview = await getAppOverview(appPool, memberSession);
      const pendingOtherOverview = await getAppOverview(appPool, otherMemberSession);
      const ownerProjection = pendingOwnerOverview.pendingItinerary.find(
        (item) => item.requestId === pendingAiCreate.id,
      );
      const requesterProjection = pendingRequesterOverview.pendingItinerary.find(
        (item) => item.requestId === pendingAiCreate.id,
      );
      const otherProjection = pendingOtherOverview.pendingItinerary.find(
        (item) => item.requestId === pendingAiCreate.id,
      );
      assert.ok(ownerProjection);
      assert.ok(requesterProjection);
      assert.equal(otherProjection, undefined);
      assert.equal(requesterProjection.tripDayId, "30000000-0000-4000-8000-000000000002");
      assert.equal(
        pendingRequesterOverview.days.find((day) => day.id === requesterProjection.tripDayId)?.date,
        "2030-04-02",
      );
      assert.equal(requesterProjection.title, "Pending AI ramen plan");
      assert.equal(requesterProjection.requestedByMemberId, memberSession.memberId);
      assert.equal(requesterProjection.requestedByName, memberSession.displayName);
      assert.equal(requesterProjection.status, "pending");
      assert.deepEqual(requesterProjection.viewerMemberIds, []);
      assert.equal(requesterProjection.visibility, "trip");
      assert.deepEqual(Object.keys(requesterProjection).sort(), [
        "createdAt",
        "createdByMemberId",
        "departureLocationName",
        "departureMapUrl",
        "destinationLocationName",
        "destinationMapUrl",
        "endsAt",
        "itemType",
        "locationName",
        "mapUrl",
        "notes",
        "operation",
        "proposalRevision",
        "requestId",
        "requestedByMemberId",
        "requestedByName",
        "startsAt",
        "status",
        "targetItemId",
        "title",
        "tripDayId",
        "updatedAt",
        "viewerMemberIds",
        "visibility",
      ].sort());
      assert.equal(pendingRequesterOverview.approvalPendingCount, 0);
      assert.equal(pendingOtherOverview.approvalPendingCount, 0);
      assert.ok(pendingOwnerOverview.approvalPendingCount >= 1);
      assert.equal(Object.hasOwn(pendingOwnerOverview, "changeRequests"), false);
      assert.equal(Object.hasOwn(pendingRequesterOverview, "changeRequests"), false);

      const pendingMemberCreate = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000003",
            title: "Pending member-created dinner",
            itemType: "meal",
            startsAt: "2030-04-03T09:00:00.000Z",
            endsAt: "2030-04-03T10:00:00.000Z",
          },
          reason: "Manual proposal awaiting owner approval",
        },
      );
      for (const overview of [
        await getAppOverview(appPool, ownerSession),
        await getAppOverview(appPool, memberSession),
        await getAppOverview(appPool, otherMemberSession),
      ]) {
        const projection = overview.pendingItinerary.find(
          (item) => item.requestId === pendingMemberCreate.id,
        );
        assert.ok(projection);
        assert.equal(projection.title, "Pending member-created dinner");
      }
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        pendingMemberCreate.id,
        "reject",
        "Manual pending-create projection regression cleanup",
      );
      for (const overview of [
        await getAppOverview(appPool, ownerSession),
        await getAppOverview(appPool, memberSession),
        await getAppOverview(appPool, otherMemberSession),
      ]) {
        assert.ok(!overview.pendingItinerary.some(
          (item) => item.requestId === pendingMemberCreate.id,
        ));
      }
      const rejectedMemberCreateHistory = (await readAllApprovalHistory(appPool, ownerSession)).find(
        (request) => request.id === pendingMemberCreate.id,
      );
      assert.equal(rejectedMemberCreateHistory?.status, "rejected");
      assert.equal(rejectedMemberCreateHistory?.reviewNote, "Manual pending-create projection regression cleanup");
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          pendingMemberCreate.id,
          "approve",
        ),
        (error) => error instanceof AppForbiddenError && /only the owner/i.test(error.message),
      );
      const approvedAfterRejection = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        pendingMemberCreate.id,
        "approve",
        "Reconsidered after reviewing the full plan",
      );
      assert.equal(approvedAfterRejection.status, "approved");
      assert.equal(approvedAfterRejection.revision, 1);
      assert.ok(approvedAfterRejection.entityId);
      const approvedMemberCreateHistory = (await readAllApprovalHistory(appPool, ownerSession)).find(
        (request) => request.id === pendingMemberCreate.id,
      );
      assert.equal(approvedMemberCreateHistory?.status, "approved");
      assert.equal(approvedMemberCreateHistory?.reviewNote, "Reconsidered after reviewing the full plan");
      const rejectedThenApprovedState = await appPool.query(
        `SELECT cr.status, cr.applied_revision,
                count(DISTINCT i.id)::integer AS item_count,
                count(DISTINCT ir.revision)::integer AS revision_count,
                count(DISTINCT ae.id) FILTER (
                  WHERE ae.entity_type = 'change_request' AND ae.action = 'rejected'
                )::integer AS rejection_audit_count,
                count(DISTINCT ae.id) FILTER (
                  WHERE ae.entity_type = 'itinerary_item' AND ae.action = 'created'
                )::integer AS approval_audit_count
           FROM change_requests cr
           LEFT JOIN itinerary_items i
             ON i.trip_id = cr.trip_id AND i.id = cr.entity_id
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
           LEFT JOIN audit_events ae
             ON ae.trip_id = cr.trip_id
            AND (
              (ae.entity_type = 'change_request' AND ae.entity_id = cr.id)
              OR
              (ae.entity_type = 'itinerary_item' AND ae.entity_id = i.id
                AND ae.metadata->>'changeRequestId' = cr.id::text)
            )
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.applied_revision`,
        [ownerSession.tripId, pendingMemberCreate.id],
      );
      assert.deepEqual(rejectedThenApprovedState.rows[0], {
        status: "approved",
        applied_revision: 1,
        item_count: 1,
        revision_count: 1,
        rejection_audit_count: 1,
        approval_audit_count: 1,
      });
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          pendingMemberCreate.id,
          "reject",
          "Approved history is immutable",
        ),
        (error) => error instanceof AppConflictError && /approved request cannot be rejected/i.test(error.message),
      );
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          pendingMemberCreate.id,
          "approve",
        ),
        (error) => error instanceof AppConflictError && /already reviewed/i.test(error.message),
      );
      const immutableApprovedState = await appPool.query(
        `SELECT cr.status, cr.applied_revision,
                count(DISTINCT i.id)::integer AS item_count,
                count(DISTINCT ir.revision)::integer AS revision_count
           FROM change_requests cr
           LEFT JOIN itinerary_items i
             ON i.trip_id = cr.trip_id AND i.id = cr.entity_id
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.applied_revision`,
        [ownerSession.tripId, pendingMemberCreate.id],
      );
      assert.deepEqual(immutableApprovedState.rows[0], {
        status: "approved",
        applied_revision: 1,
        item_count: 1,
        revision_count: 1,
      });

      const staleViewerMember = await createTripMember(
        appPool,
        ownerSession,
        ownerSession.tripId,
        { displayName: "Stale private viewer" },
      );
      const staleViewerRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000003",
            title: "Removed private viewer must block reapproval",
            visibility: "private",
            viewerMemberIds: [staleViewerMember.id, ownerSession.memberId],
          },
          reason: "Review-time private viewer eligibility regression",
          source: "ai",
        },
      );
      await retireSyntheticMemberBefore0037(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleViewerMember.id,
      );
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleViewerRequest.id,
        "reject",
        "Reject after removing a proposed private viewer",
      );
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          staleViewerRequest.id,
          "approve",
          "A removed private viewer must make this request stale",
        ),
        (error) => error instanceof AppNotFoundError && /change request not found/i.test(error.message),
      );
      const staleViewerState = await appPool.query(
        `SELECT cr.status, cr.entity_id, cr.applied_revision,
                count(i.id)::integer AS canonical_item_count
           FROM change_requests cr
           LEFT JOIN itinerary_items i
             ON i.trip_id = cr.trip_id
            AND i.title = 'Removed private viewer must block reapproval'
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.entity_id, cr.applied_revision`,
        [ownerSession.tripId, staleViewerRequest.id],
      );
      assert.deepEqual(staleViewerState.rows[0], {
        status: "rejected",
        entity_id: null,
        applied_revision: null,
        canonical_item_count: 0,
      });

      const staleLinkedExpenseMember = await createTripMember(
        appPool,
        ownerSession,
        ownerSession.tripId,
        { displayName: "Stale linked expense member" },
      );
      const staleLinkedExpenseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000003",
            title: "Revoked linked expense member must block reapproval",
            linkedExpense: {
              description: "Revoked linked expense must not be created",
              amountMinor: 1800,
              currency: "JPY",
              payerMemberId: staleLinkedExpenseMember.id,
              splitMemberIds: [memberSession.memberId, staleLinkedExpenseMember.id],
              occurredAt: "2030-04-03T08:00:00.000Z",
            },
          },
          reason: "Review-time linked-expense member eligibility regression",
          source: "ai",
        },
      );
      await updateTripMember(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleLinkedExpenseMember.id,
        { disabled: true },
      );
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleLinkedExpenseRequest.id,
        "reject",
        "Reject after disabling a linked-expense participant",
      );
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          staleLinkedExpenseRequest.id,
          "approve",
          "A revoked linked-expense member must make this request stale",
        ),
        (error) => error instanceof AppNotFoundError && /change request not found/i.test(error.message),
      );
      const staleLinkedExpenseState = await appPool.query(
        `SELECT cr.status, cr.entity_id, cr.applied_revision,
                count(DISTINCT i.id)::integer AS canonical_item_count,
                count(DISTINCT e.id)::integer AS canonical_expense_count
           FROM change_requests cr
           LEFT JOIN itinerary_items i
             ON i.trip_id = cr.trip_id
            AND i.title = 'Revoked linked expense member must block reapproval'
           LEFT JOIN expenses e
             ON e.trip_id = cr.trip_id
            AND e.description = 'Revoked linked expense must not be created'
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.entity_id, cr.applied_revision`,
        [ownerSession.tripId, staleLinkedExpenseRequest.id],
      );
      assert.deepEqual(staleLinkedExpenseState.rows[0], {
        status: "rejected",
        entity_id: null,
        applied_revision: null,
        canonical_item_count: 0,
        canonical_expense_count: 0,
      });
      await retireSyntheticMemberBefore0037(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleLinkedExpenseMember.id,
      );

      const staleExpenseMember = await createTripMember(
        appPool,
        ownerSession,
        ownerSession.tripId,
        { displayName: "Stale standalone expense member" },
      );
      const staleExpenseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "expense",
          operation: "create",
          patch: {
            description: "Removed standalone expense must not be created",
            amountMinor: 2300,
            currency: "JPY",
            payerMemberId: staleExpenseMember.id,
            splitMemberIds: [staleExpenseMember.id, memberSession.memberId],
            occurredAt: "2030-04-03T09:00:00.000Z",
          },
          reason: "Review-time standalone-expense member eligibility regression",
          source: "ai",
        },
      );
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleExpenseRequest.id,
        "reject",
        "Reject before removing a standalone-expense participant",
      );
      await retireSyntheticMemberBefore0037(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleExpenseMember.id,
      );
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          staleExpenseRequest.id,
          "approve",
          "A removed expense member must make this request stale",
        ),
        (error) => error instanceof AppNotFoundError && /change request not found/i.test(error.message),
      );
      const staleExpenseState = await appPool.query(
        `SELECT cr.status, cr.entity_id, cr.applied_revision,
                count(e.id)::integer AS canonical_expense_count
           FROM change_requests cr
           LEFT JOIN expenses e
             ON e.trip_id = cr.trip_id
            AND e.description = 'Removed standalone expense must not be created'
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.entity_id, cr.applied_revision`,
        [ownerSession.tripId, staleExpenseRequest.id],
      );
      assert.deepEqual(staleExpenseState.rows[0], {
        status: "rejected",
        entity_id: null,
        applied_revision: null,
        canonical_expense_count: 0,
      });

      const staleDirectExpenseMember = await createTripMember(
        appPool,
        ownerSession,
        ownerSession.tripId,
        { displayName: "Stale direct expense member" },
      );
      const staleDirectExpenseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "expense",
          operation: "create",
          patch: {
            description: "Removed direct expense must not be created",
            amountMinor: 2700,
            currency: "JPY",
            payerMemberId: staleDirectExpenseMember.id,
            splitMemberIds: [memberSession.memberId, staleDirectExpenseMember.id],
            occurredAt: "2030-04-03T10:00:00.000Z",
          },
          reason: "Direct member apply must revalidate proposed members",
        },
      );
      await retireSyntheticMemberBefore0037(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleDirectExpenseMember.id,
      );
      await assert.rejects(
        applyPermittedChangeRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          staleDirectExpenseRequest.id,
        ),
        (error) => error instanceof AppNotFoundError && /change request not found/i.test(error.message),
      );
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        staleDirectExpenseRequest.id,
        "reject",
        "Reject the stale direct-apply request",
      );
      const staleDirectExpenseState = await appPool.query(
        `SELECT cr.status, cr.entity_id, cr.applied_revision,
                count(e.id)::integer AS canonical_expense_count
           FROM change_requests cr
           LEFT JOIN expenses e
             ON e.trip_id = cr.trip_id
            AND e.description = 'Removed direct expense must not be created'
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.entity_id, cr.applied_revision`,
        [ownerSession.tripId, staleDirectExpenseRequest.id],
      );
      assert.deepEqual(staleDirectExpenseState.rows[0], {
        status: "rejected",
        entity_id: null,
        applied_revision: null,
        canonical_expense_count: 0,
      });

      const privateAudienceMarker = "PRIVATE_AUDIENCE_REGRESSION_SECRET";
      const publicToPrivateRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: approvedAfterRejection.entityId,
          operation: "update",
          baseRevision: 1,
          patch: {
            visibility: "private",
            viewerMemberIds: [otherMemberSession.memberId],
            notes: privateAudienceMarker,
          },
          reason: "Effective proposed audience privacy regression",
        },
      );
      const pendingPrivateAudienceVisibility = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS creator_can_view,
                app_member_can_view_change_request($1, $2, $5) AS selected_viewer_can_view`,
        [
          memberSession.tripId,
          publicToPrivateRequest.id,
          ownerSession.memberId,
          memberSession.memberId,
          otherMemberSession.memberId,
        ],
      );
      assert.deepEqual(pendingPrivateAudienceVisibility.rows[0], {
        owner_can_view: false,
        creator_can_view: true,
        selected_viewer_can_view: true,
      });
      const ownerPendingPrivateSnapshot = JSON.stringify(await getAppOverview(appPool, ownerSession));
      assert.doesNotMatch(ownerPendingPrivateSnapshot, new RegExp(privateAudienceMarker));
      assert.doesNotMatch(ownerPendingPrivateSnapshot, new RegExp(publicToPrivateRequest.id));
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          publicToPrivateRequest.id,
          "reject",
          "Owner must not learn a private proposed patch",
        ),
        /change request not found/i,
      );
      await appPool.query(
        `UPDATE change_requests
            SET status = 'rejected', reviewed_by_member_id = $3,
                review_note = 'Synthetic privacy regression cleanup',
                reviewed_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, publicToPrivateRequest.id, memberSession.memberId],
      );
      const rejectedPrivateAudienceVisibility = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS creator_can_view,
                app_member_can_view_change_request($1, $2, $5) AS selected_viewer_can_view`,
        [
          memberSession.tripId,
          publicToPrivateRequest.id,
          ownerSession.memberId,
          memberSession.memberId,
          otherMemberSession.memberId,
        ],
      );
      assert.deepEqual(rejectedPrivateAudienceVisibility.rows[0], {
        owner_can_view: false,
        creator_can_view: true,
        selected_viewer_can_view: true,
      });
      const ownerRejectedPrivateSnapshot = JSON.stringify(await getAppOverview(appPool, ownerSession));
      assert.doesNotMatch(ownerRejectedPrivateSnapshot, new RegExp(privateAudienceMarker));
      assert.doesNotMatch(ownerRejectedPrivateSnapshot, new RegExp(publicToPrivateRequest.id));

      await assert.rejects(
        reviewChangeRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          pendingAiCreate.id,
          "approve",
        ),
        (error) => error instanceof AppForbiddenError && /only the owner/i.test(error.message),
      );
      const stillPending = await appPool.query(
        `SELECT status, entity_id FROM change_requests WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, pendingAiCreate.id],
      );
      assert.deepEqual(stillPending.rows[0], { status: "pending", entity_id: null });
      assert.equal(
        Number((await appPool.query(
          `SELECT count(*) FROM itinerary_items WHERE trip_id = $1 AND title = 'Pending AI ramen plan'`,
          [memberSession.tripId],
        )).rows[0].count),
        0,
      );

      const approvedAiCreate = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        pendingAiCreate.id,
        "approve",
        "Approved from the inline pending-event card",
      );
      assert.equal(approvedAiCreate.status, "approved");
      assert.equal(approvedAiCreate.revision, 1);
      assert.ok(approvedAiCreate.entityId);
      for (const overview of [
        await getAppOverview(appPool, ownerSession),
        await getAppOverview(appPool, memberSession),
        await getAppOverview(appPool, otherMemberSession),
      ]) {
        assert.ok(!overview.pendingItinerary.some((item) => item.requestId === pendingAiCreate.id));
        assert.equal(
          overview.itinerary.filter((item) => item.id === approvedAiCreate.entityId).length,
          1,
        );
      }
      const canonicalAfterAiApproval = await appPool.query(
        `SELECT count(DISTINCT i.id)::integer AS item_count,
                count(DISTINCT ir.revision)::integer AS revision_count,
                count(DISTINCT ae.id)::integer AS created_audit_count
           FROM itinerary_items i
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
           LEFT JOIN audit_events ae
             ON ae.trip_id = i.trip_id
            AND ae.entity_type = 'itinerary_item'
            AND ae.entity_id = i.id
            AND ae.action = 'created'
            AND ae.metadata->>'changeRequestId' = $3
          WHERE i.trip_id = $1 AND i.id = $2`,
        [memberSession.tripId, approvedAiCreate.entityId, pendingAiCreate.id],
      );
      assert.deepEqual(canonicalAfterAiApproval.rows[0], {
        item_count: 1,
        revision_count: 1,
        created_audit_count: 1,
      });
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          pendingAiCreate.id,
          "approve",
        ),
        (error) => error instanceof AppConflictError && /already reviewed/i.test(error.message),
      );
      const canonicalAfterDuplicateApproval = await appPool.query(
        `SELECT count(DISTINCT i.id)::integer AS item_count,
                count(DISTINCT ir.revision)::integer AS revision_count,
                count(DISTINCT ae.id)::integer AS created_audit_count
           FROM itinerary_items i
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
           LEFT JOIN audit_events ae
             ON ae.trip_id = i.trip_id
            AND ae.entity_type = 'itinerary_item'
            AND ae.entity_id = i.id
            AND ae.action = 'created'
            AND ae.metadata->>'changeRequestId' = $3
          WHERE i.trip_id = $1 AND i.id = $2`,
        [memberSession.tripId, approvedAiCreate.entityId, pendingAiCreate.id],
      );
      assert.deepEqual(canonicalAfterDuplicateApproval.rows[0], {
        item_count: 1,
        revision_count: 1,
        created_audit_count: 1,
      });

      const concurrentPendingCreate = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000003",
            title: "Concurrent approval snapshot regression",
            itemType: "activity",
            startsAt: "2030-04-03T05:00:00.000Z",
            endsAt: "2030-04-03T06:00:00.000Z",
          },
          reason: "Verify overview reads confirmed and pending events from one snapshot",
          source: "ai",
        },
      );
      const snapshotClient = await appPool.connect();
      let releaseOverviewAfterApproval;
      const approvalCommitted = new Promise((resolve) => {
        releaseOverviewAfterApproval = resolve;
      });
      let reportCanonicalRead;
      const canonicalRead = new Promise((resolve) => {
        reportCanonicalRead = resolve;
      });
      let snapshotQueryQueue = Promise.resolve();
      const snapshotPool = {
        async connect() {
          return {
            query(...args) {
              const queryText = typeof args[0] === "string" ? args[0] : args[0].text;
              const queryResult = snapshotQueryQueue.then(async () => {
                const result = await snapshotClient.query(...args);
                if (queryText.includes("SELECT i.id, i.trip_day_id, i.title")) {
                  reportCanonicalRead();
                  await approvalCommitted;
                }
                return result;
              });
              snapshotQueryQueue = queryResult.then(() => undefined, () => undefined);
              return queryResult;
            },
            release() {
              snapshotClient.release();
            },
          };
        },
      };
      const snapshotOverviewPromise = getAppOverview(snapshotPool, memberSession);
      await canonicalRead;
      let concurrentlyApproved;
      try {
        concurrentlyApproved = await reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          concurrentPendingCreate.id,
          "approve",
          "Committed while an overview snapshot was in progress",
        );
      } finally {
        releaseOverviewAfterApproval();
      }
      const snapshotOverview = await snapshotOverviewPromise;
      assert.equal(
        snapshotOverview.itinerary.some((item) => item.id === concurrentlyApproved.entityId),
        false,
      );
      assert.equal(
        snapshotOverview.pendingItinerary.some(
          (item) => item.requestId === concurrentPendingCreate.id,
        ),
        true,
      );
      const afterConcurrentApprovalOverview = await getAppOverview(appPool, memberSession);
      assert.equal(
        afterConcurrentApprovalOverview.pendingItinerary.some(
          (item) => item.requestId === concurrentPendingCreate.id,
        ),
        false,
      );
      assert.equal(
        afterConcurrentApprovalOverview.itinerary.filter(
          (item) => item.id === concurrentlyApproved.entityId,
        ).length,
        1,
      );

      const privatePendingAiCreate = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000003",
            title: "Private pending AI plan",
            itemType: "activity",
            startsAt: "2030-04-03T03:00:00.000Z",
            endsAt: "2030-04-03T04:00:00.000Z",
            visibility: "private",
            viewerMemberIds: [],
          },
          reason: "Private AI proposal audience regression",
          source: "ai",
        },
      );
      const privatePendingOwnerOverview = await getAppOverview(appPool, ownerSession);
      const privatePendingRequesterOverview = await getAppOverview(appPool, memberSession);
      const privatePendingOtherOverview = await getAppOverview(appPool, otherMemberSession);
      assert.ok(privatePendingOwnerOverview.pendingItinerary.some(
        (item) => item.requestId === privatePendingAiCreate.id,
      ));
      assert.ok(privatePendingRequesterOverview.pendingItinerary.some(
        (item) => item.requestId === privatePendingAiCreate.id,
      ));
      assert.ok(!privatePendingOtherOverview.pendingItinerary.some(
        (item) => item.requestId === privatePendingAiCreate.id,
      ));
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        privatePendingAiCreate.id,
        "reject",
        "Keep this private proposal out of the plan",
      );
      for (const overview of [
        await getAppOverview(appPool, ownerSession),
        await getAppOverview(appPool, memberSession),
        await getAppOverview(appPool, otherMemberSession),
      ]) {
        assert.ok(!overview.pendingItinerary.some(
          (item) => item.requestId === privatePendingAiCreate.id,
        ));
      }
      const rejectedPrivateAiHistory = (await readAllApprovalHistory(appPool, ownerSession)).find(
        (request) => request.id === privatePendingAiCreate.id,
      );
      assert.equal(rejectedPrivateAiHistory?.status, "rejected");
      assert.equal(
        Number((await appPool.query(
          `SELECT count(*) FROM itinerary_items WHERE trip_id = $1 AND title = 'Private pending AI plan'`,
          [memberSession.tripId],
        )).rows[0].count),
        0,
      );

      const supersededPendingAiCreate = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000003",
            title: "Superseded pending AI plan",
          },
          reason: "Superseded AI projection regression",
          source: "ai",
        },
      );
      await appPool.query(
        `UPDATE change_requests
            SET status = 'superseded', reviewed_by_member_id = $3,
                review_note = 'Superseded by a newer proposal', reviewed_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, supersededPendingAiCreate.id, ownerSession.memberId],
      );
      for (const overview of [
        await getAppOverview(appPool, ownerSession),
        await getAppOverview(appPool, memberSession),
        await getAppOverview(appPool, otherMemberSession),
      ]) {
        assert.ok(!overview.pendingItinerary.some(
          (item) => item.requestId === supersededPendingAiCreate.id,
        ));
      }
      assert.equal(
        Number((await appPool.query(
          `SELECT count(*) FROM itinerary_items WHERE trip_id = $1 AND title = 'Superseded pending AI plan'`,
          [memberSession.tripId],
        )).rows[0].count),
        0,
      );

      const requested = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: "40000000-0000-4000-8000-000000000001",
          operation: "update",
          baseRevision: 2,
          patch: { notes: "Meet beside the east entrance" },
          reason: "The meeting note changed",
        },
      );
      const pending = await withClient((client) => client.query(
        `SELECT status, proposed_patch->>'notes' AS notes
           FROM change_requests WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, requested.id],
      ));
      assert.deepEqual(pending.rows[0], { status: "pending", notes: "Meet beside the east entrance" });

      const applied = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        requested.id,
        "approve",
        "Verified meeting note",
      );
      assert.equal(applied.status, "approved");
      assert.equal(applied.revision, 3);
      const updatedItem = await withClient((client) => client.query(
        `SELECT notes, current_revision
           FROM itinerary_items WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, applied.entityId],
      ));
      assert.deepEqual(updatedItem.rows[0], { notes: "Meet beside the east entrance", current_revision: 3 });

      const expenseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "expense",
          operation: "create",
          patch: {
            description: "Member-added train fare",
            amountMinor: 1001,
            currency: "JPY",
            payerMemberId: memberSession.memberId,
            itineraryItemId: "40000000-0000-4000-8000-000000000001",
            splitMemberIds: [ownerSession.memberId, memberSession.memberId],
            occurredAt: "2030-04-01T08:00:00.000Z",
            status: "posted",
          },
          reason: "Expense entered by a permitted member",
        },
      );
      const directExpense = await applyPermittedChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        expenseRequest.id,
      );
      assert.equal(directExpense.status, "approved");
      const storedExpense = await withClient((client) => client.query(
        `SELECT e.itinerary_item_id, e.current_revision,
                sum(es.share_minor)::integer AS allocated,
                count(es.member_id)::integer AS split_count,
                EXISTS (
                  SELECT 1 FROM audit_events ae
                   WHERE ae.trip_id = e.trip_id AND ae.entity_id = e.id
                     AND ae.entity_type = 'expense' AND ae.action = 'created'
                ) AS audited
           FROM expenses e
           JOIN expense_splits es ON es.trip_id = e.trip_id AND es.expense_id = e.id
          WHERE e.trip_id = $1 AND e.id = $2
          GROUP BY e.trip_id, e.id`,
        [memberSession.tripId, directExpense.entityId],
      ));
      assert.deepEqual(storedExpense.rows[0], {
        itinerary_item_id: "40000000-0000-4000-8000-000000000001",
        current_revision: 1,
        allocated: 1001,
        split_count: 2,
        audited: true,
      });

      const publicTargetRelinkMarker = "PUBLIC_TARGET_RELINK_SNAPSHOT_REGRESSION_SECRET";
      const publicTargetRelinkRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "expense",
          entityId: directExpense.entityId,
          operation: "update",
          baseRevision: 1,
          patch: {
            payerMemberId: memberSession.memberId,
            splitMemberIds: [memberSession.memberId],
            itineraryItemId: approvedAfterRejection.entityId,
            description: publicTargetRelinkMarker,
          },
          reason: "Proposed target current-and-submit-time audience regression",
        },
      );
      const publicTargetSnapshotBeforePrivacyChange = await appPool.query(
        `SELECT proposed_patch->'itineraryAudienceSnapshot'->>'itineraryItemId'
                  AS itinerary_item_id,
                proposed_patch->'itineraryAudienceSnapshot'->>'visibility'
                  AS visibility,
                app_member_can_view_change_request(trip_id, id, $3) AS owner_can_view
           FROM change_requests
          WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, publicTargetRelinkRequest.id, ownerSession.memberId],
      );
      assert.deepEqual(publicTargetSnapshotBeforePrivacyChange.rows[0], {
        itinerary_item_id: approvedAfterRejection.entityId,
        visibility: "trip",
        owner_can_view: true,
      });
      const hidePublicRelinkTargetRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: approvedAfterRejection.entityId,
          operation: "update",
          baseRevision: 1,
          patch: {
            visibility: "private",
            viewerMemberIds: [otherMemberSession.memberId],
          },
          reason: "Make a formerly public proposed expense target private",
        },
      );
      const hiddenPublicRelinkTarget = await applyPermittedChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        hidePublicRelinkTargetRequest.id,
      );
      assert.equal(hiddenPublicRelinkTarget.revision, 2);
      const publicTargetVisibilityAfterPrivacyChange = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS requester_can_view,
                app_member_can_view_change_request($1, $2, $5) AS selected_viewer_can_view`,
        [
          memberSession.tripId,
          publicTargetRelinkRequest.id,
          ownerSession.memberId,
          memberSession.memberId,
          otherMemberSession.memberId,
        ],
      );
      assert.deepEqual(publicTargetVisibilityAfterPrivacyChange.rows[0], {
        owner_can_view: false,
        requester_can_view: true,
        selected_viewer_can_view: true,
      });
      const invalidSnapshotRequest = await appPool.query(
        `INSERT INTO change_requests (
           trip_id, id, requested_by_member_id, source, entity_type, entity_id,
           operation, base_revision, proposed_patch, reason
         ) VALUES (
           $1, gen_random_uuid(), $2, 'member', 'expense', $3,
           'update', 1, $4::jsonb,
           'Invalid itinerary audience snapshot UUID must fail closed'
         )
         RETURNING id`,
        [
          memberSession.tripId,
          memberSession.memberId,
          directExpense.entityId,
          JSON.stringify({
            itineraryItemId: approvedAfterRejection.entityId,
            itineraryAudienceSnapshot: {
              itineraryItemId: "not-a-uuid",
              createdByMemberId: memberSession.memberId,
              visibility: "trip",
              viewerMemberIds: [],
            },
          }),
        ],
      );
      const invalidSnapshotRequestId = invalidSnapshotRequest.rows[0].id;
      const invalidSnapshotVisibility = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS requester_can_view`,
        [
          memberSession.tripId,
          invalidSnapshotRequestId,
          ownerSession.memberId,
          memberSession.memberId,
        ],
      );
      assert.deepEqual(invalidSnapshotVisibility.rows[0], {
        owner_can_view: false,
        requester_can_view: false,
      });
      const ownerAfterTargetPrivacyChange = JSON.stringify(await getAppOverview(appPool, ownerSession));
      assert.doesNotMatch(ownerAfterTargetPrivacyChange, new RegExp(publicTargetRelinkMarker));
      assert.doesNotMatch(ownerAfterTargetPrivacyChange, new RegExp(publicTargetRelinkRequest.id));
      assert.doesNotMatch(ownerAfterTargetPrivacyChange, new RegExp(invalidSnapshotRequestId));
      await appPool.query(
        `UPDATE change_requests
            SET status = 'rejected', reviewed_by_member_id = $3,
                review_note = 'Synthetic proposed-target transition cleanup',
                reviewed_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = ANY($2::uuid[])`,
        [
          memberSession.tripId,
          [publicTargetRelinkRequest.id, invalidSnapshotRequestId],
          memberSession.memberId,
        ],
      );

      const eventWithExpenseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Dinner created with its bill",
            itemType: "meal",
            startsAt: "2030-04-02T10:00:00.000Z",
            endsAt: "2030-04-02T11:30:00.000Z",
            linkedExpense: {
              description: "Shared dinner bill",
              amountMinor: 5001,
              currency: "JPY",
              payerMemberId: memberSession.memberId,
              splitMemberIds: [ownerSession.memberId, memberSession.memberId],
              occurredAt: "2030-04-02T10:00:00.000Z",
              status: "posted",
            },
          },
          reason: "Create the plan and linked expense atomically",
        },
      );
      const eventWithExpense = await applyPermittedChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        eventWithExpenseRequest.id,
      );
      const linkedRecords = await withClient((client) => client.query(
        `SELECT i.title, i.current_revision AS event_revision,
                e.description, e.current_revision AS expense_revision,
                sum(es.share_minor)::integer AS allocated,
                count(es.member_id)::integer AS split_count,
                count(DISTINCT ae.id) FILTER (WHERE ae.entity_type = 'expense' AND ae.action = 'created')::integer AS expense_audits
           FROM itinerary_items i
           JOIN expenses e ON e.trip_id = i.trip_id AND e.itinerary_item_id = i.id
           JOIN expense_splits es ON es.trip_id = e.trip_id AND es.expense_id = e.id
           LEFT JOIN audit_events ae ON ae.trip_id = e.trip_id AND ae.entity_id = e.id
          WHERE i.trip_id = $1 AND i.id = $2
          GROUP BY i.id, i.title, i.current_revision,
                   e.id, e.description, e.current_revision`,
        [memberSession.tripId, eventWithExpense.entityId],
      ));
      assert.deepEqual(linkedRecords.rows[0], {
        title: "Dinner created with its bill",
        event_revision: 1,
        description: "Shared dinner bill",
        expense_revision: 1,
        allocated: 5001,
        split_count: 2,
        expense_audits: 1,
      });

      const privateEventRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Private member dinner",
            itemType: "meal",
            startsAt: "2030-04-02T12:00:00.000Z",
            endsAt: "2030-04-02T13:00:00.000Z",
            visibility: "private",
            viewerMemberIds: [],
            linkedExpense: {
              description: "Private dinner bill",
              amountMinor: 2400,
              currency: "JPY",
              payerMemberId: memberSession.memberId,
              splitMemberIds: [memberSession.memberId],
              occurredAt: "2030-04-02T12:00:00.000Z",
              status: "posted",
            },
          },
          reason: "Private event visibility test",
        },
      );
      const privateEvent = await applyPermittedChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        privateEventRequest.id,
      );
      const memberPrivateOverview = await getAppOverview(appPool, memberSession);
      const ownerPrivateOverview = await getAppOverview(appPool, ownerSession);
      assert.equal(memberPrivateOverview.approvalPendingCount, 0);
      assert.deepEqual(memberPrivateOverview.activity, []);
      assert.deepEqual(memberPrivateOverview.aiLogs, []);
      assert.ok(memberPrivateOverview.itinerary.some((item) => item.id === privateEvent.entityId));
      assert.ok(!ownerPrivateOverview.itinerary.some((item) => item.id === privateEvent.entityId));
      assert.ok(memberPrivateOverview.expenses.some((expense) => expense.itineraryItemId === privateEvent.entityId));
      assert.ok(!ownerPrivateOverview.expenses.some((expense) => expense.itineraryItemId === privateEvent.entityId));
      assert.ok(!(await readAllApprovalHistory(appPool, ownerSession)).some(
        (request) => request.id === privateEventRequest.id,
      ));
      const privateExpense = memberPrivateOverview.expenses.find(
        (expense) => expense.itineraryItemId === privateEvent.entityId,
      );
      assert.ok(privateExpense);

      await updateMemberPermissions(appPool, ownerSession, ownerSession.tripId, memberSession.memberId, {
        canEditItinerary: true,
        itineraryRequiresApproval: false,
        canEditExpenses: true,
        expenseRequiresApproval: true,
        canSyncCalendar: true,
      });
      const privateExpenseApprovalReasons = [
        "Approval-required private expense create must not leak",
        "Approval-required public expense relink must not leak",
        "Approval-required current private expense update must not leak",
      ];
      await assert.rejects(
        createChangeRequest(appPool, memberSession, memberSession.tripId, {
          entityType: "expense",
          operation: "create",
          patch: {
            description: "Owner-excluded private expense",
            amountMinor: 800,
            currency: "JPY",
            payerMemberId: memberSession.memberId,
            itineraryItemId: privateEvent.entityId,
            splitMemberIds: [memberSession.memberId],
            occurredAt: "2030-04-02T12:10:00.000Z",
            status: "posted",
          },
          reason: privateExpenseApprovalReasons[0],
        }),
        (error) => error instanceof AppForbiddenError
          && /private event expense requires approval/i.test(error.message)
          && /share the event with the owner/i.test(error.message),
      );
      await assert.rejects(
        createChangeRequest(appPool, memberSession, memberSession.tripId, {
          entityType: "expense",
          entityId: directExpense.entityId,
          operation: "update",
          baseRevision: 1,
          patch: {
            payerMemberId: memberSession.memberId,
            splitMemberIds: [memberSession.memberId],
            itineraryItemId: privateEvent.entityId,
          },
          reason: privateExpenseApprovalReasons[1],
        }),
        (error) => error instanceof AppForbiddenError
          && /private event expense requires approval/i.test(error.message)
          && /share the event with the owner/i.test(error.message),
      );
      await assert.rejects(
        createChangeRequest(appPool, memberSession, memberSession.tripId, {
          entityType: "expense",
          entityId: privateExpense.id,
          operation: "update",
          baseRevision: privateExpense.currentRevision,
          patch: { description: "Approval-required hidden correction" },
          reason: privateExpenseApprovalReasons[2],
        }),
        (error) => error instanceof AppForbiddenError
          && /private event expense requires approval/i.test(error.message)
          && /share the event with the owner/i.test(error.message),
      );
      await updateMemberPermissions(appPool, ownerSession, ownerSession.tripId, memberSession.memberId, {
        canEditItinerary: true,
        itineraryRequiresApproval: false,
        canEditExpenses: true,
        expenseRequiresApproval: false,
        canSyncCalendar: true,
      });
      const preAudienceMigrationAiPrivateExpenseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "expense",
          operation: "create",
          patch: {
            description: "Owner-excluded AI private expense",
            amountMinor: 900,
            currency: "JPY",
            payerMemberId: memberSession.memberId,
            itineraryItemId: privateEvent.entityId,
            splitMemberIds: [memberSession.memberId],
            occurredAt: "2030-04-02T12:12:00.000Z",
            status: "posted",
          },
          reason: "AI private expense create must use temporary review visibility",
          source: "ai",
        },
      );
      assert.equal(preAudienceMigrationAiPrivateExpenseRequest.status, "pending");
      const preMigrationAiExpenseAudience = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS requester_can_view,
                app_member_can_view_change_request($1, $2, $5) AS unrelated_member_can_view`,
        [
          memberSession.tripId,
          preAudienceMigrationAiPrivateExpenseRequest.id,
          ownerSession.memberId,
          memberSession.memberId,
          otherMemberSession.memberId,
        ],
      );
      assert.deepEqual(preMigrationAiExpenseAudience.rows[0], {
        owner_can_view: false,
        requester_can_view: true,
        unrelated_member_can_view: false,
      });
      const rejectedBeforeInsertion = await appPool.query(
        `SELECT count(*)::integer AS request_count
           FROM change_requests
          WHERE trip_id = $1 AND reason = ANY($2::text[])`,
        [memberSession.tripId, privateExpenseApprovalReasons],
      );
      assert.equal(rejectedBeforeInsertion.rows[0].request_count, 0);

      const privateRelinkMarker = "PRIVATE_EXPENSE_RELINK_REGRESSION_SECRET";
      const rawPrivateRelink = await appPool.query(
        `INSERT INTO change_requests (
           trip_id, id, requested_by_member_id, source, entity_type, entity_id,
           operation, base_revision, proposed_patch, reason
         ) VALUES (
           $1, gen_random_uuid(), $2, 'member', 'expense', $3,
           'update', 1, $4::jsonb, $5
         )
         RETURNING id`,
        [
          memberSession.tripId,
          memberSession.memberId,
          directExpense.entityId,
          JSON.stringify({
            payerMemberId: memberSession.memberId,
            splitMemberIds: [memberSession.memberId],
            itineraryItemId: privateEvent.entityId,
            itineraryAudienceSnapshot: {
              itineraryItemId: privateEvent.entityId,
              createdByMemberId: memberSession.memberId,
              visibility: "private",
              viewerMemberIds: [],
            },
          }),
          privateRelinkMarker,
        ],
      );
      const rawPrivateRelinkId = rawPrivateRelink.rows[0].id;
      const privateRelinkVisibility = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS requester_can_view,
                app_member_can_view_change_request($1, $2, $5) AS unrelated_member_can_view`,
        [
          memberSession.tripId,
          rawPrivateRelinkId,
          ownerSession.memberId,
          memberSession.memberId,
          otherMemberSession.memberId,
        ],
      );
      assert.deepEqual(privateRelinkVisibility.rows[0], {
        owner_can_view: false,
        requester_can_view: true,
        unrelated_member_can_view: false,
      });
      const ownerPrivateRelinkSnapshot = JSON.stringify(await getAppOverview(appPool, ownerSession));
      assert.doesNotMatch(ownerPrivateRelinkSnapshot, new RegExp(privateRelinkMarker));
      assert.doesNotMatch(ownerPrivateRelinkSnapshot, new RegExp(rawPrivateRelinkId));
      await appPool.query(
        `UPDATE change_requests
            SET status = 'rejected', reviewed_by_member_id = $3,
                review_note = 'Synthetic privacy regression cleanup',
                reviewed_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, rawPrivateRelinkId, memberSession.memberId],
      );
      const rejectedPrivateRelinkVisibility = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS requester_can_view`,
        [memberSession.tripId, rawPrivateRelinkId, ownerSession.memberId, memberSession.memberId],
      );
      assert.deepEqual(rejectedPrivateRelinkVisibility.rows[0], {
        owner_can_view: false,
        requester_can_view: true,
      });
      await assert.rejects(
        createChangeRequest(appPool, memberSession, memberSession.tripId, {
          entityType: "expense",
          entityId: privateExpense.id,
          operation: "update",
          baseRevision: privateExpense.currentRevision,
          patch: { itineraryItemId: null },
          reason: "Private expense must not become trip-visible",
        }),
        (error) => error instanceof AppForbiddenError && /must stay linked/i.test(error.message),
      );

      await assert.rejects(
        createChangeRequest(appPool, memberSession, memberSession.tripId, {
          entityType: "expense",
          operation: "create",
          patch: {
            description: "Invalid private split",
            amountMinor: 1000,
            currency: "JPY",
            payerMemberId: memberSession.memberId,
            itineraryItemId: privateEvent.entityId,
            splitMemberIds: [memberSession.memberId, ownerSession.memberId],
            occurredAt: "2030-04-02T12:15:00.000Z",
            status: "posted",
          },
          reason: "This must be rejected",
        }),
        (error) => error instanceof AppForbiddenError && /private event expense/i.test(error.message),
      );
      await assert.rejects(
        createChangeRequest(appPool, ownerSession, ownerSession.tripId, {
          entityType: "itinerary_item",
          entityId: privateEvent.entityId,
          operation: "update",
          baseRevision: 1,
          patch: { notes: "Owner must not see this" },
          reason: "Private item access test",
        }),
        /plan item not found/i,
      );

      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(
            `INSERT INTO expenses (
               trip_id, id, payer_member_id, itinerary_item_id, description,
               amount_minor, currency, status, occurred_at
             ) VALUES ($1, '70000000-0000-4000-8000-000000000099', $2, $3,
                       'Database audience bypass', 1, 'JPY', 'draft', CURRENT_TIMESTAMP)`,
            [ownerSession.tripId, ownerSession.memberId, privateEvent.entityId],
          );
          await assert.rejects(
            client.query("COMMIT"),
            /private event expense member/i,
          );
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
        }
      });

      await updateMemberPermissions(appPool, ownerSession, ownerSession.tripId, memberSession.memberId, {
        canEditItinerary: true,
        itineraryRequiresApproval: true,
        canEditExpenses: true,
        expenseRequiresApproval: false,
        canSyncCalendar: true,
      });
      const approvalRequiredOwnerShareReason =
        "Approval-required private audience expansion uses temporary owner review";
      const preOwnerReviewMigrationPrivateUpdate = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: privateEvent.entityId,
          operation: "update",
          baseRevision: 1,
          patch: {
            visibility: "private",
            viewerMemberIds: [ownerSession.memberId],
          },
          reason: approvalRequiredOwnerShareReason,
        },
      );
      assert.equal(preOwnerReviewMigrationPrivateUpdate.status, "pending");
      assert.deepEqual((await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS requester_can_view`,
        [
          memberSession.tripId,
          preOwnerReviewMigrationPrivateUpdate.id,
          ownerSession.memberId,
          memberSession.memberId,
        ],
      )).rows[0], {
        owner_can_view: false,
        requester_can_view: true,
      });
      await updateMemberPermissions(appPool, ownerSession, ownerSession.tripId, memberSession.memberId, {
        canEditItinerary: true,
        itineraryRequiresApproval: false,
        canEditExpenses: true,
        expenseRequiresApproval: false,
        canSyncCalendar: true,
      });

      const privateNotesMarker = "PRIVATE_NOTES_SNAPSHOT_REGRESSION_SECRET";
      const privateNotesRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: privateEvent.entityId,
          operation: "update",
          baseRevision: 1,
          patch: { notes: privateNotesMarker },
          reason: "Private itinerary submit-time audience snapshot regression",
        },
      );
      const privateExpenseMarker = "PRIVATE_EXPENSE_SNAPSHOT_REGRESSION_SECRET";
      const privateExpenseNotesRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "expense",
          entityId: privateExpense.id,
          operation: "update",
          baseRevision: privateExpense.currentRevision,
          patch: { description: privateExpenseMarker },
          reason: "Private expense submit-time audience snapshot regression",
        },
      );
      const storedAudienceSnapshots = await appPool.query(
        `SELECT id,
                proposed_patch->>'visibility' AS visibility,
                proposed_patch->'viewerMemberIds' AS viewer_member_ids,
                proposed_patch->>'itineraryItemId' AS itinerary_item_id,
                proposed_patch->'itineraryAudienceSnapshot'->>'visibility'
                  AS expense_visibility,
                proposed_patch->'itineraryAudienceSnapshot'->'viewerMemberIds'
                  AS expense_viewer_member_ids
           FROM change_requests
          WHERE trip_id = $1 AND id = ANY($2::uuid[])
          ORDER BY id`,
        [memberSession.tripId, [privateNotesRequest.id, privateExpenseNotesRequest.id]],
      );
      const storedPrivateNotes = storedAudienceSnapshots.rows.find(
        (request) => request.id === privateNotesRequest.id,
      );
      const storedPrivateExpense = storedAudienceSnapshots.rows.find(
        (request) => request.id === privateExpenseNotesRequest.id,
      );
      assert.deepEqual(storedPrivateNotes, {
        id: privateNotesRequest.id,
        visibility: "private",
        viewer_member_ids: [],
        itinerary_item_id: null,
        expense_visibility: null,
        expense_viewer_member_ids: null,
      });
      assert.deepEqual(storedPrivateExpense, {
        id: privateExpenseNotesRequest.id,
        visibility: null,
        viewer_member_ids: null,
        itinerary_item_id: privateEvent.entityId,
        expense_visibility: "private",
        expense_viewer_member_ids: [],
      });
      const publishPrivateEventRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: privateEvent.entityId,
          operation: "update",
          baseRevision: 1,
          patch: { visibility: "trip" },
          reason: "Publish the private event after private requests were submitted",
        },
      );
      const publishedPrivateEvent = await applyPermittedChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        publishPrivateEventRequest.id,
      );
      assert.equal(publishedPrivateEvent.revision, 2);
      const visibilityAfterPublishing = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $4) AS owner_can_view_item,
                app_member_can_view_change_request($1, $3, $4) AS owner_can_view_expense,
                app_member_can_view_change_request($1, $2, $5) AS creator_can_view_item,
                app_member_can_view_change_request($1, $3, $5) AS creator_can_view_expense`,
        [
          memberSession.tripId,
          privateNotesRequest.id,
          privateExpenseNotesRequest.id,
          ownerSession.memberId,
          memberSession.memberId,
        ],
      );
      assert.deepEqual(visibilityAfterPublishing.rows[0], {
        owner_can_view_item: false,
        owner_can_view_expense: false,
        creator_can_view_item: true,
        creator_can_view_expense: true,
      });
      const ownerPublishedPrivateSnapshot = JSON.stringify(await getAppOverview(appPool, ownerSession));
      assert.doesNotMatch(ownerPublishedPrivateSnapshot, new RegExp(privateNotesMarker));
      assert.doesNotMatch(ownerPublishedPrivateSnapshot, new RegExp(privateExpenseMarker));
      assert.doesNotMatch(ownerPublishedPrivateSnapshot, new RegExp(privateNotesRequest.id));
      assert.doesNotMatch(ownerPublishedPrivateSnapshot, new RegExp(privateExpenseNotesRequest.id));
      await appPool.query(
        `UPDATE change_requests
            SET status = 'rejected', reviewed_by_member_id = $3,
                review_note = 'Synthetic submit-time snapshot regression cleanup',
                reviewed_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = ANY($2::uuid[])`,
        [
          memberSession.tripId,
          [privateNotesRequest.id, privateExpenseNotesRequest.id],
          memberSession.memberId,
        ],
      );
      const rejectedVisibilityAfterPublishing = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $4) AS owner_can_view_item,
                app_member_can_view_change_request($1, $3, $4) AS owner_can_view_expense`,
        [
          memberSession.tripId,
          privateNotesRequest.id,
          privateExpenseNotesRequest.id,
          ownerSession.memberId,
        ],
      );
      assert.deepEqual(rejectedVisibilityAfterPublishing.rows[0], {
        owner_can_view_item: false,
        owner_can_view_expense: false,
      });

      const sharePrivateRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: privateEvent.entityId,
          operation: "update",
          baseRevision: 2,
          patch: {
            visibility: "private",
            viewerMemberIds: [ownerSession.memberId],
          },
          reason: "Share the private event with the selected owner",
        },
      );
      await applyPermittedChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        sharePrivateRequest.id,
      );
      const sharedOwnerOverview = await getAppOverview(appPool, ownerSession);
      assert.ok(sharedOwnerOverview.itinerary.some((item) => item.id === privateEvent.entityId));
      assert.ok(sharedOwnerOverview.expenses.some((expense) => expense.itineraryItemId === privateEvent.entityId));
      assert.ok((await readAllApprovalHistory(appPool, ownerSession)).every(
        (request) => !Object.hasOwn(request.patch, "itineraryAudienceSnapshot"),
      ));

      await updateMemberPermissions(appPool, ownerSession, ownerSession.tripId, memberSession.memberId, {
        canEditItinerary: true,
        itineraryRequiresApproval: true,
        canEditExpenses: true,
        expenseRequiresApproval: false,
        canSyncCalendar: true,
      });
      const permissionAudit = await withClient((client) => client.query(
        `SELECT after_state->>'itineraryRequiresApproval' AS approval
           FROM audit_events
          WHERE trip_id = $1 AND entity_type = 'member_permissions'
            AND entity_id = $2 AND action = 'updated'
          ORDER BY created_at DESC LIMIT 1`,
        [ownerSession.tripId, memberSession.memberId],
      ));
      assert.equal(permissionAudit.rows[0]?.approval, "true");

      const reviewRaceMarker = "OWNER_REVIEW_AUDIENCE_RACE_MUST_NOT_APPLY";
      const reviewRaceRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: privateEvent.entityId,
          operation: "update",
          baseRevision: 3,
          patch: { notes: reviewRaceMarker },
          reason: "Review-time audience removal race regression",
        },
      );
      const raceApplicationName = `stardust-review-race-${Date.now()}`;
      const raceReviewPool = new Pool({
        connectionString,
        max: 1,
        application_name: raceApplicationName,
      });
      const audienceRemovalClient = await appPool.connect();
      let audienceRemovalOpen = false;
      try {
        await audienceRemovalClient.query("BEGIN");
        audienceRemovalOpen = true;
        await audienceRemovalClient.query(
          `SELECT 1
             FROM itinerary_items
            WHERE trip_id = $1 AND id = $2
            FOR UPDATE`,
          [memberSession.tripId, privateEvent.entityId],
        );
        await audienceRemovalClient.query(
          `DELETE FROM itinerary_item_viewers
            WHERE trip_id = $1 AND itinerary_item_id = $2 AND member_id = $3`,
          [memberSession.tripId, privateEvent.entityId, ownerSession.memberId],
        );

        const reviewOutcomePromise = reviewChangeRequest(
          raceReviewPool,
          ownerSession,
          ownerSession.tripId,
          reviewRaceRequest.id,
          "approve",
          "This approval must lose the audience race",
        ).then(
          (value) => ({ status: "fulfilled", value }),
          (reason) => ({ status: "rejected", reason }),
        );

        let reviewBlockedOnAudienceLock = false;
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const activity = await appPool.query(
            `SELECT wait_event_type
               FROM pg_stat_activity
              WHERE application_name = $1`,
            [raceApplicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            reviewBlockedOnAudienceLock = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(
          reviewBlockedOnAudienceLock,
          true,
          "owner review must lock the request and wait for the canonical audience row",
        );

        await audienceRemovalClient.query("COMMIT");
        audienceRemovalOpen = false;
        const reviewOutcome = await reviewOutcomePromise;
        assert.equal(reviewOutcome.status, "rejected");
        assert.ok(
          reviewOutcome.reason instanceof AppNotFoundError
            && /change request not found/i.test(reviewOutcome.reason.message),
        );
      } finally {
        if (audienceRemovalOpen) {
          await audienceRemovalClient.query("ROLLBACK").catch(() => undefined);
        }
        audienceRemovalClient.release();
        await raceReviewPool.end();
      }

      const reviewRaceState = await appPool.query(
        `SELECT cr.status, cr.applied_revision,
                i.current_revision, i.notes,
                count(ir.revision)::integer AS revision_count,
                app_member_can_view_change_request(cr.trip_id, cr.id, $3) AS owner_can_view
           FROM change_requests cr
           JOIN itinerary_items i
             ON i.trip_id = cr.trip_id AND i.id = cr.entity_id
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.trip_id, cr.id, cr.status, cr.applied_revision,
                   i.current_revision, i.notes`,
        [memberSession.tripId, reviewRaceRequest.id, ownerSession.memberId],
      );
      assert.deepEqual(reviewRaceState.rows[0], {
        status: "pending",
        applied_revision: null,
        current_revision: 3,
        notes: null,
        revision_count: 3,
        owner_can_view: false,
      });
      const audienceRestoreClient = await appPool.connect();
      try {
        await audienceRestoreClient.query("BEGIN");
        await audienceRestoreClient.query(
          `SELECT 1
             FROM itinerary_items
            WHERE trip_id = $1 AND id = $2
            FOR UPDATE`,
          [memberSession.tripId, privateEvent.entityId],
        );
        await audienceRestoreClient.query(
          `INSERT INTO itinerary_item_viewers (
             trip_id, itinerary_item_id, member_id, added_by_member_id
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            memberSession.tripId,
            privateEvent.entityId,
            ownerSession.memberId,
            memberSession.memberId,
          ],
        );
        await audienceRestoreClient.query("COMMIT");
      } catch (error) {
        await audienceRestoreClient.query("ROLLBACK");
        throw error;
      } finally {
        audienceRestoreClient.release();
      }
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        reviewRaceRequest.id,
        "reject",
        "Review-time audience race regression cleanup",
      );

      const approvalRequired = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: "40000000-0000-4000-8000-000000000001",
          operation: "update",
          baseRevision: 3,
          patch: { notes: "Wait for owner review" },
          reason: "Approval policy test",
        },
      );
      await assert.rejects(
        applyPermittedChangeRequest(appPool, memberSession, memberSession.tripId, approvalRequired.id),
        (error) => error instanceof AppForbiddenError && /approval is required/i.test(error.message),
      );
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        approvalRequired.id,
        "reject",
        "Rejected before a concurrent owner edit",
      );
      const concurrentOwnerEditRequest = await createChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: "40000000-0000-4000-8000-000000000001",
          operation: "update",
          baseRevision: 3,
          patch: { notes: "Owner committed a newer note" },
          reason: "Advance the canonical revision before reconsidering a rejection",
        },
      );
      const concurrentOwnerEdit = await applyPermittedChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        concurrentOwnerEditRequest.id,
      );
      assert.equal(concurrentOwnerEdit.revision, 4);
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          approvalRequired.id,
          "approve",
          "Try to reconsider the now-stale rejection",
        ),
        (error) => error instanceof AppConflictError && /stale/i.test(error.message),
      );
      const staleRejectedState = await appPool.query(
        `SELECT cr.status, cr.applied_revision, cr.review_note,
                i.current_revision, i.notes,
                count(ir.revision)::integer AS revision_count
           FROM change_requests cr
           JOIN itinerary_items i
             ON i.trip_id = cr.trip_id AND i.id = cr.entity_id
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.applied_revision, cr.review_note,
                   i.current_revision, i.notes`,
        [ownerSession.tripId, approvalRequired.id],
      );
      assert.deepEqual(staleRejectedState.rows[0], {
        status: "rejected",
        applied_revision: null,
        review_note: "Rejected before a concurrent owner edit",
        current_revision: 4,
        notes: "Owner committed a newer note",
        revision_count: 4,
      });

      const firstOwnerConversation = await prepareConversation(appPool, ownerSession);
      assert.deepEqual(firstOwnerConversation.turns, []);
      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id, id, actor_member_id, actor_user_id, actor_role, feature,
           prompt_text, result_text, requested_model, effective_model,
           provider, transport, authentication_mode, billing_basis, status,
           input_tokens, output_tokens, cached_input_tokens, completed_at
         ) VALUES (
           $1, '91000000-0000-4000-8000-000000000004', $2, $3, 'owner', 'off_topic',
           'Write unrelated source code', 'Localized deterministic roast',
           'gpt-6.1-sol', 'gpt-6.1-sol', 'local', 'deterministic_gate', 'none', 'none',
           'succeeded', 0, 0, 0, CURRENT_TIMESTAMP
         )`,
        [ownerSession.tripId, ownerSession.memberId, ownerSession.userId],
      );
      const offTopicAudit = await appPool.query(
        `SELECT actor_user_id, conversation_id, feature, status, provider, transport,
                authentication_mode, billing_basis,
                requested_model, effective_model,
                input_tokens, output_tokens, cached_input_tokens
           FROM ai_requests
          WHERE trip_id = $1 AND id = '91000000-0000-4000-8000-000000000004'`,
        [ownerSession.tripId],
      );
      assert.deepEqual(offTopicAudit.rows[0], {
        actor_user_id: ownerSession.userId,
        conversation_id: null,
        feature: "off_topic",
        status: "succeeded",
        provider: "local",
        transport: "deterministic_gate",
        authentication_mode: "none",
        billing_basis: "none",
        requested_model: "gpt-6.1-sol",
        effective_model: "gpt-6.1-sol",
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
      });

      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id, id, actor_member_id, actor_user_id, conversation_id,
           actor_role, prompt_text, requested_model, status
         ) VALUES (
           $1, '91000000-0000-4000-8000-000000000007', $2, $3, $4,
           'owner', 'Synthetic request holding the active conversation',
           'gpt-6.1-sol', 'started'
         )`,
        [ownerSession.tripId, ownerSession.memberId, ownerSession.userId, firstOwnerConversation.conversationId],
      );
      const usageBeforeBusyRejection = (await getAiPolicy(appPool, ownerSession)).usedToday;
      const busyPrompt = "Move dinner to 20:30 while another request is running";
      await assert.rejects(
        runAiPlanner(appPool, ownerSession, busyPrompt, "gpt-6.1-sol", "en"),
        (error) => error instanceof AppConflictError
          && /another AI request is already being processed/i.test(error.message),
      );
      const busyRejectionAudit = await appPool.query(
        `SELECT ar.actor_user_id, ar.conversation_id, ar.feature, ar.status,
                ar.provider, ar.transport, ar.authentication_mode, ar.billing_basis,
                ar.requested_model, ar.effective_model, ar.result_text,
                ar.input_tokens, ar.output_tokens, ar.cached_input_tokens,
                ar.error_code, ar.error_message,
                array_agg(ae.event_type ORDER BY ae.sequence) AS lifecycle
           FROM ai_requests ar
           JOIN ai_request_events ae
             ON ae.trip_id = ar.trip_id AND ae.ai_request_id = ar.id
          WHERE ar.trip_id = $1 AND ar.actor_member_id = $2
            AND ar.prompt_text = $3
          GROUP BY ar.trip_id, ar.id`,
        [ownerSession.tripId, ownerSession.memberId, busyPrompt],
      );
      assert.deepEqual(busyRejectionAudit.rows[0], {
        actor_user_id: ownerSession.userId,
        conversation_id: null,
        feature: "policy_denial",
        status: "rejected",
        provider: "local",
        transport: "policy_gate",
        authentication_mode: "none",
        billing_basis: "none",
        requested_model: "gpt-6.1-sol",
        effective_model: null,
        result_text: "Another AI request is already being processed for this conversation.",
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        error_code: "conversation_busy",
        error_message: "Another AI request is already being processed for this conversation.",
        lifecycle: ["request.started", "request.rejected", "request.completed"],
      });
      assert.equal((await getAiPolicy(appPool, ownerSession)).usedToday, usageBeforeBusyRejection);
      await appPool.query(
        `UPDATE ai_requests
            SET status = 'failed', completed_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = '91000000-0000-4000-8000-000000000007'`,
        [ownerSession.tripId],
      );
      assert.deepEqual((await prepareConversation(appPool, ownerSession)).turns, []);

      await assert.rejects(
        appPool.query(
          `INSERT INTO ai_requests (
             trip_id, id, actor_member_id, actor_user_id, actor_role, feature,
             prompt_text, requested_model
           ) VALUES (
             $1, '91000000-0000-4000-8000-000000000006', $2,
             '00000000-0000-4000-8000-000000000099', 'owner', 'off_topic',
             'Invalid actor identity', 'gpt-6.1-sol'
           )`,
          [ownerSession.tripId, ownerSession.memberId],
        ),
        /ai_requests_actor_user_fk/,
      );
      await assert.rejects(
        appPool.query(
          `INSERT INTO ai_requests (
             trip_id, id, actor_member_id, conversation_id, actor_role,
             prompt_text, requested_model
           ) VALUES (
             $1, '91000000-0000-4000-8000-000000000005', $2, $3, 'owner',
             'Missing exact actor identity', 'gpt-6.1-sol'
           )`,
          [ownerSession.tripId, ownerSession.memberId, firstOwnerConversation.conversationId],
        ),
        /ai_requests_conversation_identity_ck/,
      );
      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id, id, actor_member_id, actor_user_id, conversation_id,
           actor_role, prompt_text, result_text, requested_model, status, completed_at
         ) VALUES
           ($1, '91000000-0000-4000-8000-000000000001', $2, $3, $4,
            'owner', 'First memory prompt', 'First memory response',
            'gpt-6.1-sol', 'succeeded', CURRENT_TIMESTAMP),
           ($1, '91000000-0000-4000-8000-000000000002', $2, $3, $4,
            'owner', 'Second memory prompt', 'Second memory response',
            'gpt-6.1-sol', 'succeeded', CURRENT_TIMESTAMP)`,
        [ownerSession.tripId, ownerSession.memberId, ownerSession.userId, firstOwnerConversation.conversationId],
      );
      const rememberedOwnerConversation = await prepareConversation(appPool, ownerSession);
      assert.equal(rememberedOwnerConversation.conversationId, firstOwnerConversation.conversationId);
      assert.deepEqual(
        rememberedOwnerConversation.turns.map(({ user, assistant }) => ({ user, assistant })),
        [
          { user: "First memory prompt", assistant: "First memory response" },
          { user: "Second memory prompt", assistant: "Second memory response" },
        ],
      );
      assert.ok(rememberedOwnerConversation.tokenEstimate > 0);
      assert.ok(rememberedOwnerConversation.tokenEstimate <= 6000);
      const checkpoint = await createConversationCheckpoint(appPool, ownerSession, {
        conversationId: firstOwnerConversation.conversationId,
        through: rememberedOwnerConversation.checkpointThrough,
        summaryText: "The owner is comparing Tokyo food and anime-focused activities.",
        goals: ["Plan a Tokyo trip around food and anime interests"],
        decisions: ["Keep itinerary changes subject to owner approval"],
        openQuestions: ["Which anime franchises should drive the store search?"],
      });
      assert.deepEqual(checkpoint && { version: checkpoint.version }, { version: 1 });
      const checkpointedOwnerConversation = await prepareConversation(appPool, ownerSession);
      assert.equal(checkpointedOwnerConversation.checkpoint?.id, checkpoint.id);
      assert.equal(checkpointedOwnerConversation.checkpoint?.version, 1);
      assert.deepEqual(checkpointedOwnerConversation.turns, []);

      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id, id, actor_member_id, actor_user_id, conversation_id,
           actor_role, prompt_text, result_text, requested_model, effective_model,
           provider, transport, authentication_mode, billing_basis, status, completed_at
         ) VALUES (
           $1, '91000000-0000-4000-8000-000000000008', $2, $3, $4,
           'owner', 'Continue with the same preferences', 'I will keep the same planning goal.',
           'claude-haiku-5-5', 'claude-haiku-5-5', 'anthropic', 'claude_agent_sdk',
           'claude_subscription', 'subscription', 'succeeded', CURRENT_TIMESTAMP
         )`,
        [ownerSession.tripId, ownerSession.memberId, ownerSession.userId, firstOwnerConversation.conversationId],
      );
      const providerSwitchedConversation = await prepareConversation(appPool, ownerSession);
      assert.equal(providerSwitchedConversation.checkpoint?.version, 1);
      assert.deepEqual(
        providerSwitchedConversation.turns.map(({ user, assistant }) => ({ user, assistant })),
        [{
          user: "Continue with the same preferences",
          assistant: "I will keep the same planning goal.",
        }],
      );

      await appPool.query(
        `INSERT INTO itinerary_items (
           trip_id, id, trip_day_id, created_by_member_id, title, item_type,
           starts_at, ends_at, location_name, map_url
         ) VALUES (
           $1, '4f000000-0000-4000-8000-000000000001',
           '30000000-0000-4000-8000-000000000002', $2,
           'Legacy station transfer', 'transport',
           '2030-04-02T01:00:00Z', '2030-04-02T02:00:00Z',
           'Legacy destination station',
           'https://www.google.com/maps/search/?api=1&query=Legacy+destination+station'
         )`,
        [ownerSession.tripId, ownerSession.memberId],
      );
      await appPool.query(
        `INSERT INTO itinerary_items (
           trip_id, id, trip_day_id, created_by_member_id, title, item_type,
           starts_at, ends_at, location_name, map_url
         ) VALUES (
           $1, '4f000000-0000-4000-8000-000000000004',
           '30000000-0000-4000-8000-000000000002', $2,
           'Legacy arrow transfer', 'transport',
           '2030-04-02T04:00:00Z', '2030-04-02T05:00:00Z',
           'Origin Station → Destination Station',
           'https://www.google.com/maps/search/?api=1&query=Origin+Station+Destination+Station'
         )`,
        [ownerSession.tripId, ownerSession.memberId],
      );
      assert.deepEqual(await migrate({
        connectionString,
        through: "0024_disruption_event_cadence.sql",
      }), [
        "0016_preference_catalog_import_integrity.sql",
        "0017_preference_catalog_import_hardening.sql",
        "0018_transport_endpoints.sql",
        "0019_split_legacy_transport_routes.sql",
        "0020_live_trip_context.sql",
        "0021_disruption_current_integrity.sql",
        "0022_weather_refresh_leases.sql",
        "0023_weather_refresh_member_leases.sql",
        "0024_disruption_event_cadence.sql",
      ]);
      await appPool.query(
        `INSERT INTO event_weather_forecasts (
           trip_id, itinerary_item_id, item_revision, forecast_at, location_key,
           location_label, location_precision, latitude, longitude, provider,
           weather_code, condition_key, icon_key, is_day,
           temperature_celsius, apparent_temperature_celsius,
           precipitation_probability_percent, sampled_at, fetched_at, stale_after
         ) VALUES (
           $1,'4f000000-0000-4000-8000-000000000001',1,
           CURRENT_TIMESTAMP + interval '1 hour','synthetic-location-key',
           'Synthetic destination','trip_destination',35.68,139.76,'open-meteo',
           61,'rain','rain',true,20.5,19.5,70,
           CURRENT_TIMESTAMP + interval '1 hour',CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP + interval '30 minutes'
         )`,
        [ownerSession.tripId],
      );
      await appPool.query(
        `UPDATE member_permissions
            SET can_edit_itinerary = false,
                itinerary_requires_approval = false
          WHERE trip_id = $1 AND member_id = $2`,
        [memberSession.tripId, memberSession.memberId],
      );
      assert.deepEqual(await migrate({
        connectionString,
        through: "0031_private_itinerary_owner_review.sql",
      }), [
        "0025_transport_weather_targets.sql",
        "0026_pending_change_request_editing.sql",
        "0027_pending_itinerary_visibility.sql",
        "0028_last_selected_trip.sql",
        "0029_pending_expense_audience.sql",
        "0030_editor_approval_defaults.sql",
        "0031_private_itinerary_owner_review.sql",
      ]);
      assert.deepEqual(await migrate({
        connectionString,
        through: "0031_private_itinerary_owner_review.sql",
      }), []);

      const migratedEditorDefaults = await appPool.query(
        `SELECT can_edit_itinerary, itinerary_requires_approval
           FROM member_permissions
          WHERE trip_id = $1 AND member_id = $2`,
        [memberSession.tripId, memberSession.memberId],
      );
      assert.deepEqual(migratedEditorDefaults.rows[0], {
        can_edit_itinerary: false,
        itinerary_requires_approval: true,
      });
      await appPool.query(
        `UPDATE member_permissions
            SET can_edit_itinerary = true
          WHERE trip_id = $1 AND member_id = $2`,
        [memberSession.tripId, memberSession.memberId],
      );

      assert.equal((await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view`,
        [
          memberSession.tripId,
          preOwnerReviewMigrationPrivateUpdate.id,
          ownerSession.memberId,
        ],
      )).rows[0].owner_can_view, true);
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        preOwnerReviewMigrationPrivateUpdate.id,
        "reject",
        "Temporary owner-review migration regression cleanup",
      );

      const uninvolvedEditorSession = {
        ...memberSession,
        sessionId: "uninvolved-editor-test-session",
        memberId: "20000000-0000-4000-8000-000000000006",
        userId: "00000000-0000-4000-8000-000000000006",
        role: "editor",
        displayName: "Uninvolved editor",
        subject: "uninvolved-editor-subject",
      };
      await appPool.query(
        `INSERT INTO app_users (id, display_name)
         VALUES ($1, $2)`,
        [
          uninvolvedEditorSession.userId,
          uninvolvedEditorSession.displayName,
        ],
      );
      await appPool.query(
        `INSERT INTO trip_members (
           trip_id, id, user_id, display_name, role, status
         ) VALUES ($1, $2, $3, $4, 'editor', 'active')`,
        [
          uninvolvedEditorSession.tripId,
          uninvolvedEditorSession.memberId,
          uninvolvedEditorSession.userId,
          uninvolvedEditorSession.displayName,
        ],
      );

      const privateEditorBaseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Private selected-editor dinner",
            itemType: "meal",
            startsAt: "2030-04-02T14:00:00.000Z",
            endsAt: "2030-04-02T15:00:00.000Z",
            notes: "Canonical private detail",
            visibility: "private",
            viewerMemberIds: [otherMemberSession.memberId],
          },
          reason: "Create an approved private event for selected-editor review coverage",
        },
      );
      assert.equal(privateEditorBaseRequest.status, "pending");
      const privateCreateReviewAudience = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view_request,
                app_member_can_view_change_request($1, $2, $4) AS selected_editor_can_view_request,
                app_member_can_view_change_request($1, $2, $5) AS uninvolved_editor_can_view_request`,
        [
          memberSession.tripId,
          privateEditorBaseRequest.id,
          ownerSession.memberId,
          otherMemberSession.memberId,
          uninvolvedEditorSession.memberId,
        ],
      );
      assert.deepEqual(privateCreateReviewAudience.rows[0], {
        owner_can_view_request: true,
        selected_editor_can_view_request: true,
        uninvolved_editor_can_view_request: false,
      });
      const privateEditorBase = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        privateEditorBaseRequest.id,
        "approve",
        "Approve creator-only private base event",
      );
      assert.equal(privateEditorBase.status, "approved");
      assert.ok(privateEditorBase.entityId);
      assert.equal(privateEditorBase.revision, 1);
      const ownerPrivateCreateHistory = (await readAllApprovalHistory(
        appPool,
        ownerSession,
      )).find((request) => request.id === privateEditorBaseRequest.id);
      assert.equal(ownerPrivateCreateHistory?.status, "approved");

      const selectedEditorPrivateUpdate = await createChangeRequest(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: privateEditorBase.entityId,
          operation: "update",
          baseRevision: privateEditorBase.revision,
          patch: { title: "Private dinner edited by selected editor" },
          reason: "Selected editor change requires owner review",
        },
      );
      assert.equal(selectedEditorPrivateUpdate.status, "pending");
      const privateUpdateAudience = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view_request,
                app_member_can_view_change_request($1, $2, $4) AS creator_can_view_request,
                app_member_can_view_change_request($1, $2, $5) AS selected_editor_can_view_request,
                app_member_can_view_change_request($1, $2, $6) AS uninvolved_editor_can_view_request,
                app_member_can_view_itinerary_item($1, $7, $3) AS owner_can_view_canonical,
                app_member_can_view_itinerary_item($1, $7, $5) AS selected_editor_can_view_canonical,
                app_member_can_view_itinerary_item($1, $7, $6) AS uninvolved_editor_can_view_canonical`,
        [
          memberSession.tripId,
          selectedEditorPrivateUpdate.id,
          ownerSession.memberId,
          memberSession.memberId,
          otherMemberSession.memberId,
          uninvolvedEditorSession.memberId,
          privateEditorBase.entityId,
        ],
      );
      assert.deepEqual(privateUpdateAudience.rows[0], {
        owner_can_view_request: true,
        creator_can_view_request: true,
        selected_editor_can_view_request: true,
        uninvolved_editor_can_view_request: false,
        owner_can_view_canonical: false,
        selected_editor_can_view_canonical: true,
        uninvolved_editor_can_view_canonical: false,
      });
      const selectedEditorPrivateDetail = await getPendingItineraryRequestForEdit(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        selectedEditorPrivateUpdate.id,
      );
      const selectedEditorRevisedPrivateUpdate = await updatePendingItineraryRequest(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        selectedEditorPrivateUpdate.id,
        {
          proposalRevision: selectedEditorPrivateDetail.proposalRevision,
          patch: { notes: "Selected editor corrected the private event before review" },
        },
      );
      assert.equal(selectedEditorRevisedPrivateUpdate.status, "pending");
      assert.equal(selectedEditorRevisedPrivateUpdate.createdByMemberId, memberSession.memberId);
      assert.deepEqual(
        selectedEditorRevisedPrivateUpdate.patch.viewerMemberIds,
        [otherMemberSession.memberId],
      );
      await assert.rejects(
        getPendingItineraryRequestForEdit(
          appPool,
          uninvolvedEditorSession,
          uninvolvedEditorSession.tripId,
          selectedEditorPrivateUpdate.id,
        ),
        (error) => error instanceof AppNotFoundError
          && /pending event request not found/i.test(error.message),
      );
      const ownerPendingPrivateHistory = (await readAllApprovalHistory(
        appPool,
        ownerSession,
      )).find((request) => request.id === selectedEditorPrivateUpdate.id);
      assert.equal(ownerPendingPrivateHistory?.status, "pending");

      const rejectedSelectedEditorPrivateUpdate = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        selectedEditorPrivateUpdate.id,
        "reject",
        "Reject once to verify private approval history",
      );
      assert.equal(rejectedSelectedEditorPrivateUpdate.status, "rejected");
      const privateRejectedHistoryAudience = await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view_history,
                app_member_can_view_change_request($1, $2, $4) AS uninvolved_editor_can_view_history`,
        [
          memberSession.tripId,
          selectedEditorPrivateUpdate.id,
          ownerSession.memberId,
          uninvolvedEditorSession.memberId,
        ],
      );
      assert.deepEqual(privateRejectedHistoryAudience.rows[0], {
        owner_can_view_history: true,
        uninvolved_editor_can_view_history: false,
      });
      const ownerRejectedPrivateHistory = (await readAllApprovalHistory(
        appPool,
        ownerSession,
      )).find((request) => request.id === selectedEditorPrivateUpdate.id);
      assert.equal(ownerRejectedPrivateHistory?.status, "rejected");

      const approvedSelectedEditorPrivateUpdate = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        selectedEditorPrivateUpdate.id,
        "approve",
        "Approved selected-editor private update",
      );
      assert.equal(approvedSelectedEditorPrivateUpdate.status, "approved");
      assert.equal(approvedSelectedEditorPrivateUpdate.entityId, privateEditorBase.entityId);
      assert.equal(approvedSelectedEditorPrivateUpdate.revision, privateEditorBase.revision + 1);
      const privateUpdateAfterApproval = await appPool.query(
        `SELECT i.title, i.notes, i.visibility, i.created_by_member_id,
                i.current_revision,
                app_member_can_view_itinerary_item(i.trip_id, i.id, $3) AS owner_can_view_canonical,
                app_member_can_view_itinerary_item(i.trip_id, i.id, $4) AS selected_editor_can_view_canonical,
                app_member_can_view_itinerary_item(i.trip_id, i.id, $5) AS uninvolved_editor_can_view_canonical,
                app_member_can_view_change_request(i.trip_id, $2, $3) AS owner_can_view_history,
                app_member_can_view_change_request(i.trip_id, $2, $5) AS uninvolved_editor_can_view_history,
                COALESCE(ARRAY(
                  SELECT viewer.member_id
                    FROM itinerary_item_viewers viewer
                   WHERE viewer.trip_id = i.trip_id
                     AND viewer.itinerary_item_id = i.id
                   ORDER BY viewer.member_id
                ), ARRAY[]::uuid[]) AS viewer_member_ids
           FROM itinerary_items i
          WHERE i.trip_id = $1 AND i.id = $6`,
        [
          memberSession.tripId,
          selectedEditorPrivateUpdate.id,
          ownerSession.memberId,
          otherMemberSession.memberId,
          uninvolvedEditorSession.memberId,
          privateEditorBase.entityId,
        ],
      );
      assert.deepEqual(privateUpdateAfterApproval.rows[0], {
        title: "Private dinner edited by selected editor",
        notes: "Selected editor corrected the private event before review",
        visibility: "private",
        created_by_member_id: memberSession.memberId,
        current_revision: 2,
        owner_can_view_canonical: false,
        selected_editor_can_view_canonical: true,
        uninvolved_editor_can_view_canonical: false,
        owner_can_view_history: true,
        uninvolved_editor_can_view_history: false,
        viewer_member_ids: [otherMemberSession.memberId],
      });
      const ownerApprovedPrivateHistory = (await readAllApprovalHistory(
        appPool,
        ownerSession,
      )).find((request) => request.id === selectedEditorPrivateUpdate.id);
      assert.equal(ownerApprovedPrivateHistory?.status, "approved");
      assert.equal(
        ownerApprovedPrivateHistory?.reviewNote,
        "Approved selected-editor private update",
      );

      await updateMemberPermissions(
        appPool,
        ownerSession,
        ownerSession.tripId,
        otherMemberSession.memberId,
        {
          canEditItinerary: true,
          itineraryRequiresApproval: false,
          canEditExpenses: true,
          expenseRequiresApproval: false,
          canSyncCalendar: true,
        },
      );
      const privateCancellationWithoutReview = await createChangeRequest(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: privateEditorBase.entityId,
          operation: "cancel",
          baseRevision: approvedSelectedEditorPrivateUpdate.revision,
          patch: {},
          reason: "Private cancellation without an approval policy remains audience-bound",
        },
      );
      assert.deepEqual((await appPool.query(
        `SELECT app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
                app_member_can_view_change_request($1, $2, $4) AS requester_can_view`,
        [
          memberSession.tripId,
          privateCancellationWithoutReview.id,
          ownerSession.memberId,
          otherMemberSession.memberId,
        ],
      )).rows[0], {
        owner_can_view: false,
        requester_can_view: true,
      });
      assert.equal((await getAppOverview(appPool, ownerSession)).pendingItinerary.some(
        (item) => item.requestId === privateCancellationWithoutReview.id,
      ), false);
      assert.equal((await getAppOverview(appPool, otherMemberSession)).pendingItinerary.some(
        (item) => item.requestId === privateCancellationWithoutReview.id
          && item.operation === "cancel",
      ), true);
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          privateCancellationWithoutReview.id,
          "reject",
          "An owner outside the private audience must not review this cancellation",
        ),
        (error) => error instanceof AppNotFoundError,
      );
      const privatelyAppliedCancellation = await applyPermittedChangeRequest(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        privateCancellationWithoutReview.id,
      );
      assert.equal(privatelyAppliedCancellation.status, "approved");
      assert.equal(privatelyAppliedCancellation.revision, approvedSelectedEditorPrivateUpdate.revision + 1);
      await updateMemberPermissions(
        appPool,
        ownerSession,
        ownerSession.tripId,
        otherMemberSession.memberId,
        {
          canEditItinerary: true,
          itineraryRequiresApproval: true,
          canEditExpenses: true,
          expenseRequiresApproval: false,
          canSyncCalendar: true,
        },
      );

      await updateMemberPermissions(
        appPool,
        ownerSession,
        ownerSession.tripId,
        memberSession.memberId,
        {
          canEditItinerary: true,
          itineraryRequiresApproval: false,
          canEditExpenses: true,
          expenseRequiresApproval: false,
          canSyncCalendar: true,
        },
      );
      const collaborativeDirectApplyRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000003",
            title: "Requester-owned collaborative draft",
            itemType: "activity",
            startsAt: "2030-04-03T09:00:00.000Z",
            endsAt: "2030-04-03T10:00:00.000Z",
            visibility: "trip",
            viewerMemberIds: [],
          },
          reason: "Cross-editor direct-apply policy coverage",
        },
      );
      const collaborativeEditorDetail = await getPendingItineraryRequestForEdit(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        collaborativeDirectApplyRequest.id,
      );
      const collaborativeEditorUpdate = await updatePendingItineraryRequest(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        collaborativeDirectApplyRequest.id,
        {
          proposalRevision: collaborativeEditorDetail.proposalRevision,
          patch: { notes: "Another editor added this detail" },
        },
      );
      const collaborativeOwnerDetail = await getPendingItineraryRequestForEdit(
        appPool,
        ownerSession,
        ownerSession.tripId,
        collaborativeDirectApplyRequest.id,
      );
      const collaborativeOwnerUpdate = await updatePendingItineraryRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        collaborativeDirectApplyRequest.id,
        {
          proposalRevision: collaborativeOwnerDetail.proposalRevision,
          patch: { title: "Owner-corrected collaborative draft" },
        },
      );
      assert.equal(
        collaborativeOwnerUpdate.proposalRevision,
        collaborativeEditorUpdate.proposalRevision + 1,
      );
      await assert.rejects(
        applyPermittedChangeRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          collaborativeDirectApplyRequest.id,
        ),
        (error) => error instanceof AppForbiddenError
          && /another member edited this proposal/i.test(error.message),
      );
      const collaborativeDirectApplyDeniedState = await appPool.query(
        `SELECT cr.status,
                count(event.id) FILTER (
                  WHERE event.action = 'proposal_updated'
                    AND event.actor_member_id = $3
                )::integer AS editor_edit_count,
                count(event.id) FILTER (
                  WHERE event.action = 'proposal_updated'
                    AND event.actor_member_id = $4
                )::integer AS owner_edit_count,
                (SELECT count(*)::integer
                   FROM itinerary_items item
                  WHERE item.trip_id = cr.trip_id
                    AND item.title = 'Owner-corrected collaborative draft') AS canonical_count
           FROM change_requests cr
           LEFT JOIN audit_events event
             ON event.trip_id = cr.trip_id
            AND event.entity_type = 'change_request'
            AND event.entity_id = cr.id
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.trip_id, cr.status`,
        [
          memberSession.tripId,
          collaborativeDirectApplyRequest.id,
          otherMemberSession.memberId,
          ownerSession.memberId,
        ],
      );
      assert.deepEqual(collaborativeDirectApplyDeniedState.rows[0], {
        status: "pending",
        editor_edit_count: 1,
        owner_edit_count: 1,
        canonical_count: 0,
      });
      const approvedCollaborativeRequest = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        collaborativeDirectApplyRequest.id,
        "approve",
        "Owner explicitly approved the collaboratively edited proposal",
      );
      assert.equal(approvedCollaborativeRequest.status, "approved");
      assert.ok(approvedCollaborativeRequest.entityId);
      assert.equal((await appPool.query(
        `SELECT count(*)::integer AS count
           FROM itinerary_items
          WHERE trip_id = $1 AND id = $2
            AND title = 'Owner-corrected collaborative draft'
            AND notes = 'Another editor added this detail'`,
        [memberSession.tripId, approvedCollaborativeRequest.entityId],
      )).rows[0].count, 1);
      await updateMemberPermissions(
        appPool,
        ownerSession,
        ownerSession.tripId,
        memberSession.memberId,
        {
          canEditItinerary: true,
          itineraryRequiresApproval: true,
          canEditExpenses: true,
          expenseRequiresApproval: false,
          canSyncCalendar: true,
        },
      );

      const pendingCollaborativeCancellation = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: approvedCollaborativeRequest.entityId,
          operation: "cancel",
          baseRevision: 1,
          patch: {},
          reason: "Editor cancellation remains visible while awaiting owner review",
        },
      );
      await assert.rejects(
        applyPermittedChangeRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          pendingCollaborativeCancellation.id,
        ),
        (error) => error instanceof AppForbiddenError && /approval is required/i.test(error.message),
      );
      for (const visibleSession of [ownerSession, memberSession, otherMemberSession]) {
        const overview = await getAppOverview(appPool, visibleSession);
        const projection = overview.pendingItinerary.find(
          (item) => item.requestId === pendingCollaborativeCancellation.id,
        );
        assert.ok(projection);
        assert.equal(projection.operation, "cancel");
        assert.equal(projection.targetItemId, approvedCollaborativeRequest.entityId);
        assert.equal(projection.createdByMemberId, memberSession.memberId);
      }
      assert.deepEqual((await appPool.query(
        `SELECT status, current_revision
           FROM itinerary_items
          WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, approvedCollaborativeRequest.entityId],
      )).rows[0], { status: "planned", current_revision: 1 });
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        pendingCollaborativeCancellation.id,
        "reject",
        "Keep the synthetic event for restore-proposal coverage",
      );

      const ownerCancellationRequest = await createChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: approvedCollaborativeRequest.entityId,
          operation: "cancel",
          baseRevision: 1,
          patch: {},
          reason: "Prepare a cancelled item for restore-proposal coverage",
        },
      );
      const ownerCancellation = await applyPermittedChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        ownerCancellationRequest.id,
      );
      assert.equal(ownerCancellation.revision, 2);
      const pendingCollaborativeRestore = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          entityId: approvedCollaborativeRequest.entityId,
          operation: "restore",
          baseRevision: 2,
          patch: {},
          reason: "Editor restore remains visible while awaiting owner review",
        },
      );
      for (const visibleSession of [ownerSession, memberSession, otherMemberSession]) {
        const overview = await getAppOverview(appPool, visibleSession);
        const projection = overview.pendingItinerary.find(
          (item) => item.requestId === pendingCollaborativeRestore.id,
        );
        assert.ok(projection);
        assert.equal(projection.operation, "restore");
        assert.equal(projection.targetItemId, approvedCollaborativeRequest.entityId);
      }
      assert.deepEqual((await appPool.query(
        `SELECT status, current_revision
           FROM itinerary_items
          WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, approvedCollaborativeRequest.entityId],
      )).rows[0], { status: "cancelled", current_revision: 2 });
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        pendingCollaborativeRestore.id,
        "reject",
        "Pending restore projection regression cleanup",
      );

      const pendingAiExpenseCanonicalCount = await appPool.query(
        `SELECT count(*)::integer AS expense_count
           FROM expenses
          WHERE trip_id = $1 AND description = 'Owner-excluded AI private expense'`,
        [memberSession.tripId],
      );
      assert.equal(pendingAiExpenseCanonicalCount.rows[0].expense_count, 0);
      const ownerPendingExpenseOverview = await getAppOverview(appPool, ownerSession);
      const requesterPendingExpenseOverview = await getAppOverview(appPool, memberSession);
      const unrelatedPendingExpenseOverview = await getAppOverview(appPool, otherMemberSession);
      const ownerPendingExpense = ownerPendingExpenseOverview.pendingExpenses.find(
        (expense) => expense.requestId === preAudienceMigrationAiPrivateExpenseRequest.id,
      );
      const requesterPendingExpense = requesterPendingExpenseOverview.pendingExpenses.find(
        (expense) => expense.requestId === preAudienceMigrationAiPrivateExpenseRequest.id,
      );
      assert.ok(ownerPendingExpense);
      assert.ok(requesterPendingExpense);
      assert.equal(
        unrelatedPendingExpenseOverview.pendingExpenses.some(
          (expense) => expense.requestId === preAudienceMigrationAiPrivateExpenseRequest.id,
        ),
        false,
      );
      assert.equal(ownerPendingExpense.amountMinor, 900);
      assert.equal(ownerPendingExpense.currency, "JPY");
      assert.equal(ownerPendingExpense.payerMemberId, memberSession.memberId);
      assert.equal(ownerPendingExpense.itineraryItemTitle, "Private member dinner");
      assert.deepEqual(ownerPendingExpense.splits.map((split) => ({
        memberId: split.memberId,
        shareMinor: split.shareMinor,
      })), [{ memberId: memberSession.memberId, shareMinor: 900 }]);
      assert.equal(requesterPendingExpense.itineraryItemTitle, "Private member dinner");

      const involvedMemberExpenseRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "expense",
          operation: "create",
          patch: {
            description: "AI shared taxi expense",
            amountMinor: 1001,
            currency: "JPY",
            payerMemberId: memberSession.memberId,
            occurredAt: "2030-04-03T12:12:00.000Z",
            status: "posted",
            splitMemberIds: [memberSession.memberId, otherMemberSession.memberId],
          },
          reason: "Verify that another involved member sees the pending expense",
          source: "ai",
        },
      );
      for (const session of [ownerSession, memberSession, otherMemberSession]) {
        const overview = await getAppOverview(appPool, session);
        const projection = overview.pendingExpenses.find(
          (expense) => expense.requestId === involvedMemberExpenseRequest.id,
        );
        assert.ok(projection);
        assert.equal(projection.splits.reduce(
          (total, split) => total + split.shareMinor,
          0,
        ), 1001);
      }
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        involvedMemberExpenseRequest.id,
        "reject",
        "Pending involved-member visibility integration cleanup",
      );

      const mixedBatchEventReason = "Mixed AI batch event must roll back";
      const mixedBatchExpenseReason = "Mixed AI batch invalid expense must roll back";
      await assert.rejects(
        createChangeRequestsAtomically(
          appPool,
          memberSession,
          memberSession.tripId,
          [
            {
              entityType: "itinerary_item",
              operation: "create",
              patch: {
                tripDayId: "30000000-0000-4000-8000-000000000003",
                title: "Mixed batch rollback dinner",
                itemType: "meal",
                startsAt: "2030-04-03T13:00:00.000Z",
                endsAt: "2030-04-03T14:00:00.000Z",
                visibility: "trip",
                viewerMemberIds: [],
              },
              reason: mixedBatchEventReason,
              source: "ai",
            },
            {
              entityType: "expense",
              operation: "create",
              patch: {
                description: "Invalid mixed-batch dinner expense",
                amountMinor: 5000,
                currency: "JPY",
                payerMemberId: "20000000-0000-4000-8000-000000000099",
                occurredAt: "2030-04-03T13:00:00.000Z",
                status: "posted",
                splitMemberIds: [memberSession.memberId],
              },
              reason: mixedBatchExpenseReason,
              source: "ai",
            },
          ],
        ),
        (error) => error instanceof AppNotFoundError && /expense members are invalid/i.test(error.message),
      );
      assert.equal((await appPool.query(
        `SELECT count(*)::integer AS count
           FROM change_requests
          WHERE trip_id = $1 AND reason = ANY($2::text[])`,
        [memberSession.tripId, [mixedBatchEventReason, mixedBatchExpenseReason]],
      )).rows[0].count, 0);

      await assert.rejects(
        applyPermittedChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          preAudienceMigrationAiPrivateExpenseRequest.id,
        ),
        (error) => error instanceof AppForbiddenError
          && /AI-created expenses require explicit owner approval/i.test(error.message),
      );
      const approvedAiPrivateExpense = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        preAudienceMigrationAiPrivateExpenseRequest.id,
        "approve",
        "Explicit owner approval integration",
      );
      assert.equal(approvedAiPrivateExpense.status, "approved");
      assert.ok(approvedAiPrivateExpense.entityId);
      const requesterAfterAiExpenseApproval = await getAppOverview(appPool, memberSession);
      const ownerAfterAiExpenseApproval = await getAppOverview(appPool, ownerSession);
      const unrelatedAfterAiExpenseApproval = await getAppOverview(appPool, otherMemberSession);
      assert.ok(requesterAfterAiExpenseApproval.expenses.some(
        (expense) => expense.id === approvedAiPrivateExpense.entityId,
      ));
      assert.ok(ownerAfterAiExpenseApproval.expenses.some(
        (expense) => expense.id === approvedAiPrivateExpense.entityId,
      ));
      assert.equal(unrelatedAfterAiExpenseApproval.expenses.some(
        (expense) => expense.id === approvedAiPrivateExpense.entityId,
      ), false);

      const migratedOwnerSelection = await appPool.query(
        `SELECT last_selected_trip_id
           FROM app_users
          WHERE id = $1`,
        [switchSourceSession.userId],
      );
      assert.equal(
        migratedOwnerSelection.rows[0]?.last_selected_trip_id,
        "10000000-0000-4000-8000-000000000002",
      );
      const preferredTripGrant = await signInExistingIdentity(appPool, authConfig, {
        identity: {
          issuer: switchSourceSession.issuer,
          subject: switchSourceSession.subject,
          emailHint: "owner@example.test",
          displayNameHint: "Verified Owner",
        },
        userAgent: "Preferred trip sign-in browser",
      });
      assert.equal(preferredTripGrant.tripId, "10000000-0000-4000-8000-000000000002");

      const preferredTripSession = await verifySession(
        appPool,
        authConfig,
        preferredTripGrant.rawToken,
      );
      assert.ok(preferredTripSession);
      const switchedBackGrant = await switchSessionTrip(
        appPool,
        authConfig,
        preferredTripSession,
        "10000000-0000-4000-8000-000000000001",
        "Persistent trip switch browser",
      );
      await revokeSession(appPool, switchedBackGrant.sessionId, switchedBackGrant.userId);
      const resumedAfterSignOut = await signInExistingIdentity(appPool, authConfig, {
        identity: {
          issuer: switchSourceSession.issuer,
          subject: switchSourceSession.subject,
          emailHint: "owner@example.test",
          displayNameHint: "Verified Owner",
        },
        userAgent: "Trip resume browser",
      });
      assert.equal(resumedAfterSignOut.tripId, "10000000-0000-4000-8000-000000000001");
      await revokeSession(appPool, resumedAfterSignOut.sessionId, resumedAfterSignOut.userId);

      await appPool.query(
        `UPDATE trip_members
            SET status = 'revoked'
          WHERE trip_id = '10000000-0000-4000-8000-000000000001'
            AND id = '20000000-0000-4000-8000-000000000001'`,
      );
      try {
        const safeFallbackGrant = await signInExistingIdentity(appPool, authConfig, {
          identity: {
            issuer: switchSourceSession.issuer,
            subject: switchSourceSession.subject,
            emailHint: "owner@example.test",
            displayNameHint: "Verified Owner",
          },
          userAgent: "Unavailable preference fallback browser",
        });
        assert.equal(safeFallbackGrant.tripId, "10000000-0000-4000-8000-000000000002");
        const fallbackSelection = await appPool.query(
          `SELECT last_selected_trip_id
             FROM app_users
            WHERE id = $1`,
          [switchSourceSession.userId],
        );
        assert.equal(
          fallbackSelection.rows[0]?.last_selected_trip_id,
          "10000000-0000-4000-8000-000000000002",
        );
        await revokeSession(appPool, safeFallbackGrant.sessionId, safeFallbackGrant.userId);
      } finally {
        await appPool.query(
          `UPDATE trip_members
              SET status = 'active'
            WHERE trip_id = '10000000-0000-4000-8000-000000000001'
              AND id = '20000000-0000-4000-8000-000000000001'`,
        );
      }

      const tripVisiblePendingRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Trip-visible pending proposal",
            itemType: "activity",
            startsAt: "2030-04-02T08:00:00.000Z",
            endsAt: "2030-04-02T09:00:00.000Z",
            visibility: "trip",
          },
          reason: "Pending trip visibility integration",
          source: "ai",
        },
      );
      for (const session of [ownerSession, memberSession, otherMemberSession]) {
        const overview = await getAppOverview(appPool, session);
        assert.ok(overview.pendingItinerary.some(
          (item) => item.requestId === tripVisiblePendingRequest.id,
        ));
      }
      const otherEditorDetail = await getPendingItineraryRequestForEdit(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        tripVisiblePendingRequest.id,
      );
      assert.equal(otherEditorDetail.requestId, tripVisiblePendingRequest.id);
      const otherEditorUpdate = await updatePendingItineraryRequest(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        tripVisiblePendingRequest.id,
        {
          proposalRevision: otherEditorDetail.proposalRevision,
          patch: { notes: "Updated by another active editor" },
        },
      );
      assert.equal(otherEditorUpdate.proposalRevision, 2);
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        tripVisiblePendingRequest.id,
        "reject",
        "Trip-visible pending proposal regression cleanup",
      );
      const rejectedTripVisibleAudience = await appPool.query(
        `SELECT
           app_member_can_view_change_request($1, $2, $3) AS owner_can_view,
           app_member_can_view_change_request($1, $2, $4) AS requester_can_view,
           app_member_can_view_change_request($1, $2, $5) AS unrelated_member_can_view`,
        [
          memberSession.tripId,
          tripVisiblePendingRequest.id,
          ownerSession.memberId,
          memberSession.memberId,
          otherMemberSession.memberId,
        ],
      );
      assert.deepEqual(rejectedTripVisibleAudience.rows[0], {
        owner_can_view: true,
        requester_can_view: true,
        unrelated_member_can_view: false,
      });

      const unsharedPrivatePendingRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Unshared private pending proposal",
            itemType: "activity",
            startsAt: "2030-04-02T09:00:00.000Z",
            endsAt: "2030-04-02T10:00:00.000Z",
            visibility: "private",
            viewerMemberIds: [],
          },
          reason: "Pending private visibility integration",
          source: "ai",
        },
      );
      const unsharedPrivateOwnerOverview = await getAppOverview(appPool, ownerSession);
      const unsharedPrivateRequesterOverview = await getAppOverview(appPool, memberSession);
      const unsharedPrivateOtherOverview = await getAppOverview(appPool, otherMemberSession);
      assert.ok(unsharedPrivateOwnerOverview.pendingItinerary.some(
        (item) => item.requestId === unsharedPrivatePendingRequest.id,
      ));
      assert.ok(unsharedPrivateRequesterOverview.pendingItinerary.some(
        (item) => item.requestId === unsharedPrivatePendingRequest.id,
      ));
      assert.ok(!unsharedPrivateOtherOverview.pendingItinerary.some(
        (item) => item.requestId === unsharedPrivatePendingRequest.id,
      ));
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        unsharedPrivatePendingRequest.id,
        "reject",
        "Unshared private pending proposal regression cleanup",
      );

      const editablePendingRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Pending edit integration dinner",
            itemType: "meal",
            startsAt: "2030-04-02T10:00:00.000Z",
            endsAt: "2030-04-02T11:00:00.000Z",
            locationName: "Synthetic private restaurant",
            mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic+private+restaurant",
            notes: "Original pending proposal",
            visibility: "private",
            viewerMemberIds: [otherMemberSession.memberId],
            status: "planned",
          },
          reason: "Pending proposal edit integration",
          source: "ai",
        },
      );
      const requesterEditableDetail = await getPendingItineraryRequestForEdit(
        appPool,
        memberSession,
        memberSession.tripId,
        editablePendingRequest.id,
      );
      const ownerEditableDetail = await getPendingItineraryRequestForEdit(
        appPool,
        ownerSession,
        ownerSession.tripId,
        editablePendingRequest.id,
      );
      assert.equal(requesterEditableDetail.proposalRevision, 1);
      assert.equal(requesterEditableDetail.status, "pending");
      assert.equal(requesterEditableDetail.requestedByMemberId, memberSession.memberId);
      assert.equal(requesterEditableDetail.source, "ai");
      assert.deepEqual(requesterEditableDetail.patch.viewerMemberIds, [otherMemberSession.memberId]);
      assert.deepEqual(ownerEditableDetail, requesterEditableDetail);
      const selectedViewerPendingOverview = await getAppOverview(appPool, otherMemberSession);
      assert.ok(selectedViewerPendingOverview.pendingItinerary.some(
        (item) => item.requestId === editablePendingRequest.id,
      ));
      const selectedEditorDetail = await getPendingItineraryRequestForEdit(
        appPool,
        otherMemberSession,
        otherMemberSession.tripId,
        editablePendingRequest.id,
      );
      assert.equal(selectedEditorDetail.requestId, editablePendingRequest.id);
      await assert.rejects(
        updatePendingItineraryRequest(
          appPool,
          otherMemberSession,
          otherMemberSession.tripId,
          editablePendingRequest.id,
          {
            proposalRevision: 1,
            patch: { viewerMemberIds: [] },
          },
        ),
        (error) => error instanceof AppForbiddenError && /event creator can change/i.test(error.message),
      );

      const requesterEditedPending = await updatePendingItineraryRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        editablePendingRequest.id,
        {
          proposalRevision: 1,
          patch: {
            title: "Pending edit integration dinner — requester edit",
            startsAt: "2030-04-02T10:30:00.000Z",
            endsAt: "2030-04-02T12:00:00.000Z",
            locationName: "Synthetic requester-selected restaurant",
            mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic+requester+restaurant",
          },
          reason: "Requester corrected the pending dinner",
        },
      );
      assert.equal(requesterEditedPending.proposalRevision, 2);
      assert.equal(requesterEditedPending.status, "pending");
      assert.equal(requesterEditedPending.requestedByMemberId, memberSession.memberId);
      assert.equal(requesterEditedPending.source, "ai");
      assert.equal(requesterEditedPending.patch.visibility, "private");
      assert.deepEqual(requesterEditedPending.patch.viewerMemberIds, [otherMemberSession.memberId]);
      assert.equal(requesterEditedPending.patch.title, "Pending edit integration dinner — requester edit");
      assert.equal(requesterEditedPending.patch.startsAt, "2030-04-02T10:30:00.000Z");
      assert.equal(requesterEditedPending.patch.endsAt, "2030-04-02T12:00:00.000Z");
      assert.ok(Date.parse(requesterEditedPending.updatedAt) >= Date.parse(requesterEditableDetail.updatedAt));
      assert.deepEqual((await appPool.query(
        `SELECT cr.status, cr.entity_id,
                count(i.id)::integer AS canonical_count
           FROM change_requests cr
           LEFT JOIN itinerary_items i
             ON i.trip_id = cr.trip_id AND i.id = cr.entity_id
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.entity_id`,
        [memberSession.tripId, editablePendingRequest.id],
      )).rows[0], {
        status: "pending",
        entity_id: null,
        canonical_count: 0,
      });
      await assert.rejects(
        updatePendingItineraryRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          editablePendingRequest.id,
          {
            proposalRevision: 1,
            patch: { notes: "A stale browser must not overwrite the requester edit" },
          },
        ),
        (error) => error instanceof AppConflictError && /pending event changed/i.test(error.message),
      );

      const ownerEditedPending = await updatePendingItineraryRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        editablePendingRequest.id,
        {
          proposalRevision: requesterEditedPending.proposalRevision,
          patch: {
            title: "Pending edit integration dinner — owner edit",
            notes: "Owner corrected the meeting instructions before approval",
            isLocked: true,
          },
          reason: "Owner corrected the pending dinner",
        },
      );
      assert.equal(ownerEditedPending.proposalRevision, 3);
      assert.equal(ownerEditedPending.status, "pending");
      assert.equal(ownerEditedPending.requestedByMemberId, memberSession.memberId);
      assert.equal(ownerEditedPending.source, "ai");
      assert.equal(ownerEditedPending.patch.isLocked, true);
      assert.equal(ownerEditedPending.patch.visibility, "private");
      assert.deepEqual(ownerEditedPending.patch.viewerMemberIds, [otherMemberSession.memberId]);
      const pendingEditState = await appPool.query(
        `SELECT cr.status, cr.source, cr.requested_by_member_id,
                cr.proposal_revision,
                cr.proposed_patch->>'title' AS title,
                cr.proposed_patch->>'visibility' AS visibility,
                cr.proposed_patch->'viewerMemberIds' AS viewer_member_ids,
                count(ae.id)::integer AS edit_audit_count,
                bool_or(ae.actor_member_id = $3) AS requester_edit_audited,
                bool_or(ae.actor_member_id = $4) AS owner_edit_audited
           FROM change_requests cr
           LEFT JOIN audit_events ae
             ON ae.trip_id = cr.trip_id
            AND ae.entity_type = 'change_request'
            AND ae.entity_id = cr.id
            AND ae.action = 'proposal_updated'
          WHERE cr.trip_id = $1 AND cr.id = $2
          GROUP BY cr.status, cr.source, cr.requested_by_member_id,
                   cr.proposal_revision, cr.proposed_patch`,
        [
          memberSession.tripId,
          editablePendingRequest.id,
          memberSession.memberId,
          ownerSession.memberId,
        ],
      );
      assert.deepEqual(pendingEditState.rows[0], {
        status: "pending",
        source: "ai",
        requested_by_member_id: memberSession.memberId,
        proposal_revision: 3,
        title: "Pending edit integration dinner — owner edit",
        visibility: "private",
        viewer_member_ids: [otherMemberSession.memberId],
        edit_audit_count: 2,
        requester_edit_audited: true,
        owner_edit_audited: true,
      });

      const approvedEditedPending = await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        editablePendingRequest.id,
        "approve",
        "Approved after requester and owner corrections",
      );
      assert.equal(approvedEditedPending.status, "approved");
      assert.equal(approvedEditedPending.revision, 1);
      assert.ok(approvedEditedPending.entityId);
      const approvedEditedState = await appPool.query(
        `SELECT cr.status, cr.source, cr.requested_by_member_id,
                cr.applied_revision, i.title, i.notes, i.created_by_member_id,
                i.visibility, i.is_locked, i.current_revision,
                COALESCE(ARRAY(
                  SELECT iv.member_id
                    FROM itinerary_item_viewers iv
                   WHERE iv.trip_id = i.trip_id AND iv.itinerary_item_id = i.id
                   ORDER BY iv.member_id
                ), ARRAY[]::uuid[]) AS viewer_member_ids,
                (SELECT count(*)::integer
                   FROM itinerary_revisions ir
                  WHERE ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id) AS revision_count
           FROM change_requests cr
           JOIN itinerary_items i
             ON i.trip_id = cr.trip_id AND i.id = cr.entity_id
          WHERE cr.trip_id = $1 AND cr.id = $2`,
        [memberSession.tripId, editablePendingRequest.id],
      );
      assert.deepEqual(approvedEditedState.rows[0], {
        status: "approved",
        source: "ai",
        requested_by_member_id: memberSession.memberId,
        applied_revision: 1,
        title: "Pending edit integration dinner — owner edit",
        notes: "Owner corrected the meeting instructions before approval",
        created_by_member_id: memberSession.memberId,
        visibility: "private",
        is_locked: true,
        current_revision: 1,
        viewer_member_ids: [otherMemberSession.memberId],
        revision_count: 1,
      });
      const requesterAfterPendingApproval = await getAppOverview(appPool, memberSession);
      const selectedViewerAfterPendingApproval = await getAppOverview(appPool, otherMemberSession);
      const ownerAfterPendingApproval = await getAppOverview(appPool, ownerSession);
      assert.ok(requesterAfterPendingApproval.itinerary.some(
        (item) => item.id === approvedEditedPending.entityId,
      ));
      assert.ok(selectedViewerAfterPendingApproval.itinerary.some(
        (item) => item.id === approvedEditedPending.entityId,
      ));
      assert.ok(!ownerAfterPendingApproval.itinerary.some(
        (item) => item.id === approvedEditedPending.entityId,
      ));
      for (const overview of [
        requesterAfterPendingApproval,
        selectedViewerAfterPendingApproval,
        ownerAfterPendingApproval,
      ]) {
        assert.ok(!overview.pendingItinerary.some(
          (item) => item.requestId === editablePendingRequest.id,
        ));
      }
      await assert.rejects(
        updatePendingItineraryRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          editablePendingRequest.id,
          {
            proposalRevision: ownerEditedPending.proposalRevision,
            patch: { title: "An approved request must not reopen" },
          },
        ),
        (error) => error instanceof AppConflictError && /only a pending event request/i.test(error.message),
      );
      await assert.rejects(
        reviewChangeRequest(
          appPool,
          ownerSession,
          ownerSession.tripId,
          editablePendingRequest.id,
          "approve",
          "A second approval must not create another event",
        ),
        (error) => error instanceof AppNotFoundError || error instanceof AppConflictError,
      );
      assert.deepEqual((await appPool.query(
        `SELECT count(i.id)::integer AS item_count,
                count(ir.revision)::integer AS revision_count
           FROM itinerary_items i
           LEFT JOIN itinerary_revisions ir
             ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
          WHERE i.trip_id = $1 AND i.id = $2`,
        [memberSession.tripId, approvedEditedPending.entityId],
      )).rows[0], { item_count: 1, revision_count: 1 });

      const rejectedEditableRequest = await createChangeRequest(
        appPool,
        memberSession,
        memberSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Rejected pending edit integration event",
          },
          reason: "Rejected pending edit terminal-state regression",
          source: "ai",
        },
      );
      await reviewChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        rejectedEditableRequest.id,
        "reject",
        "Reject before attempted edit",
      );
      await assert.rejects(
        updatePendingItineraryRequest(
          appPool,
          memberSession,
          memberSession.tripId,
          rejectedEditableRequest.id,
          {
            proposalRevision: 1,
            patch: { title: "A rejected request must not reopen" },
          },
        ),
        (error) => error instanceof AppConflictError && /only a pending event request/i.test(error.message),
      );
      assert.deepEqual((await appPool.query(
        `SELECT status, entity_id, proposal_revision,
                proposed_patch->>'title' AS title
           FROM change_requests
          WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, rejectedEditableRequest.id],
      )).rows[0], {
        status: "rejected",
        entity_id: null,
        proposal_revision: 1,
        title: "Rejected pending edit integration event",
      });

      const systemAiRequestId = "9d000000-0000-4000-8000-000000000001";
      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id, id, actor_member_id, actor_user_id, conversation_id,
           actor_role, initiator_kind, feature, prompt_text, requested_model,
           effective_model, provider, transport, authentication_mode,
           billing_basis, status, completed_at
         ) VALUES (
           $1,$2,NULL,NULL,NULL,'system','system','disruption_monitor',
           'Synthetic public disruption verification','gpt-6.1-sol','gpt-6.1-sol',
           'openai','codex_sdk','chatgpt_subscription','subscription','succeeded',
           CURRENT_TIMESTAMP
         )`,
        [ownerSession.tripId, systemAiRequestId],
      );
      await assert.rejects(
        appPool.query(
          `INSERT INTO ai_requests (
             trip_id, id, actor_member_id, actor_user_id, actor_role,
             initiator_kind, feature, prompt_text, requested_model
           ) VALUES (
             $1,'9d000000-0000-4000-8000-000000000002',$2,$3,'system',
             'system','disruption_monitor','Invalid mixed initiator','gpt-6.1-sol'
           )`,
          [ownerSession.tripId, ownerSession.memberId, ownerSession.userId],
        ),
        /ai_requests_initiator_shape_ck/u,
      );

      await assert.rejects(
        appPool.query(
          `INSERT INTO event_weather_forecasts (
             trip_id, itinerary_item_id, item_revision, target_role, forecast_at, location_key,
             location_label, location_precision, latitude, longitude, provider,
             weather_code, condition_key, icon_key, is_day, sampled_at, fetched_at,
             stale_after
           ) VALUES (
             $1,'4f000000-0000-4000-8000-000000000004',1,'location',CURRENT_TIMESTAMP,
             'invalid-weather','Invalid weather','event',91,139,'open-meteo',
             0,'clear','sunny',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP + interval '30 minutes'
           )`,
          [ownerSession.tripId],
        ),
        /event_weather_forecasts_latitude_check/u,
      );
      await appPool.query(
        `INSERT INTO event_weather_forecasts (
           trip_id, itinerary_item_id, item_revision, target_role,
           forecast_at, location_key, location_label, location_precision,
           latitude, longitude, provider, weather_code, condition_key, icon_key,
           is_day, temperature_celsius, apparent_temperature_celsius,
           precipitation_probability_percent, sampled_at, fetched_at, stale_after
         ) VALUES
           ($1,'4f000000-0000-4000-8000-000000000004',1,'departure',
            CURRENT_TIMESTAMP + interval '2 hours','synthetic-departure-key',
            'Origin Station','event',35.68,139.76,'open-meteo',
            0,'clear','sunny',true,21,21,0,
            CURRENT_TIMESTAMP + interval '2 hours',CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + interval '30 minutes'),
           ($1,'4f000000-0000-4000-8000-000000000004',1,'destination',
            CURRENT_TIMESTAMP + interval '3 hours','synthetic-destination-key',
            'Destination Station','event',34.69,135.50,'open-meteo',
            2,'partly_cloudy','partly-cloudy-day',true,24,25,10,
            CURRENT_TIMESTAMP + interval '3 hours',CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + interval '30 minutes')`,
        [ownerSession.tripId],
      );
      const transportWeatherRoles = await appPool.query(
        `SELECT target_role
           FROM event_weather_forecasts
          WHERE trip_id = $1
            AND itinerary_item_id = '4f000000-0000-4000-8000-000000000004'
          ORDER BY CASE target_role WHEN 'departure' THEN 1 ELSE 2 END`,
        [ownerSession.tripId],
      );
      assert.deepEqual(
        transportWeatherRoles.rows.map((row) => row.target_role),
        ["departure", "destination"],
      );
      await assert.rejects(
        appPool.query(
          `INSERT INTO event_weather_forecasts (
             trip_id, itinerary_item_id, item_revision, target_role,
             forecast_at, location_key, location_label, location_precision,
             latitude, longitude, provider, weather_code, condition_key, icon_key,
             is_day, sampled_at, fetched_at, stale_after
           ) VALUES (
             $1,'4f000000-0000-4000-8000-000000000004',1,'arrival',
             CURRENT_TIMESTAMP,'invalid-target-role','Invalid target role','event',
             35.68,139.76,'open-meteo',0,'clear','sunny',true,
             CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '30 minutes'
           )`,
          [ownerSession.tripId],
        ),
        /event_weather_forecasts_target_role_check/u,
      );

      const weatherLeaseToken = "9d000000-0000-4000-8000-000000000010";
      await appPool.query(
        `INSERT INTO weather_refresh_leases (
           trip_id, member_id, lease_token, acquired_at, leased_until
         ) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 minute')`,
        [ownerSession.tripId, ownerSession.memberId, weatherLeaseToken],
      );
      await appPool.query(
        `INSERT INTO weather_refresh_leases (
           trip_id, member_id, lease_token, acquired_at, leased_until
         ) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 minute')`,
        [ownerSession.tripId, memberSession.memberId, "9d000000-0000-4000-8000-000000000011"],
      );
      const concurrentMemberLeaseCount = await appPool.query(
        `SELECT count(*)::integer AS count
           FROM weather_refresh_leases
          WHERE trip_id = $1`,
        [ownerSession.tripId],
      );
      assert.equal(concurrentMemberLeaseCount.rows[0].count, 2);
      await assert.rejects(
        appPool.query(
          `UPDATE weather_refresh_leases
              SET leased_until = acquired_at
            WHERE trip_id = $1 AND member_id = $2`,
          [ownerSession.tripId, ownerSession.memberId],
        ),
        /weather_refresh_leases_check/u,
      );
      await appPool.query(
        `DELETE FROM weather_refresh_leases WHERE trip_id = $1`,
        [ownerSession.tripId],
      );

      const monitorRunId = "9d000000-0000-4000-8000-000000000003";
      const observationId = "9d000000-0000-4000-8000-000000000004";
      await appPool.query(
        `INSERT INTO disruption_monitor_runs (
           trip_id, id, scheduled_for, status, candidate_count, web_search_count,
           ai_request_id, started_at, completed_at
         ) VALUES ($1,$2,CURRENT_TIMESTAMP,'succeeded',1,1,$3,
                   CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [ownerSession.tripId, monitorRunId, systemAiRequestId],
      );
      await appPool.query(
        `INSERT INTO event_disruption_observations (
           trip_id, id, itinerary_item_id, monitor_run_id, item_revision, state,
           reason_code, severity, detail, source_urls, evidence_fingerprint,
           observed_at, valid_until
         ) VALUES (
           $1,$2,'4f000000-0000-4000-8000-000000000001',$3,1,'possible',
           'delay','warning','Synthetic sourced delay for migration coverage',
           '["https://status.example.test/event"]'::jsonb,$4,
           CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 hour'
         )`,
        [ownerSession.tripId, observationId, monitorRunId, "a".repeat(64)],
      );
      await appPool.query(
        `INSERT INTO event_disruption_current (
           trip_id, itinerary_item_id, observation_id, item_revision, state,
           reason_code, severity, detail, source_urls, evidence_fingerprint,
           first_seen_at, last_seen_at, checked_at, stale_after
         ) VALUES (
           $1,'4f000000-0000-4000-8000-000000000001',$2,1,'possible',
           'delay','warning','Synthetic sourced delay for migration coverage',
           '["https://status.example.test/event"]'::jsonb,$3,
           CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP + interval '1 hour'
         )`,
        [ownerSession.tripId, observationId, "a".repeat(64)],
      );
      await assert.rejects(
        appPool.query(
          `INSERT INTO event_disruption_current (
             trip_id, itinerary_item_id, observation_id, item_revision, state,
             reason_code, severity, detail, source_urls, evidence_fingerprint,
             first_seen_at, last_seen_at, checked_at, stale_after
           ) VALUES (
             $1,'4f000000-0000-4000-8000-000000000004',$2,1,'possible',
             'delay','warning','Synthetic sourced delay for migration coverage',
             '["https://status.example.test/event"]'::jsonb,$3,
             CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP + interval '1 hour'
           )`,
          [ownerSession.tripId, observationId, "a".repeat(64)],
        ),
        /event_disruption_current_observation_item_fk/u,
      );
      await assert.rejects(
        appPool.query(
          `UPDATE event_disruption_current
              SET severity = 'critical'
            WHERE trip_id = $1 AND itinerary_item_id = '4f000000-0000-4000-8000-000000000001'`,
          [ownerSession.tripId],
        ),
        (error) => error?.code === "23514"
          && error?.constraint === "event_disruption_current_observation_shape_ck",
      );
      await assert.rejects(
        appPool.query(
          `UPDATE event_disruption_observations SET detail = 'mutated'
            WHERE trip_id = $1 AND id = $2`,
          [ownerSession.tripId, observationId],
        ),
        /append-only/u,
      );
      const sourceWarningBeforeLocalization = (await appPool.query(
        `SELECT * FROM event_disruption_current
          WHERE trip_id = $1 AND observation_id = $2`,
        [ownerSession.tripId, observationId],
      )).rows[0];
      const sourceObservationBeforeLocalization = (await appPool.query(
        `SELECT * FROM event_disruption_observations
          WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, observationId],
      )).rows[0];
      const preLocalizationOverview = await getAppOverview(appPool, ownerSession);
      const preLocalizationWarning = preLocalizationOverview.itinerary.find(
        (item) => item.id === "4f000000-0000-4000-8000-000000000001",
      ).disruption;
      assert.equal(preLocalizationWarning, null,
        "legacy observations cannot become visible before qualification is available");
      assert.deepEqual(await migrate({
        connectionString,
        through: "0032_disruption_localizations.sql",
      }), ["0032_disruption_localizations.sql"]);
      assert.deepEqual(await migrate({
        connectionString,
        through: "0032_disruption_localizations.sql",
      }), []);

      const localizedDetails = {
        en: "The official operator reports a possible delay during this event.",
        "zh-HK": "營運機構公告指活動時段可能出現延誤。",
        "ja-JP": "運営者の公式発表によると、予定時間帯に遅延の可能性があります。",
      };
      const insertLocalization = (details, overrides = {}) => appPool.query(
        `INSERT INTO event_disruption_localizations (
           trip_id, observation_id, itinerary_item_id, details, origin
         ) VALUES ($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT (trip_id, observation_id) DO NOTHING`,
        [overrides.tripId ?? ownerSession.tripId, overrides.observationId ?? observationId,
          overrides.itemId ?? "4f000000-0000-4000-8000-000000000001",
          JSON.stringify(details), overrides.origin ?? "monitor"],
      );
      for (const invalidDetails of [null, [], {}, "not an object",
        { ...localizedDetails, unexpected: "extra" },
        { en: localizedDetails.en, "zh-HK": localizedDetails["zh-HK"] },
        ...Object.keys(localizedDetails).flatMap((locale) => [
          { ...localizedDetails, [locale]: null },
          { ...localizedDetails, [locale]: 42 },
          { ...localizedDetails, [locale]: "" },
          { ...localizedDetails, [locale]: " \t\n " },
          { ...localizedDetails, [locale]: "x".repeat(801) },
        ])]) {
        await assert.rejects(
          insertLocalization(invalidDetails),
          (error) => error?.code === "23514"
            && error?.constraint === "event_disruption_localizations_details_ck",
        );
      }
      await assert.rejects(
        insertLocalization(localizedDetails, { origin: "unverified" }),
        (error) => error?.code === "23514"
          && error?.constraint === "event_disruption_localizations_origin_check",
      );
      for (const mismatchedIdentity of [
        { tripId: "10000000-0000-4000-8000-000000000002" },
        { itemId: "4f000000-0000-4000-8000-000000000004" },
      ]) {
        await assert.rejects(
          insertLocalization(localizedDetails, mismatchedIdentity),
          (error) => error?.code === "23503"
            && error?.constraint === "event_disruption_localizations_observation_item_fk",
        );
      }

      // An older observation for the same item must never supply current copy.
      const olderObservationId = "9d000000-0000-4000-8000-000000000005";
      await appPool.query(
        `INSERT INTO event_disruption_observations (
           trip_id, id, itinerary_item_id, monitor_run_id, item_revision, state,
           reason_code, severity, detail, source_urls, evidence_fingerprint,
           observed_at, valid_until
         ) SELECT trip_id,$3,itinerary_item_id,monitor_run_id,item_revision,state,
                  reason_code,severity,'Older synthetic disruption',source_urls,$4,
                  observed_at - interval '2 hours',valid_until - interval '2 hours'
             FROM event_disruption_observations WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, observationId, olderObservationId, "b".repeat(64)],
      );
      await insertLocalization({
        en: "Older warning, not the current event evidence.",
        "zh-HK": "舊預警，並非活動現時的資料。",
        "ja-JP": "過去の警告で、現在の根拠ではありません。",
      }, { observationId: olderObservationId, origin: "maintenance" });
      const olderOnlyOverview = await getAppOverview(appPool, ownerSession);
      assert.equal(olderOnlyOverview.itinerary.find(
        (item) => item.id === "4f000000-0000-4000-8000-000000000001",
      ).disruption, null, "a stored translation must not qualify legacy evidence");

      assert.equal((await insertLocalization(localizedDetails)).rowCount, 1);
      assert.equal((await insertLocalization(localizedDetails)).rowCount, 0);
      assert.equal((await insertLocalization({
        ...localizedDetails, en: "A conflicting retry cannot replace the first translation.",
      })).rowCount, 0);
      const storedLocalization = (await appPool.query(
        `SELECT details, origin, created_at FROM event_disruption_localizations
          WHERE trip_id = $1 AND observation_id = $2`,
        [ownerSession.tripId, observationId],
      )).rows[0];
      assert.deepEqual(storedLocalization.details, localizedDetails);
      assert.equal(storedLocalization.origin, "monitor");
      assert.ok(storedLocalization.created_at instanceof Date);
      for (const mutation of [
        `UPDATE event_disruption_localizations SET details = details
          WHERE trip_id = $1 AND observation_id = $2`,
        `DELETE FROM event_disruption_localizations
          WHERE trip_id = $1 AND observation_id = $2`,
      ]) {
        await assert.rejects(
          appPool.query(mutation, [ownerSession.tripId, observationId]),
          /append-only/u,
        );
      }
      assert.deepEqual((await appPool.query(
        `SELECT * FROM event_disruption_current
          WHERE trip_id = $1 AND observation_id = $2`,
        [ownerSession.tripId, observationId],
      )).rows[0], sourceWarningBeforeLocalization);
      assert.deepEqual((await appPool.query(
        `SELECT * FROM event_disruption_observations
          WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, observationId],
      )).rows[0], sourceObservationBeforeLocalization);
      const liveContextOverview = await getAppOverview(appPool, ownerSession);
      assert.equal(
        new Set(liveContextOverview.itinerary.map((item) => item.id)).size,
        liveContextOverview.itinerary.length,
      );
      const liveContextItem = liveContextOverview.itinerary.find(
        (item) => item.id === "4f000000-0000-4000-8000-000000000001",
      );
      assert.equal(liveContextItem.weather.provider, "open-meteo");
      assert.equal(liveContextItem.weather.targetRole, "destination");
      assert.equal(liveContextItem.weather.locationPrecision, "trip_destination");
      assert.deepEqual(
        liveContextItem.weatherForecasts.map((forecast) => forecast.targetRole),
        ["destination"],
      );
      assert.equal(liveContextItem.disruption, null,
        "localized possible evidence stays stored but is excluded by the qualification gate");
      const twoEndpointWeatherItem = liveContextOverview.itinerary.find(
        (item) => item.id === "4f000000-0000-4000-8000-000000000004",
      );
      assert.equal(twoEndpointWeatherItem.weather.targetRole, "destination");
      assert.deepEqual(
        twoEndpointWeatherItem.weatherForecasts.map((forecast) => forecast.targetRole),
        ["departure", "destination"],
      );
      assert.ok(liveContextOverview.aiLogs.some((entry) => (
        entry.id === systemAiRequestId && entry.actorName === "Stardust monitor"
      )));

      const backfilledTransport = await appPool.query(
        `SELECT location_name, map_url, departure_location_name, departure_map_url,
                destination_location_name, destination_map_url
           FROM itinerary_items
          WHERE trip_id = $1 AND id = '4f000000-0000-4000-8000-000000000001'`,
        [ownerSession.tripId],
      );
      assert.deepEqual(backfilledTransport.rows[0], {
        location_name: null,
        map_url: null,
        departure_location_name: null,
        departure_map_url: null,
        destination_location_name: "Legacy destination station",
        destination_map_url: "https://www.google.com/maps/search/?api=1&query=Legacy+destination+station",
      });
      const splitLegacyTransport = await appPool.query(
        `SELECT location_name, map_url, departure_location_name, departure_map_url,
                destination_location_name, destination_map_url
           FROM itinerary_items
          WHERE trip_id = $1 AND id = '4f000000-0000-4000-8000-000000000004'`,
        [ownerSession.tripId],
      );
      assert.deepEqual(splitLegacyTransport.rows[0], {
        location_name: null,
        map_url: null,
        departure_location_name: "Origin Station",
        departure_map_url: null,
        destination_location_name: "Destination Station",
        destination_map_url: null,
      });
      await assert.rejects(
        appPool.query(
          `INSERT INTO itinerary_items (
             trip_id, id, trip_day_id, created_by_member_id, title, item_type
           ) VALUES (
             $1, '4f000000-0000-4000-8000-000000000002',
             '30000000-0000-4000-8000-000000000002', $2,
             'Endpoint-less transport', 'transport'
           )`,
          [ownerSession.tripId, ownerSession.memberId],
        ),
        /itinerary_items_transport_endpoint_ck/u,
      );
      await assert.rejects(
        appPool.query(
          `INSERT INTO itinerary_items (
             trip_id, id, trip_day_id, created_by_member_id, title, item_type,
             departure_location_name
           ) VALUES (
             $1, '4f000000-0000-4000-8000-000000000003',
             '30000000-0000-4000-8000-000000000002', $2,
             'Invalid activity route', 'activity', 'Not allowed'
           )`,
          [ownerSession.tripId, ownerSession.memberId],
        ),
        /itinerary_items_location_shape_ck/u,
      );

      const transportCreateRequest = await createChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        {
          entityType: "itinerary_item",
          operation: "create",
          patch: {
            tripDayId: "30000000-0000-4000-8000-000000000002",
            title: "Tokyo to Kyoto integration train",
            itemType: "transport",
            startsAt: "2030-04-02T01:00:00.000Z",
            endsAt: "2030-04-02T03:30:00.000Z",
            departureLocationName: "Tokyo Station",
            departureMapUrl: "https://www.google.com/maps/search/?api=1&query=Tokyo+Station",
            destinationLocationName: "Kyoto Station",
            destinationMapUrl: "https://www.google.com/maps/search/?api=1&query=Kyoto+Station",
          },
          reason: "Transport endpoint integration coverage",
        },
      );
      const appliedTransport = await applyPermittedChangeRequest(
        appPool,
        ownerSession,
        ownerSession.tripId,
        transportCreateRequest.id,
      );
      const transportState = await appPool.query(
        `SELECT i.location_name, i.map_url, i.departure_location_name,
                i.departure_map_url, i.destination_location_name,
                i.destination_map_url, i.starts_at, i.ends_at,
                r.snapshot, EXISTS (
                  SELECT 1 FROM audit_events a
                   WHERE a.trip_id = i.trip_id AND a.entity_id = i.id
                     AND a.entity_type = 'itinerary_item' AND a.action = 'created'
                ) AS audited
           FROM itinerary_items i
           JOIN itinerary_revisions r
             ON r.trip_id = i.trip_id AND r.itinerary_item_id = i.id
            AND r.revision = 1
          WHERE i.trip_id = $1 AND i.id = $2`,
        [ownerSession.tripId, appliedTransport.entityId],
      );
      assert.deepEqual({
        location_name: transportState.rows[0].location_name,
        map_url: transportState.rows[0].map_url,
        departure_location_name: transportState.rows[0].departure_location_name,
        departure_map_url: transportState.rows[0].departure_map_url,
        destination_location_name: transportState.rows[0].destination_location_name,
        destination_map_url: transportState.rows[0].destination_map_url,
        audited: transportState.rows[0].audited,
      }, {
        location_name: null,
        map_url: null,
        departure_location_name: "Tokyo Station",
        departure_map_url: "https://www.google.com/maps/search/?api=1&query=Tokyo+Station",
        destination_location_name: "Kyoto Station",
        destination_map_url: "https://www.google.com/maps/search/?api=1&query=Kyoto+Station",
        audited: true,
      });
      assert.equal(transportState.rows[0].starts_at.toISOString(), "2030-04-02T01:00:00.000Z");
      assert.equal(transportState.rows[0].ends_at.toISOString(), "2030-04-02T03:30:00.000Z");
      assert.equal(transportState.rows[0].snapshot.departureLocationName, "Tokyo Station");
      assert.equal(transportState.rows[0].snapshot.destinationLocationName, "Kyoto Station");
      const transportOverview = await getAppOverview(appPool, ownerSession);
      const overviewTransport = transportOverview.itinerary.find(
        (item) => item.id === appliedTransport.entityId,
      );
      assert.ok(overviewTransport);
      assert.equal(overviewTransport.departureLocationName, "Tokyo Station");
      assert.equal(overviewTransport.destinationLocationName, "Kyoto Station");
      await assert.rejects(
        createChangeRequest(appPool, ownerSession, ownerSession.tripId, {
          entityType: "itinerary_item",
          entityId: appliedTransport.entityId,
          operation: "update",
          baseRevision: 1,
          patch: {
            departureLocationName: null,
            destinationLocationName: null,
          },
          reason: "Transport must retain at least one endpoint",
        }),
        (error) => error instanceof AppConflictError && /departure location or destination/i.test(error.message),
      );
      await assert.rejects(
        appPool.query(
          `INSERT INTO ai_conversations (
             trip_id, id, actor_member_id, actor_user_id
           ) VALUES ($1, '92000000-0000-4000-8000-000000000001', $2, $3)`,
          [ownerSession.tripId, ownerSession.memberId, ownerSession.userId],
        ),
        /ai_conversations_one_active_member_idx/,
      );
      await assert.rejects(
        appPool.query(
          `INSERT INTO ai_requests (
             trip_id, id, actor_member_id, actor_user_id, conversation_id,
             actor_role, prompt_text, result_text, requested_model, status, completed_at
           ) VALUES (
             $1, '91000000-0000-4000-8000-000000000003', $2, $3, $4,
             'editor', 'Cross-member memory', 'Must be rejected',
             'gpt-6.1-sol', 'succeeded', CURRENT_TIMESTAMP
           )`,
          [memberSession.tripId, memberSession.memberId, memberSession.userId, firstOwnerConversation.conversationId],
        ),
        /ai_requests_conversation_fk/,
      );
      // Owner bootstrap replaced the demo identity. Application mutations now
      // use the bound owner; the original stale identity must not reset this history.
      await assert.rejects(
        resetAiConversation(appPool, { ...ownerSession, userId: "00000000-0000-4000-8000-000000000001" }, ownerSession.tripId),
        (error) => error instanceof AppForbiddenError,
      );
      assert.equal((await appPool.query(
        `SELECT closed_at FROM ai_conversations WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, firstOwnerConversation.conversationId],
      )).rows[0].closed_at, null);
      const boundOwnerConversation = await prepareConversation(appPool, boundOwnerSession);
      assert.equal(boundOwnerConversation.conversationId, firstOwnerConversation.conversationId);
      assert.ok(boundOwnerConversation.turns.length > 0);
      const resetOwnerConversation = await resetAiConversation(
        appPool,
        boundOwnerSession,
        boundOwnerSession.tripId,
      );
      assert.notEqual(resetOwnerConversation.conversationId, boundOwnerConversation.conversationId);
      const emptyOwnerConversation = await prepareConversation(appPool, boundOwnerSession);
      assert.equal(emptyOwnerConversation.conversationId, resetOwnerConversation.conversationId);
      assert.deepEqual(emptyOwnerConversation.turns, []);
      const retainedOwnerMemory = await appPool.query(
        `SELECT count(DISTINCT ar.id)::integer AS request_count,
                count(*) FILTER (WHERE ac.closed_at IS NOT NULL)::integer AS closed_request_count,
                EXISTS (
                  SELECT 1 FROM audit_events ae
                   WHERE ae.trip_id = $1 AND ae.entity_type = 'ai_conversation'
                     AND ae.action = 'reset'
                ) AS reset_audited
           FROM ai_requests ar
           JOIN ai_conversations ac
             ON ac.trip_id = ar.trip_id AND ac.id = ar.conversation_id
          WHERE ar.trip_id = $1 AND ar.actor_member_id = $2
            AND ar.id IN (
              '91000000-0000-4000-8000-000000000001',
              '91000000-0000-4000-8000-000000000002'
            )`,
        [ownerSession.tripId, ownerSession.memberId],
      );
      assert.deepEqual(retainedOwnerMemory.rows[0], {
        request_count: 2,
        closed_request_count: 2,
        reset_audited: true,
      });

      const memberPolicy = await getAiPolicy(appPool, memberSession, "gpt-6.1-terra");
      assert.equal(memberPolicy.model, "gpt-6.1-sol");
      assert.equal(memberPolicy.limit, 20);
      await updateAiSettings(appPool, ownerSession, ownerSession.tripId, { memberDailyLimit: 3 });
      const limitedMemberPolicy = await getAiPolicy(appPool, memberSession);
      assert.equal(limitedMemberPolicy.limit, 3);
      for (let index = 0; index < 2; index += 1) {
        await appPool.query(
          `INSERT INTO ai_requests (
             trip_id, id, actor_member_id, actor_role, prompt_text, requested_model, status
           ) VALUES ($1, gen_random_uuid(), $2, 'editor', $3, 'gpt-6.1-sol', 'succeeded')`,
          [memberSession.tripId, memberSession.memberId, `Synthetic prompt ${index + 1}`],
        );
      }
      const quotaRacePrompts = [
        "Write Python code to sort a linked list for quota race A",
        "Debug this JavaScript function for quota race B",
      ];
      const quotaRaceResults = await Promise.allSettled(
        quotaRacePrompts.map((prompt) =>
          runAiPlanner(appPool, memberSession, prompt, undefined, "en")),
      );
      assert.equal(quotaRaceResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(quotaRaceResults.filter((result) => result.status === "rejected").length, 1);
      const quotaRaceRejection = quotaRaceResults.find((result) => result.status === "rejected");
      assert.ok(
        quotaRaceRejection.reason instanceof AppForbiddenError
          && /daily AI limit/i.test(quotaRaceRejection.reason.message),
      );
      const quotaRaceState = await appPool.query(
        `SELECT count(DISTINCT ar.id)::integer AS request_count,
                count(ae.sequence)::integer AS event_count,
                count(DISTINCT ar.id) FILTER (
                  WHERE ar.feature = 'off_topic' AND ar.status = 'succeeded'
                )::integer AS accepted_count,
                count(DISTINCT ar.id) FILTER (
                  WHERE ar.feature = 'policy_denial' AND ar.status = 'rejected'
                    AND ar.actor_user_id = $4
                    AND ar.conversation_id IS NULL
                    AND ar.provider = 'local' AND ar.transport = 'policy_gate'
                    AND ar.authentication_mode = 'none' AND ar.billing_basis = 'none'
                    AND ar.input_tokens = 0 AND ar.output_tokens = 0
                    AND ar.cached_input_tokens = 0
                    AND ar.error_code = 'daily_limit_reached'
                )::integer AS denied_count
           FROM ai_requests ar
           LEFT JOIN ai_request_events ae
             ON ae.trip_id = ar.trip_id AND ae.ai_request_id = ar.id
          WHERE ar.trip_id = $1 AND ar.actor_member_id = $2
            AND ar.prompt_text = ANY($3::text[])`,
        [memberSession.tripId, memberSession.memberId, quotaRacePrompts, memberSession.userId],
      );
      assert.deepEqual(quotaRaceState.rows[0], {
        request_count: 2,
        event_count: 6,
        accepted_count: 1,
        denied_count: 1,
      });
      const countedMemberUsage = await appPool.query(
        `SELECT count(*)::integer AS count
           FROM ai_requests
          WHERE trip_id = $1 AND actor_member_id = $2
            AND created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            AND status <> 'rejected'`,
        [memberSession.tripId, memberSession.memberId],
      );
      assert.equal(countedMemberUsage.rows[0].count, 3);
      await assert.rejects(
        getAiPolicy(appPool, memberSession),
        (error) => error instanceof AppForbiddenError && /daily AI limit/i.test(error.message),
      );
      await updateAiSettings(appPool, ownerSession, ownerSession.tripId, { enabled: false });
      const disabledPolicyPrompt = "Plan a dinner while AI access is disabled";
      await assert.rejects(
        runAiPlanner(appPool, memberSession, disabledPolicyPrompt, undefined, "en"),
        (error) => error instanceof AppForbiddenError && /AI is disabled/i.test(error.message),
      );
      const disabledPolicyState = await appPool.query(
        `SELECT count(DISTINCT ar.id)::integer AS request_count,
                count(ae.sequence)::integer AS event_count,
                bool_and(ar.feature = 'policy_denial' AND ar.status = 'rejected') AS rejected,
                bool_and(ar.actor_user_id = $3 AND ar.conversation_id IS NULL) AS exact_identity,
                bool_and(ar.error_code = 'ai_disabled') AS disabled_reason
           FROM ai_requests ar
           LEFT JOIN ai_request_events ae
             ON ae.trip_id = ar.trip_id AND ae.ai_request_id = ar.id
          WHERE ar.trip_id = $1 AND ar.actor_member_id = $2
            AND ar.prompt_text = $4`,
        [memberSession.tripId, memberSession.memberId, memberSession.userId, disabledPolicyPrompt],
      );
      assert.deepEqual(disabledPolicyState.rows[0], {
        request_count: 1,
        event_count: 3,
        rejected: true,
        exact_identity: true,
        disabled_reason: true,
      });
      assert.equal((await appPool.query(
        `SELECT count(*)::integer AS count
           FROM ai_requests
          WHERE trip_id = $1 AND actor_member_id = $2 AND status <> 'rejected'`,
        [memberSession.tripId, memberSession.memberId],
      )).rows[0].count, 3);
      await updateAiSettings(appPool, ownerSession, ownerSession.tripId, { enabled: true });
      for (let index = 0; index < 4; index += 1) {
        await appPool.query(
          `INSERT INTO ai_requests (
             trip_id, id, actor_member_id, actor_role, feature,
             prompt_text, requested_model, status
           ) VALUES (
             $1, gen_random_uuid(), $2, 'owner', 'quota_owner_test',
             $3, 'claude-haiku-5-5', 'succeeded'
           )`,
          [ownerSession.tripId, ownerSession.memberId, `Unlimited owner prompt ${index + 1}`],
        );
      }
      const ownerPolicy = await getAiPolicy(appPool, ownerSession, "claude-haiku-5-5");
      assert.equal(ownerPolicy.model, "claude-haiku-5-5");
      assert.equal(ownerPolicy.limit, null);
      assert.ok(ownerPolicy.usedToday > 3);

      await updateTripMember(appPool, memberSession, memberSession.tripId, memberSession.memberId, {
        displayName: "Renamed Sample Member",
      });
      await assert.rejects(
        updateTripMember(appPool, memberSession, memberSession.tripId, ownerSession.memberId, {
          displayName: "Unauthorized owner rename",
        }),
        (error) => error instanceof AppForbiddenError && /only change their own name/i.test(error.message),
      );
      const renamedMember = await appPool.query(
        `SELECT display_name FROM trip_members WHERE trip_id = $1 AND id = $2`,
        [memberSession.tripId, memberSession.memberId],
      );
      assert.equal(renamedMember.rows[0].display_name, "Renamed Sample Member");

      const addedMember = await createTripMember(appPool, ownerSession, ownerSession.tripId, {
        displayName: "Inactive Invitee",
      });
      let addedMemberState = await appPool.query(
        `SELECT status, user_id FROM trip_members WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, addedMember.id],
      );
      assert.deepEqual(addedMemberState.rows[0], { status: "invited", user_id: null });
      const overviewBeforeRemoval = await getAppOverview(appPool, ownerSession);
      assert.equal(overviewBeforeRemoval.members.find((member) => member.id === addedMember.id)?.canRemove, true);
      const inviteBeforeDisable = await issueClaim(appPool, authConfig, {
        tripId: ownerSession.tripId,
        memberId: addedMember.id,
        actorMemberId: ownerSession.memberId,
      });
      assert.ok(await previewClaim(appPool, authConfig, inviteBeforeDisable.rawToken));
      await updateTripMember(appPool, ownerSession, ownerSession.tripId, addedMember.id, { disabled: true });
      assert.equal(await previewClaim(appPool, authConfig, inviteBeforeDisable.rawToken), null);
      const claimsAfterDisable = await appPool.query(
        `SELECT count(*)::integer AS count
           FROM member_claim_links
          WHERE trip_id = $1 AND member_id = $2
            AND consumed_at IS NULL AND revoked_at IS NULL`,
        [ownerSession.tripId, addedMember.id],
      );
      assert.equal(claimsAfterDisable.rows[0].count, 0);
      await updateTripMember(appPool, ownerSession, ownerSession.tripId, addedMember.id, { disabled: false });
      addedMemberState = await appPool.query(
        `SELECT status, user_id FROM trip_members WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, addedMember.id],
      );
      assert.deepEqual(addedMemberState.rows[0], { status: "invited", user_id: null });
      const reenabledClaim = await issueClaim(appPool, authConfig, {
        tripId: ownerSession.tripId,
        memberId: addedMember.id,
        actorMemberId: ownerSession.memberId,
      });
      const reenabledGrant = await consumeClaim(appPool, authConfig, {
        rawToken: reenabledClaim.rawToken,
        identity: {
          issuer: "https://accounts.google.com",
          subject: "calendar-unbind-test-subject",
          emailHint: "calendar-member@example.test",
          displayNameHint: "Calendar member",
        },
        userAgent: "Calendar identity lifecycle test",
      });
      await appPool.query(
        `INSERT INTO calendar_connections (
           trip_id, member_id, refresh_token_encrypted, scopes
         ) VALUES ($1, $2, 'synthetic-encrypted-refresh', ARRAY['https://www.googleapis.com/auth/calendar.events'])`,
        [ownerSession.tripId, addedMember.id],
      );
      await appPool.query(
        `INSERT INTO calendar_event_links (
           trip_id, itinerary_item_id, member_id, provider_event_id,
           last_synced_item_revision
         ) VALUES ($1, '40000000-0000-4000-8000-000000000001', $2, 'calendar-unbind-provider-event', 1)`,
        [ownerSession.tripId, addedMember.id],
      );
      const identityChangeSession = await verifySession(appPool, authConfig, reenabledGrant.rawToken);
      assert.ok(identityChangeSession);
      const identityConversation = await prepareConversation(appPool, identityChangeSession);
      assert.ok(identityConversation.conversationId);
      await unbindMemberIdentity(appPool, {
        tripId: ownerSession.tripId,
        memberId: addedMember.id,
        actorMemberId: ownerSession.memberId,
      });
      assert.equal(await verifySession(appPool, authConfig, reenabledGrant.rawToken), null);
      const unboundCalendarState = await appPool.query(
        `SELECT tm.status, tm.user_id,
                EXISTS (
                  SELECT 1 FROM calendar_connections cc
                   WHERE cc.trip_id = tm.trip_id AND cc.member_id = tm.id
                ) AS has_connection,
                EXISTS (
                  SELECT 1 FROM calendar_event_links cel
                   WHERE cel.trip_id = tm.trip_id AND cel.member_id = tm.id
                ) AS has_event_links,
                EXISTS (
                  SELECT 1 FROM audit_events ae
                   WHERE ae.trip_id = tm.trip_id AND ae.entity_id = tm.id
                     AND ae.entity_type = 'calendar_connection'
                     AND ae.action = 'calendar_disconnected'
                ) AS disconnect_audited,
                EXISTS (
                  SELECT 1 FROM ai_conversations ac
                   WHERE ac.trip_id = tm.trip_id AND ac.actor_member_id = tm.id
                     AND ac.closed_at IS NULL
                ) AS has_active_ai_conversation,
                EXISTS (
                  SELECT 1 FROM audit_events ae
                   WHERE ae.trip_id = tm.trip_id
                     AND ae.entity_id = $3
                     AND ae.entity_type = 'ai_conversation'
                     AND ae.action = 'closed'
                     AND ae.metadata->>'cause' = 'identity_unbound'
                ) AS ai_conversation_close_audited
           FROM trip_members tm WHERE tm.trip_id = $1 AND tm.id = $2`,
        [ownerSession.tripId, addedMember.id, identityConversation.conversationId],
      );
      assert.deepEqual(unboundCalendarState.rows[0], {
        status: "invited",
        user_id: null,
        has_connection: false,
        has_event_links: false,
        disconnect_audited: true,
        has_active_ai_conversation: false,
        ai_conversation_close_audited: true,
      });
      const replacementClaim = await issueClaim(appPool, authConfig, {
        tripId: ownerSession.tripId,
        memberId: addedMember.id,
        actorMemberId: ownerSession.memberId,
      });
      const replacementGrant = await consumeClaim(appPool, authConfig, {
        rawToken: replacementClaim.rawToken,
        identity: {
          issuer: "https://accounts.google.com",
          subject: "replacement-memory-test-subject",
          emailHint: "replacement-memory@example.test",
          displayNameHint: "Replacement identity",
        },
        userAgent: "Replacement identity memory isolation test",
      });
      const replacementSession = await verifySession(appPool, authConfig, replacementGrant.rawToken);
      assert.ok(replacementSession);
      assert.notEqual(replacementSession.userId, identityChangeSession.userId);
      await retireSyntheticMemberBefore0037(appPool, ownerSession, ownerSession.tripId, addedMember.id);
      const removedMember = await appPool.query(
        `SELECT status,
                EXISTS (
                  SELECT 1 FROM audit_events
                   WHERE trip_id = $1 AND entity_id = $2
                     AND entity_type = 'trip_member' AND action = 'removed'
                ) AS audited
           FROM trip_members WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, addedMember.id],
      );
      assert.deepEqual(removedMember.rows[0], { status: "removed", audited: true });
      const overviewAfterRemoval = await getAppOverview(appPool, ownerSession);
      assert.ok(!overviewAfterRemoval.members.some((member) => member.id === addedMember.id));
      await assert.rejects(
        removeTripMember(appPool, ownerSession, ownerSession.tripId, memberSession.memberId),
        (error) => error instanceof AppInvalidInputError && /explicitly confirm/i.test(error.message),
      );

      await appPool.query(
        `INSERT INTO change_requests (
           trip_id, id, requested_by_member_id, source, entity_type, entity_id,
           operation, base_revision, proposed_patch, reason, status,
           reviewed_by_member_id, review_note, applied_revision, reviewed_at
         )
         SELECT $1::uuid, gen_random_uuid(), $2::uuid, 'member', 'expense', NULL,
                'create', NULL,
                jsonb_build_object(
                  'description', format('Historical expense %s', sequence),
                  'amountMinor', sequence,
                  'currency', 'JPY',
                  'payerMemberId', ($2::uuid)::text,
                  'splitMemberIds', jsonb_build_array(($2::uuid)::text),
                  'occurredAt', '2030-04-01T00:00:00.000Z'
                ),
                format('Approval history cap regression %s', sequence),
                CASE WHEN sequence % 2 = 0 THEN 'approved' ELSE 'rejected' END,
                $3::uuid,
                format('Historical review %s', sequence),
                CASE WHEN sequence % 2 = 0 THEN 1 ELSE NULL END,
                CURRENT_TIMESTAMP - make_interval(secs => sequence)
           FROM generate_series(1, 105) AS sequence`,
        [ownerSession.tripId, memberSession.memberId, ownerSession.memberId],
      );
      const completeApprovalHistory = await readAllApprovalHistory(appPool, ownerSession);
      assert.equal(
        completeApprovalHistory.filter(
          (request) => request.reason.startsWith("Approval history cap regression "),
        ).length,
        105,
      );
      await appPool.query(
        `INSERT INTO change_requests (
           trip_id, id, requested_by_member_id, source, entity_type, entity_id,
           operation, base_revision, proposed_patch, reason, status,
           reviewed_by_member_id, review_note, reviewed_at, created_at
         )
         SELECT $1::uuid, gen_random_uuid(), $2::uuid, 'member', 'expense', NULL,
                'create', NULL,
                jsonb_build_object(
                  'description', format('Microsecond expense %s', sequence),
                  'amountMinor', sequence,
                  'currency', 'JPY',
                  'payerMemberId', ($2::uuid)::text,
                  'splitMemberIds', jsonb_build_array(($2::uuid)::text),
                  'occurredAt', '2030-04-01T00:00:00.000Z'
                ),
                format('Approval microsecond boundary %s', sequence),
                'rejected', $3::uuid, 'Microsecond cursor regression',
                TIMESTAMPTZ '2099-01-01T00:00:01Z',
                TIMESTAMPTZ '2099-01-01T00:00:00Z' + sequence * INTERVAL '1 microsecond'
           FROM generate_series(1, 26) AS sequence`,
        [ownerSession.tripId, memberSession.memberId, ownerSession.memberId],
      );
      // This upgrade stage predates invalidation columns. Active pending requests
      // may precede even these 2099 rows, so traverse the real priority keyset.
      // Twenty-six sub-millisecond timestamps necessarily cross a 25-row boundary.
      const microsecondHistory = (await readAllApprovalHistory(appPool, ownerSession)).filter(
        (request) => request.reason.startsWith("Approval microsecond boundary "),
      );
      assert.equal(microsecondHistory.length, 26);
      assert.equal(new Set(microsecondHistory.map((request) => request.id)).size, 26);
      assert.deepEqual(microsecondHistory.map((request) => request.reason), Array.from(
        { length: 26 }, (_, index) => `Approval microsecond boundary ${26 - index}`,
      ));
      await assert.rejects(
        getApprovalHistory(appPool, memberSession, memberSession.tripId),
        (error) => error instanceof AppForbiddenError && /only the owner/i.test(error.message),
      );
      assert.deepEqual(await migrate({
        connectionString, through: "0033_ai_request_recovery.sql",
      }), ["0033_ai_request_recovery.sql"]);
      assert.deepEqual(await migrate({
        connectionString, through: "0033_ai_request_recovery.sql",
      }), []);
      const recoveryMetadataCount = await appPool.query(
        `SELECT count(*)::integer AS total,
                count(*) FILTER (WHERE client_request_id IS NOT NULL
                  OR request_payload_hash IS NOT NULL OR response_json IS NOT NULL)::integer AS enriched
           FROM ai_requests`,
      );
      assert.ok(recoveryMetadataCount.rows[0].total > 0);
      assert.equal(recoveryMetadataCount.rows[0].enriched, 0,
        "legacy requests must not gain inferred recovery metadata");

      let recoveryFixtureSequence = 1;
      const sharedClientRequestId = "9f000000-0000-4000-8000-000000000001";
      const insertRecoveryFixture = async (overrides = {}) => {
        const requestId = `9e000000-0000-4000-8000-${String(recoveryFixtureSequence++).padStart(12, "0")}`;
        const values = {
          tripId: ownerSession.tripId,
          memberId: ownerSession.memberId,
          userId: ownerSession.userId,
          role: "owner",
          initiator: "member",
          clientId: requestId,
          hash: "a".repeat(64),
          response: null,
          status: "started",
          completedAt: null,
          ...overrides,
        };
        await appPool.query(
          `INSERT INTO ai_requests (
             trip_id,id,actor_member_id,actor_user_id,actor_role,initiator_kind,
             prompt_text,requested_model,client_request_id,request_payload_hash,
             response_json,status,completed_at,created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,'Synthetic recovery fixture','gpt-6.1-sol',
                     $7,$8,$9::jsonb,$10,$11,CURRENT_TIMESTAMP - interval '1 minute')`,
          [values.tripId,requestId,values.memberId,values.userId,values.role,values.initiator,
            values.clientId,values.hash,
            values.response === null ? null : JSON.stringify(values.response),
            values.status,values.completedAt],
        );
        return requestId;
      };
      for (const invalidPair of [
        { clientId: sharedClientRequestId, hash: null },
        { clientId: null, hash: "a".repeat(64) },
      ]) {
        await assert.rejects(insertRecoveryFixture(invalidPair), (error) => (
          error?.code === "23514" && error?.constraint === "ai_requests_client_request_pair_ck"
        ));
      }
      for (const hash of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
        await assert.rejects(insertRecoveryFixture({ hash }), (error) => (
          error?.code === "23514" && error?.constraint === "ai_requests_request_payload_hash_ck"
        ));
      }
      await assert.rejects(insertRecoveryFixture({ userId: null }), (error) => (
        error?.code === "23514" && error?.constraint === "ai_requests_client_request_actor_ck"
      ));
      await assert.rejects(insertRecoveryFixture({
        memberId: null, userId: null, role: "system", initiator: "system",
      }), (error) => (
        error?.code === "23514" && error?.constraint === "ai_requests_client_request_actor_ck"
      ));
      await insertRecoveryFixture({ clientId: sharedClientRequestId });
      await assert.rejects(insertRecoveryFixture({ clientId: sharedClientRequestId }), (error) => (
        error?.code === "23505" && error?.constraint === "ai_requests_client_request_identity_uq"
      ));
      await insertRecoveryFixture({
        clientId: sharedClientRequestId,
        memberId: memberSession.memberId,
        userId: memberSession.userId,
        role: "editor",
      });
      await insertRecoveryFixture();
      const startedForSameActor = await appPool.query(
        `SELECT count(*)::integer AS count FROM ai_requests
          WHERE trip_id = $1 AND actor_user_id = $2
            AND status = 'started' AND client_request_id IS NOT NULL`,
        [ownerSession.tripId, ownerSession.userId],
      );
      assert.equal(startedForSameActor.rows[0].count, 2,
        "admission serialization must not become a permanent unique-started-row lock");
      for (const invalidResponse of [
        { response: [] },
        { response: "not an envelope" },
        { response: { message: "x".repeat(131072) } },
        { response: {}, status: "started", completedAt: null },
        { response: {}, status: "failed" },
        { response: {}, status: "rejected" },
        { response: {}, completedAt: null },
        { response: {}, clientId: null, hash: null, userId: null },
        { response: {}, clientId: null, hash: null, memberId: null,
          userId: null, role: "system", initiator: "system" },
      ]) {
        await assert.rejects(insertRecoveryFixture({
          status: "succeeded", completedAt: new Date(), ...invalidResponse,
        }), (error) => (
          error?.code === "23514" && error?.constraint === "ai_requests_response_json_ck"
        ));
      }
      const recoveryReceipt = { message: "Safe synthetic successful response." };
      const succeededRecoveryId = await insertRecoveryFixture({
        response: recoveryReceipt, status: "succeeded", completedAt: new Date(),
      });
      assert.deepEqual((await appPool.query(
        `SELECT response_json FROM ai_requests WHERE trip_id = $1 AND id = $2`,
        [ownerSession.tripId, succeededRecoveryId],
      )).rows[0].response_json, recoveryReceipt);

      const { readAiRequestRecovery } = await import("../../src/lib/ai/request-recovery.ts");
      const recoveryTripId = "e5100000-0000-4000-8000-000000000001";
      const recoveryOtherTripId = "e5100000-0000-4000-8000-000000000002";
      const recoveryOwner = {
        ...ownerSession, tripId: recoveryTripId,
        memberId: "e5200000-0000-4000-8000-000000000001",
        userId: "e5000000-0000-4000-8000-000000000001",
      };
      const recoveryMember = {
        ...memberSession, tripId: recoveryTripId,
        memberId: "e5200000-0000-4000-8000-000000000002",
        userId: "e5000000-0000-4000-8000-000000000002",
      };
      const recoveryOtherTripOwner = {
        ...recoveryOwner, tripId: recoveryOtherTripId,
        memberId: "e5200000-0000-4000-8000-000000000003",
      };
      const recoveryConversationId = "e5300000-0000-4000-8000-000000000001";
      const recoveryMemberConversationId = "e5300000-0000-4000-8000-000000000002";
      const recoveryOtherConversationId = "e5300000-0000-4000-8000-000000000003";
      await appPool.query(
        `INSERT INTO app_users (id,display_name) VALUES
           ($1,'Synthetic recovery owner'),($2,'Synthetic recovery member'),
           ('e5000000-0000-4000-8000-000000000003','Synthetic replacement identity')`,
        [recoveryOwner.userId,recoveryMember.userId],
      );
      await appPool.query(
        `INSERT INTO trips (id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
         VALUES ($1,$3,'Synthetic recovery trip','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE + 3),
                ($2,$3,'Synthetic other recovery trip','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE + 3)`,
        [recoveryTripId,recoveryOtherTripId,recoveryOwner.userId],
      );
      await appPool.query(
        `INSERT INTO trip_members (trip_id,id,user_id,display_name,role,status)
         VALUES ($1,$3,$6,'Synthetic recovery owner','owner','active'),
                ($1,$4,$7,'Synthetic recovery member','editor','active'),
                ($2,$5,$6,'Synthetic other-trip owner','owner','active')`,
        [recoveryTripId,recoveryOtherTripId,recoveryOwner.memberId,recoveryMember.memberId,
          recoveryOtherTripOwner.memberId,recoveryOwner.userId,recoveryMember.userId],
      );
      const admissionOwnerClient = await appPool.connect();
      const admissionPeerClient = await appPool.connect();
      try {
        await admissionOwnerClient.query("BEGIN");
        await admissionPeerClient.query("BEGIN");
        await lockBoundUserAi(admissionOwnerClient, recoveryOwner.userId);
        const sameUserAdmission = await admissionPeerClient.query(
          `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired`,
          [JSON.stringify([recoveryOtherTripOwner.userId, "ai-bound-user"])],
        );
        assert.equal(sameUserAdmission.rows[0].acquired, false,
          "the same bound user must serialize AI admission even across trips");
        const differentUserAdmission = await admissionPeerClient.query(
          `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired`,
          [JSON.stringify([recoveryMember.userId, "ai-bound-user"])],
        );
        assert.equal(differentUserAdmission.rows[0].acquired, true,
          "another bound user must not wait for the owner's AI admission lock");
      } finally {
        await Promise.all([
          admissionOwnerClient.query("ROLLBACK"),
          admissionPeerClient.query("ROLLBACK"),
        ]).finally(() => {
          admissionOwnerClient.release();
          admissionPeerClient.release();
        });
      }
      await appPool.query(
        `INSERT INTO ai_conversations (trip_id,id,actor_member_id,actor_user_id)
         VALUES ($1,$3,$6,$9),($1,$4,$7,$10),($2,$5,$8,$9)`,
        [recoveryTripId,recoveryOtherTripId,recoveryConversationId,recoveryMemberConversationId,
          recoveryOtherConversationId,recoveryOwner.memberId,recoveryMember.memberId,
          recoveryOtherTripOwner.memberId,recoveryOwner.userId,recoveryMember.userId],
      );
      const recoveryClientId = "e5500000-0000-4000-8000-000000000001";
      const recoveryRequestId = "e5400000-0000-4000-8000-000000000001";
      const fullRecoveryReceipt = {
        requestId: recoveryRequestId,
        message: "A safe response restored after mobile suspension.",
        proposalIds: [], proposalCount: 0, proposalId: null, changeStatus: null, entityId: null,
        model: "gpt-6.1-sol", usedToday: 1, remainingToday: null,
        webSearch: { performed: false, queryCount: 0, sources: [] },
        memory: { previousTurnsUsed: 0, tokenEstimate: 0, tokenBudget: 6000,
          checkpointVersion: null, truncated: false },
      };
      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
           prompt_text,result_text,requested_model,status,client_request_id,
           request_payload_hash,response_json,error_message,created_at,completed_at
         ) VALUES ($1,$2,$3,$4,$5,'owner','PRIVATE PROMPT NEVER TRANSMIT',$6,
                   'gpt-6.1-sol','succeeded',$7,$8,$9::jsonb,'INTERNAL ERROR NEVER TRANSMIT',
                   CURRENT_TIMESTAMP - interval '1 minute',CURRENT_TIMESTAMP)`,
        [recoveryTripId,recoveryRequestId,recoveryOwner.memberId,recoveryOwner.userId,
          recoveryConversationId,fullRecoveryReceipt.message,recoveryClientId,"a".repeat(64),
          JSON.stringify({ ...fullRecoveryReceipt,
            memory: { ...fullRecoveryReceipt.memory, personalMemoriesUsed: 0 } })],
      );
      const recoveredSelf = await readAiRequestRecovery(
        appPool,recoveryOwner,recoveryTripId,recoveryClientId,
      );
      assert.equal(recoveredSelf.busyElsewhere,false);
      assert.equal(recoveredSelf.request.requestId,recoveryRequestId);
      assert.equal(recoveredSelf.request.status,"succeeded");
      assert.deepEqual(recoveredSelf.request.result,fullRecoveryReceipt);
      assert.equal(recoveredSelf.request.errorCode,null);
      assert.doesNotMatch(JSON.stringify(recoveredSelf), /PRIVATE PROMPT|INTERNAL ERROR/u);
      assert.deepEqual(await readAiRequestRecovery(
        appPool,recoveryMember,recoveryTripId,recoveryClientId,
      ), { request: null, busyElsewhere: false, activeConversationId: recoveryMemberConversationId });
      assert.deepEqual(await readAiRequestRecovery(
        appPool,recoveryOtherTripOwner,recoveryOtherTripId,recoveryClientId,
      ), { request: null, busyElsewhere: false, activeConversationId: recoveryOtherConversationId });
      await assert.rejects(readAiRequestRecovery(appPool,recoveryOwner,recoveryOtherTripId),
        (error) => error instanceof AppForbiddenError);
      const memberRecoveryRequestId = "e5400000-0000-4000-8000-000000000004";
      const memberRecoveryReceipt = {
        ...fullRecoveryReceipt,requestId:memberRecoveryRequestId,
        message:"Only this member's own response.",remainingToday:19,
      };
      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
           prompt_text,result_text,requested_model,status,client_request_id,
           request_payload_hash,response_json,created_at,completed_at
         ) VALUES ($1,$2,$3,$4,$5,'editor','PRIVATE MEMBER PROMPT',$6,
                   'gpt-6.1-sol','succeeded',$7,$8,$9::jsonb,
                   CURRENT_TIMESTAMP - interval '1 minute',CURRENT_TIMESTAMP)`,
        [recoveryTripId,memberRecoveryRequestId,recoveryMember.memberId,recoveryMember.userId,
          recoveryMemberConversationId,memberRecoveryReceipt.message,recoveryClientId,
          "c".repeat(64),JSON.stringify(memberRecoveryReceipt)],
      );
      assert.deepEqual((await readAiRequestRecovery(
        appPool,recoveryMember,recoveryTripId,recoveryClientId,
      )).request.result,memberRecoveryReceipt);
      assert.deepEqual((await readAiRequestRecovery(
        appPool,recoveryOwner,recoveryTripId,recoveryClientId,
      )).request.result,fullRecoveryReceipt,
      "even an owner can recover only their own request when client UUIDs coincide");

      // Cross-trip activity exposes only a busy boolean, never that trip's request.
      const otherRecoveryRequestId = "e5400000-0000-4000-8000-000000000002";
      await appPool.query(
        `INSERT INTO ai_requests (
           trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
           prompt_text,requested_model,status,client_request_id,request_payload_hash
         ) VALUES ($1,$2,$3,$4,$5,'owner','Other private trip prompt',
                   'gpt-6.1-sol','started',$6,$7)`,
        [recoveryOtherTripId,otherRecoveryRequestId,recoveryOtherTripOwner.memberId,
          recoveryOwner.userId,recoveryOtherConversationId,
          "e5500000-0000-4000-8000-000000000002","b".repeat(64)],
      );
      const busyElsewhere = await readAiRequestRecovery(appPool,recoveryOwner,recoveryTripId);
      assert.equal(busyElsewhere.busyElsewhere,true);
      assert.equal(busyElsewhere.request.requestId,recoveryRequestId);
      assert.doesNotMatch(JSON.stringify(busyElsewhere), new RegExp(`${otherRecoveryRequestId}|Other private trip`));
      await appPool.query(
        `UPDATE ai_requests SET created_at = CURRENT_TIMESTAMP - interval '11 minutes'
          WHERE trip_id = $1 AND id = $2`,
        [recoveryOtherTripId,otherRecoveryRequestId],
      );
      const interrupted = await readAiRequestRecovery(appPool,recoveryOtherTripOwner,recoveryOtherTripId);
      assert.equal(interrupted.request.status,"interrupted");
      assert.equal(interrupted.request.errorCode,"AI_REQUEST_INTERRUPTED");
      assert.equal(interrupted.request.result,null);
      assert.equal(interrupted.request.message,null);
      assert.equal((await readAiRequestRecovery(appPool,recoveryOwner,recoveryTripId)).busyElsewhere,false);
      await appPool.query(
        `UPDATE ai_requests SET status = 'failed',completed_at = CURRENT_TIMESTAMP,
                error_code = 'PRIVATE_PROVIDER_DIAGNOSTIC',error_message = 'PRIVATE PROVIDER ERROR',
                result_text = 'PRIVATE FAILED PROVIDER OUTPUT'
          WHERE trip_id = $1 AND id = $2`,
        [recoveryOtherTripId,otherRecoveryRequestId],
      );
      const failedRecovery = await readAiRequestRecovery(appPool,recoveryOtherTripOwner,recoveryOtherTripId);
      assert.equal(failedRecovery.request.status,"failed");
      assert.equal(failedRecovery.request.errorCode,"AI_REQUEST_FAILED");
      assert.equal(failedRecovery.request.result,null);
      assert.equal(failedRecovery.request.message,null);
      assert.doesNotMatch(JSON.stringify(failedRecovery), /PRIVATE_PROVIDER|PRIVATE PROVIDER|PRIVATE FAILED/u);

      // A conversation reset and a replacement binding independently stop old recovery.
      const recoveryResetConversation = await resetAiConversation(appPool,recoveryOwner,recoveryTripId);
      assert.deepEqual(await readAiRequestRecovery(
        appPool,recoveryOwner,recoveryTripId,recoveryClientId,
      ), { request: null, busyElsewhere: false, activeConversationId: recoveryResetConversation.conversationId });
      await appPool.query(
        `UPDATE trip_members SET status = 'revoked' WHERE trip_id = $1 AND id = $2`,
        [recoveryTripId,recoveryMember.memberId],
      );
      await assert.rejects(readAiRequestRecovery(appPool,recoveryMember,recoveryTripId),
        (error) => error instanceof AppForbiddenError);
      await appPool.query(
        `UPDATE trip_members SET status = 'active',user_id = 'e5000000-0000-4000-8000-000000000003'
          WHERE trip_id = $1 AND id = $2`,
        [recoveryTripId,recoveryMember.memberId],
      );
      await assert.rejects(readAiRequestRecovery(appPool,recoveryMember,recoveryTripId),
        (error) => error instanceof AppForbiddenError);
      assert.deepEqual(await readAiRequestRecovery(appPool,{
        ...recoveryMember,userId:"e5000000-0000-4000-8000-000000000003",
      },recoveryTripId,recoveryClientId), { request: null,busyElsewhere:false,activeConversationId:null });

      await testAiConversationHistory(appPool,connectionString,ownerSession);
      await testAiImageInputs(appPool,connectionString,ownerSession);
      await testAccountOnboarding(appPool,connectionString,ownerSession);
      await testMemberRemoval(appPool,connectionString,ownerSession);
      await testAiPendingItinerary(appPool,connectionString,ownerSession);
      await testLinkedEventExpense(appPool,connectionString,ownerSession);
      await testIndividualEventExpenses(appPool,ownerSession);
      await testCancelledEventRemoval(appPool,ownerSession);
      await testDisruptionQualification(appPool,ownerSession);
      await testMemberPaymentsAndRemoval(appPool,ownerSession);
      await testCustomExpenseSplits(appPool,connectionString,ownerSession);
      await testApprovalPriority(appPool,connectionString,ownerSession);
      await testProviderFailureRecovery(appPool,ownerSession);
      await testCalendarImports(appPool,connectionString,ownerSession);
      await testCompletedTripAccess(appPool,connectionString);
      await testTripDateSettings(appPool,connectionString,ownerSession);
      assert.deepEqual(await migrate({ connectionString, through: "0043_preference_conversations.sql" }), ["0043_preference_conversations.sql"]);
      await testActivityPrivacy(appPool,ownerSession);
      await testFeedbackTriage(appPool,connectionString,ownerSession);
      await testFeedbackWorker(appPool,connectionString);
      await testCustomAiInstructions(appPool,connectionString,ownerSession);
      await testTripDestinationLookups(appPool,connectionString);
      await testTripDeletion(appPool,connectionString);
      await testAiCredentials(appPool,connectionString);
      await testAiKeySharing(appPool,connectionString);
      await testGuestAccounts(appPool,connectionString);

    } finally {
      await appPool.end();
    }
  },
);
