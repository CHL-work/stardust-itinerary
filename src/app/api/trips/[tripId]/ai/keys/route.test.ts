import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCredentialRejectedError } from "@/lib/ai/credentials";
import { RateLimitError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), limit: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn() }));
const session = { tripId: "trip-a", memberId: "member-a", userId: "user-a", role: "editor" };
const config = { appBaseUrl: new URL("https://stardust.test"), databaseUrl: "postgresql://local/test", authSecret: "synthetic" };
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin,
  requestRateLimitKey: () => "203.0.113.9\0synthetic-agent" }));
vi.mock("@/lib/auth/repository", () => ({ enforceRateLimit: mocks.limit }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/ai/credentials", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/credentials")>(),
  listAiCredentials: mocks.list, saveAiCredential: mocks.save, deleteAiCredential: mocks.remove,
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

describe("own AI keys route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.list.mockResolvedValue([saved]);
    mocks.save.mockResolvedValue(saved);
  });

  it("lists only summaries, never cached", async () => {
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ keys: [saved] });
  });

  it("budgets key checks per account and per address before asking the provider", async () => {
    const response = await PUT(request("PUT", { provider: "openai", apiKey: syntheticKey }), context);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(syntheticKey);
    expect(mocks.limit).toHaveBeenCalledWith("pool", config, { scope: "ai-key-check", key: "user-a", maximum: 10, windowSeconds: 3600 });
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

  it("deletes one known provider", async () => {
    expect((await DELETE(request("DELETE", undefined, "?provider=anthropic"), context)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("pool", session, "trip-a", "anthropic");
    expect((await DELETE(request("DELETE", undefined, "?provider=other"), context)).status).toBe(400);
  });
});
