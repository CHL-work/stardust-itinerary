import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/db/pool", () => ({
  getPool: () => ({ query: mocks.query }),
}));

import { GET, resetHealthCheckCacheForTests } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://local/test");
    resetHealthCheckCacheForTests();
  });

  it("reports ready only after PostgreSQL answers", async () => {
    mocks.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      service: "stardust-itinerary",
      version: "0.1.0",
      database: "ready",
    });
    expect(mocks.query).toHaveBeenCalledWith({ text: "SELECT 1", query_timeout: 2_500 });
  });

  it("returns a safe degraded response when PostgreSQL fails", async () => {
    mocks.query.mockRejectedValue(new Error("synthetic database failure containing private details"));

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      status: "degraded",
      service: "stardust-itinerary",
      version: "0.1.0",
      database: "unavailable",
    });
    expect(body).not.toContain("private details");
  });

  it("reports a driver-enforced query timeout as degraded", async () => {
    mocks.query.mockRejectedValue(new Error("Query read timeout"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect((await response.json()).database).toBe("unavailable");
  });

  it("checks database readiness independently of OAuth configuration", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    mocks.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()).database).toBe("ready");
  });
});
