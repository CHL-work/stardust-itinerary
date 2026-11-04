import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import type { AuthConfig } from "@/lib/auth/config";
const mocks = vi.hoisted(() => ({ query: vi.fn(), authorize: vi.fn(), permissions: vi.fn(), policy: vi.fn(), idle: vi.fn(),
  provider: vi.fn(), mkdir: vi.fn(), rm: vi.fn() }));
vi.mock("node:fs/promises", () => ({ mkdtemp: mocks.mkdir, rm: mocks.rm }));
vi.mock("@/lib/app/trip-authorization", () => ({ lockCurrentTripActor: mocks.authorize }));
vi.mock("@/lib/ai/conversation", () => ({ assertBoundUserAiIdle: mocks.idle, CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES: 2 }));
vi.mock("@/lib/app/repository", async (original) => {
  const actual = await original<typeof import("@/lib/app/repository")>();
  return { ...actual, getAiPolicy: async (...args: unknown[]) => ({ credentialSource: "operator", ...(await mocks.policy(...args)) }), getMemberPermissions: mocks.permissions,
    inTransaction: async (_pool: unknown, action: (client: unknown) => unknown) => action({ query: mocks.query }) };
});
vi.mock("./location-search-provider", async (original) => ({ ...await original<typeof import("./location-search-provider")>(), runCalendarLocationProvider: mocks.provider }));
import { AppForbiddenError, AppConflictError } from "@/lib/app/repository";
import { searchCalendarLocation, readCalendarLocationSearch } from "./location-search";
import { verifyCalendarLocationToken } from "./location-search-token";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = { tripId: id(1), memberId: id(2), userId: id(3), role: "editor" } as AuthenticatedSession;
const config = { authSecret: "synthetic-calendar-location-secret-only" } as AuthConfig;
const pool = {} as Pool;
const input = { subject: "Synthetic Sakura Park Tokyo", locale: "en" as const, consent: true as const, requestId: id(4) };
const evidence = { subject: input.subject, status: "found", venueName: "Synthetic Sakura Park", address: "1-2-3 Synthetic Ward Tokyo", sources: ["https://sakura.example.test/access"] };
const hash = createHash("sha256").update(JSON.stringify({ subject: input.subject, locale: input.locale, consent: true })).digest("hex");
const stored = { id: id(5), request_payload_hash: hash, status: "succeeded", stale: false, response_json: {
  requestId: input.requestId, status: "found", locationName: "Synthetic Sakura Park, 1-2-3 Synthetic Ward Tokyo",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=park", sources: [{ title: "sakura.example.test", url: evidence.sources[0] }] } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
  mocks.permissions.mockResolvedValue({ canEditItinerary: true, canSyncCalendar: true });
  mocks.policy.mockResolvedValue({ enabled: true, model: "gpt-6.1-sol", usedToday: 0, limit: 20 });
  mocks.mkdir.mockResolvedValue("C:\\Temp\\stardust-calendar-location-synthetic");
  mocks.rm.mockResolvedValue(undefined);
  mocks.provider.mockResolvedValue({ evidence, queries: [`${input.subject} official address`], inputTokens: 10, outputTokens: 5, cachedInputTokens: 1 });
});
describe("Calendar AI lookup admission and delivery", () => {
  it("charges existing member policy once, retains public logs, generates Maps URL, and signs review provenance", async () => {
    const result = await searchCalendarLocation(pool, config, session, input);
    expect(result.status).toBe("found");
    expect(new URL(result.mapUrl!).searchParams.get("query")).toBe(result.locationName);
    expect(() => verifyCalendarLocationToken(result.aiReceiptToken!, config.authSecret, session, result)).not.toThrow();
    expect(mocks.policy).toHaveBeenCalledWith(expect.anything(), session, undefined, { serializeMemberQuota: true });
    expect(mocks.idle).toHaveBeenCalledWith(expect.anything(), session.userId);
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    expect(mocks.provider).toHaveBeenCalledWith(expect.objectContaining({ subject: input.subject, model: "gpt-6.1-sol" }));
    const serializedProvider = JSON.stringify(mocks.provider.mock.calls);
    expect(serializedProvider).not.toContain(session.userId); expect(serializedProvider).not.toContain("calendarId");
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO ai_requests"))).toHaveLength(1);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO ai_request_events"))).toHaveLength(2);
    expect(JSON.stringify(mocks.query.mock.calls)).not.toContain("INSERT INTO change_requests");
    expect(mocks.rm).toHaveBeenCalledWith("C:\\Temp\\stardust-calendar-location-synthetic", { recursive: true, force: true });
  });
  it.each(["succeeded", "started", "failed"])("replays exact %s request without model calls or a second quota charge", async (status) => {
    mocks.query.mockResolvedValue({ rows: [{ ...stored, status }], rowCount: 1 });
    const result = await searchCalendarLocation(pool, config, session, input);
    expect(result.status).toBe(status === "succeeded" ? "found" : status === "started" ? "running" : "unavailable");
    expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.policy).not.toHaveBeenCalled();
  });
  it("rejects conflicting replay and rejects private/instruction inputs before provider work", async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...stored, request_payload_hash: "bad" }], rowCount: 1 });
    await expect(searchCalendarLocation(pool, config, session, input)).rejects.toThrow("REQUEST_CHANGED");
    await expect(searchCalendarLocation(pool, config, session, { ...input, subject: "private reservation 12345678" })).rejects.toThrow("PUBLIC_VENUE_REQUIRED");
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("enforces membership, edit/sync permission, funding/quota, and same-user concurrency", async () => {
    for (const denied of ["actor", "edit", "quota", "busy"]) {
      mocks.authorize.mockReset(); mocks.policy.mockReset(); mocks.idle.mockReset();
      mocks.permissions.mockResolvedValue({ canEditItinerary: denied !== "edit", canSyncCalendar: true });
      mocks.policy.mockResolvedValue({ model: "gpt-6.1-sol" });
      if (denied === "actor") mocks.authorize.mockRejectedValue(new AppForbiddenError("actor"));
      if (denied === "quota") mocks.policy.mockRejectedValue(new AppForbiddenError("quota"));
      if (denied === "busy") mocks.idle.mockRejectedValue(new AppConflictError("busy"));
      await expect(searchCalendarLocation(pool, config, session, input)).rejects.toThrow();
    }
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("recovers self-only stored results, rejects missing/removed access, and never resumes AI", async () => {
    mocks.query.mockResolvedValue({ rows: [stored], rowCount: 1 });
    expect((await readCalendarLocationSearch(pool, config, session, input.requestId)).status).toBe("found");
    expect(mocks.query.mock.calls[0]![0]).toContain("actor_user_id=$3");
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(readCalendarLocationSearch(pool, config, session, input.requestId)).rejects.toThrow("NOT_FOUND");
    mocks.authorize.mockRejectedValue(new AppForbiddenError("removed"));
    await expect(readCalendarLocationSearch(pool, config, session, input.requestId)).rejects.toThrow("removed");
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("does not deliver a result after membership changes while the model runs", async () => {
    mocks.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AppForbiddenError("removed"));
    await expect(searchCalendarLocation(pool, config, session, input)).rejects.toThrow("removed");
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("SET status='succeeded'"))).toBe(false);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("SET status='failed'"))).toBe(true);
  });
  it("fails closed with a manual fallback and no raw provider error leak", async () => {
    mocks.provider.mockRejectedValue(new Error("secret-provider-account-info"));
    expect(await searchCalendarLocation(pool, config, session, input)).toMatchObject({ status: "unavailable", aiReceiptToken: null });
    expect(JSON.stringify(mocks.query.mock.calls)).not.toContain("secret-provider-account-info");
  });
  it("bounds provider stalls and cleans only its exact temporary directory", async () => {
    vi.useFakeTimers();
    try {
      mocks.provider.mockImplementation(() => new Promise(() => {}));
      const pending = searchCalendarLocation(pool, config, session, input);
      await vi.advanceTimersByTimeAsync(60_001);
      expect((await pending).status).toBe("unavailable");
      expect(mocks.provider.mock.calls[0]![0].abortController.signal.aborted).toBe(true);
      expect(mocks.rm).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
