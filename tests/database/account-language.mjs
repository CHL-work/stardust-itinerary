import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { issueAccountOnboarding, verifyAccountOnboarding } from "../../src/lib/auth/account-session.ts";
import { readAccountLocale, readGoogleSignInLocale, saveAccountLocale } from "../../src/lib/auth/locale-preference.ts";
import { revokeSession, signInExistingIdentity, verifySession } from "../../src/lib/auth/repository.ts";
import { createTrip } from "../../src/lib/app/repository.ts";
import { createGuestSession } from "../../src/lib/app/guest.ts";
import { locales } from "../../src/lib/i18n.ts";
import { SessionUnavailableError } from "../../src/lib/auth/errors.ts";

/** Synthetic accounts in the guarded disposable database only; never a live Google or provider call. */
export async function testAccountLanguage(pool, connectionString) {
  await migrate({connectionString});
  const previousSignup=process.env.PUBLIC_SIGNUP_ENABLED, previousGuest=process.env.GUEST_MODE_ENABLED;
  process.env.PUBLIC_SIGNUP_ENABLED="true"; process.env.GUEST_MODE_ENABLED="true";
  const config={authSecret:"synthetic-language-test-secret-only",tripGraceDays:2};
  const identity={issuer:"https://accounts.google.com",subject:`synthetic-language-${randomUUID()}`,
    displayNameHint:"Synthetic language traveler",emailHint:"language-traveler@example.test"};
  try {
    const grant=await issueAccountOnboarding(pool,config,identity);
    const account=await verifyAccountOnboarding(pool,config,grant.rawToken);
    assert.ok(account);
    assert.equal(await readAccountLocale(pool,account.userId),null,"existing data is not relabeled as an explicit choice");
    assert.equal(await readGoogleSignInLocale(pool,identity),"en");
    const ceiling=(await pool.query("SELECT expires_at FROM auth_account_sessions WHERE id=$1",[account.accountSessionId])).rows[0].expires_at;
    for(const locale of locales) await saveAccountLocale(pool,account,locale);
    await saveAccountLocale(pool,account,"ja-JP");
    assert.equal(await readAccountLocale(pool,account.userId),"ja-JP","a no-trip account saves its language");
    assert.equal((await pool.query("SELECT expires_at FROM auth_account_sessions WHERE id=$1",[account.accountSessionId])).rows[0].expires_at.toISOString(),ceiling.toISOString(),"saving language does not extend authentication");
    await assert.rejects(pool.query("UPDATE app_users SET preferred_locale='bogus' WHERE id=$1",[account.userId]),error=>error.constraint==="app_users_preferred_locale_ck");

    const trip=await createTrip(pool,account,{name:"Synthetic language trip",destinationName:"Tokyo, Japan",timeZone:"Asia/Tokyo",defaultLocale:"en",defaultCurrency:"JPY",startsOn:"2031-01-01",endsOn:"2031-01-02",maxMembers:2},{config,userAgent:null});
    const session=await verifySession(pool,config,trip.sessionGrant.rawToken); assert.ok(session);
    await assert.rejects(saveAccountLocale(pool,account,"de"),error=>error instanceof SessionUnavailableError,"consumed onboarding cannot change a preference");
    await saveAccountLocale(pool,session,"fr");
    assert.equal(await readGoogleSignInLocale(pool,identity),"fr");
    assert.equal((await pool.query("SELECT default_locale FROM trips WHERE id=$1",[trip.tripId])).rows[0].default_locale,"en","personal choice does not change the trip");
    await revokeSession(pool,session.sessionId,session.userId);
    await assert.rejects(saveAccountLocale(pool,session,"de"),error=>error instanceof SessionUnavailableError,"revoked sessions cannot save");
    const next=await signInExistingIdentity(pool,config,{identity,userAgent:null});
    assert.equal(next.userId,account.userId); assert.equal(await readGoogleSignInLocale(pool,identity),"fr","fresh login restores the same account choice");

    const otherIdentity={...identity,subject:`synthetic-other-language-${randomUUID()}`};
    const otherGrant=await issueAccountOnboarding(pool,config,otherIdentity);
    const other=await verifyAccountOnboarding(pool,config,otherGrant.rawToken); assert.ok(other);
    await saveAccountLocale(pool,other,"de");
    await assert.rejects(saveAccountLocale(pool,{...other,userId:account.userId},"es"),error=>error instanceof SessionUnavailableError,"a foreign principal never changes this account");
    assert.equal(await readAccountLocale(pool,account.userId),"fr");
    await pool.query("UPDATE app_users SET suspended_at=CURRENT_TIMESTAMP WHERE id=$1",[other.userId]);
    await assert.rejects(saveAccountLocale(pool,other,"es"),error=>error instanceof SessionUnavailableError,"suspension prevents stale language writes");

    const guest=await createGuestSession(pool,config,{userAgent:null,locale:"en",address:`synthetic-language-${randomUUID()}`});
    const guestAccount=await verifyAccountOnboarding(pool,config,guest.grant.rawToken); assert.ok(guestAccount);
    await saveAccountLocale(pool,guestAccount,"zh-HK-lihkg");
    assert.equal(await readAccountLocale(pool,guest.userId),"zh-HK-lihkg","zero-trip guests also remember an explicit selection");
    assert.equal(await readGoogleSignInLocale(pool,identity),"fr","guest choices never overwrite the real identity");
    await pool.query("UPDATE auth_account_sessions SET created_at=CURRENT_TIMESTAMP - interval '16 minutes', expires_at=CURRENT_TIMESTAMP - interval '1 minute' WHERE id=$1",[guestAccount.accountSessionId]);
    await assert.rejects(saveAccountLocale(pool,guestAccount,"es"),error=>error instanceof SessionUnavailableError,"expired guests cannot save");
  } finally {
    if(previousSignup===undefined)delete process.env.PUBLIC_SIGNUP_ENABLED;else process.env.PUBLIC_SIGNUP_ENABLED=previousSignup;
    if(previousGuest===undefined)delete process.env.GUEST_MODE_ENABLED;else process.env.GUEST_MODE_ENABLED=previousGuest;
  }
}
