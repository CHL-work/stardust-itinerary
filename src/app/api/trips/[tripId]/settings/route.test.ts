import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { tripDateErrors } from "@/lib/app/trip-date-range";

const mocks = vi.hoisted(() => ({ updateTripSettings: vi.fn(), requireAuthenticatedSession: vi.fn(), getPool: vi.fn() }));
const config = { appBaseUrl: new URL("https://example.test"), allowedOrigins: new Set(["https://example.test"]) };
const tripId = "10000000-0000-4000-8000-000000000001";
const session = { tripId, memberId: "20000000-0000-4000-8000-000000000001", role: "owner" } as AuthenticatedSession;
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", async (original) => ({ ...await original<typeof import("@/lib/auth/web")>(), requireAuthenticatedSession: mocks.requireAuthenticatedSession }));
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));
vi.mock("@/lib/app/repository", async (original) => ({ ...await original<typeof import("@/lib/app/repository")>(), updateTripSettings: mocks.updateTripSettings }));
import { PATCH } from "./route";
import { AppConflictError, AppForbiddenError } from "@/lib/app/repository";
const input = { startsOn: "2030-04-01", endsOn: "2030-04-07", expectedStartsOn: "2030-04-02", expectedEndsOn: "2030-04-08" };
const request = (body: unknown, origin = "https://example.test") => new NextRequest(`https://example.test/api/trips/${tripId}/settings`,
  { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const invoke = (body: unknown = input, origin?: string) => PATCH(request(body, origin), { params: Promise.resolve({ tripId }) });

describe("trip Settings date PATCH", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireAuthenticatedSession.mockResolvedValue(session);
    mocks.getPool.mockReturnValue({ synthetic: true }); mocks.updateTripSettings.mockResolvedValue(undefined); });
  it("forwards both dates and compare-and-set values through the authenticated service", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(mocks.updateTripSettings).toHaveBeenCalledExactlyOnceWith({ synthetic: true }, session, tripId, input);
  });
  it.each([
    { ...input, endsOn: "2030-03-31" }, { ...input, endsOn: "2031-04-02" },
    { ...input, startsOn: "2030-02-30" }, { startsOn: "2030-04-01", expectedStartsOn: "2030-04-02" },
  ])("rejects invalid fields without a write: %j", async (body) => {
    expect((await invoke(body)).status).toBe(400); expect(mocks.updateTripSettings).not.toHaveBeenCalled();
  });
  it("rejects other origins before authentication or writes", async () => {
    expect((await invoke(input, "https://attacker.test")).status).toBe(401);
    expect(mocks.requireAuthenticatedSession).not.toHaveBeenCalled(); expect(mocks.updateTripSettings).not.toHaveBeenCalled();
  });
  it("retains authentication and owner service errors", async () => {
    mocks.requireAuthenticatedSession.mockRejectedValueOnce(new SessionUnavailableError("Sign in again."));
    expect((await invoke()).status).toBe(401);
    mocks.updateTripSettings.mockRejectedValueOnce(new AppForbiddenError("Only the owner can change trip settings."));
    expect((await invoke()).status).toBe(403);
  });
  it.each([tripDateErrors.stale, tripDateErrors.occupied])("returns a safe actionable conflict: %s", async (message) => {
    mocks.updateTripSettings.mockRejectedValueOnce(new AppConflictError(message));
    const response = await invoke(); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: message });
  });
});
