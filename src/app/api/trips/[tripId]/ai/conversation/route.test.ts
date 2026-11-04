import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
  requireSameOrigin: vi.fn(),
  resetAiConversation: vi.fn(),
  resumeAiConversation: vi.fn(),
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
  memberId: "20000000-0000-4000-8000-000000000002",
  userId: "30000000-0000-4000-8000-000000000002",
  role: "editor",
} as AuthenticatedSession;

vi.mock("@/lib/ai/conversation", () => ({
  resetAiConversation: mocks.resetAiConversation,
  resumeAiConversation: mocks.resumeAiConversation,
}));
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

import { POST } from "@/app/api/trips/[tripId]/ai/conversation/route";

function request(body?: unknown) {
  return new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai/conversation`, {
    method: "POST",
    headers: { origin: config.appBaseUrl.origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("POST /api/trips/[tripId]/ai/conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.requireAuthenticatedSession.mockResolvedValue(session);
    mocks.resetAiConversation.mockResolvedValue({ conversationId: "40000000-0000-4000-8000-000000000001" });
  });

  it("starts a private conversation for the authenticated trip member", async () => {
    const response = await POST(request(), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ reset: true, conversationId: "40000000-0000-4000-8000-000000000001" });
    expect(mocks.requireSameOrigin).toHaveBeenCalledWith(expect.any(NextRequest), config);
    expect(mocks.resetAiConversation).toHaveBeenCalledWith({ synthetic: true }, session, tripId);
  });

  it("explicitly resumes a selected archive through the exact authenticated identity", async () => {
    const conversationId = "40000000-0000-4000-8000-000000000002";
    mocks.resumeAiConversation.mockResolvedValue({ conversationId });
    const response = await POST(request({ action: "resume", conversationId }), { params: Promise.resolve({ tripId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationId });
    expect(mocks.resumeAiConversation).toHaveBeenCalledWith({ synthetic: true }, session, tripId, conversationId);
    expect(mocks.resetAiConversation).not.toHaveBeenCalled();
  });

  it.each([{ action: "resume", conversationId: "invalid" }, { action: "new", conversationId: "unexpected" },
    { action: "new", purpose: "preferences" }, { action: "delete" }])(
    "rejects invalid actions before changing conversations", async (body) => {
      const response = await POST(request(body), { params: Promise.resolve({ tripId }) });
      expect(response.status).toBe(400);
      expect(mocks.resetAiConversation).not.toHaveBeenCalled();
      expect(mocks.resumeAiConversation).not.toHaveBeenCalled();
    });

  it("rejects a trip outside the current session before resetting memory", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ tripId: "10000000-0000-4000-8000-000000000099" }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "This trip is not available to the current member.",
    });
    expect(mocks.resetAiConversation).not.toHaveBeenCalled();
  });

  it("returns a no-store redacted failure response", async () => {
    mocks.resetAiConversation.mockRejectedValue(new Error("private database detail"));

    const response = await POST(request(), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "The local request failed. Check the server log for details.",
    });
  });

  it("rejects malformed JSON rather than treating it as a new conversation", async () => {
    const malformed = new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/ai/conversation`,
      { method: "POST", headers: { origin: config.appBaseUrl.origin }, body: "{" });
    expect((await POST(malformed, { params: Promise.resolve({ tripId }) })).status).toBe(400);
    expect(mocks.resetAiConversation).not.toHaveBeenCalled();
    expect(mocks.resumeAiConversation).not.toHaveBeenCalled();
  });
});
