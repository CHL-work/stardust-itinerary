import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUEST_ISSUER } from "@/lib/auth/guest-identity";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), permissions: vi.fn(), transaction: vi.fn() }));
const config = { appBaseUrl: new URL("https://stardust.test"), databaseUrl: "postgresql://local/test", authSecret: "synthetic" };
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => "pool" }));
vi.mock("@/lib/auth/web", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/web")>(), requireAuthenticatedSession: mocks.auth,
}));
vi.mock("@/lib/app/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/app/repository")>(), getMemberPermissions: mocks.permissions,
}));
vi.mock("@/lib/calendar/google-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/calendar/google-auth")>(), createCalendarAuthorizationTransaction: mocks.transaction,
}));
import { GET } from "./route";

const owner = { tripId: "trip", memberId: "member", userId: "user", role: "owner", issuer: "https://accounts.google.com" };

describe("starting Google Calendar authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.permissions.mockResolvedValue({ canSyncCalendar: true });
    mocks.transaction.mockReturnValue({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?synthetic=1",
      state: "s", nonce: "n", codeVerifier: "v" });
  });

  it("refuses guests even though they own their demo trip", async () => {
    mocks.auth.mockResolvedValue({ ...owner, issuer: GUEST_ISSUER });
    const response = await GET(new NextRequest("https://stardust.test/api/integrations/google-calendar/start"));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("still lets a Google-signed-in owner start", async () => {
    mocks.auth.mockResolvedValue(owner);
    const response = await GET(new NextRequest("https://stardust.test/api/integrations/google-calendar/start"));
    expect(response.status).toBe(307);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
