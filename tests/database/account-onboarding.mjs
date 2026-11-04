import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { createTrip,getAiPolicy,updateAiSettings,AppConflictError,AppForbiddenError,AiPolicyDeniedError } from "../../src/lib/app/repository.ts";
import { issueAccountOnboarding,verifyAccountOnboarding } from "../../src/lib/auth/account-session.ts";
import { isPlatformOperator } from "../../src/lib/auth/operator-access.ts";
import { SessionUnavailableError } from "../../src/lib/auth/errors.ts";
import { verifySession,issueClaim,revokeClaims,issueJoinLink,revokeJoinLink,revokeMemberSessions,unbindMemberIdentity,consumeClaim,signInExistingIdentity } from "../../src/lib/auth/repository.ts";

const input = {name:"Synthetic self-service trip",destinationName:"Tokyo, Japan",timeZone:"Asia/Tokyo",
  defaultLocale:"en",defaultCurrency:"JPY",startsOn:"2031-01-01",endsOn:"2031-01-03",maxMembers:10};
const config = {authSecret:"synthetic-onboarding-secret-only-for-tests",tripGraceDays:2};
const identity = {issuer:"https://accounts.google.com",subject:"synthetic-public-onboarding-user",
  emailHint:"new-trip-creator@example.test",displayNameHint:"Synthetic new traveler"};

