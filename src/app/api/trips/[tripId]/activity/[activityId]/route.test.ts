import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), pool: vi.fn(), activity: vi.fn(), history: vi.fn(), query: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => ({}) }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth }));
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.pool }));
vi.mock("@/lib/app/activity-repository", () => ({ loadActivityEntries: mocks.activity }));
vi.mock("@/lib/app/repository", async (original) => ({ ...await original<typeof import("@/lib/app/repository")>(), getApprovalHistory: mocks.history }));

const tripId = "c9390000-0000-4000-8000-000000000001";
const activityId = "c9390000-0000-4000-8000-000000000002";
const requestId = "c9390000-0000-4000-8000-000000000003";
const session = { tripId, memberId: "owner", userId: "user", role: "owner" };
const call = (overrides: Partial<{ tripId: string; activityId: string }> = {}) => GET(new NextRequest(`http://localhost/api/trips/${tripId}/activity/${activityId}`), { params: Promise.resolve({ tripId, activityId, ...overrides }) });
describe("private read-only exact Activity resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.auth.mockResolvedValue(session); mocks.query.mockResolvedValue({ rows: [] });
    mocks.pool.mockReturnValue({ connect: async () => ({ query: mocks.query, release: mocks.release }) });
    mocks.activity.mockResolvedValue([{ id: activityId, target: { kind: "request", id: requestId } }]);
    mocks.history.mockResolvedValue({ requests: [{ id: requestId, patch: { forbiddenAuditContent: "secret" }, display: { kind: "unavailable" }, status: "pending" }] });
  });
  it("returns only the exact currently authorized request display with no raw patch", async () => {
    const response = await call(); expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ entry: { id: activityId }, request: { id: requestId, patch: {} } });
    expect(mocks.history).toHaveBeenCalledWith(expect.anything(), session, tripId, undefined, requestId);
    expect(mocks.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "COMMIT"]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it.each(["editor", "viewer"])("denies %s before querying", async (role) => {
    mocks.auth.mockResolvedValue({ ...session, role }); const response = await call();
    expect(response.status).toBe(403); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.pool).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("denies cross-trip and malformed identifiers before reading data", async () => {
    expect((await call({ tripId: requestId })).status).toBe(403);
    const malformed = await call({ activityId: "not-an-id" }); expect(malformed.status).toBe(400);
    expect(malformed.headers.get("Cache-Control")).toBe("private, no-store"); expect(mocks.pool).not.toHaveBeenCalled();
  });
  it("does not fall back to old snapshot data for hidden, removed-membership or missing rows", async () => {
    mocks.activity.mockResolvedValue([]); const response = await call();
    expect(response.status).toBe(404); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("does not fetch request patches for canonical or removed targets", async () => {
    mocks.activity.mockResolvedValue([{ id: activityId, target: null, targetState: "removed" }]);
    expect(await (await call()).json()).toMatchObject({ request: null, entry: { targetState: "removed" } });
    expect(mocks.history).not.toHaveBeenCalled();
  });
});
