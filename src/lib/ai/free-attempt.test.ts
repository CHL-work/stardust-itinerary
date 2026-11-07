import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { withFreeAiCredential, withOperatorAiCredential } from "@/lib/ai/credential-context";
import { FREE_AI_CATALOG, FREE_AI_ENDPOINT, freeAiSettings, generateWithFreeModel } from "@/lib/ai/free-model";
import { reserveFreeAiAttempt } from "@/lib/ai/free-attempt";

const session: AuthenticatedSession = {
  sessionId: "synthetic-session", tripId: "10000000-0000-4000-8000-000000000001",
  memberId: "20000000-0000-4000-8000-000000000001", userId: "30000000-0000-4000-8000-000000000001",
  role: "owner", displayName: "Synthetic owner", issuer: "test", subject: "synthetic-subject", generation: 1,
  expiresAt: new Date("2026-11-08T00:00:00Z"), absoluteExpiresAt: new Date("2026-12-01T00:00:00Z"),
};
const requestId = "40000000-0000-4000-8000-000000000001";

function database(options: { hour?: number; day?: number; active?: boolean; role?: string | null; trip?: boolean; insertFails?: boolean } = {}) {
  let hour = options.hour ?? 0;
  let day = options.day ?? 0;
  const inserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT id FROM trips")) return { rows: options.trip === false ? [] : [{ id: session.tripId }], rowCount: options.trip === false ? 0 : 1 };
    if (sql.includes("SELECT role FROM trip_members")) return { rows: options.role === null ? [] : [{ role: options.role ?? session.role }], rowCount: options.role === null ? 0 : 1 };
    if (sql.includes("SELECT 1 FROM ai_requests")) return { rows: options.active === false ? [] : [{}], rowCount: options.active === false ? 0 : 1 };
    if (sql.includes("count(*) FILTER")) return { rows: [{ hour, day }], rowCount: 1 };
    if (sql.includes("INSERT INTO ai_request_events")) {
      if (options.insertFails) throw new Error("Synthetic database failure");
      hour += 1; day += 1; inserts.push(values ?? []);
    }
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, query, release, inserts };
}

beforeEach(() => {
  vi.stubEnv("FREE_AI_ENABLED", "true");
  vi.stubEnv("FREE_AI_MODELS", "example/first:free,example/second:free");
  vi.stubEnv("FREE_AI_ENDPOINT", FREE_AI_ENDPOINT);
  vi.stubEnv("FREE_AI_HOURLY", "2");
  vi.stubEnv("FREE_AI_DAILY", "3");
});
afterEach(() => vi.unstubAllEnvs());

describe("durable keyless attempt reservations", () => {
  it("refuses missing or paid credential contexts before opening a database transaction", async () => {
    const db = database();
    await expect(reserveFreeAiAttempt(db.pool, session, requestId, 3)).rejects.toThrow(/credential context/u);
    await expect(withOperatorAiCredential(() => reserveFreeAiAttempt(db.pool, session, requestId, 3)))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_AUTH_REQUIRED" } });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("rechecks the enabled switch before reserving an attempt", async () => {
    const db = database();
    vi.stubEnv("FREE_AI_ENABLED", "false");
    await expect(withFreeAiCredential(() => reserveFreeAiAttempt(db.pool, session, requestId, 3)))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_UNAVAILABLE" } });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("locks one cross-replica counter and commits the event before returning to provider I/O", async () => {
    const db = database();
    await withFreeAiCredential(() => reserveFreeAiAttempt(db.pool, session, requestId, 7));
    const sql = db.query.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe("BEGIN");
    expect(sql.at(-1)).toBe("COMMIT");
    expect(sql.findIndex((statement) => statement.includes("'stardust-guest-free-ai'")))
      .toBeLessThan(sql.findIndex((statement) => statement.includes("count(*) FILTER")));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("credential_source = 'free' AND status = 'started'"),
      [session.tripId, requestId, session.userId, session.memberId]);
    const usage = sql.find((statement) => statement.includes("count(*) FILTER"))!;
    expect(usage).toContain("CURRENT_TIMESTAMP - interval '1 hour'");
    expect(usage).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'UTC'");
    expect(usage).toContain("event_type = 'provider.free.attempt.started'");
    expect(usage).not.toContain("trip_id =");
    expect(db.inserts).toEqual([[session.tripId, requestId, 7]]);
    expect(db.release).toHaveBeenCalledOnce();
  });

  it.each([{ hour: 2, day: 2 }, { hour: 0, day: 3 }])("refuses the exact hourly/daily boundary %j", async (usage) => {
    const db = database(usage);
    await expect(withFreeAiCredential(() => reserveFreeAiAttempt(db.pool, session, requestId, 3)))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_RATE_LIMITED" } });
    expect(db.inserts).toEqual([]);
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it.each([{ active: false }, { role: null }, { role: "viewer" }, { trip: false }])("refuses changed request or actor authority %j", async (options) => {
    const db = database(options);
    await expect(withFreeAiCredential(() => reserveFreeAiAttempt(db.pool, session, requestId, 3))).rejects.toThrow();
    expect(db.inserts).toEqual([]);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("count(*) FILTER"))).toBe(false);
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("counts retries separately, including a second generation used as output repair", async () => {
    const db = database();
    const settings = freeAiSettings();
    let sequence = 7;
    let posts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === FREE_AI_CATALOG) return Response.json({ data: settings.models.map((id) => ({
        id, isFree: true, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format", "structured_outputs"],
        top_provider: { max_completion_tokens: 8192 },
      })) });
      expect(db.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
      posts += 1;
      return posts === 1 ? Response.json({}, { status: 503 })
        : Response.json({ choices: [{ message: { content: '{"message":"Dinner proposed"}' }, finish_reason: "stop" }] });
    });
    const generate = () => withFreeAiCredential(() => generateWithFreeModel({
      prompt: "Plan synthetic dinner", responseJsonSchema: { type: "object" }, settings,
      fetchImpl: fetchImpl as typeof fetch,
      beforeAttempt: () => reserveFreeAiAttempt(db.pool, session, requestId, sequence++),
    }));
    await expect(generate()).resolves.toMatchObject({ text: '{"message":"Dinner proposed"}' });
    expect(db.inserts).toEqual([[session.tripId, requestId, 7], [session.tripId, requestId, 8]]);
    await expect(generate()).rejects.toMatchObject({ details: { code: "AI_PROVIDER_RATE_LIMITED" } });
    expect(posts).toBe(2); // The repair's reservation fails, so its inference POST never happens.
    expect(db.inserts).toHaveLength(2);
  });

  it("does not send inference if the durable reservation fails", async () => {
    const db = database({ insertFails: true });
    const settings = freeAiSettings();
    const fetchImpl = vi.fn(async () => Response.json({ data: settings.models.map((id) => ({
      id, isFree: true, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format", "structured_outputs"],
      top_provider: { max_completion_tokens: 8192 },
    })) }));
    await expect(withFreeAiCredential(() => generateWithFreeModel({ prompt: "Synthetic dinner", responseJsonSchema: {}, settings,
      fetchImpl, beforeAttempt: () => reserveFreeAiAttempt(db.pool, session, requestId, 7) })))
      .rejects.toThrow("Synthetic database failure");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // Catalog GET only.
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.release).toHaveBeenCalledOnce();
  });
});
