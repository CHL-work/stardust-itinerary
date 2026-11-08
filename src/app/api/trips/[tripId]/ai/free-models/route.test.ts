import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { AiProviderFailureError } from "@/lib/ai/provider-failure";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), catalog: vi.fn(), settings: vi.fn() }));
const session = { tripId: "trip-a", memberId: "member-a", userId: "user-a", role: "editor" };
const config = { appBaseUrl: new URL("https://stardust.test"), databaseUrl: "postgresql://local/test" };
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.auth }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock("@/lib/ai/free-model", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/free-model")>(),
  freeAiSettings: mocks.settings, listAvailableFreeModels: mocks.catalog,
}));
import { GET } from "./route";

const context = { params: Promise.resolve({ tripId: "trip-a" }) };
const catalog = { models: [
  { id: "dots-studio/dots-3-note-preview:free", label: "dots.3 note" },
  { id: "liquid/lfm-3-1.7b:free", label: "Liquid LFM3" },
  { id: "reflection/beam-free", label: "Reflection Beam" },
  { id: "cohere/north-mini-code:free", label: "Cohere North Mini Code" },
], defaultModel: "dots-studio/dots-3-note-preview:free" };
function request(query = "") { return new NextRequest(`https://stardust.test/api/trips/trip-a/ai/free-models${query}`); }

describe("free model catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.query.mockResolvedValue({ rows: [{ enabled: true }] });
    mocks.settings.mockReturnValue({ enabled: true });
    mocks.catalog.mockResolvedValue(catalog);
  });

  it.each(["owner", "editor", "viewer"])("allows a current %s without selecting any key", async (role) => {
    mocks.auth.mockResolvedValue({ ...session, role });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(catalog);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("member.status = 'active'"), ["trip-a", "member-a", "user-a", role]);
    const query = String(mocks.query.mock.calls[0]![0]);
    expect(query).toContain("suspended_at");
    expect(query).not.toMatch(/ai_credentials|prompt_text|result_text|itinerary_items/u);
    expect(mocks.catalog).toHaveBeenCalledWith({ settings: { enabled: true }, signal: expect.any(AbortSignal) });
  });

  it("also allows an authenticated isolated guest", async () => {
    mocks.auth.mockResolvedValue({ ...session, role: "owner", issuer: "urn:stardust:guest", isGuest: true });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(mocks.catalog).toHaveBeenCalledOnce();
  });

  it("requires authentication before database or upstream access", async () => {
    mocks.auth.mockRejectedValue(new SessionUnavailableError("Sign in again."));
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("rejects another trip and identity/provider query parameters", async () => {
    expect((await GET(request(), { params: Promise.resolve({ tripId: "trip-other" }) })).status).toBe(403);
    expect((await GET(request("?userId=someone-else"), context)).status).toBe(400);
    expect((await GET(request("?endpoint=https://other.example"), context)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ enabled: false }] }])("refuses changed/disabled memberships or disabled trip AI", async ({ rows }) => {
    mocks.query.mockResolvedValue({ rows });
    const response = await GET(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("returns an empty catalog without provider access when free AI is disabled", async () => {
    mocks.settings.mockReturnValue({ enabled: false });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [], defaultModel: null });
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it.each([
    { error: new AiProviderFailureError({ code: "AI_PROVIDER_RATE_LIMITED", provider: "kilo" }), status: 429 },
    { error: new AiProviderFailureError({ code: "AI_PROVIDER_UNAVAILABLE", provider: "kilo" }), status: 503 },
    { error: new Error("secret-provider-detail"), status: 500 },
  ])("returns safe uncached provider failures ($status)", async ({ error, status }) => {
    mocks.catalog.mockRejectedValue(error);
    const response = await GET(request(), context);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("secret-provider-detail");
  });
});
