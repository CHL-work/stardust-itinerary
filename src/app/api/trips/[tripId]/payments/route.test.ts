import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), auth: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => ({}) }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/app/member-payments", async (original) => ({
  ...await original<typeof import("@/lib/app/member-payments")>(), createMemberPayment: mocks.create, updateMemberPayment: mocks.update,
}));
import { POST } from "./route";
import { PATCH } from "./[paymentId]/route";
import { AppConflictError, AppForbiddenError, AppInvalidInputError, AppNotFoundError } from "@/lib/app/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";

const tripId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";
const paymentId = "40000000-0000-4000-8000-000000000001";
const session = { tripId, memberId, role: "editor" };
const input = { fromMemberId: memberId, toMemberId: "20000000-0000-4000-8000-000000000002",
  currency: "JPY", amountMinor: 500, occurredAt: "2020-04-01T12:00:00Z", confirmation: true,
  clientRequestId: "50000000-0000-4000-8000-000000000001" };
const action = { action: "void", expectedRevision: 1, confirmation: true, clientRequestId: input.clientRequestId };
function request(body: unknown, method = "POST") {
  return new NextRequest(`http://localhost:3100/api/trips/${tripId}/payments`, {
    method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ tripId, paymentId }) };
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(session); });

describe("repayment HTTP boundaries", () => {
  it("forwards explicit recorded-transfer input and stable key, never initiating a real transfer", async () => {
    const payment = { id: paymentId, status: "posted", revision: 1 };
    mocks.create.mockResolvedValue(payment);
    const response = await POST(request(input), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(payment);
    expect(mocks.create).toHaveBeenCalledWith("pool", session, tripId, input);
    expect(mocks.origin).toHaveBeenCalledOnce();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("forwards explicit revisioned review/void and returns current DTO", async () => {
    mocks.update.mockResolvedValue({ id: paymentId, status: "void", revision: 2 });
    const response = await PATCH(request(action, "PATCH"), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "void", revision: 2 });
    expect(mocks.update).toHaveBeenCalledWith("pool", session, tripId, paymentId, action);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([{ confirmation: false }, { confirmation: undefined }, { amountMinor: 0 }, { amountMinor: 1.5 },
    { clientRequestId: undefined }, { fromMemberId: "not-uuid" }, { status: "posted" }])("refuses malformed/expanded create %j", async (patch) => {
    expect((await POST(request({ ...input, ...patch }), params)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{ confirmation: false }, { expectedRevision: undefined }, { expectedRevision: 0 },
    { clientRequestId: undefined }, { action: "delete" }, { amountMinor: 1 }])("refuses malformed/expanded review %j", async (patch) => {
    expect((await PATCH(request({ ...action, ...patch }, "PATCH"), params)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["POST", "PATCH"])("checks same origin before authentication and %s mutation", async (method) => {
    mocks.origin.mockImplementationOnce(() => { throw new AppForbiddenError("Origin rejected."); });
    const response = method === "POST" ? await POST(request(input), params) : await PATCH(request(action, "PATCH"), params);
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([
    [new AppConflictError("Stale revision or duplicate key."), 409],
    [new AppForbiddenError("Trip role changed."), 403],
    [new AppInvalidInputError("Ineligible participant."), 400],
    [new AppNotFoundError("Payment not found."), 404],
  ])("returns safe uncached payment failure %s", async (error, status) => {
    mocks.create.mockRejectedValueOnce(error);
    mocks.update.mockRejectedValueOnce(error);
    for (const response of [await POST(request(input), params), await PATCH(request(action, "PATCH"), params)]) {
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });
  it("requires a current Google-bound app session", async () => {
    mocks.auth.mockRejectedValueOnce(new SessionUnavailableError("Sign in required."));
    expect((await POST(request(input), params)).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("validates opaque path identifiers before a backend query", async () => {
    expect((await POST(request(input), { params: Promise.resolve({ tripId: "invalid" }) })).status).toBe(400);
    expect((await PATCH(request(action, "PATCH"), { params: Promise.resolve({ tripId, paymentId: "invalid" }) })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
