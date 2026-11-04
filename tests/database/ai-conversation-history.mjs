import assert from "node:assert/strict";

import { migrate } from "../../scripts/db/migration-lib.mjs";
import {
  AppConflictError, AppForbiddenError, AppInvalidInputError, AppNotFoundError,
} from "../../src/lib/app/repository.ts";
import {
  AiConversationChangedError, closeMemberAiConversationForIdentityChange,
  createConversationCheckpoint, prepareAiConversation, resetAiConversation,
  selectAiConversationForSubmission,
} from "../../src/lib/ai/conversation.ts";
import { assertAiRequestWritable } from "../../src/lib/ai/request-recovery.ts";
import { loadPlanningDraft } from "../../src/lib/ai/planning-draft.ts";

const tripId = "e6100000-0000-4000-8000-000000000001";
const otherTripId = "e6100000-0000-4000-8000-000000000002";
const userId = (number) => `e6000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const memberId = (number) => `e6200000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const conversationId = (number) => `e6300000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const requestId = (number) => `e6400000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const auditId = (number) => `e6500000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const timestamp = (day) => `2020-01-${String(day).padStart(2, "0")}T00:00:00.000000Z`;

async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const privateAccessError = (error) => error instanceof AppForbiddenError
  || error instanceof AppNotFoundError || error instanceof AppInvalidInputError;

/** Called only by the guarded disposable-database migration suite. */
export async function testAiConversationHistory(pool, connectionString, baseSession) {
  const owner = { ...baseSession, tripId, memberId: memberId(1), userId: userId(1), role: "owner" };
  const member = { ...owner, memberId: memberId(2), userId: userId(2), role: "editor" };
  const otherTripOwner = { ...owner, tripId: otherTripId, memberId: memberId(8) };
  await pool.query(
    `INSERT INTO app_users (id,display_name)
     SELECT value::uuid,'Synthetic history identity ' || ordinal
       FROM unnest($1::text[]) WITH ORDINALITY fixture(value,ordinal)`,
    [Array.from({ length: 10 }, (_, index) => userId(index + 1))],
  );
  await pool.query(
    `INSERT INTO trips (id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
     VALUES ($1,$3,'Synthetic private history','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE + 3),
            ($2,$3,'Synthetic other history trip','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE + 3)`,
    [tripId,otherTripId,owner.userId],
  );
  for (const number of [1,2,3,4,5,7,9]) {
    await pool.query(
      `INSERT INTO trip_members (trip_id,id,user_id,display_name,role,status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [tripId,memberId(number),userId(number === 5 ? 6 : number),
        `Synthetic history member ${number}`,number === 1 ? "owner" : "editor"],
    );
  }
  await pool.query(
    `INSERT INTO trip_members (trip_id,id,user_id,display_name,role,status)
     VALUES ($1,$2,$3,'Synthetic other-trip owner','owner','active')`,
    [otherTripId,otherTripOwner.memberId,owner.userId],
  );

  // Legacy fixtures include ordinary archives, uncertain history and identity
  // changes with and without an active conversation at disconnect time.
  for (const [number,actor,createdDay,closedDay,actorUser] of [
    [1,1,1,2], [2,1,1,2], [3,3,1,2], [4,3,2,3], [5,3,4,null],
    [6,1,2,3], [7,1,4,null], [8,4,1,2], [9,5,1,2],
    [10,7,2,3], [11,7,1,2],
    [12,9,1,2,10], [13,9,2,3,10], [14,9,3,null,9], [15,4,3,null],
  ]) {
    await pool.query(
      `INSERT INTO ai_conversations (
         trip_id,id,actor_member_id,actor_user_id,created_at,last_used_at,closed_at
       ) VALUES ($1,$2,$3,$4,$5,$5,$6)`,
      [tripId,conversationId(number),memberId(actor),userId(actorUser ?? actor),timestamp(createdDay),
        closedDay === null ? null : timestamp(closedDay)],
    );
  }
  for (const [number,day,action,cause] of [
    [1,2,"reset","user_reset"], [3,2,"reset","user_reset"],
    [4,3,"closed","identity_unbound"], [6,3,"closed","user_switch"],
    [8,2,"reset","user_reset"], [9,2,"reset","user_reset"],
    [10,3,"closed","identity_mismatch"], [11,2,"reset","user_reset"],
    [12,2,"reset","user_reset"], [13,3,"closed","identity_mismatch"],
    [14,3,"created","identity_mismatch"],
  ]) {
    await pool.query(
      `INSERT INTO audit_events (trip_id,id,entity_type,entity_id,action,metadata,created_at)
       VALUES ($1,$2,'ai_conversation',$3,$4,$5::jsonb,$6)`,
      [tripId,auditId(number),conversationId(number),action,JSON.stringify({ cause }),timestamp(day)],
    );
  }
  await pool.query(
    `INSERT INTO audit_events (trip_id,id,entity_type,entity_id,action,created_at)
     VALUES ($1,$2,'trip_member',$3,'identity_unbound',$4)`,
    [tripId,auditId(20),memberId(4),timestamp(3)],
  );

  assert.deepEqual(await migrate({ connectionString, through:"0034_ai_conversation_history.sql" }), ["0034_ai_conversation_history.sql"]);
  assert.deepEqual(await migrate({ connectionString, through:"0034_ai_conversation_history.sql" }), []);
  const legacy = (await pool.query(
    `SELECT id,closed_reason,history_revoked_at IS NOT NULL AS revoked,
            closed_at IS NULL AS active
       FROM ai_conversations WHERE trip_id = $1 ORDER BY id`,
    [tripId],
  )).rows;
  assert.deepEqual(legacy, [
    { id: conversationId(1),closed_reason:"user_reset",revoked:false,active:false },
    { id: conversationId(2),closed_reason:"legacy_unknown",revoked:true,active:false },
    { id: conversationId(3),closed_reason:"user_reset",revoked:true,active:false },
    { id: conversationId(4),closed_reason:"identity_unbound",revoked:true,active:false },
    { id: conversationId(5),closed_reason:null,revoked:false,active:true },
    { id: conversationId(6),closed_reason:"user_switch",revoked:false,active:false },
    { id: conversationId(7),closed_reason:null,revoked:false,active:true },
    { id: conversationId(8),closed_reason:"user_reset",revoked:true,active:false },
    { id: conversationId(9),closed_reason:"user_reset",revoked:true,active:false },
    { id: conversationId(10),closed_reason:"identity_mismatch",revoked:true,active:false },
    { id: conversationId(11),closed_reason:"user_reset",revoked:true,active:false },
    { id: conversationId(12),closed_reason:"user_reset",revoked:true,active:false },
    { id: conversationId(13),closed_reason:"identity_mismatch",revoked:true,active:false },
    { id: conversationId(14),closed_reason:null,revoked:false,active:true },
    { id: conversationId(15),closed_reason:"identity_mismatch",revoked:true,active:false },
  ]);
  // A mismatch close and a replacement conversation share CURRENT_TIMESTAMP
  // inside one transaction; the closed row proves which user was invalidated.
  // In contrast, an equal-time member-only disconnect has no old-user evidence
  // and remains conservatively revoked rather than guessing a binding epoch.
  await assert.rejects(pool.query(
    `UPDATE ai_conversations SET history_revoked_at = NULL WHERE trip_id = $1 AND id = $2`,
    [tripId,conversationId(2)],
  ), /history revocation is permanent/u);
  await assert.rejects(pool.query(
    `UPDATE ai_conversations SET actor_user_id = $3 WHERE trip_id = $1 AND id = $2`,
    [tripId,conversationId(1),member.userId],
  ), /identity is immutable/u);
  await assert.rejects(pool.query(
    `UPDATE ai_conversations SET closed_at = NULL,closed_reason = NULL
      WHERE trip_id = $1 AND id = $2`,
    [tripId,conversationId(2)],
  ), /ai_conversations_revoked_closed_ck/u);
  await assert.rejects(pool.query(
    `UPDATE ai_conversations SET closed_reason = 'user_reset' WHERE trip_id = $1 AND id = $2`,
    [tripId,conversationId(7)],
  ), /ai_conversations_close_pair_ck/u);

  const { listAiConversations, listAiConversationMessages, resumeAiConversation } = await import(
    "../../src/lib/ai/conversation-history.ts"
  );
  const initialList = await listAiConversations(pool,owner,tripId);
  assert.deepEqual(initialList.conversations.map((item) => item.conversationId),
    [conversationId(7),conversationId(6),conversationId(1)]);
  assert.equal(initialList.activeConversationId,conversationId(7));
  assert.ok(initialList.conversations.every((item) => item.canResume || item.isActive));
  assert.deepEqual((await listAiConversations(pool,member,tripId)).conversations,[]);
  await assert.rejects(listAiConversations(pool,owner,otherTripId),privateAccessError);
  for (const forbiddenConversation of [conversationId(2),conversationId(3),conversationId(5)]) {
    await assert.rejects(listAiConversationMessages(pool,owner,tripId,forbiddenConversation),privateAccessError);
    await assert.rejects(resumeAiConversation(pool,owner,tripId,forbiddenConversation),privateAccessError);
  }

  // PostgreSQL microseconds, including tied timestamps, must survive a page
  // boundary without JS Date's millisecond precision dropping any records.
  const paginatedConversationIds = Array.from({ length: 26 }, (_, index) => conversationId(100 + index));
  for (let index = 0; index < paginatedConversationIds.length; index += 1) {
    await pool.query(
      `INSERT INTO ai_conversations (
         trip_id,id,actor_member_id,actor_user_id,created_at,last_used_at,closed_at,closed_reason
       ) VALUES ($1,$2,$3,$4,
         '2021-01-01T00:00:00Z'::timestamptz + $5 * interval '1 microsecond',
         '2021-01-01T00:00:00Z'::timestamptz + $5 * interval '1 microsecond',
         '2021-01-02T00:00:00Z','user_reset')`,
      [tripId,paginatedConversationIds[index],owner.memberId,owner.userId,Math.floor(index / 2)],
    );
  }
  const allConversations = [];
  let conversationCursor = null;
  const conversationCursors = new Set();
  do {
    const page = await listAiConversations(pool,owner,tripId,conversationCursor);
    assert.ok(page.conversations.length <= 20);
    assert.equal(page.activeConversationId,conversationId(7));
    allConversations.push(...page.conversations.map((item) => item.conversationId));
    conversationCursor = page.nextCursor;
    if (conversationCursor) {
      assert.ok(!conversationCursors.has(conversationCursor));
      conversationCursors.add(conversationCursor);
      await assert.rejects(listAiConversations(pool,member,tripId,conversationCursor),privateAccessError);
      await assert.rejects(listAiConversations(pool,otherTripOwner,otherTripId,conversationCursor),privateAccessError);
    }
  } while (conversationCursor);
  assert.deepEqual(allConversations,[...paginatedConversationIds].reverse().concat(
    [conversationId(7),conversationId(6),conversationId(1)],
  ));
  assert.equal(new Set(allConversations).size,29);
  await assert.rejects(listAiConversations(pool,owner,tripId,"not-a-cursor"),privateAccessError);

  const historyRequestIds = Array.from({ length: 26 }, (_, index) => requestId(100 + index));
  for (let index = 0; index < historyRequestIds.length; index += 1) {
    await pool.query(
      `INSERT INTO ai_requests (
         trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
         prompt_text,result_text,requested_model,status,error_message,created_at,completed_at
       ) VALUES ($1,$2,$3,$4,$5,'owner',$6,$7,'gpt-6.1-sol','succeeded',
         'INTERNAL DIAGNOSTIC NEVER RETURN',
         '2022-01-01T00:00:00Z'::timestamptz + $8 * interval '1 microsecond',
         '2022-01-01T00:01:00Z')`,
      [tripId,historyRequestIds[index],owner.memberId,owner.userId,conversationId(1),
        `Synthetic private prompt ${index}`,`Synthetic private answer ${index}`,Math.floor(index / 2)],
    );
  }
  const chronologicalMessageIds = [];
  let messageCursor = null;
  let firstMessageCursor = null;
  const messageCursors = new Set();
  do {
    const page = await listAiConversationMessages(pool,owner,tripId,conversationId(1),messageCursor);
    assert.equal(page.conversation.conversationId,conversationId(1));
    assert.ok(page.messages.length <= 20);
    assert.doesNotMatch(JSON.stringify(page),/INTERNAL DIAGNOSTIC/u);
    chronologicalMessageIds.unshift(...page.messages.map((item) => item.requestId));
    assert.ok(page.messages.every((item) => item.prompt.startsWith("Synthetic private prompt")
      && item.message.startsWith("Synthetic private answer") && item.status === "succeeded"));
    messageCursor = page.nextCursor;
    if (messageCursor) {
      firstMessageCursor ??= messageCursor;
      assert.ok(!messageCursors.has(messageCursor));
      messageCursors.add(messageCursor);
    }
  } while (messageCursor);
  assert.deepEqual(chronologicalMessageIds,historyRequestIds);
  await assert.rejects(listAiConversationMessages(pool,member,tripId,conversationId(1)),privateAccessError);
  await assert.rejects(listAiConversationMessages(pool,owner,tripId,conversationId(6),firstMessageCursor),privateAccessError);

  const expiredDraft = {
    state:"awaiting_details",rootRequestId:historyRequestIds[0],
    sourceRequestIds:[historyRequestIds[0]],expiresAt:"2022-01-02T00:00:00.000Z",
  };
  await pool.query(
    `INSERT INTO ai_request_events (trip_id,ai_request_id,sequence,event_type,payload)
     VALUES ($1,$2,1,'planning.draft',$3::jsonb)`,
    [tripId,historyRequestIds[0],JSON.stringify(expiredDraft)],
  );
  await transaction(pool,(client) => createConversationCheckpoint(client,owner,{
    conversationId:conversationId(1),through:{ requestId:historyRequestIds.at(-1),completedAt:"2022-01-01T00:01:00Z" },
    summaryText:"Synthetic retained private checkpoint",
    goals:["Synthetic earlier trip goal"],decisions:["Synthetic earlier decision"],openQuestions:[],
  }));
  const checkpointBeforeResume = (await pool.query(
    `SELECT to_jsonb(checkpoint) AS snapshot FROM ai_conversation_checkpoints checkpoint
      WHERE trip_id = $1 AND conversation_id = $2`,
    [tripId,conversationId(1)],
  )).rows;
  assert.equal(checkpointBeforeResume.length,1);
  assert.equal((await resumeAiConversation(pool,owner,tripId,conversationId(1))).conversationId,conversationId(1));
  const resumed = await transaction(pool,(client) => prepareAiConversation(client,owner));
  assert.equal(resumed.conversationId,conversationId(1));
  assert.equal(resumed.checkpoint.version,1);
  assert.equal(await transaction(pool,(client) => loadPlanningDraft(client,owner,conversationId(1))),null,
    "resuming a conversation must not renew an expired clarification draft");
  assert.deepEqual((await pool.query(
    `SELECT payload FROM ai_request_events WHERE trip_id = $1 AND ai_request_id = $2 AND sequence = 1`,
    [tripId,historyRequestIds[0]],
  )).rows[0].payload,expiredDraft);
  assert.deepEqual((await pool.query(
    `SELECT to_jsonb(checkpoint) AS snapshot FROM ai_conversation_checkpoints checkpoint
      WHERE trip_id = $1 AND conversation_id = $2`,
    [tripId,conversationId(1)],
  )).rows,checkpointBeforeResume);
  assert.deepEqual((await pool.query(
    `SELECT closed_reason,history_revoked_at FROM ai_conversations WHERE trip_id = $1 AND id = $2`,
    [tripId,conversationId(7)],
  )).rows[0],{ closed_reason:"user_switch",history_revoked_at:null });
  const newConversation = await resetAiConversation(pool,owner,tripId);
  assert.notEqual(newConversation.conversationId,conversationId(1));
  const afterNew = await listAiConversations(pool,owner,tripId);
  assert.equal(afterNew.activeConversationId,newConversation.conversationId);
  assert.ok((await listAiConversationMessages(pool,owner,tripId,conversationId(1))).messages.length > 0);
  await assert.rejects(transaction(pool,(client) => selectAiConversationForSubmission(
    client,owner,conversationId(1),
  )),(error) => error instanceof AiConversationChangedError);
  await assert.rejects(transaction(pool,(client) => selectAiConversationForSubmission(
    client,owner,null,
  )),(error) => error instanceof AiConversationChangedError);
  assert.equal(await transaction(pool,(client) => selectAiConversationForSubmission(
    client,owner,newConversation.conversationId,
  )),newConversation.conversationId);

  const busyConversation = await transaction(pool,(client) => prepareAiConversation(client,otherTripOwner));
  await pool.query(
    `INSERT INTO ai_requests (
       trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
       prompt_text,requested_model,status
     ) VALUES ($1,$2,$3,$4,$5,'owner','Synthetic busy request','gpt-6.1-sol','started')`,
    [otherTripId,requestId(400),otherTripOwner.memberId,owner.userId,busyConversation.conversationId],
  );
  await assert.rejects(resetAiConversation(pool,owner,tripId),
    (error) => error instanceof AppConflictError);
  await assert.rejects(resumeAiConversation(pool,owner,tripId,conversationId(1)),
    (error) => error instanceof AppConflictError);
  assert.ok((await listAiConversationMessages(pool,owner,tripId,conversationId(1))).messages.length > 0,
    "browsing archived messages must remain available during the same user's request");
  const memberNewConversation = await resetAiConversation(pool,member,tripId);
  assert.ok(memberNewConversation.conversationId,
    "a different user can start their own conversation while the owner is busy");
  await pool.query(
    `UPDATE ai_requests SET status = 'failed',completed_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND id = $2`,
    [otherTripId,requestId(400)],
  );

  // A request belonging to an old selected conversation cannot pass the final
  // proposal fence after a conversation switch, even if it is recent.
  await pool.query(
    `INSERT INTO ai_requests (
       trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
       prompt_text,requested_model,status
     ) VALUES ($1,$2,$3,$4,$5,'owner','Synthetic stale worker','gpt-6.1-sol','started')`,
    [tripId,requestId(401),owner.memberId,owner.userId,conversationId(1)],
  );
  await assert.rejects(transaction(pool,(client) => assertAiRequestWritable(
    client,owner,requestId(401),conversationId(1),
  )),(error) => error instanceof AppConflictError);
  await pool.query(
    `UPDATE ai_requests SET status = 'failed',completed_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND id = $2`,
    [tripId,requestId(401)],
  );

  await pool.query(
    `UPDATE trip_members SET status = 'revoked' WHERE trip_id = $1 AND id = $2`,
    [tripId,owner.memberId],
  );
  await assert.rejects(listAiConversations(pool,owner,tripId),privateAccessError);
  await assert.rejects(listAiConversationMessages(pool,owner,tripId,conversationId(1)),privateAccessError);
  await pool.query(
    `UPDATE trip_members SET status = 'active' WHERE trip_id = $1 AND id = $2`,
    [tripId,owner.memberId],
  );

  await transaction(pool,(client) => closeMemberAiConversationForIdentityChange(client,{
    tripId,memberId:owner.memberId,actorMemberId:owner.memberId,cause:"identity_unbound",
  }));
  const revokedHistory = (await pool.query(
    `SELECT bool_and(history_revoked_at IS NOT NULL AND closed_at IS NOT NULL) AS all_revoked,
            count(*)::integer AS count
       FROM ai_conversations WHERE trip_id = $1 AND actor_member_id = $2`,
    [tripId,owner.memberId],
  )).rows[0];
  assert.equal(revokedHistory.all_revoked,true);
  assert.ok(revokedHistory.count > 20,"identity closure must revoke older archives, not only the active row");
  assert.deepEqual((await listAiConversations(pool,owner,tripId)).conversations,[]);
  await assert.rejects(listAiConversationMessages(pool,owner,tripId,conversationId(1)),privateAccessError);
  await assert.rejects(resumeAiConversation(pool,owner,tripId,conversationId(1)),privateAccessError);
  await pool.query(
    `UPDATE trip_members SET user_id = $3 WHERE trip_id = $1 AND id = $2`,
    [tripId,owner.memberId,userId(5)],
  );
  await assert.rejects(listAiConversations(pool,owner,tripId),privateAccessError);
  const replacement = { ...owner,userId:userId(5) };
  assert.deepEqual((await listAiConversations(pool,replacement,tripId)).conversations,[]);
  await assert.rejects(listAiConversationMessages(pool,replacement,tripId,conversationId(1)),privateAccessError);
  await pool.query(
    `UPDATE trip_members SET user_id = $3 WHERE trip_id = $1 AND id = $2`,
    [tripId,owner.memberId,owner.userId],
  );
  assert.deepEqual((await listAiConversations(pool,owner,tripId)).conversations,[],
    "rebinding the original Google identity cannot restore permanently revoked conversation history");
  assert.deepEqual((await pool.query(
    `SELECT to_jsonb(checkpoint) AS snapshot FROM ai_conversation_checkpoints checkpoint
      WHERE trip_id = $1 AND conversation_id = $2`,
    [tripId,conversationId(1)],
  )).rows,checkpointBeforeResume,"identity revocation preserves restricted checkpoint/audit data");
}