/** Only the guarded disposable PostgreSQL suite calls this function. */
export async function testAccountOnboarding(pool,connectionString,baseSession) {
  assert.deepEqual(await migrate({connectionString,through:"0036_account_onboarding.sql"}),["0036_account_onboarding.sql"]);
  assert.deepEqual(await migrate({connectionString,through:"0036_account_onboarding.sql"}),[]);
  const oldSignup = process.env.PUBLIC_SIGNUP_ENABLED;
  const oldOperator = process.env.OWNER_GOOGLE_EMAIL;
  try {
    process.env.PUBLIC_SIGNUP_ENABLED="false";
    await assert.rejects(issueAccountOnboarding(pool,config,identity),(error)=>error instanceof SessionUnavailableError);
    process.env.PUBLIC_SIGNUP_ENABLED="true";
    process.env.OWNER_GOOGLE_EMAIL="operator-only@example.test";
    const [grant,secondGrant] = await Promise.all([issueAccountOnboarding(pool,config,identity),issueAccountOnboarding(pool,config,identity)]);
    const principal = await verifyAccountOnboarding(pool,config,grant.rawToken);
    const secondPrincipal = await verifyAccountOnboarding(pool,config,secondGrant.rawToken);
    assert.ok(principal);
    assert.equal(principal.userId,secondPrincipal.userId,"concurrent callbacks bind one stable Google identity");
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM trip_members WHERE user_id=$1",[principal.userId])).rows[0].count,0,
      "OAuth onboarding must not create a trip or membership");
    assert.equal(await verifySession(pool,config,grant.rawToken),null,"onboarding token is not a trip session");
    assert.equal(await isPlatformOperator(pool,principal.userId),false);
    await assert.rejects(createTrip(pool,principal,{...input,endsOn:"2020-01-01"},{config,userAgent:"Synthetic browser"}));
    await assert.rejects(createTrip(pool,principal,{...input,timeZone:"Dallas",defaultCurrency:"USA"},{config,userAgent:"Synthetic browser"}));
    assert.ok(await verifyAccountOnboarding(pool,config,grant.rawToken),"invalid input must not consume the grant");
    const authenticatedCeiling = (await pool.query(
      "SELECT created_at+interval '720 hours' AS ceiling FROM auth_account_sessions WHERE id=$1", [principal.accountSessionId],
    )).rows[0].ceiling;
    // A database session's DST-aware zone cannot turn 30 elapsed days into a
    // calendar interval with a different number of hours. SET LOCAL auto-resets.
    const zonedPool={connect:async()=>{
      const client=await pool.connect();
      return {query:async(sql,...args)=>{
        const result=await client.query(sql,...args);
        if(sql==="BEGIN") await client.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
        return result;
      },release:()=>client.release()};
    }};
    const created = await createTrip(zonedPool,principal,{...input,destinationName:"Dallas",timeZone:"America/Chicago",defaultCurrency:"USD"},{config,userAgent:"Synthetic browser"});
    assert.deepEqual((await pool.query("SELECT time_zone,default_currency FROM trips WHERE id=$1",[created.tripId])).rows[0],
      {time_zone:"America/Chicago",default_currency:"USD"},"Canonical dropdown values create and persist a Dallas trip");
    assert.ok(created.sessionGrant);
    assert.equal(created.sessionGrant.absoluteExpiresAt.toISOString(),authenticatedCeiling.toISOString(),
      "New-account trip creation inherits the original Google authentication time, not travel dates or consumption time");
    assert.equal(await verifyAccountOnboarding(pool,config,grant.rawToken),null);
    await assert.rejects(createTrip(pool,principal,input,{config,userAgent:"Synthetic browser"}),(error)=>error instanceof SessionUnavailableError);
    const session = await verifySession(pool,config,created.sessionGrant.rawToken);
    assert.equal(session.tripId,created.tripId);
    assert.equal(session.role,"owner");
    assert.equal(session.userId,principal.userId);
    const state = (await pool.query(
      `SELECT ai.enabled,ai.host_subscription_enabled,disruption.enabled AS disruptions,
        (SELECT count(*)::integer FROM trip_days WHERE trip_id=ai.trip_id) AS days,
        (SELECT last_selected_trip_id FROM app_users WHERE id=$2) AS selected
        FROM trip_ai_settings ai JOIN trip_disruption_settings disruption ON disruption.trip_id=ai.trip_id WHERE ai.trip_id=$1`,
      [created.tripId,principal.userId],
    )).rows[0];
    // AI starts on (D-075), but only the requester's own key can pay: no operator sponsorship.
    assert.deepEqual(state,{enabled:true,host_subscription_enabled:false,disruptions:false,days:3,selected:created.tripId});
    await updateAiSettings(pool,session,created.tripId,{enabled:false});
    await assert.rejects(getAiPolicy(pool,session),(error)=>error instanceof AiPolicyDeniedError && error.reasonCode==="ai_disabled");
    await updateAiSettings(pool,session,created.tripId,{enabled:true});
    await assert.rejects(updateAiSettings(pool,session,created.tripId,{ownerDefaultModel:"gpt-6-astra"}),(error)=>error instanceof AppForbiddenError);
    // An enabled toggle cannot confer operator sponsorship.
    await assert.rejects(getAiPolicy(pool,session,"gpt-6-astra"),(error)=>error instanceof AiPolicyDeniedError && error.reasonCode==="ai_key_required");
    await assert.rejects(getAiPolicy(pool,session),(error)=>error instanceof AiPolicyDeniedError && error.reasonCode==="ai_key_required");

    // Signup is not a global trip-creation kill switch for an existing active
    // member. Changing that member's role cannot confer operator entitlement.
    process.env.PUBLIC_SIGNUP_ENABLED="false";
    await pool.query("UPDATE trip_members SET role='viewer' WHERE trip_id=$1 AND id=$2",[created.tripId,created.memberId]);
    const viewer = {...session,role:"viewer"};
    const viewerTrip = await createTrip(pool,viewer,{...input,name:"Synthetic viewer-created trip"});
    assert.equal((await pool.query("SELECT host_subscription_enabled FROM trip_ai_settings WHERE trip_id=$1",[viewerTrip.tripId])).rows[0].host_subscription_enabled,false);
    const sponsoredOwner={...session,tripId:viewerTrip.tripId,memberId:viewerTrip.memberId};
    // Only this synthetic database fixture simulates a later operator grant.
    await pool.query("UPDATE trip_ai_settings SET host_subscription_enabled=true,enabled=true WHERE trip_id=$1",[viewerTrip.tripId]);
    const limited=await getAiPolicy(pool,sponsoredOwner,"gpt-6-astra");
    assert.equal(limited.model,"gpt-6.1-sol");
    assert.equal(limited.limit,20,"sponsorship does not turn another trip owner into the platform operator");
    await assert.rejects(updateAiSettings(pool,sponsoredOwner,viewerTrip.tripId,{ownerDefaultModel:"gpt-6-astra"}),(error)=>error instanceof AppForbiddenError);
    for(let index=0;index<20;index+=1) await pool.query(
      `INSERT INTO ai_requests (trip_id,id,actor_member_id,actor_user_id,actor_role,prompt_text,requested_model,status,completed_at)
       VALUES ($1,$2,$3,$4,'owner','Synthetic quota fixture','gpt-6.1-sol','failed',CURRENT_TIMESTAMP)`,
      [viewerTrip.tripId,randomUUID(),viewerTrip.memberId,session.userId],
    );
    await assert.rejects(getAiPolicy(pool,sponsoredOwner),(error)=>error instanceof AiPolicyDeniedError && error.reasonCode==="daily_limit_reached");
    await assert.rejects(createTrip(pool,session,input),(error)=>error instanceof AppForbiddenError,"a stale role is not silently reused");
    await pool.query("UPDATE trip_members SET role='owner' WHERE trip_id=$1 AND id=$2",[created.tripId,created.memberId]);
    for (let index=0;index<7;index+=1) await createTrip(pool,session,{...input,name:`Synthetic bounded creation ${index}`});
    const races=await Promise.allSettled([createTrip(pool,session,input),createTrip(pool,session,input)]);
    assert.equal(races.filter((result)=>result.status==="fulfilled").length,1);
    assert.equal(races.filter((result)=>result.status==="rejected" && result.reason instanceof AppConflictError).length,1);
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM account_trip_creations WHERE user_id=$1",[principal.userId])).rows[0].count,10);
    await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2",[created.tripId,created.memberId]);
    await assert.rejects(createTrip(pool,session,input),(error)=>error instanceof AppForbiddenError);

    process.env.PUBLIC_SIGNUP_ENABLED="true";
    const expired=await issueAccountOnboarding(pool,config,{...identity,subject:"synthetic-expired-account"});
    // Move both instants together so the 15-minute lifetime constraint remains valid.
    await pool.query("UPDATE auth_account_sessions SET created_at=created_at-interval '1 hour',expires_at=expires_at-interval '1 hour' WHERE user_id=(SELECT user_id FROM oidc_identities WHERE issuer=$1 AND subject=$2)",
      [identity.issuer,"synthetic-expired-account"]);
    assert.equal(await verifyAccountOnboarding(pool,config,expired.rawToken),null);
    const delayedGrant=await issueAccountOnboarding(pool,config,{...identity,subject:`synthetic-delayed-account-${randomUUID()}`});
    const delayedPrincipal=await verifyAccountOnboarding(pool,config,delayedGrant.rawToken);
    assert.ok(delayedPrincipal);
    const grantBlocker=await pool.connect();
    let signalGrantLock;
    const enteredGrantLock=new Promise(resolve=>{signalGrantLock=resolve;});
    const delayedPool={connect:async()=>{
      const client=await pool.connect();
      return {query:(sql,...args)=>{
        if(sql.includes("locked_account")) signalGrantLock();
        return client.query(sql,...args);
      },release:()=>client.release()};
    }};
    const delayedCounts=async()=>(await pool.query(`SELECT
      (SELECT count(*)::integer FROM trips) AS trips,
      (SELECT count(*)::integer FROM auth_sessions) AS sessions,
      (SELECT count(*)::integer FROM trip_members) AS members,
      (SELECT count(*)::integer FROM audit_events) AS audits,
      (SELECT count(*)::integer FROM account_trip_creations) AS creations`)).rows[0];
    let delayedCreation,grantTimeout;
    try {
      await grantBlocker.query("BEGIN");
      await grantBlocker.query("SELECT id FROM auth_account_sessions WHERE id=$1 FOR UPDATE",[delayedPrincipal.accountSessionId]);
      const before=await delayedCounts();
      delayedCreation=createTrip(delayedPool,delayedPrincipal,input,{config,userAgent:"Synthetic delayed account"})
        .then(()=>({allowed:true}),error=>({allowed:false,error}));
      await Promise.race([enteredGrantLock,new Promise((_,reject)=>{
        grantTimeout=setTimeout(()=>reject(new Error("Account creation did not reach its persisted grant lock")),3000);
      })]);
      clearTimeout(grantTimeout);
      await grantBlocker.query(`UPDATE auth_account_sessions SET created_at=created_at-interval '1 hour',
        expires_at=expires_at-interval '1 hour' WHERE id=$1`,[delayedPrincipal.accountSessionId]);
      await grantBlocker.query("COMMIT");
      const outcome=await delayedCreation;
      assert.equal(outcome.allowed,false,"A grant expired during a row-lock wait cannot create a trip");
      assert.ok(outcome.error instanceof SessionUnavailableError);
      assert.deepEqual(await delayedCounts(),before);
      assert.equal((await pool.query("SELECT consumed_at FROM auth_account_sessions WHERE id=$1",[delayedPrincipal.accountSessionId])).rows[0].consumed_at,null);
      assert.equal(await verifyAccountOnboarding(pool,config,delayedGrant.rawToken),null);
    } finally {
      clearTimeout(grantTimeout);
      await grantBlocker.query("ROLLBACK");
      grantBlocker.release();
      if(delayedCreation) await delayedCreation;
    }
    const operatorIdentity={...identity,subject:"synthetic-platform-operator",emailHint:"operator-only@example.test"};
    const operatorGrant=await issueAccountOnboarding(pool,config,operatorIdentity);
    const operator=await verifyAccountOnboarding(pool,config,operatorGrant.rawToken);
    assert.equal(await isPlatformOperator(pool,operator.userId),true);
    const operatorTrip=await createTrip(pool,operator,input,{config,userAgent:null});
    assert.deepEqual((await pool.query("SELECT enabled,host_subscription_enabled FROM trip_ai_settings WHERE trip_id=$1",[operatorTrip.tripId])).rows[0],
      {enabled:true,host_subscription_enabled:true});
    const operatorSession=await verifySession(pool,config,operatorTrip.sessionGrant.rawToken);
    await updateAiSettings(pool,operatorSession,operatorTrip.tripId,{ownerDefaultModel:"gpt-6-astra",memberDailyLimit:1});
    const operatorPolicy=await getAiPolicy(pool,operatorSession,"gpt-6-astra");
    assert.equal(operatorPolicy.model,"gpt-6-astra");
    assert.equal(operatorPolicy.limit,null);
    const invitedId=randomUUID();
    await pool.query("INSERT INTO trip_members (trip_id,id,display_name,role,status) VALUES ($1,$2,'Synthetic invited traveler','editor','invited')",
      [operatorTrip.tripId,invitedId]);
    const authInput={tripId:operatorTrip.tripId,memberId:invitedId,actorMemberId:operatorTrip.memberId,actorUserId:operator.userId};
    const staleInput={...authInput,actorUserId:principal.userId};
    for(const operation of [()=>issueClaim(pool,config,staleInput),()=>revokeClaims(pool,staleInput),
      ()=>issueJoinLink(pool,config,staleInput),()=>revokeJoinLink(pool,staleInput),
      ()=>revokeMemberSessions(pool,staleInput),()=>unbindMemberIdentity(pool,staleInput)]) {
      await assert.rejects(operation(),(error)=>error instanceof SessionUnavailableError);
    }
    const assigned=await issueClaim(pool,config,authInput);
    await revokeClaims(pool,authInput);
    const freshAssigned=await issueClaim(pool,config,authInput);
    assert.notEqual(assigned.rawToken,freshAssigned.rawToken);
    const claimed=await consumeClaim(pool,config,{rawToken:freshAssigned.rawToken,
      identity:{...identity,subject:"synthetic-claimed-onboarding-member"},userAgent:null});
    assert.equal(claimed.memberId,invitedId);
    await revokeMemberSessions(pool,authInput);
    assert.equal(await verifySession(pool,config,claimed.rawToken),null);
    await unbindMemberIdentity(pool,authInput);
    assert.deepEqual((await pool.query("SELECT status,user_id FROM trip_members WHERE trip_id=$1 AND id=$2",
      [operatorTrip.tripId,invitedId])).rows[0],{status:"invited",user_id:null});
    await assert.rejects(unbindMemberIdentity(pool,{...authInput,memberId:operatorTrip.memberId}),
      (error)=>error instanceof SessionUnavailableError,"owner unbinding must remain protected");
    const lock=await pool.connect();
    let awaiting;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE",[operatorTrip.tripId]);
      // Capture the rejection immediately to avoid an unhandled promise; the
      // service must wait behind the trip lock and recheck the demoted role.
      awaiting=issueClaim(pool,config,authInput).then(()=>({allowed:true}),error=>({allowed:false,error}));
      await lock.query("UPDATE trip_members SET role='editor' WHERE trip_id=$1 AND id=$2",[operatorTrip.tripId,operatorTrip.memberId]);
      await lock.query("COMMIT");
      const outcome=await awaiting;
      assert.equal(outcome.allowed,false);
      assert.ok(outcome.error instanceof SessionUnavailableError);
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    await pool.query("UPDATE trip_members SET role='owner' WHERE trip_id=$1 AND id=$2",[operatorTrip.tripId,operatorTrip.memberId]);
    // The selected trip must be locked before its member. Otherwise this
    // settings transaction and the sign-in last-selected-trip FK can deadlock.
    for (const disable of [false,true]) {
      const signInLock=await pool.connect();
      let signalTripLock;
      const enteredTripLock=new Promise(resolve=>{signalTripLock=resolve;});
      const signInPool={connect:async()=>{
        const client=await pool.connect();
        return {query:(sql,...args)=>{
          if (sql.includes("SELECT id FROM trips") && sql.includes("FOR UPDATE")) signalTripLock();
          return client.query(sql,...args);
        },release:()=>client.release()};
      }};
      let login;
      let lockTimeout;
      try {
        await pool.query("UPDATE app_users SET last_selected_trip_id=NULL WHERE id=$1",[operator.userId]);
        await signInLock.query("BEGIN");
        await signInLock.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE",[operatorTrip.tripId]);
        login=signInExistingIdentity(signInPool,config,{identity:operatorIdentity,userAgent:null})
          .then(grant=>({grant}),error=>({error}));
        await Promise.race([enteredTripLock,new Promise((_,reject)=>{
          lockTimeout=setTimeout(()=>reject(new Error("Sign-in did not take the trip-first lock")),3000);
        })]);
        clearTimeout(lockTimeout);
        await signInLock.query("UPDATE trip_members SET role='editor',status=$3 WHERE trip_id=$1 AND id=$2",
          [operatorTrip.tripId,operatorTrip.memberId,disable?"revoked":"active"]);
        await signInLock.query("COMMIT");
        const outcome=await login;
        if (disable) assert.ok(outcome.error instanceof SessionUnavailableError,"sign-in must reject a disabled ranked candidate");
        else {
          assert.equal(outcome.grant?.role,"editor","sign-in must use the role revalidated after the trip lock");
          assert.equal((await verifySession(pool,config,outcome.grant.rawToken)).role,"editor");
        }
      } finally {
        clearTimeout(lockTimeout);
        await signInLock.query("ROLLBACK");
        signInLock.release();
        if (login) await login;
        await pool.query("UPDATE trip_members SET role='owner',status='active' WHERE trip_id=$1 AND id=$2",[operatorTrip.tripId,operatorTrip.memberId]);
      }
    }
    assert.equal((await pool.query("SELECT host_subscription_enabled FROM trip_ai_settings WHERE trip_id=$1",[baseSession.tripId])).rows[0].host_subscription_enabled,true,
      "previous trusted local trips retain their entitlement");
  } finally {
    if (oldSignup===undefined) delete process.env.PUBLIC_SIGNUP_ENABLED; else process.env.PUBLIC_SIGNUP_ENABLED=oldSignup;
    if (oldOperator===undefined) delete process.env.OWNER_GOOGLE_EMAIL; else process.env.OWNER_GOOGLE_EMAIL=oldOperator;
  }
}
