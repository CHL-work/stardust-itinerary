import type {Pool} from "pg";
import {describe,expect,it,vi} from "vitest";
import type {AuthConfig} from "@/lib/auth/config";
import {issueClaim,revokeClaims,issueJoinLink,revokeJoinLink,revokeMemberSessions,unbindMemberIdentity,consumeClaim,signInExistingIdentity} from "@/lib/auth/repository";
import {ClaimUnavailableError,SessionUnavailableError} from "@/lib/auth/errors";

const input={tripId:"10000000-0000-4000-8000-000000000001",memberId:"20000000-0000-4000-8000-000000000001",
  actorMemberId:"20000000-0000-4000-8000-000000000002",actorUserId:"30000000-0000-4000-8000-000000000002"};
const config={authSecret:"s".repeat(32),tripGraceDays:2} as AuthConfig;
function database() {
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes("SELECT t.max_members")) return {rows:[{max_members:10,member_count:2}],rowCount:1};
    if(sql.includes("($3::uuid IS NULL OR user_id=$3)")) return {rows:[],rowCount:0};
    if(sql.includes("FOR UPDATE OF tm")) return {rows:[{role:"editor",status:"revoked"}],rowCount:1};
    if(sql.includes("FROM trip_members")) return {rows:[{role:"editor",status:"invited"}],rowCount:1};
    if(sql.includes("SELECT id, trip_id, member_id")) return {rows:[{id:"claim",trip_id:input.tripId,member_id:input.memberId}],rowCount:1};
    return {rows:[{id:input.tripId}],rowCount:1};
  });
  const pool={connect:vi.fn(async()=>({query,release:vi.fn()}))} as unknown as Pool;
  return {query,pool};
}
describe("auth owner mutations serialize with role/removal changes",()=>{
  it.each([
    ["issue claim",(pool:Pool)=>issueClaim(pool,config,input)],
    ["revoke claim",(pool:Pool)=>revokeClaims(pool,input)],
    ["issue reusable invite",(pool:Pool)=>issueJoinLink(pool,config,input)],
    ["revoke reusable invite",(pool:Pool)=>revokeJoinLink(pool,input)],
    ["revoke sessions",(pool:Pool)=>revokeMemberSessions(pool,input)],
    ["unbind identity",(pool:Pool)=>unbindMemberIdentity(pool,input)],
  ] as const)("%s locks the trip before actor/target and denies a rebound/demoted owner",async(_,action)=>{
    const db=database();
    await expect(action(db.pool)).rejects.toBeInstanceOf(SessionUnavailableError);
    const statements=db.query.mock.calls.map(([sql])=>sql);
    const trip=statements.findIndex((sql)=>sql.includes("FROM trips")&&sql.includes("FOR UPDATE"));
    const actor=statements.findIndex((sql)=>sql.includes("user_id=$3"));
    expect(trip).toBeGreaterThan(0);
    expect(actor).toBeGreaterThan(trip);
    expect(statements[actor]).toContain("FOR UPDATE");
    expect(db.query).toHaveBeenCalledWith(statements[actor],[input.tripId,input.actorMemberId,input.actorUserId]);
    expect(statements.some((sql)=>/^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(false);
  });
  it("takes the claim trip lock before reading the mutable member identity",async()=>{
    const db=database();
    await expect(consumeClaim(db.pool,config,{rawToken:"a".repeat(43),identity:{issuer:"https://accounts.google.com",subject:"test",emailHint:null,displayNameHint:null},userAgent:null}))
      .rejects.toBeInstanceOf(ClaimUnavailableError);
    const statements=db.query.mock.calls.map(([sql])=>sql);
    const trip=statements.findIndex((sql)=>sql.includes("SELECT id FROM trips"));
    const member=statements.findIndex((sql)=>sql.includes("FOR UPDATE OF tm"));
    expect(member).toBeGreaterThan(trip);
  });
});

describe("existing Google sign-in lock ordering",()=>{
  it.each([true,false])("locks the ranked trip before revalidating the membership (still active: %s)",async(active)=>{
    const identity={issuer:"https://accounts.google.com",subject:"synthetic-sign-in",emailHint:null,displayNameHint:null};
    const selected={trip_id:input.tripId,member_id:input.actorMemberId,user_id:input.actorUserId,role:"owner",absolute_expires_at:new Date("2040-01-01T00:00:00Z")};
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes("ORDER BY") && sql.includes("last_selected_trip_id")) return {rows:[selected],rowCount:1};
      if(sql.includes("FOR UPDATE OF tm")) return {rows:active?[{...selected,role:"editor"}]:[],rowCount:active?1:0};
      return {rows:[{id:input.tripId}],rowCount:1};
    });
    const pool={connect:vi.fn(async()=>({query,release:vi.fn()}))} as unknown as Pool;
    const operation=signInExistingIdentity(pool,config,{identity,userAgent:null});
    if(active) await expect(operation).resolves.toMatchObject({tripId:input.tripId,memberId:input.actorMemberId,role:"editor"});
    else await expect(operation).rejects.toBeInstanceOf(SessionUnavailableError);
    const statements=query.mock.calls.map(([sql])=>sql);
    const rank=statements.findIndex(sql=>sql.includes("last_selected_trip_id")&&sql.includes("ORDER BY"));
    const trip=statements.findIndex(sql=>sql.includes("SELECT id FROM trips")&&sql.includes("FOR UPDATE"));
    const member=statements.findIndex(sql=>sql.includes("FOR UPDATE OF tm"));
    expect(statements[rank]).not.toContain("FOR UPDATE");
    expect(trip).toBeGreaterThan(rank);
    expect(member).toBeGreaterThan(trip);
    expect(query).toHaveBeenCalledWith(statements[member],[identity.issuer,identity.subject,
      input.actorUserId,input.tripId,input.actorMemberId]);
    if(!active) expect(statements.some(sql=>/^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(false);
  });
});
