import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const mocks = vi.hoisted(() => ({
  getPendingItineraryRequestForEdit: vi.fn(),
  getPool: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
  requireSameOrigin: vi.fn(),
  reviewChangeRequest: vi.fn(),
  updatePendingItineraryRequest: vi.fn(),
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
const requestId = "40000000-0000-4000-8000-000000000001";
const requesterId = "20000000-0000-4000-8000-000000000002";
const ownerId = "20000000-0000-4000-8000-000000000001";
const selectedViewerId = "20000000-0000-4000-8000-000000000003";
const tripDayId = "30000000-0000-4000-8000-000000000002";

const requesterSession = {
  tripId,
  memberId: requesterId,
  userId: "50000000-0000-4000-8000-000000000002",
  displayName: "Requesting traveler",
  role: "editor",
} as AuthenticatedSession;

const ownerSession = {
  ...requesterSession,
  memberId: ownerId,
  userId: "50000000-0000-4000-8000-000000000001",
  displayName: "Trip owner",
  role: "owner",
} as AuthenticatedSession;

const privatePatch = {
  tripDayId,
  title: "Pending private dinner",
  itemType: "meal" as const,
  startsAt: "2026-09-06T10:00:00.000Z",
  endsAt: "2026-09-06T11:30:00.000Z",
  locationName: "Tokyo Station",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=Tokyo+Station",
  departureLocationName: null,
  departureMapUrl: null,
  destinationLocationName: null,
  destinationMapUrl: null,
  notes: "Awaiting approval",
  visibility: "private" as const,
  viewerMemberIds: [selectedViewerId],
  status: "planned" as const,
  isLocked: false,
  linkedExpense: null,
};

const detail = {
  requestId,
  status: "pending" as const,
  requestedByMemberId: requesterId,
  requestedByName: "Requesting traveler",
  source: "ai",
  reason: "AI-created itinerary proposal",
  proposalRevision: 3,
  createdAt: "2026-09-04T12:00:00.000Z",
  updatedAt: "2026-09-04T12:05:00.000Z",
  patch: privatePatch,
};

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/web")>();
  return {
    ...actual,
    requireAuthenticatedSession: mocks.requireAuthenticatedSession,
    requireSameOrigin: mocks.requireSameOrigin,
  };
});
vi.mock("@/lib/app/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app/repository")>();
  return {
    ...actual,
    getPendingItineraryRequestForEdit: mocks.getPendingItineraryRequestForEdit,
    reviewChangeRequest: mocks.reviewChangeRequest,
    updatePendingItineraryRequest: mocks.updatePendingItineraryRequest,
  };
});
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));

import { GET, PATCH, PUT } from "@/app/api/trips/[tripId]/change-requests/[requestId]/route";
import { AppConflictError, AppNotFoundError } from "@/lib/app/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";

