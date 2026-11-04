import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "@/lib/auth/config";
import { completeCalendarAuthorization, createCalendarAuthorizationTransaction, googleCalendarScope } from "./google-auth";
const config = { appBaseUrl: new URL("http://localhost:3100"), googleClientId: "synthetic-client", googleClientSecret: "synthetic-secret" } as AuthConfig;
const callback = new URL("http://localhost:3100/api/integrations/google-calendar/callback?state=expected&code=synthetic-code");
afterEach(() => vi.unstubAllGlobals());
describe("verified identity for the independently connected Calendar account", () => {
  it("requests only existing Calendar-event access plus basic OIDC identity", () => {
    const transaction = createCalendarAuthorizationTransaction(config);
    expect(transaction.authorizationUrl.searchParams.get("scope")?.split(" ")).toEqual([googleCalendarScope, "openid"]);
    expect(transaction.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("takes the subject only from the access token's official userinfo response", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", verified_account_subject: "untrusted-token-field" });
      expect(String(url)).toBe("https://openidconnect.googleapis.com/v1/userinfo");
      expect(init?.headers).toEqual({ authorization: "Bearer synthetic-access" });
      return Response.json({ sub: "other-calendar-account", email: "not-retained@example.invalid", name: "Not retained" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await completeCalendarAuthorization(config, callback, "expected", "verifier");
    expect(result.verified_account_subject).toBe("other-calendar-account");
    expect(result).not.toHaveProperty("email"); expect(result).not.toHaveProperty("name");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([401, 503])("fails closed when userinfo returns %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ access_token: "synthetic-access" })).mockResolvedValueOnce(new Response(null, { status })));
    await expect(completeCalendarAuthorization(config, callback, "expected", "verifier")).rejects.toThrow("identity");
  });
  it("rejects missing subject and foreign OAuth state", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "synthetic-access" })).mockResolvedValueOnce(Response.json({ email: "not-identity@example.invalid" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeCalendarAuthorization(config, callback, "foreign-state", "verifier")).rejects.toThrow("transaction");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(completeCalendarAuthorization(config, callback, "expected", "verifier")).rejects.toThrow();
  });
});
