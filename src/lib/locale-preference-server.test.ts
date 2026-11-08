import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeCookieName } from "@/lib/locale-preference";
import { authCookieNames } from "@/lib/auth/web";
import { accountCookieName } from "@/lib/auth/account-session";

const mocks = vi.hoisted(() => ({configured:vi.fn(),session:vi.fn(),account:vi.fn(),locale:vi.fn()}));
vi.mock("@/lib/auth/config",()=>({isAuthConfigured:mocks.configured,getAuthConfig:()=>({})}));
vi.mock("@/lib/auth/repository",()=>({verifySession:mocks.session}));
vi.mock("@/lib/auth/account-session",()=>({accountCookieName:"stardust.account-onboarding",verifyAccountOnboarding:mocks.account}));
vi.mock("@/lib/auth/locale-preference",()=>({readAccountLocale:mocks.locale}));
vi.mock("@/lib/db/pool",()=>({getPool:()=>"synthetic-pool"}));
import { resolveLocalePreference } from "./locale-preference-server";

function jar(values:Record<string,string>={}) {return {get:(name:string)=>values[name] ? {value:values[name]} : undefined};}
describe("language resolution for returning users",()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.configured.mockReturnValue(true);mocks.session.mockResolvedValue(null);mocks.account.mockResolvedValue(null);mocks.locale.mockResolvedValue(null);});
  it("uses English for a new browser, without creating any account",async()=>{
    expect(await resolveLocalePreference(jar())).toEqual({locale:"en",session:null,account:null});
    expect(mocks.locale).not.toHaveBeenCalled();
  });
  it("uses saved account language over an old device cookie",async()=>{
    mocks.session.mockResolvedValue({userId:"account-a"});mocks.locale.mockResolvedValue("fr");
    expect((await resolveLocalePreference(jar({[authCookieNames.session]:"session",[localeCookieName]:"ja-JP"}))).locale).toBe("fr");
    expect(mocks.locale).toHaveBeenCalledWith("synthetic-pool","account-a");
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it("loads a no-trip account or guest preference without a trip session",async()=>{
    mocks.account.mockResolvedValue({kind:"account",userId:"new-account"});mocks.locale.mockResolvedValue("es");
    const result=await resolveLocalePreference(jar({[accountCookieName]:"onboarding"}));
    expect(result.locale).toBe("es");expect(result.session).toBeNull();expect(result.account).toMatchObject({userId:"new-account"});
  });
  it("invalid sessions cannot read account preferences and local previews need no database",async()=>{
    expect((await resolveLocalePreference(jar({[authCookieNames.session]:"expired",[localeCookieName]:"de"}))).locale).toBe("de");
    expect(mocks.locale).not.toHaveBeenCalled();
    mocks.configured.mockReturnValue(false);
    expect((await resolveLocalePreference(jar())).locale).toBe("en");
  });
});
