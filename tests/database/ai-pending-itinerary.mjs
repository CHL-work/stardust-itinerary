import assert from "node:assert/strict";
import {
  AppConflictError, AppForbiddenError, AppNotFoundError, applyPermittedChangeRequest,
  createChangeRequest, getAiPendingItineraryContext, getPendingItineraryRequestForEdit,
  reviewChangeRequest, updatePendingItineraryRequest, updatePendingItineraryRequestWithClient,
} from "../../src/lib/app/repository.ts";
import { lockCurrentTripActor } from "../../src/lib/app/trip-authorization.ts";

const id = (group, number) => `ea${group}0000-0000-4000-8000-${String(number).padStart(12,"0")}`;
async function transaction(pool, run) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Synthetic fixtures only; invoked after the main suite applies all 37 migrations. */
export async function testAiPendingItinerary(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:","postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(target.hostname));
  assert.match(databaseName,/^stardust_test_[a-z0-9_]+$/);
  assert.equal(target.search,""); assert.equal(target.hash,"");
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,databaseName);
  const tripId = id("10",1), foreignTripId = id("10",2), dayId = id("30",1);
  const owner = { ...baseSession, tripId, memberId:id("20",1), userId:id("00",1), role:"owner" };
  const editor = { ...owner, memberId:id("20",2), userId:id("00",2), role:"editor" };
  const other = { ...owner, memberId:id("20",3), userId:id("00",3), role:"editor" };
  const viewer = { ...owner, memberId:id("20",4), userId:id("00",4), role:"viewer" };
  const foreign = { ...editor,tripId:foreignTripId,memberId:id("20",5) };
  for (const actor of [owner,editor,other,viewer]) await pool.query(
    "INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic pending edit user')",[actor.userId]);
  for (const trip of [tripId,foreignTripId]) await pool.query(
    `INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
     VALUES($1,$2,'Synthetic pending edit trip','Asia/Tokyo','JPY','2030-04-01','2030-04-05')`,[trip,owner.userId]);
  for (const actor of [owner,editor,other,viewer,foreign]) await pool.query(
    `INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
     VALUES($1,$2,$3,'Synthetic pending edit member',$4,'active')`,[actor.tripId,actor.memberId,actor.userId,actor.role]);
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2030-04-01')",[tripId,dayId]);
  await pool.query(`INSERT INTO member_permissions(trip_id,member_id,can_edit_itinerary,itinerary_requires_approval,can_edit_expenses,expense_requires_approval,updated_by_member_id)
    VALUES($1,$2,true,false,true,false,$3)`,[tripId,editor.memberId,owner.memberId]);
  const aiIds = new Map();
  for (const [actor,number] of [[owner,1],[editor,2],[other,3]]) {
    const conversationId=id("70",number), aiRequestId=id("80",number);
    await pool.query("INSERT INTO ai_conversations(trip_id,id,actor_member_id,actor_user_id) VALUES($1,$2,$3,$4)",[tripId,conversationId,actor.memberId,actor.userId]);
    await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,conversation_id,prompt_text,requested_model,status,feature)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic event correction','gpt-6.1-sol','started','planning')`,[tripId,aiRequestId,actor.memberId,actor.userId,actor.role,conversationId]);
    aiIds.set(actor.memberId,aiRequestId);
  }
  const eventPatch = { tripDayId:dayId,title:"Synthetic pending dinner",itemType:"meal",startsAt:"2030-04-01T10:00:00Z",
    endsAt:"2030-04-01T11:00:00Z",locationName:"Synthetic restaurant",notes:"Keep original notes",visibility:"trip",viewerMemberIds:[] };
  const expense = { description:"Synthetic dinner charge",amountMinor:101,currency:"JPY",payerMemberId:editor.memberId,
    splitMemberIds:[editor.memberId,other.memberId],occurredAt:"2030-04-01T10:00:00Z",status:"posted" };
  async function create(actor,patch={},options={}) {
    return createChangeRequest(pool,actor,tripId,{entityType:"itinerary_item",operation:"create",source:actor.role==="owner"?"owner":"member",
      patch:{...eventPatch,...patch},reason:"Synthetic original private reason",...options});
  }
  const context = (actor) => transaction(pool,async(client)=>{
    await lockCurrentTripActor(client,actor);
    return getAiPendingItineraryContext(client,actor,actor.tripId);
  });
  const edit = (actor,requestId,input) => transaction(pool,(client)=>updatePendingItineraryRequestWithClient(
    client,actor,actor.tripId,requestId,input,{aiRequestId:aiIds.get(actor.memberId)}));
  const request = await create(editor,{visibility:"private",viewerMemberIds:[other.memberId],linkedExpense:expense});
  const ownerRequest = await create(owner,{title:"Synthetic owner pending event"});
  const publicRequest = await create(other);
  const otherPrivate = await create(other,{visibility:"private",viewerMemberIds:[],title:"Hidden other private event"});
  const original = (await pool.query("SELECT * FROM change_requests WHERE trip_id=$1 AND id=$2",[tripId,request.id])).rows[0];
  const beforeCounts = (await pool.query(`SELECT (SELECT count(*)::int FROM itinerary_items WHERE trip_id=$1) AS events,
    (SELECT count(*)::int FROM expenses WHERE trip_id=$1) AS expenses`,[tripId])).rows[0];
  const result = await edit(editor,request.id,{proposalRevision:1,patch:{title:"Corrected pending dinner",locationName:"Corrected synthetic branch"}});
  assert.equal(result.requestId,request.id); assert.equal(result.proposalRevision,2); assert.equal(result.status,"pending");
  assert.equal(result.source,"member"); assert.equal(result.requestedByMemberId,editor.memberId); assert.equal(result.createdByMemberId,editor.memberId);
  assert.deepEqual(result.patch.linkedExpense,expense); assert.deepEqual(result.patch.viewerMemberIds,[other.memberId]);
  assert.equal(result.patch.notes,eventPatch.notes);
  const stored = (await pool.query("SELECT * FROM change_requests WHERE trip_id=$1 AND id=$2",[tripId,request.id])).rows[0];
  assert.equal(stored.entity_id,null); assert.equal(stored.source,original.source); assert.equal(stored.requested_by_member_id,original.requested_by_member_id);
  assert.deepEqual(stored.proposed_patch.linkedExpense,original.proposed_patch.linkedExpense);
  assert.deepEqual((await pool.query(`SELECT (SELECT count(*)::int FROM itinerary_items WHERE trip_id=$1) AS events,
    (SELECT count(*)::int FROM expenses WHERE trip_id=$1) AS expenses`,[tripId])).rows[0],beforeCounts);
  const audit=(await pool.query(`SELECT before_state,after_state,metadata FROM audit_events
    WHERE trip_id=$1 AND entity_id=$2 AND action='proposal_updated'`,[tripId,request.id])).rows[0];
  assert.equal(audit.before_state.proposalRevision,1); assert.equal(audit.after_state.proposalRevision,2);
  assert.deepEqual(audit.metadata,{source:"member",requestedByMemberId:editor.memberId,editSource:"ai",aiRequestId:aiIds.get(editor.memberId),requiresOwnerReview:true});
  for (const actor of [editor,owner]) await assert.rejects(applyPermittedChangeRequest(pool,actor,tripId,request.id),AppForbiddenError);
  await edit(owner,ownerRequest.id,{proposalRevision:1,patch:{notes:"Owner AI edit still pending"}});
  await assert.rejects(applyPermittedChangeRequest(pool,owner,tripId,ownerRequest.id),AppForbiddenError);

  const editorContext=await context(editor);
  const entry=editorContext.pendingItinerary.find((item)=>item.requestId===request.id);
  assert.equal(entry.proposalRevision,2); assert.equal(entry.createdByMemberId,editor.memberId); assert.equal(entry.hasLinkedExpense,true);
  assert.equal(Object.hasOwn(entry.patch,"linkedExpense"),false); assert.equal(Object.hasOwn(entry,"reason"),false);
  assert.ok(editorContext.pendingItinerary.some((item)=>item.requestId===publicRequest.id));
  assert.ok(!editorContext.pendingItinerary.some((item)=>item.requestId===otherPrivate.id));
  assert.ok(!JSON.stringify(editorContext).includes("Synthetic dinner charge"));
  assert.deepEqual((await context(viewer)).pendingItinerary,[]);
  assert.deepEqual((await context(foreign)).pendingItinerary,[]);
  assert.ok((await context(owner)).pendingItinerary.some((item)=>item.requestId===otherPrivate.id));
  await assert.rejects(edit(editor,otherPrivate.id,{proposalRevision:1,patch:{notes:"Hidden overwrite"}}),AppNotFoundError);
  await assert.rejects(updatePendingItineraryRequest(pool,viewer,tripId,publicRequest.id,{proposalRevision:1,patch:{notes:"Read only"}}),AppNotFoundError);
  await assert.rejects(edit(editor,request.id,{proposalRevision:1,patch:{notes:"Stale browser"}}),AppConflictError);
  await assert.rejects(edit(owner,request.id,{proposalRevision:2,patch:{visibility:"trip"}}),AppForbiddenError);
  await assert.rejects(edit(editor,request.id,{proposalRevision:2,patch:{linkedExpense:null}}),AppForbiddenError);
  await assert.rejects(edit(owner,request.id,{proposalRevision:2,patch:{isLocked:false}}),AppForbiddenError);
  await assert.rejects(transaction(pool,(client)=>updatePendingItineraryRequestWithClient(client,editor,tripId,request.id,
    {proposalRevision:2,patch:{notes:"Wrong provenance"}},{aiRequestId:aiIds.get(owner.memberId)})),AppConflictError);

  // A failed completion rolls back the proposal, audit and saved AI result together.
  const aiRequestId=aiIds.get(editor.memberId);
  const rollbackMarker=new Error("Synthetic completion failure");
  await assert.rejects(transaction(pool,async(client)=>{
    await updatePendingItineraryRequestWithClient(client,editor,tripId,request.id,
      {proposalRevision:2,patch:{title:"Must roll back"}},{aiRequestId});
    await client.query("UPDATE ai_requests SET result_text='Synthetic unsaved completion' WHERE trip_id=$1 AND id=$2",[tripId,aiRequestId]);
    throw rollbackMarker;
  }),(error)=>error===rollbackMarker);
  assert.equal((await getPendingItineraryRequestForEdit(pool,editor,tripId,request.id)).proposalRevision,2);
  assert.equal((await pool.query("SELECT result_text FROM ai_requests WHERE trip_id=$1 AND id=$2",[tripId,aiRequestId])).rows[0].result_text,null);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM audit_events WHERE trip_id=$1 AND entity_id=$2 AND action='proposal_updated'",[tripId,request.id])).rows[0].total,1);

  // Concurrent edits with one revision token can commit only one change.
  const concurrent=await Promise.allSettled([
    edit(editor,publicRequest.id,{proposalRevision:1,patch:{notes:"Concurrent A"}}),
    edit(other,publicRequest.id,{proposalRevision:1,patch:{notes:"Concurrent B"}}),
  ]);
  assert.equal(concurrent.filter((outcome)=>outcome.status==="fulfilled").length,1);
  const rejected=concurrent.find((outcome)=>outcome.status==="rejected");
  assert.ok(rejected.reason instanceof AppConflictError);

  const locked=await create(owner,{title:"Locked synthetic draft",isLocked:true});
  await assert.rejects(edit(editor,locked.id,{proposalRevision:1,patch:{title:"Bypass owner lock"}}),AppForbiddenError);
  assert.ok(!(await context(editor)).pendingItinerary.some((item)=>item.requestId===locked.id));
  assert.ok((await context(owner)).pendingItinerary.some((item)=>item.requestId===locked.id&&item.patch.isLocked));
  assert.equal((await edit(owner,locked.id,{proposalRevision:1,patch:{notes:"Owner correction"}})).patch.isLocked,true);

  // Existing-target updates keep the immutable base/creator and never edit a stale target.
  const canonicalCreate=await create(editor,{title:"Synthetic canonical event"});
  const canonical=await reviewChangeRequest(pool,owner,tripId,canonicalCreate.id,"approve");
  const pendingUpdate=await create(editor,{}, {operation:"update",entityId:canonical.entityId,baseRevision:canonical.revision,patch:{notes:"Proposed note"}});
  const editedUpdate=await edit(other,pendingUpdate.id,{proposalRevision:1,patch:{title:"AI corrected pending update"}});
  assert.equal(editedUpdate.targetItemId,canonical.entityId); assert.equal(editedUpdate.createdByMemberId,editor.memberId);
  assert.equal((await pool.query("SELECT title,current_revision FROM itinerary_items WHERE trip_id=$1 AND id=$2",[tripId,canonical.entityId])).rows[0].title,"Synthetic canonical event");
  const canonicalChange=await create(owner,{}, {operation:"update",entityId:canonical.entityId,baseRevision:canonical.revision,patch:{notes:"New canonical revision"}});
  await reviewChangeRequest(pool,owner,tripId,canonicalChange.id,"approve");
  await assert.rejects(edit(owner,pendingUpdate.id,{proposalRevision:2,patch:{notes:"Stale pending target"}}),AppConflictError);
  assert.ok(!(await context(owner)).pendingItinerary.some((item)=>item.requestId===pendingUpdate.id));

  const invalidated=await create(owner,{title:"Invalidated synthetic proposal"});
  await pool.query(`UPDATE change_requests SET invalidated_at=CURRENT_TIMESTAMP,invalidated_reason='member_removed',
    invalidated_by_member_id=$3,invalidated_member_id=$4 WHERE trip_id=$1 AND id=$2`,[tripId,invalidated.id,owner.memberId,other.memberId]);
  await assert.rejects(edit(owner,invalidated.id,{proposalRevision:1,patch:{notes:"Must remain invalidated"}}),AppNotFoundError);
  assert.ok(!(await context(owner)).pendingItinerary.some((item)=>item.requestId===invalidated.id));
  await assert.rejects(reviewChangeRequest(pool,owner,tripId,ownerRequest.id,"reject",undefined,1),AppConflictError);
  await reviewChangeRequest(pool,owner,tripId,ownerRequest.id,"reject",undefined,2);
  await assert.rejects(edit(owner,ownerRequest.id,{proposalRevision:2,patch:{notes:"Cannot edit rejected"}}),AppConflictError);
  assert.ok(!(await context(owner)).pendingItinerary.some((item)=>item.requestId===ownerRequest.id));
  // Explicit review remains available, including proposal-only owner review of a private event.
  await assert.rejects(reviewChangeRequest(pool,owner,tripId,request.id,"approve","Stale synthetic review",1),AppConflictError);
  const approved=await reviewChangeRequest(pool,owner,tripId,request.id,"approve","Explicit synthetic review",2);
  assert.equal(approved.status,"approved"); assert.ok(approved.entityId);
  await assert.rejects(edit(editor,request.id,{proposalRevision:2,patch:{notes:"Replay cannot update approved"}}),AppConflictError);
  const canonicalExpense=(await pool.query("SELECT amount_minor::text,payer_member_id FROM expenses WHERE trip_id=$1 AND itinerary_item_id=$2",[tripId,approved.entityId])).rows[0];
  assert.deepEqual(canonicalExpense,{amount_minor:"101",payer_member_id:editor.memberId});
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM itinerary_item_viewers WHERE trip_id=$1 AND itinerary_item_id=$2 AND member_id=$3",[tripId,approved.entityId,owner.memberId])).rows[0].total,0);

  // The context and write authorization use the current binding, not a stale role claim.
  await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2",[tripId,other.memberId]);
  await assert.rejects(context(other),AppForbiddenError);
  await assert.rejects(edit(other,publicRequest.id,{proposalRevision:2,patch:{notes:"Revoked actor"}}),AppForbiddenError);
}
