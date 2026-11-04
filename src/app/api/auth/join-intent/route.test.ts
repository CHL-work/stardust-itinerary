import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { authCookieNames } from "@/lib/auth/web";

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  getPool: vi.fn(),
  previewJoinLink: vi.fn(),
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
vi.mock("@/lib/auth/repository", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  previewJoinLink: mocks.previewJoinLink,
}));
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));

import { POST } from "@/app/api/auth/join-intent/route";

const token = "A".repeat(43);

function request(origin = config.appBaseUrl.origin) {
  return new NextRequest(`${config.appBaseUrl.origin}/api/auth/join-intent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ token }),
  });
}

describe("POST /api/auth/join-intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.previewJoinLink.mockResolvedValue({
      tripId: "10000000-0000-4000-8000-000000000001",
      tripName: "Synthetic trip",
      maxMembers: 10,
      memberCount: 2,
      remainingSeats: 8,
    });
  });

  it("stores an accepted token only in a secure HttpOnly intent cookie", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${authCookieNames.joinIntent}=${token}`);
    expect(setCookie).toContain("; Path=/;");
    expect(setCookie).toContain("; Max-Age=900;");
    expect(setCookie).toContain("; Secure; HttpOnly; SameSite=lax;");
    expect(setCookie).toMatch(/stardust\.claim-intent=;/i);
    expect(mocks.enforceRateLimit).toHaveBeenCalledOnce();
    expect(mocks.previewJoinLink).toHaveBeenCalledWith(
      { synthetic: true },
      config,
      token,
    );
  });

  it("rejects cross-origin token capture before database work", async () => {
    await expect(POST(request("https://attacker.invalid"))).rejects.toThrow(
      "The request origin is not allowed.",
    );

    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.previewJoinLink).not.toHaveBeenCalled();
  });
});
