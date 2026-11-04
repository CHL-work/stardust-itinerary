import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), auth: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => ({}) }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/app/repository", async (original) => ({
  ...await original<typeof import("@/lib/app/repository")>(), removeCancelledItineraryItem: mocks.remove,
}));

import { POST } from "./route";
import { AppConflictError, AppForbiddenError, AppNotFoundError } from "@/lib/app/repository";

const tripId = "10000000-0000-4000-8000-000000000001";
const itemId = "30000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ tripId, itemId }) };
const session = { tripId, memberId: "20000000-0000-4000-8000-000000000001", role: "owner" };
function request(body: unknown) {
  return new NextRequest(`http://localhost:3100/api/trips/${tripId}/itinerary/${itemId}/remove`, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(session); });

describe("cancelled event removal HTTP boundary", () => {
  it("passes explicit confirmation and current revision to owner-authorized removal", async () => {
    const input = { expectedRevision: 2, confirm: true };
    const result = { status: "removed", itemId, revision: 3 };
    mocks.remove.mockResolvedValue(result);
    const response = await POST(request(input), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.remove).toHaveBeenCalledWith("pool", session, tripId, itemId, input);
    expect(mocks.origin).toHaveBeenCalledOnce();
  });
  it.each([{}, { expectedRevision: 2 }, { expectedRevision: 0, confirm: true },
    { expectedRevision: 2, confirm: false }, { expectedRevision: 2, confirm: true, deleteExpenses: true }])(
    "rejects absent, stale-format or expanded destruction confirmation %j", async (input) => {
      const response = await POST(request(input), params);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-origin removal before authorizing a mutation", async () => {
    mocks.origin.mockImplementationOnce(() => { throw new AppForbiddenError("Origin rejected."); });
    expect((await POST(request({ expectedRevision: 2, confirm: true }), params)).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([
    [new AppConflictError("The plan item changed."), 409],
    [new AppForbiddenError("Only an owner can remove cancelled events."), 403],
    [new AppNotFoundError("Plan item not found."), 404],
  ])("returns safe uncached backend failure %s", async (error, status) => {
    mocks.remove.mockRejectedValue(error);
    const response = await POST(request({ expectedRevision: 2, confirm: true }), params);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("validates opaque trip and item identifiers before the backend", async () => {
    const response = await POST(request({ expectedRevision: 2, confirm: true }), {
      params: Promise.resolve({ tripId, itemId: "invalid" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
