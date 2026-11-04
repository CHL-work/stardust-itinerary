import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({ origin: vi.fn(), limit: vi.fn(), create: vi.fn(), turnstile: vi.fn() }));
const config = { appBaseUrl: new URL("https://stardust.test"), allowedOrigins: new Set(["https://stardust.test"]),
  authSecret: "synthetic", databaseUrl: "postgresql://local/test", tripGraceDays: 2 };
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/auth/repository", () => ({ enforceRateLimit: mocks.limit }));
vi.mock("@/lib/auth/web", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/web")>(), requireSameOrigin: mocks.origin,
}));
vi.mock("@/lib/app/guest", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/app/guest")>(), createGuestSession: mocks.create, verifyTurnstile: mocks.turnstile,
}));
import { POST } from "./route";

function request(body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://stardust.test/api/auth/guest", {
    method: "POST",
    headers: { origin: "https://stardust.test", "content-type": "application/json", "user-agent": "Synthetic browser",
      "cf-connecting-ip": "203.0.113.7", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const grant = { rawToken: "synthetic-session-token", sessionId: "s", tripId: "t", memberId: "m", userId: "u", role: "owner",
  expiresAt: new Date("2030-01-02T00:00:00Z"), absoluteExpiresAt: new Date("2030-01-02T00:00:00Z") };

describe("starting a guest trip", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GUEST_MODE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "synthetic-turnstile-secret");
    vi.stubEnv("GUEST_ALLOW_WITHOUT_TURNSTILE", "");
    mocks.turnstile.mockResolvedValue(true);
    mocks.create.mockResolvedValue({ grant, tripId: "synthetic-trip" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not exist unless the operator turns guest mode on", async () => {
    vi.stubEnv("GUEST_MODE_ENABLED", "false");
    expect((await POST(request({}))).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses to run without Turnstile unless the operator explicitly waives it", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("TURNSTILE_SITE_KEY", "synthetic-site-key");
    const response = await POST(request({}));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "GUEST_UNAVAILABLE" });
    vi.stubEnv("GUEST_ALLOW_WITHOUT_TURNSTILE", "true");
    expect((await POST(request({}))).status).toBe(201);
    expect(mocks.turnstile).not.toHaveBeenCalled();
  });

  it("limits by Cloudflare's address, checks Turnstile for this site, and sets only the session cookie", async () => {
    const response = await POST(request({ turnstileToken: "synthetic-token", locale: "ja-JP" },
      { "x-forwarded-for": "198.51.100.1", "user-agent": "Another browser" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ tripId: "synthetic-trip" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("synthetic-session-token");
    expect(mocks.limit).toHaveBeenCalledWith("pool", config, { scope: "guest-create", key: "203.0.113.7", maximum: 3, windowSeconds: 3600 });
    expect(mocks.turnstile).toHaveBeenCalledWith("synthetic-token", "203.0.113.7", { hostname: "stardust.test", action: "guest" });
    expect(mocks.create).toHaveBeenCalledWith("pool", config, { userAgent: "Another browser", locale: "ja-JP", address: "203.0.113.7" });
    expect(mocks.limit.mock.invocationCallOrder[0]!).toBeLessThan(mocks.create.mock.invocationCallOrder[0]!);
  });

  it("refuses a failed person check, over-limit callers and unknown fields before creating anything", async () => {
    mocks.turnstile.mockResolvedValueOnce(false);
    const failed = await POST(request({ turnstileToken: "bad" }));
    expect(failed.status).toBe(403);
    expect(await failed.json()).toMatchObject({ code: "GUEST_CHALLENGE_FAILED" });
    mocks.limit.mockRejectedValueOnce(new RateLimitError(900));
    const limited = await POST(request({}));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
    expect((await POST(request({ tripId: "someone-else" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    mocks.origin.mockImplementationOnce(() => { throw new Error("origin"); });
    expect((await POST(request({}))).status).toBe(500);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
