import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), get: vi.fn(), save: vi.fn(), claim: vi.fn(), run: vi.fn(), limit: vi.fn(), after: vi.fn() }));
const session = { tripId: "trip-a", memberId: "member-a", userId: "user-a", role: "editor" };
const config = { appBaseUrl: new URL("https://stardust.test"), databaseUrl: "postgresql://local/test", authSecret: "synthetic" };
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/ai/preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/preferences")>(),
  getAiPreferences: mocks.get, saveAiPreferences: mocks.save, claimRoutineAutoCheck: mocks.claim, runRoutineAutoCheck: mocks.run,
  limitRoutineSearchChecks: mocks.limit,
}));
import { PATCH, POST } from "./route";

const context = { params: Promise.resolve({ tripId: "trip-a" }) };
const request = (method: string, body?: unknown) => new NextRequest("https://stardust.test/api/trips/trip-a/ai/preferences", {
  method, headers: { origin: "https://stardust.test", "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
});
const view = { chatEffort: null, providers: ["openai"], revision: 3, routine: { enabled: false, model: null, effort: "medium", active: false,
  lastCheckAt: null, checksToday: 0, optedOut: false, autoCheck: { state: "running", model: "gpt-6-astra", reason: null } } };

describe("AI preferences route (JOB-094, JOB-096)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.get.mockResolvedValue(view);
    mocks.save.mockResolvedValue(view);
    mocks.claim.mockResolvedValue(null);
    mocks.run.mockResolvedValue("enabled");
  });

  it("starts a due automatic check after responding, and returns its progress", async () => {
    const claim = { model: "gpt-6-astra", effort: "medium", claimedAt: new Date("2030-01-01T00:00:01Z") };
    mocks.claim.mockResolvedValueOnce(claim);
    const response = await POST(request("POST"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(view);
    expect(mocks.run).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.run).toHaveBeenCalledWith("pool", session, "trip-a", claim);
    await mocks.claim.mock.calls[0]![3].beforeCheck();
    expect(mocks.limit).toHaveBeenCalledWith("pool", config, session);
  });

  it("starts nothing when no check is due, and refuses one over budget", async () => {
    expect((await POST(request("POST"), context)).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    mocks.claim.mockRejectedValueOnce(new RateLimitError(900));
    const limited = await POST(request("POST"), context);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "ROUTINE_CHECKS_LIMITED" });
  });

  it("rejects cross-origin writes before authentication", async () => {
    mocks.origin.mockImplementation(() => { throw new Error("Invalid origin."); });
    await POST(request("POST"), context);
    await PATCH(request("PATCH", { expectedRevision: 0, chatEffort: "low" }), context);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("budgets a manual check through the same limit", async () => {
    await PATCH(request("PATCH", { expectedRevision: 3, routine: { enabled: true } }), context);
    await mocks.save.mock.calls[0]![4].beforeSearchCheck();
    expect(mocks.limit).toHaveBeenCalledWith("pool", config, session);
  });
});
