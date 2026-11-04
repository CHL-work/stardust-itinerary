import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unavailableDestination } from "@/lib/app/trip-destination-contract";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), session: vi.fn(), onboarding: vi.fn(), consume: vi.fn() }));
const config = { appBaseUrl: new URL("https://stardust.example"), allowedOrigins: new Set(["https://stardust.example"]) };
const pool = { synthetic: true };
const principal = { userId: "synthetic-authenticated-account", role: "viewer" };
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => pool }));
vi.mock("@/lib/app/trip-destination-service", () => ({ runTripDestinationLookup: mocks.lookup }));
vi.mock("@/lib/auth/web", async (original) => ({ ...await original<typeof import("@/lib/auth/web")>(), authenticatedSession: mocks.session }));
vi.mock("@/lib/auth/account-session", async (original) => ({ ...await original<typeof import("@/lib/auth/account-session")>(),
  verifyAccountOnboarding: mocks.onboarding, consumeAccountOnboarding: mocks.consume }));

import { POST } from "@/app/api/trips/destination-defaults/route";
import { AppConflictError } from "@/lib/app/repository";

const input = { destination: "Japan", locale: "en", requestId: "a0000000-0000-4000-8000-000000000001" };
function request(body: unknown = input, origin = config.appBaseUrl.origin) {
  return new NextRequest(`${config.appBaseUrl.origin}/api/trips/destination-defaults`, { method: "POST",
    headers: { origin, "content-type": "application/json", cookie: "stardust.account-onboarding=synthetic" }, body: JSON.stringify(body) });
}
describe("destination lookup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(principal);
    mocks.onboarding.mockResolvedValue(null);
    mocks.lookup.mockResolvedValue({ ...unavailableDestination("provider_unavailable"), requestId: input.requestId, lookupId: null, source: "none" });
  });
  it("returns safe 200 manual fallback and private no-store without changing account state", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store, private");
    expect((await result.json()).reason).toBe("provider_unavailable");
    expect(mocks.lookup).toHaveBeenCalledWith(pool, config, principal, input);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("verifies but never consumes an onboarding grant", async () => {
    const account = { kind: "account", userId: "verified-account" };
    mocks.session.mockResolvedValue(null);
    mocks.onboarding.mockResolvedValue(account);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.onboarding).toHaveBeenCalledWith(pool, config, "synthetic");
    expect(mocks.lookup).toHaveBeenCalledWith(pool, config, account, input);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("rejects cross-origin before authentication", async () => {
    expect((await POST(request(input, "https://other.example"))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("requires an authenticated principal", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it.each([{ ...input, userId: "spoof" }, { ...input, locale: "invalid" }, { ...input, requestId: "bad" },
    { ...input, destination: "x" }, { ...input, destination: "x".repeat(161) }, null])("rejects strict invalid body %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("preserves idempotency conflict status", async () => {
    mocks.lookup.mockRejectedValue(new AppConflictError("Request ID already used."));
    const result = await POST(request());
    expect(result.status).toBe(409);
    expect(result.headers.get("cache-control")).toBe("no-store, private");
  });
  it.each(["4097", "not-a-number", "-1", "1.5", "1"])("rejects invalid Content-Length %s before lookup", async (length) => {
    const req = request(); req.headers.set("content-length", length);
    expect((await POST(req)).status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("bounds streamed JSON even without Content-Length and rejects non-JSON media", async () => {
    expect((await POST(request({ ...input, destination: "字".repeat(1500) }))).status).toBe(400);
    const req = request(); req.headers.set("content-type", "text/plain");
    expect((await POST(req)).status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
