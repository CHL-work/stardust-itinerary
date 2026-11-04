import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppConflictError, AppForbiddenError } from "@/lib/app/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), get: vi.fn(), save: vi.fn() }));
const session = { tripId: "trip-a", memberId: "member-a", userId: "user-a", role: "editor" };
const config = { appBaseUrl: new URL("https://stardust.test"), databaseUrl: "postgresql://local/test" };
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/ai/custom-instructions", () => ({ getAiInstructions: mocks.get, saveAiInstructions: mocks.save }));
import { GET, PATCH } from "./route";

const context = { params: Promise.resolve({ tripId: "trip-a" }) };
function request(method = "GET", body?: unknown, query = "") {
  return new NextRequest(`https://stardust.test/api/trips/trip-a/ai/instructions${query}`, {
    method, headers: { origin: "https://stardust.test", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("own AI instructions routes", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.auth.mockResolvedValue(session);
    mocks.get.mockResolvedValue({ instructions: "Relaxed days", revision: 1 });
    mocks.save.mockResolvedValue({ instructions: "", revision: 2 });
  });
  it("reads own settings without caching and without accepting identity parameters", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ instructions: "Relaxed days", revision: 1 });
    expect(mocks.get).toHaveBeenCalledWith("pool", session, "trip-a");
    mocks.get.mockClear();
    expect((await GET(request("GET", undefined, "?userId=other"), context)).status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("saves and clears through same-origin authentication with a revision", async () => {
    const response = await PATCH(request("PATCH", { instructions: "", expectedRevision: 1 }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.origin).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith("pool", session, "trip-a", { instructions: "", expectedRevision: 1 });
  });
  it("rejects cross-origin requests before authentication or saving", async () => {
    mocks.origin.mockImplementation(() => { throw new AppForbiddenError("Invalid origin."); });
    expect((await PATCH(request("PATCH", { instructions: "new", expectedRevision: 1 }), context)).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns no-store authentication and conflict failures without exposing text", async () => {
    mocks.auth.mockRejectedValueOnce(new SessionUnavailableError("Sign in again."));
    const unauthorized = await GET(request(), context);
    expect(unauthorized.status).toBe(401); expect(unauthorized.headers.get("cache-control")).toContain("no-store");
    mocks.save.mockRejectedValueOnce(new AppConflictError("Reload before saving."));
    expect((await PATCH(request("PATCH", { instructions: "new", expectedRevision: 1 }), context)).status).toBe(409);
  });
  it.each([
    { instructions: "x".repeat(8_001), expectedRevision: 1 },
    { instructions: "new" },
    { instructions: "new", expectedRevision: 1, userId: "someone-else" },
  ])("rejects malformed or targeted input before the repository", async (body) => {
    expect((await PATCH(request("PATCH", body), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
