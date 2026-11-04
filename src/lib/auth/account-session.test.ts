import type { Pool,PoolClient } from "pg";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { AuthConfig } from "@/lib/auth/config";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { consumeAccountOnboarding,issueAccountOnboarding,issueCreatedTripSession,publicSignupEnabled,verifyAccountOnboarding,type AccountPrincipal } from "@/lib/auth/account-session";
import { isPlatformOperator } from "@/lib/auth/operator-access";

const config = {authSecret:"s".repeat(32)} as AuthConfig;
const identity = {issuer:"https://accounts.google.com",subject:"synthetic-subject",emailHint:"synthetic@example.test",displayNameHint:"Synthetic"};
const principal:AccountPrincipal = {kind:"account",accountSessionId:"account",userId:"user",issuer:identity.issuer,subject:identity.subject,displayName:"Synthetic"};
function database(options:{existing?:boolean;valid?:boolean}={}) {
  const query = vi.fn(async (sql:string) => {
    if (sql.startsWith("SELECT user_id FROM oidc_identities")) return {rows:options.existing ? [{user_id:"user"}] : []};
    if (sql.includes("INSERT INTO auth_account_sessions")) return {rows:[{expires_at:new Date("2030-01-01")}]};
    if (sql.includes("SET consumed_at=CURRENT_TIMESTAMP")) return {rows:options.valid === false ? [] : [{absolute_expires_at:new Date("2030-01-31T00:00:00Z")}],rowCount:options.valid === false ? 0 : 1};
    if (sql.includes("SELECT account_session.id")) return {rows:options.valid === false ? [] : [{id:"account",user_id:"user",issuer:identity.issuer,subject:identity.subject,display_name:"Synthetic"}]};
    return {rows:[{}],rowCount:options.valid === false ? 0 : 1};
  });
  const client = {query,release:vi.fn()} as unknown as PoolClient;
  const pool = {connect:vi.fn(async()=>client),query} as unknown as Pool;
  return {query,client,pool};
}
describe("separate account onboarding scope",() => {
  beforeEach(()=>vi.stubEnv("PUBLIC_SIGNUP_ENABLED","true"));
  afterEach(()=>vi.unstubAllEnvs());
  it("is off by default and denies non-Google identities before database work",async()=>{
    const db=database();
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED","");
    expect(publicSignupEnabled()).toBe(false);
    await expect(issueAccountOnboarding(db.pool,config,identity)).rejects.toBeInstanceOf(SessionUnavailableError);
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED","true");
    await expect(issueAccountOnboarding(db.pool,config,{...identity,issuer:"https://attacker.example"})).rejects.toBeInstanceOf(SessionUnavailableError);
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([false,true])("upserts only account identity and a hashed grant, never a trip (existing=%s)",async(existing)=>{
    const db=database({existing});
    const grant=await issueAccountOnboarding(db.pool,config,identity);
    expect(grant.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const sql=db.query.mock.calls.map(([value])=>value).join("\n");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).not.toContain("INSERT INTO trips");
    expect(sql).not.toContain("INSERT INTO auth_sessions (");
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(grant.rawToken);
    expect(sql.includes("INSERT INTO app_users")).toBe(!existing);
  });
  it("rechecks exact OIDC/user binding and expiry without accepting malformed tokens",async()=>{
    const db=database();
    expect(await verifyAccountOnboarding(db.client,config,"invalid")).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(await verifyAccountOnboarding(db.client,config,"a".repeat(43))).toEqual(principal);
    const sql=db.query.mock.calls[0][0];
    expect(sql).toContain("identity.user_id=account_session.user_id");
    expect(sql).toContain("account_session.consumed_at IS NULL");
    expect(sql).toContain("account_session.expires_at>CURRENT_TIMESTAMP");
  });
  it("consumes once inside caller transaction and rejects expiry/replay/flag withdrawal",async()=>{
    const db=database();
    expect(await consumeAccountOnboarding(db.client,principal)).toEqual(new Date("2030-01-31T00:00:00Z"));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("SET consumed_at=CURRENT_TIMESTAMP"),["account","user",identity.issuer,identity.subject]);
    const consumeSql=db.query.mock.calls[0][0];
    expect(consumeSql).toContain("account_session.created_at + interval '720 hours'");
    expect(consumeSql).toContain("WITH locked_account AS MATERIALIZED");
    expect(consumeSql).toContain("locked_account.expires_at>clock_timestamp()");
    expect(consumeSql.indexOf("FOR UPDATE OF account_session")).toBeLessThan(consumeSql.indexOf("locked_account.expires_at>clock_timestamp()"));
    expect(consumeSql).not.toContain("last_authenticated_at");
    await expect(consumeAccountOnboarding(database({valid:false}).client,principal)).rejects.toBeInstanceOf(SessionUnavailableError);
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED","false");
    const disabled=database();
    await expect(consumeAccountOnboarding(disabled.client,principal)).rejects.toBeInstanceOf(SessionUnavailableError);
    expect(disabled.query).not.toHaveBeenCalled();
  });
  it("issues a created-trip session using only its trusted inherited ceiling, never trip dates",async()=>{
    const db=database();
    const cap=new Date(Date.now()+5*60_000);
    const grant=await issueCreatedTripSession(db.client,config,{tripId:"new-trip",memberId:"new-member",userId:"user",userAgent:null,absoluteExpiresAt:cap});
    expect(grant.absoluteExpiresAt).toEqual(cap);
    expect(grant.expiresAt).toEqual(cap);
    const sql=db.query.mock.calls.map(([value])=>value).join("\n");
    expect(sql).not.toContain("FROM trips");
    expect(sql).not.toContain("make_interval");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO auth_sessions"),expect.arrayContaining([cap]));
    const expired=database();
    await expect(issueCreatedTripSession(expired.client,config,{tripId:"new-trip",memberId:"new-member",userId:"user",userAgent:null,absoluteExpiresAt:new Date(0)})).rejects.toThrow(SessionUnavailableError);
    expect(expired.query).not.toHaveBeenCalled();
  });
});

describe("platform operator is not a trip role",()=>{
  afterEach(()=>vi.unstubAllEnvs());
  it("requires configured email and stored exact Google identity for the app user",async()=>{
    const db=database();
    vi.stubEnv("OWNER_GOOGLE_EMAIL","");
    expect(await isPlatformOperator(db.client,"user")).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
    vi.stubEnv("OWNER_GOOGLE_EMAIL"," SYNTHETIC@example.test ");
    expect(await isPlatformOperator(db.client,"user")).toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("issuer = 'https://accounts.google.com'"),["user","synthetic@example.test"]);
    expect(db.query.mock.calls[0][0]).not.toContain("role");
  });
});
