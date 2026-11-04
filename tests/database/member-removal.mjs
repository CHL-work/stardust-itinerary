import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { AppConflictError, AppForbiddenError, AppNotFoundError, createChangeRequest, getMemberPermissions, reviewChangeRequest, updateTripMember } from "../../src/lib/app/repository.ts";
import { getTripMemberRemovalPreview, removeTripMemberSafely } from "../../src/lib/app/member-removal.ts";
import { readAiRequestImage } from "../../src/lib/ai/image-store.ts";
import { assertAiRequestWritable } from "../../src/lib/ai/request-recovery.ts";
import { listAiConversations } from "../../src/lib/ai/conversation-history.ts";

const id = (group, number) => `e8${group}0000-0000-4000-8000-${String(number).padStart(12,"0")}`;
const tripId = id("10",1);
const foreignTripId = id("10",2);
const inputFor = (preview,expenseReassignments=[]) => ({ confirmation:true,expectedRevision:preview.member.revision,previewDigest:preview.previewDigest,expenseReassignments });

async function transaction(pool,run) {
  const client=await pool.connect();
  try { await client.query("BEGIN"); const result=await run(client); await client.query("COMMIT"); return result; }
  catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Called only after the parent suite's exact disposable-loopback database guard. */
export async function testMemberRemoval(pool,connectionString,baseSession) {
  assert.deepEqual(await migrate({connectionString,through:"0037_member_removal.sql"}),["0037_member_removal.sql"]);
  assert.deepEqual(await migrate({connectionString,through:"0037_member_removal.sql"}),[]);
  const owner={...baseSession,tripId,memberId:id("20",1),userId:id("00",1),role:"owner"};
  const member={...owner,memberId:id("20",2),userId:id("00",2),role:"editor"};
  const other={...owner,memberId:id("20",3),userId:id("00",3),role:"editor"};
  const foreignMember={...member,tripId:foreignTripId,memberId:id("20",4)};
  for(const actor of [owner,member,other]) await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic removal user')",[actor.userId]);
  for(const currentTrip of [tripId,foreignTripId]) {
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic removal trip','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE+5)`,[currentTrip,owner.userId]);
  }
  for(const actor of [owner,member,other,foreignMember]) await pool.query(
    `INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic removal member',$4,'active')`,[actor.tripId,actor.memberId,actor.userId,actor.role]);
  await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,CURRENT_DATE)",[tripId,id("30",1)]);
  for(const [number,creator,visibility] of [[1,member.memberId,"private"],[2,other.memberId,"private"],[3,owner.memberId,"trip"]]) {
    await pool.query(`INSERT INTO itinerary_items(trip_id,id,trip_day_id,created_by_member_id,title,visibility)
      VALUES($1,$2,$3,$4,$5,$6)`,[tripId,id("40",number),id("30",1),creator,number===1?"Hidden synthetic venue":"Synthetic removal event",visibility]);
    await pool.query(`INSERT INTO itinerary_revisions(trip_id,itinerary_item_id,revision,changed_by_member_id,snapshot,reason)
      VALUES($1,$2,1,$3,$4::jsonb,'Synthetic fixture')`,[tripId,id("40",number),creator,JSON.stringify({id:id("40",number),createdByMemberId:creator,visibility,currentRevision:1})]);
  }
  await pool.query(`INSERT INTO itinerary_item_viewers(trip_id,itinerary_item_id,member_id,added_by_member_id)
    VALUES($1,$2,$3,$4)`,[tripId,id("40",2),member.memberId,other.memberId]);
  async function createExpense(number,status,item,amount,splits,description="Synthetic removal expense") {
    await transaction(pool,async(client)=>{
      await client.query(`INSERT INTO expenses(trip_id,id,payer_member_id,itinerary_item_id,description,amount_minor,currency,status,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,'JPY',$7,CURRENT_TIMESTAMP)`,[tripId,id("50",number),member.memberId,item,description,amount,status]);
      for(const [participant,share] of splits) await client.query("INSERT INTO expense_splits(trip_id,expense_id,member_id,share_minor) VALUES($1,$2,$3,$4)",[tripId,id("50",number),participant,share]);
      await client.query(`INSERT INTO expense_revisions(trip_id,expense_id,revision,changed_by_member_id,snapshot)
        VALUES($1,$2,1,$3,$4::jsonb)`,[tripId,id("50",number),member.memberId,JSON.stringify({payerMemberId:member.memberId,amountMinor:amount,splits})]);
    });
  }
  await createExpense(1,"posted",id("40",3),101,[[member.memberId,51],[owner.memberId,50]]);
  await createExpense(2,"void",id("40",2),17,[[member.memberId,17]]);
  await createExpense(3,"posted",id("40",1),777,[[member.memberId,777]],"Hidden synthetic expense");
  await createExpense(4,"posted",id("40",3),201,[[member.memberId,201]],"Synthetic sole payer expense");
  for(const [number,status,requester,patch] of [
    [1,"pending",owner.memberId,{title:"Synthetic pending event",viewerMemberIds:[member.memberId]}],
    [2,"rejected",member.memberId,{title:"Synthetic rejected event"}],
    [3,"approved",member.memberId,{title:"Retained approved event"}],
  ]) await pool.query(`INSERT INTO change_requests(trip_id,id,requested_by_member_id,entity_type,entity_id,operation,proposed_patch,reason,source,status,reviewed_by_member_id,reviewed_at,applied_revision)
    VALUES($1,$2,$3,'itinerary_item',$4,'create',$5::jsonb,'Synthetic removal fixture','owner',$6,$7,$8,$9)`,
  [tripId,id("60",number),requester,status==="approved"?id("40",1):null,JSON.stringify(patch),status,status==="pending"?null:owner.memberId,status==="pending"?null:new Date(),status==="approved"?1:null]);
  await pool.query(`INSERT INTO change_requests(trip_id,id,requested_by_member_id,entity_type,entity_id,operation,base_revision,proposed_patch,reason,source)
    VALUES($1,$2,$3,'expense',$4,'update',1,'{"description":"Corrected synthetic receipt"}'::jsonb,'Synthetic partial expense update','member')`,
    [tripId,id("60",4),other.memberId,id("50",1)]);
  for(const [actor,number] of [[member,1],[foreignMember,2]]) {
    await pool.query("INSERT INTO ai_conversations(trip_id,id,actor_member_id,actor_user_id) VALUES($1,$2,$3,$4)",[actor.tripId,id("70",number),actor.memberId,actor.userId]);
    await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,conversation_id,prompt_text,requested_model,status)
      VALUES($1,$2,$3,$4,'editor',$5,'Synthetic retained prompt','gpt-6.1-sol','started')`,[actor.tripId,id("80",number),actor.memberId,actor.userId,id("70",number)]);
  }
  const data=Buffer.from([0xff,0xd8,0xff,0xd9]);
  await pool.query(`INSERT INTO ai_request_images(trip_id,id,ai_request_id,ordinal,media_type,image_data,sha256,width,height)
    VALUES($1,$2,$3,0,'image/jpeg',$4,$5,2,2)`,[tripId,id("90",1),id("80",1),data,createHash("sha256").update(data).digest("hex")]);
  await pool.query(`INSERT INTO member_claim_links(id,trip_id,member_id,token_hash,expires_at,created_by_member_id)
    VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP+interval '1 day',$5)`,[id("91",1),tripId,member.memberId,Buffer.alloc(32,91),owner.memberId]);
  await pool.query(`INSERT INTO auth_sessions(id,family_id,trip_id,member_id,user_id,token_hash,device_label,expires_at,absolute_expires_at)
    VALUES($1,$1,$2,$3,$4,$5,'Synthetic device',CURRENT_TIMESTAMP+interval '1 day',CURRENT_TIMESTAMP+interval '2 days')`,
  [id("92",1),tripId,member.memberId,member.userId,Buffer.alloc(32,92)]);
  await pool.query("INSERT INTO calendar_connections(trip_id,member_id,access_token_encrypted) VALUES($1,$2,'synthetic-ciphertext')",[tripId,member.memberId]);
  await pool.query(`INSERT INTO calendar_event_links(trip_id,itinerary_item_id,member_id,provider_event_id,last_synced_item_revision)
    VALUES($1,$2,$3,'synthetic-google-event',1)`,[tripId,id("40",3),member.memberId]);

  await assert.rejects(updateTripMember(pool,owner,tripId,owner.memberId,{disabled:true}),(error)=>error instanceof AppForbiddenError);
  await assert.rejects(updateTripMember(pool,owner,tripId,owner.memberId,{role:"editor",expectedRevision:1}),(error)=>error instanceof AppForbiddenError);
  await assert.rejects(updateTripMember(pool,other,tripId,other.memberId,{role:"owner",expectedRevision:1}),(error)=>error instanceof AppForbiddenError);
  await updateTripMember(pool,owner,tripId,other.memberId,{role:"owner",expectedRevision:1});
  const staleOwner={...other,role:"owner"};
  await assert.rejects(updateTripMember(pool,owner,tripId,other.memberId,{role:"viewer",expectedRevision:1}),(error)=>error instanceof AppConflictError);
  await updateTripMember(pool,owner,tripId,other.memberId,{role:"viewer",expectedRevision:2});
  const permissions=await getMemberPermissions(pool,tripId,other.memberId);
  assert.equal(permissions.canEditItinerary,false); assert.equal(permissions.canEditExpenses,false);
  await assert.rejects(getTripMemberRemovalPreview(pool,staleOwner,tripId,member.memberId),(error)=>error instanceof AppForbiddenError);
  await assert.rejects(reviewChangeRequest(pool,staleOwner,tripId,id("60",1),"approve"),(error)=>error instanceof AppForbiddenError);
  await assert.rejects(createChangeRequest(pool,staleOwner,tripId,{entityType:"itinerary_item",entityId:id("40",3),operation:"update",baseRevision:1,
    proposedPatch:{title:"Stale owner must not edit"},reason:"Synthetic stale role",source:"owner"}),(error)=>error instanceof AppForbiddenError);

  await assert.rejects(getTripMemberRemovalPreview(pool,member,tripId,other.memberId),(error)=>error instanceof AppForbiddenError);
  const hiddenPreview=await getTripMemberRemovalPreview(pool,owner,tripId,member.memberId);
  assert.equal(hiddenPreview.hiddenPrivateExpenseCount,1);
  assert.equal(hiddenPreview.canRemoveWithReassignment,false);
  assert.equal(JSON.stringify(hiddenPreview).includes("Hidden synthetic"),false);
  assert.equal(hiddenPreview.expenses.length,2);
  await assert.rejects(removeTripMemberSafely(pool,owner,tripId,member.memberId,inputFor(hiddenPreview)),(error)=>error instanceof AppConflictError);
  assert.equal((await pool.query("SELECT status FROM trip_members WHERE trip_id=$1 AND id=$2",[tripId,member.memberId])).rows[0].status,"active");

  // The inaccessible member resolves their own private fixture separately.
  // Removal never chooses to void it or obtains access to its details.
  await transaction(pool,async(client)=>{
    await client.query("UPDATE expenses SET status='void' WHERE trip_id=$1 AND id=$2",[tripId,id("50",3)]);
    await client.query(`INSERT INTO expense_revisions(trip_id,expense_id,revision,changed_by_member_id,snapshot)
      VALUES($1,$2,2,$3,'{"status":"void","fixture":true}'::jsonb)`,[tripId,id("50",3),member.memberId]);
  });
  const preview=await getTripMemberRemovalPreview(pool,owner,tripId,member.memberId);
  assert.equal(preview.canRemoveWithReassignment,true);
  assert.deepEqual(preview.expenses[0].eligibleMembers.map((choice)=>choice.id),[owner.memberId,other.memberId]);
  const reassignment=[{expenseId:id("50",1),expectedRevision:1,replacementPayerMemberId:owner.memberId,shareRecipientMemberId:owner.memberId},
    {expenseId:id("50",4),expectedRevision:1,replacementPayerMemberId:other.memberId,shareRecipientMemberId:other.memberId}];
  await assert.rejects(removeTripMemberSafely(pool,owner,tripId,member.memberId,{...inputFor(preview,reassignment),previewDigest:"0".repeat(64)}),(error)=>error instanceof AppConflictError);
  const result=await removeTripMemberSafely(pool,owner,tripId,member.memberId,inputFor(preview,reassignment));
  assert.deepEqual(result,{removed:true,invalidatedProposalCount:3,removedViewerLinkCount:1});
  const ledger=(await pool.query(`SELECT e.amount_minor::text,e.payer_member_id,e.current_revision,
    (SELECT sum(s.share_minor)::text FROM expense_splits s WHERE s.trip_id=e.trip_id AND s.expense_id=e.id) AS allocated
    FROM expenses e WHERE e.trip_id=$1 AND e.id=$2`,[tripId,id("50",1)])).rows[0];
  assert.deepEqual(ledger,{amount_minor:"101",payer_member_id:owner.memberId,current_revision:2,allocated:"101"});
  assert.deepEqual((await pool.query(`SELECT payer_member_id,amount_minor::text FROM expenses WHERE trip_id=$1 AND id=$2`,[tripId,id("50",4)])).rows[0],
    {payer_member_id:other.memberId,amount_minor:"201"});
  assert.deepEqual((await pool.query("SELECT member_id,share_minor::text FROM expense_splits WHERE trip_id=$1 AND expense_id=$2",[tripId,id("50",4)])).rows,
    [{member_id:other.memberId,share_minor:"201"}]);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM expense_splits WHERE trip_id=$1 AND expense_id=$2 AND member_id=$3",[tripId,id("50",1),member.memberId])).rows[0].count,0);
  assert.equal((await pool.query("SELECT payer_member_id FROM expenses WHERE trip_id=$1 AND id=$2",[tripId,id("50",2)])).rows[0].payer_member_id,member.memberId);
  assert.equal((await pool.query("SELECT created_by_member_id FROM itinerary_items WHERE trip_id=$1 AND id=$2",[tripId,id("40",1)])).rows[0].created_by_member_id,member.memberId);
  assert.equal((await pool.query("SELECT current_revision FROM itinerary_items WHERE trip_id=$1 AND id=$2",[tripId,id("40",2)])).rows[0].current_revision,2);
  const requests=(await pool.query("SELECT id,status,invalidated_reason,proposed_patch FROM change_requests WHERE trip_id=$1 ORDER BY id",[tripId])).rows;
  assert.deepEqual(requests.map((row)=>[row.status,row.invalidated_reason]),[["pending","member_removed"],["rejected","member_removed"],["approved",null],["pending","member_removed"]]);
  assert.equal(requests[0].proposed_patch.viewerMemberIds[0],member.memberId);
  assert.deepEqual(requests[3].proposed_patch,{description:"Corrected synthetic receipt"});
  await assert.rejects(reviewChangeRequest(pool,owner,tripId,id("60",4),"approve"));
  await assert.rejects(pool.query("UPDATE change_requests SET invalidated_at=NULL,invalidated_reason=NULL,invalidated_by_member_id=NULL,invalidated_member_id=NULL WHERE trip_id=$1 AND id=$2",[tripId,id("60",1)]));
  await assert.rejects(pool.query("UPDATE change_requests SET status='approved',reviewed_by_member_id=$3,reviewed_at=CURRENT_TIMESTAMP WHERE trip_id=$1 AND id=$2",[tripId,id("60",1),owner.memberId]));
  await assert.rejects(reviewChangeRequest(pool,owner,tripId,id("60",2),"approve"));
  const lifecycle=(await pool.query(`SELECT
    (SELECT revoked_at IS NOT NULL FROM auth_sessions WHERE id=$2) AS session_revoked,
    (SELECT revoked_at IS NOT NULL FROM member_claim_links WHERE id=$3) AS invite_revoked,
    (SELECT count(*)::integer FROM calendar_connections WHERE trip_id=$1) AS calendars,
    (SELECT count(*)::integer FROM ai_request_images WHERE trip_id=$1) AS retained_images,
    (SELECT status FROM ai_requests WHERE trip_id=$1 AND id=$4) AS request_status,
    (SELECT closed_reason FROM ai_conversations WHERE trip_id=$1 AND id=$5) AS closed_reason`,[tripId,id("92",1),id("91",1),id("80",1),id("70",1)])).rows[0];
  assert.deepEqual(lifecycle,{session_revoked:true,invite_revoked:true,calendars:0,retained_images:1,request_status:"failed",closed_reason:"member_removed"});
  await assert.rejects(listAiConversations(pool,member,tripId),(error)=>error instanceof AppForbiddenError);
  await assert.rejects(readAiRequestImage(pool,member,tripId,id("90",1)),(error)=>error instanceof AppForbiddenError || error instanceof AppNotFoundError);
  await assert.rejects(transaction(pool,(client)=>assertAiRequestWritable(client,member,id("80",1),id("70",1))));
  assert.deepEqual((await pool.query("SELECT status FROM trip_members WHERE trip_id=$1 AND id=$2",[foreignTripId,foreignMember.memberId])).rows[0],{status:"active"});
  assert.deepEqual((await pool.query("SELECT status FROM ai_requests WHERE trip_id=$1 AND id=$2",[foreignTripId,id("80",2)])).rows[0],{status:"started"});
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM app_users WHERE id=$1",[member.userId])).rows[0].count,1);
  await assert.rejects(pool.query("DELETE FROM trip_members WHERE trip_id=$1 AND id=$2",[tripId,member.memberId]),"history FKs retain the tombstone");
  const lastOwner=await getTripMemberRemovalPreview(pool,owner,tripId,owner.memberId);
  assert.equal(lastOwner.blockedReason,"last_bound_owner");
  await assert.rejects(removeTripMemberSafely(pool,owner,tripId,owner.memberId,inputFor(lastOwner)),(error)=>error instanceof AppConflictError);
  await updateTripMember(pool,owner,tripId,other.memberId,{role:"owner",expectedRevision:3});
  await pool.query(`INSERT INTO trip_join_links(id,trip_id,token_hash,created_by_member_id) VALUES($1,$2,$3,$4)`,
    [id("93",1),tripId,Buffer.alloc(32,93),other.memberId]);
  const removableOwner=await getTripMemberRemovalPreview(pool,owner,tripId,other.memberId);
  assert.equal(removableOwner.counts.reusableInvites,1);
  await removeTripMemberSafely(pool,owner,tripId,other.memberId,inputFor(removableOwner,[
    {expenseId:id("50",4),expectedRevision:2,replacementPayerMemberId:owner.memberId,shareRecipientMemberId:owner.memberId},
  ]));
  assert.equal((await pool.query("SELECT status FROM trip_members WHERE trip_id=$1 AND id=$2",[tripId,other.memberId])).rows[0].status,"removed");
  assert.deepEqual((await pool.query("SELECT revoked_at IS NOT NULL AS revoked,exhausted_at IS NULL AS not_exhausted FROM trip_join_links WHERE id=$1",[id("93",1)])).rows[0],
    {revoked:true,not_exhausted:true});

  const raceTrip=id("10",3);
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic owner race','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE+1)`,[raceTrip,owner.userId]);
  const raceA={...owner,tripId:raceTrip,memberId:id("20",5)};
  const raceB={...other,tripId:raceTrip,memberId:id("20",6),role:"owner"};
  for(const actor of [raceA,raceB]) await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
    VALUES($1,$2,$3,'Synthetic racing owner','owner','active')`,[raceTrip,actor.memberId,actor.userId]);
  const [previewA,previewB]=await Promise.all([getTripMemberRemovalPreview(pool,raceA,raceTrip,raceB.memberId),getTripMemberRemovalPreview(pool,raceB,raceTrip,raceA.memberId)]);
  const races=await Promise.allSettled([removeTripMemberSafely(pool,raceA,raceTrip,raceB.memberId,inputFor(previewA)),
    removeTripMemberSafely(pool,raceB,raceTrip,raceA.memberId,inputFor(previewB))]);
  assert.equal(races.filter((result)=>result.status==="fulfilled").length,1);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM trip_members WHERE trip_id=$1 AND role='owner' AND status='active' AND user_id IS NOT NULL",[raceTrip])).rows[0].count,1);
}
