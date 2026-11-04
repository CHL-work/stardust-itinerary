import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { ClaimUnavailableError, MembershipDisabledError, RateLimitError, SessionUnavailableError } from "@/lib/auth/errors";
import { authCookieNames } from "@/lib/auth/web";

const mocks = vi.hoisted(() => ({
  authenticatedSession: vi.fn(),
  completeGoogleAuthorization: vi.fn(),
  consumeClaim: vi.fn(),
  consumeJoinLink: vi.fn(),
  enforceRateLimit: vi.fn(),
  getPool: vi.fn(),
  signInExistingIdentity: vi.fn(),
  issueAccountOnboarding: vi.fn(),
  publicSignupEnabled: vi.fn(),
}));

const config: AuthConfig = {
  appBaseUrl: new URL("https://stardust-itinerary.chl-work.com"),
  allowedOrigins: new Set(["https://stardust-itinerary.chl-work.com"]),
  authSecret: "a".repeat(32),
  databaseUrl: "postgresql://local/test",
  googleClientId: "synthetic-client-id",
  googleClientSecret: "synthetic-client-secret",
  tripGraceDays: 2,
};

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/google", () => ({
  completeGoogleAuthorization: mocks.completeGoogleAuthorization,
}));
vi.mock("@/lib/auth/repository", () => ({
  consumeClaim: mocks.consumeClaim,
  consumeJoinLink: mocks.consumeJoinLink,
  enforceRateLimit: mocks.enforceRateLimit,
  signInExistingIdentity: mocks.signInExistingIdentity,
}));
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));
vi.mock("@/lib/auth/account-session",async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/account-session")>();
  return {...actual,issueAccountOnboarding:mocks.issueAccountOnboarding,publicSignupEnabled:mocks.publicSignupEnabled};
});
vi.mock("@/lib/auth/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/web")>();
  return { ...actual, authenticatedSession: mocks.authenticatedSession };
});

import { GET } from "@/app/api/auth/google/callback/route";

function callbackRequest(cookies: Record<string, string>) {
  return new NextRequest(`${config.appBaseUrl.origin}/api/auth/google/callback?code=synthetic`, {
    headers: {
      cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; "),
      "user-agent": "Synthetic browser",
    },
  });
}

function expectIntentCookiesCleared(response: Response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  for (const name of [
    authCookieNames.oauthState,
    authCookieNames.oauthNonce,
    authCookieNames.oauthVerifier,
    authCookieNames.claimIntent,
    authCookieNames.joinIntent,
  ]) {
    expect(setCookie).toMatch(new RegExp(`${name.replace(".", "\\.")}=;`));
  }
}

function sessionGrant(rawToken: string) {
  return {
    rawToken,
    sessionId: "synthetic-session",
    tripId: "synthetic-trip",
    memberId: "synthetic-member",
    userId: "synthetic-user",
    role: "editor" as const,
    expiresAt: new Date("2030-04-02T00:00:00.000Z"),
    absoluteExpiresAt: new Date("2030-04-03T00:00:00.000Z"),
  };
}

