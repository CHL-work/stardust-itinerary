import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), overview: vi.fn(), generate: vi.fn(), pool: vi.fn(), operator: vi.fn() }));
const tripId = "10000000-0000-4000-8000-000000000001";
const tripDayId = "10000000-0000-4000-8000-000000000002";
const config: AuthConfig = { appBaseUrl: new URL("https://map-test.invalid"), allowedOrigins: new Set(["https://map-test.invalid"]), authSecret: "a".repeat(32), databaseUrl: "postgresql://local/test", googleClientId: "synthetic-id", googleClientSecret: "synthetic-secret", tripGraceDays: 2 };
const session = { tripId, memberId: "member", userId: "user", sessionId: "session", generation: 1, role: "editor" } as AuthenticatedSession;
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", async (original) => ({ ...await original<typeof import("@/lib/auth/web")>(), requireAuthenticatedSession: mocks.authenticate }));
vi.mock("@/lib/app/repository", async (original) => ({ ...await original<typeof import("@/lib/app/repository")>(), getAppOverview: mocks.overview }));
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.pool }));
vi.mock("@/lib/auth/operator-access", () => ({ isPlatformOperator: mocks.operator }));
vi.mock("@/lib/maps/service", async (original) => ({ ...await original<typeof import("@/lib/maps/service")>(), generateDayMap: mocks.generate }));
import { POST } from "./route";

function request(body: unknown = { tripDayId, locale: "en" }, headers: Record<string, string> = {}) {
  return new NextRequest(`${config.appBaseUrl}/api/trips/${tripId}/map`, { method: "POST", headers: { "content-type": "application/json", origin: config.appBaseUrl.origin, ...headers }, body: JSON.stringify(body) });
}
function post(req = request(), target = tripId) { return POST(req, { params: Promise.resolve({ tripId: target }) }); }
function privateResponse(response: Response) { expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie"); }

describe("authenticated daily map POST", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.authenticate.mockResolvedValue(session); mocks.pool.mockReturnValue("synthetic-pool"); mocks.overview.mockResolvedValue({ safe: true });
    mocks.operator.mockResolvedValue(false);
    mocks.generate.mockImplementation(async ({ loadOverview }) => { await loadOverview(); await loadOverview(); return { status: "not_configured", reason: "map_not_configured", stops: [], viewport: null, imageDataUrl: null }; });
  });

  it("defaults private opt-in off and reads only the freshly authenticated authorized projection", async () => {
    const response = await post(); expect(response.status).toBe(200); privateResponse(response);
    expect(await response.json()).toMatchObject({ status: "not_configured" });
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ userId: "user", bypassRequestQuota: false, input: { tripDayId, includePrivate: false, locale: "en" } });
    expect(mocks.authenticate).toHaveBeenCalledTimes(3);
    expect(mocks.overview).toHaveBeenCalledTimes(2);
    expect(mocks.overview).toHaveBeenCalledWith("synthetic-pool", session);
  });

  it("exempts only the server-verified operator, independently of their trip role", async () => {
    mocks.operator.mockResolvedValue(true);
    expect((await post()).status).toBe(200);
    expect(mocks.operator).toHaveBeenCalledWith("synthetic-pool", session.userId);
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ userId: session.userId, bypassRequestQuota: true });
  });

  it("does not infer platform operator access from trip ownership", async () => {
    mocks.authenticate.mockResolvedValue({ ...session, role: "owner" });
    expect((await post()).status).toBe(200);
    expect(mocks.generate.mock.calls[0][0].bypassRequestQuota).toBe(false);
  });

  it("fails closed before provider work if the operator identity cannot be read", async () => {
    mocks.operator.mockRejectedValueOnce(new Error("synthetic lookup unavailable"));
    const response = await post();
    expect(response.status).toBe(500); privateResponse(response);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"])("accepts an explicit opt-in in %s", async (locale) => {
    expect((await post(request({ tripDayId, includePrivate: true, locale }))).status).toBe(200);
    expect(mocks.generate.mock.calls[0][0].input).toEqual({ tripDayId, includePrivate: true, locale });
  });

  it("rejects cross-origin requests before authorization or provider work", async () => {
    const response = await post(request(undefined, { origin: "https://foreign.invalid" }));
    expect(response.status).toBe(401); privateResponse(response); expect(mocks.authenticate).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and foreign-trip requests without provider work", async () => {
    mocks.authenticate.mockRejectedValueOnce(new SessionUnavailableError());
    const missing = await post(); expect(missing.status).toBe(401); privateResponse(missing);
    const foreign = await post(request(), "20000000-0000-4000-8000-000000000002"); expect(foreign.status).toBe(403); privateResponse(foreign);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each([
    { tripDayId: "bad", locale: "en" }, { tripDayId, locale: "ko-KR" }, { tripDayId, locale: "en", includePrivate: "true" },
    { tripDayId, locale: "en", locationName: "browser-injected-location" }, { tripDayId, locale: "en", userId: "forged" },
    { tripDayId, locale: "en", bypassRequestQuota: true }, { tripDayId, locale: "en", isPlatformOperator: true },
  ])("rejects strict malformed input without echoing submitted fields %#", async (body) => {
    const response = await post(request(body)); expect(response.status).toBe(400); privateResponse(response);
    expect(await response.json()).toEqual({ error: "map_invalid_input" }); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("bounds declared and streamed request bytes and requires JSON", async () => {
    for (const req of [request(undefined, { "content-length": "2049" }), request({ tripDayId, locale: "en", padding: "x".repeat(3000) }), request(undefined, { "content-type": "text/plain" })]) {
      const response = await post(req); expect(response.status).toBe(400); privateResponse(response);
    }
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("stops late delivery after revocation", async () => {
    mocks.authenticate.mockResolvedValueOnce(session).mockResolvedValueOnce(session).mockRejectedValueOnce(new SessionUnavailableError());
    const response = await post(); expect(response.status).toBe(401); privateResponse(response);
    expect(await response.text()).not.toContain("imageDataUrl");
  });

  it.each(["sessionId", "userId", "memberId", "tripId", "generation", "role"])("rejects a changed authentication %s during delivery", async (field) => {
    mocks.authenticate.mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session, [field]: "changed" });
    const response = await post(); expect(response.status).toBe(403); privateResponse(response); expect(mocks.overview).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "map_forbidden" });
  });

  it("never reflects provider diagnostics on unexpected errors", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("KEY=synthetic-private-provider-key"));
    const response = await post(); expect(response.status).toBe(500); privateResponse(response);
    expect(await response.text()).not.toContain("synthetic-private-provider-key");
  });
});
