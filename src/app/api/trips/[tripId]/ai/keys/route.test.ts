import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCredentialRejectedError, AiKeyCheckError } from "@/lib/ai/credentials";
import { RateLimitError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), limit: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn(), usage: vi.fn(),
  claim: vi.fn(), run: vi.fn(), searchLimit: vi.fn(), after: vi.fn() }));
const session = { tripId: "trip-a", memberId: "member-a", userId: "user-a", role: "editor" };
const config = { appBaseUrl: new URL("https://stardust.test"), databaseUrl: "postgresql://local/test", authSecret: "synthetic" };
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/ai/preferences", () => ({ claimRoutineAutoCheck: mocks.claim, runRoutineAutoCheck: mocks.run, limitRoutineSearchChecks: mocks.searchLimit }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin,
  trustedClientAddress: () => "203.0.113.9" }));
vi.mock("@/lib/auth/repository", () => ({ enforceRateLimit: mocks.limit }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/ai/credentials", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/credentials")>(),
  listAiCredentials: mocks.list, saveAiCredential: mocks.save, deleteAiCredential: mocks.remove, aiKeyUsage: mocks.usage,
}));
import { DELETE, GET, PUT } from "./route";

const context = { params: Promise.resolve({ tripId: "trip-a" }) };
const syntheticKey = "sk-synthetic-route-0123456789";
function request(method: string, body?: unknown, query = "") {
  return new NextRequest(`https://stardust.test/api/trips/trip-a/ai/keys${query}`, {
    method, headers: { origin: "https://stardust.test", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const saved = { provider: "openai", hint: "6789", vertex: false, validatedAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" };
const counts = { today: 1, last30Days: 4, sharedToday: 0, sharedLast30Days: 2 };
const usage = { openai: counts, anthropic: counts, google: counts };

describe("own AI keys route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.list.mockResolvedValue([saved]);
    mocks.save.mockResolvedValue(saved);
    mocks.usage.mockResolvedValue(usage);
    mocks.claim.mockResolvedValue(null);
    mocks.run.mockResolvedValue("enabled");
  });

  it("starts the routine web search test after the response when a saved key needs one (JOB-096)", async () => {
    const claim = { model: "gpt-6-astra", effort: "medium", claimedAt: new Date("2030-01-01T00:00:01Z") };
    mocks.claim.mockResolvedValueOnce(claim);
    const response = await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    expect(await response.json()).toEqual({ key: saved, routineCheck: "running" });
    expect(mocks.claim.mock.invocationCallOrder[0]!).toBeGreaterThan(mocks.save.mock.invocationCallOrder[0]!);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.run).toHaveBeenCalledWith("pool", session, "trip-a", claim);
    // The search check budget is spent only when a check starts.
    await mocks.claim.mock.calls[0]![3].beforeCheck();
    expect(mocks.searchLimit).toHaveBeenCalledWith("pool", config, session);
  });

  it("keeps the key saved when no test is needed or it cannot start", async () => {
    expect(await (await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context)).json()).toEqual({ key: saved, routineCheck: null });
    mocks.claim.mockRejectedValueOnce(new RateLimitError(600));
    const limited = await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    expect([limited.status, (await limited.json()).routineCheck]).toEqual([200, "limited"]);
    mocks.claim.mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    expect([failed.status, (await failed.json()).routineCheck]).toEqual([200, null]);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("lists only summaries, never cached", async () => {
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ keys: [saved], usage, protection: null });
  });

  it("budgets key checks per account and per address before asking the provider", async () => {
    const response = await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(syntheticKey);
    expect(mocks.limit).toHaveBeenCalledWith("pool", config, { scope: "ai-key-check", key: "user-a", userId: "user-a", maximum: 10, windowSeconds: 3600 });
    expect(mocks.limit).toHaveBeenCalledWith("pool", config, expect.objectContaining({ scope: "ai-key-check-address", maximum: 30 }));
    expect(mocks.limit.mock.invocationCallOrder[1]!).toBeLessThan(mocks.save.mock.invocationCallOrder[0]!);
  });

  it("refuses a check over budget with 429 and Retry-After, without calling the provider", async () => {
    mocks.limit.mockRejectedValueOnce(new RateLimitError(1200));
    const response = await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1200");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ code: "AI_KEY_CHECKS_LIMITED" });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not spend the budget on malformed input, and never echoes a rejected key", async () => {
    expect((await PUT(request("PUT", { provider: "openai", apiKey: "short" }), context)).status).toBe(400);
    expect(mocks.limit).not.toHaveBeenCalled();
    mocks.save.mockRejectedValueOnce(new AiCredentialRejectedError());
    const rejected = await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).not.toContain(syntheticKey);
  });

  it("rejects cross-origin writes before authentication", async () => {
    mocks.origin.mockImplementation(() => { throw new Error("Invalid origin."); });
    await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    await DELETE(request("DELETE", undefined, "?provider=openai"), context);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(["AI_KEY_CONFIGURATION", "AI_KEY_PROVIDER_UNAVAILABLE", "AI_KEY_PROVIDER_LIMITED"] as const)(
    "returns a safe actionable %s code, never the submitted key", async (code) => {
      mocks.save.mockRejectedValueOnce(new AiKeyCheckError(code));
      const response = await PUT(request("PUT", { provider: "google", apiKey: syntheticKey, vertexExpress: true }), context);
      expect(response.status).toBe(code === "AI_KEY_CONFIGURATION" ? 400 : 503);
      const body = await response.json();
      expect(body.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain(syntheticKey);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

  it("deletes one known provider", async () => {
    expect((await DELETE(request("DELETE", undefined, "?provider=anthropic"), context)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("pool", session, "trip-a", "anthropic");
    expect((await DELETE(request("DELETE", undefined, "?provider=other"), context)).status).toBe(400);
  });
});