function routeRequest(method: "GET" | "PATCH" | "PUT", body?: unknown, origin = config.appBaseUrl.origin) {
  return new NextRequest(
    `${config.appBaseUrl.origin}/api/trips/${tripId}/change-requests/${requestId}`,
    {
      method,
      headers: { origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

const params = { params: Promise.resolve({ tripId, requestId }) };

describe("pending itinerary edit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.requireAuthenticatedSession.mockResolvedValue(requesterSession);
    mocks.getPendingItineraryRequestForEdit.mockResolvedValue(detail);
    mocks.updatePendingItineraryRequest.mockResolvedValue(detail);
    mocks.reviewChangeRequest.mockResolvedValue({ status: "approved", entityId: "item-1", revision: 1 });
  });

  it("loads the editable pending-create detail for the authenticated requester without caching", async () => {
    const response = await GET(routeRequest("GET"), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(detail);
    expect(mocks.requireSameOrigin).not.toHaveBeenCalled();
    expect(mocks.getPendingItineraryRequestForEdit).toHaveBeenCalledWith(
      { synthetic: true },
      requesterSession,
      tripId,
      requestId,
    );
  });

  it.each([
    ["requester", requesterSession],
    ["owner", ownerSession],
  ])("updates a pending create for its %s while preserving request identity and private audience", async (_label, session) => {
    mocks.requireAuthenticatedSession.mockResolvedValue(session);
    const input = {
      proposalRevision: detail.proposalRevision,
      patch: {
        ...privatePatch,
        title: "Edited pending private dinner",
        notes: "Edited before approval",
      },
      reason: "Corrected the pending event",
    };
    const updated = {
      ...detail,
      proposalRevision: 4,
      reason: input.reason,
      patch: input.patch,
    };
    mocks.updatePendingItineraryRequest.mockResolvedValue(updated);

    const response = await PUT(routeRequest("PUT", input), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    expect(mocks.requireSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.updatePendingItineraryRequest).toHaveBeenCalledWith(
      { synthetic: true },
      session,
      tripId,
      requestId,
      input,
    );
    expect(updated).toMatchObject({
      requestId,
      status: "pending",
      requestedByMemberId: requesterId,
      source: "ai",
      patch: {
        visibility: "private",
        viewerMemberIds: [selectedViewerId],
      },
    });
  });

  it("strips attempts to rewrite the request source, requester, or approval status", async () => {
    const response = await PUT(routeRequest("PUT", {
      proposalRevision: detail.proposalRevision,
      patch: { title: "Legitimate title correction" },
      source: "owner",
      requestedByMemberId: ownerId,
      status: "approved",
    }), params);

    expect(response.status).toBe(200);
    expect(mocks.updatePendingItineraryRequest).toHaveBeenCalledWith(
      { synthetic: true },
      requesterSession,
      tripId,
      requestId,
      {
        proposalRevision: detail.proposalRevision,
        patch: { title: "Legitimate title correction" },
      },
    );
  });

  it("maps a hidden request to not-found so an unrelated member learns nothing", async () => {
    mocks.getPendingItineraryRequestForEdit.mockRejectedValue(
      new AppNotFoundError("Pending event not found."),
    );

    const response = await GET(routeRequest("GET"), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Pending event not found." });
  });

  it.each(["approved", "rejected", "superseded"])(
    "maps a %s request edit to conflict instead of reopening it",
    async (status) => {
      mocks.updatePendingItineraryRequest.mockRejectedValue(
        new AppConflictError(`A ${status} request cannot be edited.`),
      );

      const response = await PUT(routeRequest("PUT", {
        proposalRevision: detail.proposalRevision,
        patch: { title: "Must not be stored" },
      }), params);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: `A ${status} request cannot be edited.` });
    },
  );

  it("rejects a stale or malformed proposal revision before persistence", async () => {
    const response = await PUT(routeRequest("PUT", {
      proposalRevision: 0,
      patch: { title: "Invalid revision" },
    }), params);

    expect(response.status).toBe(400);
    expect(mocks.updatePendingItineraryRequest).not.toHaveBeenCalled();
  });

  it("rejects cross-origin edits before authentication or persistence", async () => {
    mocks.requireSameOrigin.mockImplementationOnce(() => {
      throw new SessionUnavailableError("Authentication is required.");
    });

    const response = await PUT(routeRequest("PUT", {
      proposalRevision: detail.proposalRevision,
      patch: { title: "Cross-origin edit" },
    }, "https://attacker.example"), params);

    expect(response.status).toBe(401);
    expect(mocks.requireAuthenticatedSession).not.toHaveBeenCalled();
    expect(mocks.updatePendingItineraryRequest).not.toHaveBeenCalled();
  });

  it.each(["approve", "reject"])("forwards the owner's rendered proposal version when deciding to %s", async (decision) => {
    mocks.requireAuthenticatedSession.mockResolvedValue(ownerSession);

    const response = await PATCH(routeRequest("PATCH", {
      decision,
      proposalRevision: detail.proposalRevision,
      note: "Reviewed after editing",
    }), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.requireSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.reviewChangeRequest).toHaveBeenCalledWith(
      { synthetic: true },
      ownerSession,
      tripId,
      requestId,
      decision,
      "Reviewed after editing",
      detail.proposalRevision,
    );
  });

  it.each([undefined, null, 0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1])(
    "rejects an absent or invalid review version before persistence: %s",
    async (proposalRevision) => {
      const response = await PATCH(routeRequest("PATCH", { decision: "approve", proposalRevision }), params);

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.reviewChangeRequest).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({
        issues: [expect.objectContaining({ path: ["proposalRevision"] })],
      });
    },
  );

  it("reports a changed proposal as a non-cacheable conflict instead of approving unseen content", async () => {
    mocks.requireAuthenticatedSession.mockResolvedValue(ownerSession);
    mocks.reviewChangeRequest.mockRejectedValueOnce(new AppConflictError("The proposal changed. Refresh before reviewing."));
    const response = await PATCH(routeRequest("PATCH", {
      decision: "approve",
      proposalRevision: detail.proposalRevision,
    }), params);

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "The proposal changed. Refresh before reviewing." });
    expect(mocks.reviewChangeRequest).toHaveBeenCalledWith(
      { synthetic: true }, ownerSession, tripId, requestId, "approve", undefined, detail.proposalRevision,
    );
  });

  it("rejects cross-origin reviews before authentication or persistence", async () => {
    mocks.requireSameOrigin.mockImplementationOnce(() => {
      throw new SessionUnavailableError("Authentication is required.");
    });
    const response = await PATCH(routeRequest("PATCH", {
      decision: "reject",
      proposalRevision: detail.proposalRevision,
    }, "https://attacker.example"), params);

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.requireAuthenticatedSession).not.toHaveBeenCalled();
    expect(mocks.reviewChangeRequest).not.toHaveBeenCalled();
  });
});
