import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), remove: vi.fn(), update: vi.fn(), auth: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => ({}) }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/app/repository", async (original) => ({ ...await original<typeof import("@/lib/app/repository")>(), removeTripMember: mocks.remove, updateTripMember: mocks.update }));
vi.mock("@/lib/app/member-removal", async (original) => ({ ...await original<typeof import("@/lib/app/member-removal")>(), getTripMemberRemovalPreview: mocks.preview }));
import { DELETE, GET, PATCH } from "./route";
import { AppForbiddenError, AppConflictError } from "@/lib/app/repository";
const tripId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ tripId, memberId }) };
const session = { tripId, memberId, role: "owner" };
function request(method: string, body?: unknown) {
  return new NextRequest(`http://localhost:3100/api/trips/${tripId}/members/${memberId}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(session); mocks.origin.mockReturnValue(undefined); });
describe("member management HTTP boundary", () => {
  it("serves only the authorized removal preview and never caches it", async () => {
    mocks.preview.mockResolvedValue({ counts: { expenses: 2 }, canRemove: false });
    const response = await GET(request("GET"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.preview).toHaveBeenCalledWith("pool", session, tripId, memberId);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("passes explicit fresh removal confirmation to the atomic backend", async () => {
    const body = { confirmation: true, expectedRevision: 4, previewDigest: "a".repeat(64) };
    expect((await DELETE(request("DELETE", body), params)).status).toBe(200);
    expect(mocks.origin).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith("pool", session, tripId, memberId, body);
  });
  it.each([{ confirmation: false }, { confirmation: true, expectedRevision: 1 }, { confirmation: true, expectedRevision: 1, previewDigest: "invalid" }])("rejects incomplete removal confirmation %j", async (body) => {
    expect((await DELETE(request("DELETE", body), params)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("blocks cross-origin mutations before removal or role writes", async () => {
    mocks.origin.mockImplementation(() => { throw new AppForbiddenError("origin rejected"); });
    expect((await DELETE(request("DELETE", {}), params)).status).toBe(403);
    expect((await PATCH(request("PATCH", { role: "owner", expectedRevision: 1 }), params)).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("returns stale preview conflicts without exposing details or caching", async () => {
    mocks.remove.mockRejectedValueOnce(new AppConflictError("Refresh preview."));
    const response = await DELETE(request("DELETE", { confirmation: true, expectedRevision: 1, previewDigest: "b".repeat(64) }), params);
    expect(response.status).toBe(409); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("requires role revision and delegates authorization to the backend", async () => {
    expect((await PATCH(request("PATCH", { role: "owner" }), params)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    const body = { role: "owner", expectedRevision: 2 };
    expect((await PATCH(request("PATCH", body), params)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("pool", session, tripId, memberId, body);
  });
});
