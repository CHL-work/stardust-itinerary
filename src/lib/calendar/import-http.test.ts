import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), session: vi.fn(), origin: vi.fn(), pool: vi.fn(),
  preview: vi.fn(), commit: vi.fn(), search: vi.fn(), recover: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: mocks.config }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.session, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: mocks.pool }));
vi.mock("@/lib/calendar/import-repository", () => ({ previewCalendarImport: mocks.preview, commitCalendarImport: mocks.commit }));
vi.mock("@/lib/calendar/location-search", () => ({ searchCalendarLocation: mocks.search, readCalendarLocationSearch: mocks.recover }));
import { POST as preview } from "@/app/api/trips/[tripId]/calendar/import/preview/route";
import { POST as commit } from "@/app/api/trips/[tripId]/calendar/import/route";
import { POST as search, GET as recover } from "@/app/api/trips/[tripId]/calendar/location-search/route";
import { AppForbiddenError } from "@/lib/app/repository";
import { readCalendarImportJson } from "./import-http";
const tripId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const params = { params: Promise.resolve({ tripId }) };
const post = (body: unknown) => new NextRequest(`http://localhost:3100/api/trips/${tripId}/calendar/import`,
  { method: "POST", headers: { origin: "http://localhost:3100", "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.config.mockReturnValue({}); mocks.session.mockResolvedValue({ tripId });
  mocks.preview.mockResolvedValue({ previewToken: "signed", source: {} }); mocks.commit.mockResolvedValue({ requestId, status: "pending" });
  mocks.search.mockResolvedValue({ requestId, status: "unverified" }); mocks.recover.mockResolvedValue({ requestId, status: "running" });
});
describe("private Calendar import endpoints", () => {
  it.each([["preview", preview, { eventId: "synthetic-event" }], ["commit", commit, { previewToken: "signed" }],
    ["search", search, { subject: "Synthetic Park Tokyo", consent: true, locale: "en", requestId }]] as const)("authenticates same-origin %s and never caches response", async (_name, action, body) => {
    const response = await action(post(body), params);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie"); expect(mocks.origin).toHaveBeenCalledOnce();
    expect(mocks.session).toHaveBeenCalledOnce();
  });
  it.each([preview, commit, search])("rejects foreign trip before body work and keeps errors private", async (action) => {
    mocks.session.mockResolvedValue({ tripId: requestId });
    const response = await action(post({}), params);
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
  });
  it("requires explicit public-search consent and forbids untrusted preview/source fields", async () => {
    expect((await search(post({ subject: "Synthetic Park Tokyo", requestId }), params)).status).toBe(400);
    expect((await preview(post({ eventId: "synthetic-event", title: "forged" }), params)).status).toBe(400);
    expect((await commit(post({ previewToken: "signed", startsAt: "forged", source: "ai" }), params)).status).toBe(400);
  });
  it("returns no-store for same-origin/auth errors and does not expose secrets", async () => {
    mocks.origin.mockImplementation(() => { throw new AppForbiddenError("Origin not allowed."); });
    const response = await commit(post({ previewToken: "secret-preview-token" }), params);
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("secret-preview-token");
  });
  it("GET recovers only authenticated current-trip request and never starts search", async () => {
    const response = await recover(new NextRequest(`http://localhost:3100/?requestId=${requestId}`), params);
    expect(response.status).toBe(200); expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.recover).toHaveBeenCalledWith(undefined, {}, { tripId }, requestId);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await recover(new NextRequest("http://localhost:3100/?requestId=invalid"), params)).status).toBe(400);
  });
  it("bounds streamed and declared payloads, rejects malformed/missing JSON", async () => {
    expect(await readCalendarImportJson(post({ eventId: "synthetic" }))).toEqual({ eventId: "synthetic" });
    for (const request of [new Request("http://localhost", { method: "POST", body: "x".repeat(49*1024) }),
      new Request("http://localhost", { method: "POST", body: "{}", headers: { "content-length": "999999" } }),
      new Request("http://localhost", { method: "POST", body: "invalid" }), new Request("http://localhost")]) {
      await expect(readCalendarImportJson(request)).rejects.toThrow("CALENDAR_IMPORT_INVALID");
    }
  });
});