describe("GET /api/auth/google/callback invitation cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.authenticatedSession.mockResolvedValue(null);
    mocks.publicSignupEnabled.mockReturnValue(false);
    mocks.completeGoogleAuthorization.mockResolvedValue({
      issuer: "https://accounts.google.com",
      subject: "synthetic-subject",
      emailHint: "traveler@example.test",
      displayNameHint: "Traveler",
    });
  });

  it("issues only a narrow onboarding grant after no-intent Google login when signup is enabled",async () => {
    mocks.publicSignupEnabled.mockReturnValue(true);
    mocks.signInExistingIdentity.mockRejectedValue(new SessionUnavailableError("No eligible membership"));
    mocks.issueAccountOnboarding.mockResolvedValue({rawToken:"synthetic-onboarding",expiresAt:new Date("2030-01-01")});
    const response = await GET(callbackRequest({[authCookieNames.oauthState]:"state",[authCookieNames.oauthNonce]:"nonce",[authCookieNames.oauthVerifier]:"verifier"}));
    expect(response.headers.get("location")).toBe(`${config.appBaseUrl.origin}/trips/new`);
    expect(response.headers.get("set-cookie")).toContain("stardust.account-onboarding=synthetic-onboarding");
    expect(mocks.issueAccountOnboarding).toHaveBeenCalledOnce();
    expect(mocks.consumeClaim).not.toHaveBeenCalled();
  });

  it("does not turn an unavailable invitation into public onboarding",async () => {
    mocks.publicSignupEnabled.mockReturnValue(true);
    mocks.consumeClaim.mockRejectedValue(new ClaimUnavailableError());
    const log = vi.spyOn(console,"error").mockImplementation(() => undefined);
    try {
      const response = await GET(callbackRequest({[authCookieNames.oauthState]:"state",[authCookieNames.oauthNonce]:"nonce",[authCookieNames.oauthVerifier]:"verifier",[authCookieNames.claimIntent]:"stale-invite"}));
      expect(response.headers.get("location")).toBe(`${config.appBaseUrl.origin}/auth/sign-in?error=claim`);
      expect(mocks.issueAccountOnboarding).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("clears stale invitation and OAuth cookies when the transaction expired", async () => {
    const response = await GET(callbackRequest({
      [authCookieNames.claimIntent]: "stale-claim",
      [authCookieNames.joinIntent]: "stale-join",
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${config.appBaseUrl.origin}/auth/sign-in?error=expired`,
    );
    expectIntentCookiesCleared(response);
    expect(mocks.completeGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("rejects conflicting claim and join intents and clears both", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await GET(callbackRequest({
        [authCookieNames.oauthState]: "state",
        [authCookieNames.oauthNonce]: "nonce",
        [authCookieNames.oauthVerifier]: "verifier",
        [authCookieNames.claimIntent]: "claim-token",
        [authCookieNames.joinIntent]: "join-token",
      }));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `${config.appBaseUrl.origin}/auth/sign-in?error=unbound`,
      );
      expectIntentCookiesCleared(response);
      expect(mocks.consumeClaim).not.toHaveBeenCalled();
      expect(mocks.consumeJoinLink).not.toHaveBeenCalled();
      expect(mocks.signInExistingIdentity).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("clears invitation state when the callback rate limit is exceeded", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new RateLimitError(60));

    const response = await GET(callbackRequest({
      [authCookieNames.oauthState]: "state",
      [authCookieNames.oauthNonce]: "nonce",
      [authCookieNames.oauthVerifier]: "verifier",
      [authCookieNames.joinIntent]: "join-token",
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${config.appBaseUrl.origin}/auth/sign-in?error=rate_limit`,
    );
    expectIntentCookiesCleared(response);
    expect(mocks.completeGoogleAuthorization).not.toHaveBeenCalled();
    expect(mocks.consumeJoinLink).not.toHaveBeenCalled();
  });

  it("reports a disabled bound membership and clears OAuth and invitation state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.signInExistingIdentity.mockRejectedValue(new MembershipDisabledError());
    try {
      const response = await GET(callbackRequest({
        [authCookieNames.oauthState]: "state",
        [authCookieNames.oauthNonce]: "nonce",
        [authCookieNames.oauthVerifier]: "verifier",
      }));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `${config.appBaseUrl.origin}/auth/sign-in?error=disabled`,
      );
      expectIntentCookiesCleared(response);
      expect(mocks.signInExistingIdentity).toHaveBeenCalledOnce();
      expect(mocks.consumeClaim).not.toHaveBeenCalled();
      expect(mocks.consumeJoinLink).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("sets a session for a reusable join and for a later ordinary sign-in", async () => {
    mocks.consumeJoinLink.mockResolvedValueOnce(sessionGrant("joined-session-token"));
    mocks.signInExistingIdentity.mockResolvedValueOnce(sessionGrant("returning-session-token"));

    const joined = await GET(callbackRequest({
      [authCookieNames.oauthState]: "join-state",
      [authCookieNames.oauthNonce]: "join-nonce",
      [authCookieNames.oauthVerifier]: "join-verifier",
      [authCookieNames.joinIntent]: "join-token",
    }));
    expect(joined.status).toBe(307);
    expect(joined.headers.get("location")).toBe(`${config.appBaseUrl.origin}/`);
    expectIntentCookiesCleared(joined);
    expect(joined.headers.get("set-cookie")).toContain(
      `${authCookieNames.session}=joined-session-token`,
    );
    expect(mocks.consumeJoinLink).toHaveBeenCalledOnce();

    const returning = await GET(callbackRequest({
      [authCookieNames.oauthState]: "return-state",
      [authCookieNames.oauthNonce]: "return-nonce",
      [authCookieNames.oauthVerifier]: "return-verifier",
    }));
    expect(returning.status).toBe(307);
    expect(returning.headers.get("location")).toBe(`${config.appBaseUrl.origin}/`);
    expectIntentCookiesCleared(returning);
    expect(returning.headers.get("set-cookie")).toContain(
      `${authCookieNames.session}=returning-session-token`,
    );
    expect(mocks.signInExistingIdentity).toHaveBeenCalledOnce();
  });
});
