import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const mocks = vi.hoisted(() => ({
  createTrip: vi.fn(),
  getPool: vi.fn(),
  authenticatedSession: vi.fn(),
  verifyAccountOnboarding: vi.fn(),
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

const ownerSession = {
  tripId: "10000000-0000-4000-8000-000000000001",
  memberId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001",
  displayName: "Synthetic owner",
  role: "owner",
} as AuthenticatedSession;

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/web")>();
  return { ...actual, authenticatedSession: mocks.authenticatedSession };
});
vi.mock("@/lib/auth/account-session",async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/account-session")>();
  return {...actual,verifyAccountOnboarding:mocks.verifyAccountOnboarding};
});
vi.mock("@/lib/app/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app/repository")>();
  return { ...actual, createTrip: mocks.createTrip };
});
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.getPool }));

import { POST } from "@/app/api/trips/route";
import { AppConflictError, AppForbiddenError } from "@/lib/app/repository";

const validInput = {
  name: "Kyoto autumn",
  destinationName: "Kyoto, Japan",
  timeZone: "Asia/Tokyo",
  defaultLocale: "zh-HK-lihkg",
  defaultCurrency: "jpy",
  startsOn: "2030-11-01",
  endsOn: "2030-11-07",
  maxMembers: 10,
};

function request(body: unknown, origin = config.appBaseUrl.origin) {
  return new NextRequest(`${config.appBaseUrl.origin}/api/trips`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("POST /api/trips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ synthetic: true });
    mocks.authenticatedSession.mockResolvedValue(ownerSession);
    mocks.verifyAccountOnboarding.mockResolvedValue(null);
    mocks.createTrip.mockResolvedValue({
      tripId: "40000000-0000-4000-8000-000000000001",
      memberId: "50000000-0000-4000-8000-000000000001",
    });
  });

  it("creates a trip for the authenticated owner with normalized values", async () => {
    const response = await POST(request(validInput));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({
      tripId: "40000000-0000-4000-8000-000000000001",
      memberId: "50000000-0000-4000-8000-000000000001",
    });
    expect(mocks.createTrip).toHaveBeenCalledWith(
      { synthetic: true },
      ownerSession,
      { ...validInput, defaultCurrency: "JPY" },
      {config,userAgent:null},
    );
  });

  it("rejects an invalid date range before writing", async () => {
    const response = await POST(request({
      ...validInput,
      startsOn: "2030-11-07",
      endsOn: "2030-11-01",
    }));

    expect(response.status).toBe(400);
    expect(mocks.createTrip).not.toHaveBeenCalled();
  });

  it.each(["EST", "+09:00", "GMT+9"])("rejects non-IANA create time zone %s", async (timeZone) => {
    const result = await POST(request({ ...validInput, timeZone }));
    expect(result.status).toBe(400);
    expect(mocks.createTrip).not.toHaveBeenCalled();
  });

  it("accepts a valid IANA alias unchanged and optional lookup provenance", async () => {
    const input = { ...validInput, timeZone: "US/Central", destinationLookupId: "a0000000-0000-4000-8000-000000000001" };
    expect((await POST(request(input))).status).toBe(201);
    expect(mocks.createTrip).toHaveBeenLastCalledWith({ synthetic: true }, ownerSession,
      { ...input, defaultCurrency: "JPY" }, { config, userAgent: null });
  });

  it("returns both reported field failures without touching the repository",async () => {
    const response = await POST(request({...validInput,timeZone:"Dallas",defaultCurrency:"USA"}));
    expect(response.status).toBe(400);
    expect((await response.json()).issues.map((issue:{path:string[]}) => issue.path)).toEqual([["timeZone"],["defaultCurrency"]]);
    expect(mocks.createTrip).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("accepts Dallas/US dollar selections and preserves the UTC-day quota error",async () => {
    const input = {...validInput,name:"Dallas October test",destinationName:"Dallas",timeZone:"America/Chicago",defaultCurrency:"USD",startsOn:"2026-10-08",endsOn:"2026-10-31"};
    expect((await POST(request(input))).status).toBe(201);
    expect(mocks.createTrip).toHaveBeenLastCalledWith({synthetic:true},ownerSession,input,{config,userAgent:null});
    mocks.createTrip.mockRejectedValue(new AppConflictError("The daily limit of 10 new trips has been reached."));
    const response = await POST(request(input));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({error:"The daily limit of 10 new trips has been reached."});
  });

  it("maps owner authorization failures to 403", async () => {
    mocks.createTrip.mockRejectedValue(new AppForbiddenError("Only an owner can create a new trip."));

    const response = await POST(request(validInput));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only an owner can create a new trip." });
  });

  it("rejects cross-origin writes before authentication or repository access", async () => {
    const response = await POST(request(validInput, "https://attacker.example"));

    expect(response.status).toBe(401);
    expect(mocks.authenticatedSession).not.toHaveBeenCalled();
    expect(mocks.createTrip).not.toHaveBeenCalled();
  });

  it("allows an active editor or a narrow account grant without accepting client identity or role",async () => {
    mocks.authenticatedSession.mockResolvedValue({...ownerSession,role:"editor"});
    expect((await POST(request(validInput))).status).toBe(201);
    mocks.authenticatedSession.mockResolvedValue(null);
    const principal = {kind:"account",accountSessionId:"account",userId:"user",issuer:"https://accounts.google.com",subject:"test",displayName:"Traveler"};
    mocks.verifyAccountOnboarding.mockResolvedValue(principal);
    const result = await POST(request({...validInput,userId:"attacker",role:"owner"}));
    expect(result.status).toBe(201);
    expect(mocks.createTrip).toHaveBeenLastCalledWith({synthetic:true},principal,{...validInput,defaultCurrency:"JPY"},{config,userAgent:null});
  });

  it("requires authentication and never returns the new raw session grant in JSON",async () => {
    mocks.authenticatedSession.mockResolvedValue(null);
    expect((await POST(request(validInput))).status).toBe(401);
    mocks.authenticatedSession.mockResolvedValue(ownerSession);
    mocks.createTrip.mockResolvedValue({tripId:"trip",memberId:"member",sessionGrant:{rawToken:"private-session",expiresAt:new Date("2030-01-01")}});
    const response = await POST(request(validInput));
    expect(await response.json()).toEqual({tripId:"trip",memberId:"member"});
    expect(response.headers.get("set-cookie")).toContain("stardust.session=private-session");
  });
});
