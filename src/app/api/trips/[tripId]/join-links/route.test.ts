import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { SessionUnavailableError } from "@/lib/auth/errors";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  issueJoinLink: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
  requireSameOrigin: vi.fn(),
  revokeJoinLink: vi.fn(),
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
const ownerMemberId = "20000000-0000-4000-8000-000000000001";
const ownerSession = {
  tripId,
  memberId: ownerMemberId,
  userId: "30000000-0000-4000-8000-000000000001",
  role: "owner",
} as AuthenticatedSession;

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/repository")>();
  return {
    ...actual,
    issueJoinLink: mocks.issueJoinLink,
    revokeJoinLink: mocks.revokeJoinLink,
  };
});
vi.mock("@/lib/auth/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/web")>();
  return {
    ...actual,
    requireAuthenticatedSession: mocks.requireAuthenticatedSession,
    requireSameOrigin: mocks.requireSameOrigin,
  };
});
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));

import { DELETE, POST } from "@/app/api/trips/[tripId]/join-links/route";

function request(method: "POST" | "DELETE") {
  return new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/join-links`, {
    method,
    headers: { origin: config.appBaseUrl.origin },
  });
}

describe("owner-only reusable trip join-link routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.requireAuthenticatedSession.mockResolvedValue(ownerSession);
    mocks.issueJoinLink.mockResolvedValue({ rawToken: "A".repeat(43) });
  });

  it("allows the current trip owner to create a no-store invitation URL", async () => {
    const response = await POST(request("POST"), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      joinUrl: `${config.appBaseUrl.origin}/join#token=${"A".repeat(43)}`,
    });
    expect(mocks.issueJoinLink).toHaveBeenCalledWith(
      { synthetic: true },
      config,
      { tripId, actorMemberId: ownerMemberId,actorUserId:"30000000-0000-4000-8000-000000000001" },
    );
  });

  it("allows the current trip owner to revoke the active invitation", async () => {
    const response = await DELETE(request("DELETE"), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(mocks.revokeJoinLink).toHaveBeenCalledWith(
      { synthetic: true },
      { tripId, actorMemberId: ownerMemberId,actorUserId:"30000000-0000-4000-8000-000000000001" },
    );
  });

  it("rejects a member session before issuing or revoking an invitation", async () => {
    mocks.requireAuthenticatedSession.mockResolvedValue({ ...ownerSession, role: "editor" });

    const createResponse = await POST(request("POST"), {
      params: Promise.resolve({ tripId }),
    });
    const revokeResponse = await DELETE(request("DELETE"), {
      params: Promise.resolve({ tripId }),
    });

    expect(createResponse.status).toBe(401);
    expect(revokeResponse.status).toBe(401);
    expect(await createResponse.json()).toEqual({ error: "Owner authorization is required." });
    expect(await revokeResponse.json()).toEqual({ error: "Owner authorization is required." });
    expect(mocks.issueJoinLink).not.toHaveBeenCalled();
    expect(mocks.revokeJoinLink).not.toHaveBeenCalled();
  });

  it("maps a repository authorization failure without exposing internals", async () => {
    mocks.issueJoinLink.mockRejectedValue(
      new SessionUnavailableError("Owner authorization is required."),
    );

    const response = await POST(request("POST"), { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Owner authorization is required." });
  });
});
