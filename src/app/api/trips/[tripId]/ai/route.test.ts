import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { AiProviderFailureError, aiProviderFailureCodes } from "@/lib/ai/provider-failure";

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
  requireSameOrigin: vi.fn(),
  runAiPlanner: vi.fn(),
  readAiRequestRecovery: vi.fn(),
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

const tripId = "10000000-0000-4000-8000-000000000001";
const session = {
  tripId,
  memberId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001",
  role: "owner",
} as AuthenticatedSession;

vi.mock("@/lib/ai/planner", () => ({ runAiPlanner: mocks.runAiPlanner }));
vi.mock("@/lib/ai/request-recovery", () => ({ readAiRequestRecovery: mocks.readAiRequestRecovery }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/web")>();
  return {
    ...actual,
    requireAuthenticatedSession: mocks.requireAuthenticatedSession,
    requireSameOrigin: mocks.requireSameOrigin,
  };
});
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));

import { GET, POST } from "@/app/api/trips/[tripId]/ai/route";

function request(body: Record<string, unknown>) {
  return new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.appBaseUrl.origin },
    body: JSON.stringify({ conversationId: null, ...body }),
  });
}

describe("POST /api/trips/[tripId]/ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.requireAuthenticatedSession.mockResolvedValue(session);
    mocks.runAiPlanner.mockResolvedValue({
      message: "Ready.",
      proposalIds: [],
      proposalCount: 0,
      proposalId: null,
      changeStatus: null,
      entityId: null,
      model: "gpt-6.1-sol",
      webSearch: { performed: false, queryCount: 0, sources: [] },
      memory: {
        previousTurnsUsed: 0,
        tokenEstimate: 0,
        tokenBudget: 1_000,
        checkpointVersion: null,
        truncated: false,
      },
    });
  });

  it("runs the planner for the authenticated trip and disables caching", async () => {
    const response = await POST(request({
      prompt: "  Tell me the next event.  ",
      model: "gpt-6.1-sol",
      locale: "en",
    }), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(mocks.requireSameOrigin).toHaveBeenCalledWith(expect.any(NextRequest), config);
    expect(mocks.runAiPlanner).toHaveBeenCalledWith(
      { synthetic: true },
      session,
      "Tell me the next event.",
      "gpt-6.1-sol",
      "en",
      undefined,
      null,
    );
  });

  it("accepts the exact Astra model id for an owner request", async () => {
    const response = await POST(request({
      prompt: "Review the dinner plan.",
      model: "gpt-6-astra",
      locale: "en",
    }), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(200);
    expect(mocks.runAiPlanner).toHaveBeenCalledWith(
      { synthetic: true },
      session,
      "Review the dinner plan.",
      "gpt-6-astra",
      "en",
      undefined,
      null,
    );
  });

  it("normalizes and passes pictures only after identity and trip checks", async () => {
    const png = await sharp({ create: { width: 10, height: 20, channels: 3, background: "white" } }).png().toBuffer();
    const response = await POST(request({ prompt: "Create this receipt expense", images: [{ mediaType: "image/png", data: png.toString("base64") }] }), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(200);
    expect(mocks.runAiPlanner.mock.calls[0][7]).toEqual([expect.objectContaining({ mediaType: "image/jpeg", width: 10, height: 20, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) })]);
  });

  it("rejects disguised or invalid pictures without starting planner work", async () => {
    const response = await POST(request({ prompt: "Create event", images: [{ mediaType: "image/png", data: "eA==" }] }), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "AI_IMAGE_INVALID" });
    expect(mocks.runAiPlanner).not.toHaveBeenCalled();
  });

  it("passes the stable client identity and returns a replay envelope unchanged", async () => {
    const clientRequestId = "40000000-0000-4000-8000-000000000001";
    const recovery = { request: { requestId: clientRequestId, status: "running" }, busyElsewhere: false };
    mocks.runAiPlanner.mockResolvedValue(recovery);
    const response = await POST(request({ prompt: "Plan dinner.", locale: "en", clientRequestId }), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recovery);
    expect(mocks.runAiPlanner).toHaveBeenCalledWith(expect.anything(), session, "Plan dinner.", undefined, "en", clientRequestId, null);
  });

  it.each([null, "50000000-0000-4000-8000-000000000001"])("passes explicit conversation selection %s without treating null as omission", async (conversationId) => {
    const clientRequestId = "40000000-0000-4000-8000-000000000001";
    await POST(request({ prompt: "Plan dinner.", clientRequestId, conversationId }), { params: Promise.resolve({ tripId }) });
    expect(mocks.runAiPlanner).toHaveBeenCalledWith(expect.anything(), session, "Plan dinner.", undefined, undefined, clientRequestId, conversationId);
  });

  it("keeps admitted server work independent of browser cancellation", async () => {
    const controller = new AbortController();
    let finish!: (value: unknown) => void;
    mocks.runAiPlanner.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const submitted = POST(new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai`, {
      method: "POST", body: JSON.stringify({ prompt: "Plan dinner.", conversationId: null }), signal: controller.signal,
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ tripId }) });
    await vi.waitFor(() => expect(mocks.runAiPlanner).toHaveBeenCalledOnce());
    controller.abort();
    finish({ message: "Durable result." });
    expect(await (await submitted).json()).toEqual({ message: "Durable result." });
    expect(mocks.runAiPlanner.mock.calls[0]).toHaveLength(7);
  });

  it("recovers only through the authenticated self-only reader without invoking the planner", async () => {
    const clientRequestId = "40000000-0000-4000-8000-000000000001";
    mocks.readAiRequestRecovery.mockResolvedValue({ request: null, busyElsewhere: false });
    const response = await GET(new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai?clientRequestId=${clientRequestId}`),
      { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.readAiRequestRecovery).toHaveBeenCalledWith(expect.anything(), session, tripId, clientRequestId);
    expect(mocks.runAiPlanner).not.toHaveBeenCalled();
  });

  it("rejects malformed recovery IDs and other-trip reads before the recovery query", async () => {
    const malformed = await GET(new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai?clientRequestId=invalid`),
      { params: Promise.resolve({ tripId }) });
    expect(malformed.status).toBe(400);
    const foreign = await GET(new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai`),
      { params: Promise.resolve({ tripId: "10000000-0000-4000-8000-000000000099" }) });
    expect(foreign.status).toBe(403);
    expect(mocks.readAiRequestRecovery).not.toHaveBeenCalled();
  });

  it("rejects another trip before invoking the planner", async () => {
    const response = await POST(request({ prompt: "Plan dinner." }), {
      params: Promise.resolve({ tripId: "10000000-0000-4000-8000-000000000099" }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.runAiPlanner).not.toHaveBeenCalled();
  });

  it("rejects an invalid prompt before invoking the planner", async () => {
    const response = await POST(request({ prompt: "" }), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.runAiPlanner).not.toHaveBeenCalled();
  });

  it("requires old browser tabs to refresh rather than silently submitting into a changed active conversation", async () => {
    const response = await POST(request({ prompt: "Plan dinner.", conversationId: undefined }), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("active AI conversation changed");
    expect(mocks.runAiPlanner).not.toHaveBeenCalled();
  });

  it("returns an actionable status when the session expired", async () => {
    mocks.requireAuthenticatedSession.mockRejectedValue(new SessionUnavailableError("Authentication is required."));

    const response = await POST(request({ prompt: "Plan dinner." }), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Authentication is required." });
    expect(mocks.runAiPlanner).not.toHaveBeenCalled();
  });

  it("redacts an unexpected planner failure and emits a correlation header", async () => {
    mocks.runAiPlanner.mockRejectedValue(new Error("private provider detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ prompt: "Plan dinner." }), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await response.json()).toEqual({
      error: "The local request failed. Check the server log for details.",
    });
    expect(log).toHaveBeenCalledWith("AI HTTP request failed", {
      requestId,
      errorName: "Error",
    });
    log.mockRestore();
  });
  it.each(aiProviderFailureCodes)("delivers safe %s details without treating provider access as a website session failure", async (code) => {
    const details = { code, provider: "anthropic" as const,
      ...(code === "AI_PROVIDER_RATE_LIMITED" ? { retryAt: "2026-09-09T21:00:00.000Z" } : {}) };
    const failure = new AiProviderFailureError(details);
    failure.message = "PRIVATE provider token/account/diagnostic";
    mocks.runAiPlanner.mockRejectedValue(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await POST(request({ prompt: "Plan synthetic dinner." }), { params: Promise.resolve({ tripId }) });
      const expectedStatus = code === "AI_PROVIDER_RATE_LIMITED" ? 429
        : code === "AI_PROVIDER_MODEL_UNAVAILABLE" || code === "AI_PROVIDER_OUTPUT_INVALID" ? 502 : 503;
      expect(result.status).toBe(expectedStatus); expect(result.status).not.toBe(401);
      expect(await result.json()).toEqual({ error: code, code, providerFailure: details });
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
      expect(result.headers.get("retry-after")).toBeNull();
      expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
      expect(mocks.runAiPlanner).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
  it("does not promote a forged provider-shaped error or expose its raw fields", async () => {
    mocks.runAiPlanner.mockRejectedValue(Object.assign(new Error("PRIVATE provider body"), {
      name: "AI_PROVIDER_RATE_LIMITED", details: { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2026-09-09T21:00:00.000Z", secret: "PRIVATE" },
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await POST(request({ prompt: "Plan synthetic dinner." }), { params: Promise.resolve({ tripId }) });
      expect(result.status).toBe(500);
      expect(await result.json()).toEqual({ error: "The local request failed. Check the server log for details." });
      expect(mocks.runAiPlanner).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
  it("returns persisted failure metadata from a GET without launching or retrying provider work", async () => {
    const providerFailure = { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2026-09-09T21:00:00.000Z" };
    const recovery = { request: { requestId: "40000000-0000-4000-8000-000000000001", status: "failed", errorCode: providerFailure.code, providerFailure }, busyElsewhere: false };
    mocks.readAiRequestRecovery.mockResolvedValue(recovery);
    const result = await GET(new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai`), { params: Promise.resolve({ tripId }) });
    expect(result.status).toBe(200); expect(await result.json()).toEqual(recovery);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(mocks.runAiPlanner).not.toHaveBeenCalled();
  });
});
