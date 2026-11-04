import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppNotFoundError } from "@/lib/app/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({ read: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/ai/image-store", () => ({ readAiRequestImage: mocks.read }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => ({ synthetic: true }) }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.session }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => ({ synthetic: true }) }));
import { GET } from "@/app/api/trips/[tripId]/ai/images/[imageId]/route";
const tripId = "10000000-0000-4000-8000-000000000001";
const imageId = "20000000-0000-4000-8000-000000000001";
function read() { return GET(new NextRequest(`http://localhost/api/trips/${tripId}/ai/images/${imageId}`), { params: Promise.resolve({ tripId, imageId }) }); }
describe("private AI image delivery", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ tripId, memberId: "synthetic" }); });
  it("serves only authenticated bytes with private no-store and no sniffing", async () => {
    mocks.read.mockResolvedValue({ data: Buffer.from([255, 216, 255, 217]), mediaType: "image/jpeg" });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 217]));
  });
  it("returns noncacheable 404 for a picture belonging to another identity", async () => {
    mocks.read.mockRejectedValue(new AppNotFoundError("AI picture not found."));
    const response = await read();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("requires sign-in before any image lookup", async () => {
    mocks.session.mockRejectedValue(new SessionUnavailableError("Sign in."));
    expect((await read()).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
