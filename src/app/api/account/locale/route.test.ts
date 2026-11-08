import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({configured:vi.fn(),session:vi.fn(),account:vi.fn(),save:vi.fn()}));
const config={appBaseUrl:new URL("https://stardust.test"),allowedOrigins:new Set(["https://stardust.test"])};
vi.mock("@/lib/auth/config",()=>({isAuthConfigured:mocks.configured,getAuthConfig:()=>config}));
vi.mock("@/lib/auth/web",async(original)=>({...await original<typeof import("@/lib/auth/web")>(),authenticatedSession:mocks.session}));
vi.mock("@/lib/auth/account-session",()=>({accountCookieName:"stardust.account-onboarding",verifyAccountOnboarding:mocks.account}));
vi.mock("@/lib/auth/locale-preference",()=>({saveAccountLocale:mocks.save}));
vi.mock("@/lib/db/pool",()=>({getPool:()=>"synthetic-pool"}));
import { PUT } from "./route";
function request(body:unknown={locale:"fr"},cookie="",origin="https://stardust.test") {
  return new NextRequest("https://stardust.test/api/account/locale",{method:"PUT",headers:{origin,cookie,"content-type":"application/json"},body:JSON.stringify(body)});
}
describe("account language API",()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.configured.mockReturnValue(true);mocks.session.mockResolvedValue(null);mocks.account.mockResolvedValue(null);});
  it("remembers an anonymous choice only in a safe year-long cookie",async()=>{
    const response=await PUT(request());expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("stardust.locale=fr");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=31536000");
    expect(response.headers.get("cache-control")).toBe("no-store");expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["session","account"] as const)("saves only the server-bound %s principal",async(kind)=>{
    const principal={userId:"account-only",...(kind==="account" ? {kind:"account"}: {})};mocks[kind].mockResolvedValue(principal);
    expect((await PUT(request())).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("synthetic-pool",principal,"fr");
  });
  it("refuses account spoofing, unknown locales, cross-origin and stale cookies",async()=>{
    expect((await PUT(request({locale:"fr",userId:"victim"}))).status).toBe(400);
    expect((await PUT(request({locale:"invalid"}))).status).toBe(400);
    expect((await PUT(request({},"","https://evil.test"))).status).toBe(403);
    expect((await PUT(request({locale:"en"},"stardust.session=expired"))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not claim success or replace the cookie when database persistence fails",async()=>{
    mocks.session.mockResolvedValue({userId:"account-only"});mocks.save.mockRejectedValue(new Error("internal database detail"));
    const response=await PUT(request());expect(response.status).toBe(503);expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain("internal database detail");
  });
  it("bounds actual input bytes even without a content-length header",async()=>{
    expect((await PUT(request({locale:"x".repeat(1000)}))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("works without auth configuration for an isolated preview, but still refuses CSRF",async()=>{
    mocks.configured.mockReturnValue(false);expect((await PUT(request())).status).toBe(200);
    expect((await PUT(request({},"","https://evil.test"))).status).toBe(403);expect(mocks.save).not.toHaveBeenCalled();
  });
});
