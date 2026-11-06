import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppForbiddenError } from "@/lib/app/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), origin: vi.fn(), access: vi.fn(), overview: vi.fn(), list: vi.fn(), detail: vi.fn(), suspend: vi.fn(), limit: vi.fn(),
}));
const session = { tripId: "trip-a", memberId: "member-a", userId: "user-a", role: "owner" };
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => ({ appBaseUrl: new URL("https://stardust.test") }) }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/admin/repository", () => ({
  adminAccess: mocks.access, adminOverview: mocks.overview, listAdminAccounts: mocks.list, adminAccountDetail: mocks.detail,
  setAccountSuspension: mocks.suspend, setSignupDailyLimit: mocks.limit,
}));

import { GET as status } from "./status/route";
import { GET as overview } from "./overview/route";
import { GET as accounts } from "./accounts/route";
import { GET as detail } from "./accounts/[userId]/route";
import { PUT as suspension } from "./accounts/[userId]/suspension/route";
import { PUT as signupLimit } from "./signup-limit/route";

const userId = "00000000-0000-4000-8000-0000000000aa";
function request(path: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`https://stardust.test${path}`, {
    method: init.method ?? "GET", headers: { origin: "https://stardust.test", "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}
const params = (value: string) => ({ params: Promise.resolve({ userId: value }) });

describe("admin routes (JOB-069)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.overview.mockResolvedValue({ accounts: {} });
    mocks.list.mockResolvedValue({ accounts: [], total: 0, nextOffset: null });
    mocks.suspend.mockResolvedValue({ userId });
    mocks.limit.mockResolvedValue({ dailyLimit: 20 });
  });

  it("tells any signed-in account only whether it is the operator, never cached", async () => {
    mocks.access.mockResolvedValue(false);
    const response = await status(request("/api/admin/status"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ operator: false });
  });

  it("requires a session and returns 403 when the repository refuses a non-operator", async () => {
    mocks.auth.mockRejectedValueOnce(new SessionUnavailableError());
    expect((await overview(request("/api/admin/overview"))).status).toBe(401);
    mocks.overview.mockRejectedValueOnce(new AppForbiddenError("Only the platform operator can use the admin page."));
    const refused = await overview(request("/api/admin/overview"));
    expect(refused.status).toBe(403);
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
  });

  it("parses the account list query strictly", async () => {
    expect((await accounts(request("/api/admin/accounts?filter=guest&q=%20sam%20&offset=50"))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("pool", session, { filter: "guest", q: "sam", offset: 50 });
    expect((await accounts(request("/api/admin/accounts?filter=everyone"))).status).toBe(400);
    expect((await accounts(request("/api/admin/accounts?offset=-1"))).status).toBe(400);
  });

  it("refuses an account id that is not a UUID before any database work", async () => {
    expect((await detail(request("/api/admin/accounts/not-a-user"), params("not-a-user"))).status).toBe(400);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("changes suspension only from this site's origin, with a strict body", async () => {
    expect((await suspension(request(`/api/admin/accounts/${userId}/suspension`, { method: "PUT", body: { suspended: true } }), params(userId))).status).toBe(200);
    expect(mocks.suspend).toHaveBeenCalledWith("pool", session, userId, true);
    expect((await suspension(request(`/api/admin/accounts/${userId}/suspension`, { method: "PUT", body: { suspended: "yes" } }), params(userId))).status).toBe(400);
    expect((await suspension(request(`/api/admin/accounts/${userId}/suspension`, { method: "PUT", body: { suspended: true, extra: 1 } }), params(userId))).status).toBe(400);
    mocks.origin.mockImplementationOnce(() => { throw new SessionUnavailableError("The request origin is not allowed."); });
    expect((await suspension(request(`/api/admin/accounts/${userId}/suspension`, { method: "PUT", body: { suspended: false } }), params(userId))).status).toBe(401);
    expect(mocks.suspend).toHaveBeenCalledTimes(1);
  });

  it("accepts a whole-number sign-up cap, 0 to pause, or null to remove it", async () => {
    for (const dailyLimit of [20, 0, null]) {
      expect((await signupLimit(request("/api/admin/signup-limit", { method: "PUT", body: { dailyLimit } }))).status).toBe(200);
    }
    for (const dailyLimit of [-1, 1.5, "10", 100_001]) {
      expect((await signupLimit(request("/api/admin/signup-limit", { method: "PUT", body: { dailyLimit } }))).status).toBe(400);
    }
    expect(mocks.limit).toHaveBeenCalledTimes(3);
  });
});
