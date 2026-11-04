import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const mocks = vi.hoisted(() => ({
  getApprovalHistory: vi.fn(),
  getPool: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
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
const ownerSession = {
  tripId,
  memberId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001",
  role: "owner",
} as AuthenticatedSession;

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/web")>();
  return {
    ...actual,
    requireAuthenticatedSession: mocks.requireAuthenticatedSession,
  };
});
vi.mock("@/lib/app/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app/repository")>();
  return {
    ...actual,
    getApprovalHistory: mocks.getApprovalHistory,
  };
});
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));

import { GET } from "@/app/api/trips/[tripId]/change-requests/route";
import { AppForbiddenError, AppInvalidInputError } from "@/lib/app/repository";

describe("owner approval-history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.requireAuthenticatedSession.mockResolvedValue(ownerSession);
    mocks.getApprovalHistory.mockResolvedValue({ requests: [], nextCursor: null });
  });

  it("passes the opaque cursor to the bounded repository read and disables caching", async () => {
    const request = new NextRequest(
      `${config.appBaseUrl.origin}/api/trips/${tripId}/change-requests?cursor=opaque-cursor`,
    );

    const response = await GET(request, { params: Promise.resolve({ tripId }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ requests: [], nextCursor: null });
    expect(mocks.getApprovalHistory).toHaveBeenCalledWith(
      { synthetic: true },
      ownerSession,
      tripId,
      "opaque-cursor",
    );
  });

  it("maps member denial and malformed cursors to safe API responses", async () => {
    mocks.getApprovalHistory.mockRejectedValueOnce(
      new AppForbiddenError("Only the owner can view approval history."),
    );
    const memberResponse = await GET(
      new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/change-requests`),
      { params: Promise.resolve({ tripId }) },
    );
    expect(memberResponse.status).toBe(403);
    expect(await memberResponse.json()).toEqual({ error: "Only the owner can view approval history." });

    mocks.getApprovalHistory.mockRejectedValueOnce(
      new AppInvalidInputError("The approval history cursor is invalid."),
    );
    const cursorResponse = await GET(
      new NextRequest(`${config.appBaseUrl.origin}/api/trips/${tripId}/change-requests?cursor=bad`),
      { params: Promise.resolve({ tripId }) },
    );
    expect(cursorResponse.status).toBe(400);
    expect(await cursorResponse.json()).toEqual({ error: "The approval history cursor is invalid." });
  });
});
