import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { authCookieNames } from "@/lib/auth/web";

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
  revokeSession: vi.fn(),
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
vi.mock("@/lib/auth/repository", () => ({ revokeSession: mocks.revokeSession }));
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));
vi.mock("@/lib/auth/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/web")>();
  return { ...actual, requireAuthenticatedSession: mocks.requireAuthenticatedSession };
});

import { POST } from "@/app/api/auth/sign-out/route";

function signOutRequest() {
  return new NextRequest(`${config.appBaseUrl.origin}/api/auth/sign-out`, {
    method: "POST",
    headers: { origin: config.appBaseUrl.origin },
  });
}

describe("POST /api/auth/sign-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.requireAuthenticatedSession.mockResolvedValue({
      sessionId: "30000000-0000-4000-8000-000000000001",
      tripId: "10000000-0000-4000-8000-000000000001",
      memberId: "20000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000002",
      role: "editor",
      expiresAt: new Date("2030-04-04T00:00:00.000Z"),
      absoluteExpiresAt: new Date("2030-04-06T00:00:00.000Z"),
      displayName: "Synthetic member",
      issuer: "https://accounts.google.com",
      subject: "synthetic-subject",
      generation: 1,
    });
  });

  it("revokes the current session and clears its browser cookie", async () => {
    const response = await POST(signOutRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedOut: true });
    expect(mocks.revokeSession).toHaveBeenCalledOnce();
    expect(mocks.revokeSession).toHaveBeenCalledWith(
      { synthetic: true },
      "30000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    );

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${authCookieNames.session}=;`);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });
});
