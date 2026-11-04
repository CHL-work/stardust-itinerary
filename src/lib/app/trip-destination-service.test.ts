import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppConflictError } from "@/lib/app/repository";
import type { DestinationDefaults } from "@/lib/app/trip-destination-contract";
import { validateLookupOutput } from "@/lib/app/trip-destination-defaults";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), operator: vi.fn() }));
vi.mock("@/lib/ai/trip-destination-provider", () => ({ lookupTripDestination: mocks.provider,
  DESTINATION_LOOKUP_PROMPT_VERSION: 1, DESTINATION_LOOKUP_TIMEOUT_MS: 20_000 }));
vi.mock("@/lib/auth/operator-access", () => ({ isPlatformOperator: mocks.operator }));
import { canLookupTripDestination, runTripDestinationLookup } from "@/lib/app/trip-destination-service";

const principal = { sessionId: randomUUID(), userId: randomUUID(), memberId: randomUUID(), tripId: randomUUID(),
  role: "viewer", generation: 1, issuer: "https://accounts.google.com", subject: "synthetic-user" } as AuthenticatedSession;
const config = { authSecret: "synthetic-test-secret-only".repeat(2) } as AuthConfig;
const defaults = validateLookupOutput({ status: "resolved", countryCode: "JP", timeZone: "Asia/Tokyo",
  timeZoneCandidates: [], currency: "JPY", currencyCandidates: [] }, "japan");
const providerResult = { defaults, usage: { inputTokens: 15, outputTokens: 9, cachedInputTokens: 0 }, effectiveModel: "gpt-6.1-sol", latencyMs: 5 };
type Row = { id: string; requestId: string; hash: Buffer; inputHash: Buffer; status: string;
  response_json: DestinationDefaults | null; error_code: string | null };

function database() {
  const rows: Row[] = [];
  const state = { eligible: true, active: true, daily: 0, busy: false, attempts: 0, leases: 0, finished: true };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT 1 FROM oidc_identities")) return { rows: state.eligible ? [{}] : [] };
    if (sql.startsWith("SELECT 1 FROM auth_")) return { rows: state.active ? [{}] : [] };
    if (sql.includes("SET status='failed',error_code='TIMEOUT'")) return { rows: [], rowCount: 0 };
    if (sql.includes("client_request_id=$2")) {
      const row = rows.find((row) => row.requestId === values[1]);
      return { rows: row ? [{ ...row, request_payload_hash: row.hash }] : [] };
    }
    if (sql.includes("INSERT INTO auth_rate_limits")) return { rows: [{ attempt_count: ++state.attempts }] };
    if (sql.includes("input_hash=$2")) return { rows: rows.filter((row) => row.status === "succeeded" && row.inputHash.equals(values[1] as Buffer)) };
    if (sql.includes("bool_or(status='started')")) return { rows: [{ busy: state.busy, daily: state.daily + rows.length }] };
    if (sql.includes("INSERT INTO account_ai_lookups")) {
      rows.push({ id: values[0] as string, requestId: values[2] as string, hash: values[3] as Buffer,
        inputHash: values[4] as Buffer, status: "started", response_json: null, error_code: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SET status=$3,response_json")) {
      const row = rows.find((row) => row.id === values[0])!;
      row.status = values[2] as string;
      row.response_json = values[3] ? JSON.parse(values[3] as string) : null;
      row.error_code = values[9] as string | null;
      return { rows: state.finished ? [{ id: row.id }] : [], rowCount: state.finished ? 1 : 0 };
    }
    throw new Error(`Unexpected synthetic query: ${sql}`);
  });
  const pool = { query, connect: async () => { state.leases++; return { query, release: () => { state.leases--; } }; } } as unknown as Pool;
  return { pool, query, rows, state };
}
const input = (destination = "Japan") => ({ destination, locale: "en" as const, requestId: randomUUID() });

describe("account-scoped destination lookups", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("STARDUST_DESTINATION_LOOKUP", "creators");
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "false"); mocks.operator.mockResolvedValue(false); mocks.provider.mockResolvedValue(providerResult); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it("calls AI even for a country and releases its transaction before provider work", async () => {
    const db = database();
    mocks.provider.mockImplementation(async () => { expect(db.state.leases).toBe(0); return providerResult; });
    const result = await runTripDestinationLookup(db.pool, config, principal, input());
    expect(result).toMatchObject({ source: "ai", timeZone: "Asia/Tokyo", currency: "JPY" });
    expect(mocks.provider).toHaveBeenCalledWith({ destination: "japan", locale: "en", signal: expect.any(AbortSignal) });
    expect(db.rows[0].status).toBe("succeeded");
    expect(db.state.leases).toBe(0);
  });
  it("admits an unsponsored active viewer under creators, not operator-only or disabled", async () => {
    const db = database();
    expect(await canLookupTripDestination(db.pool, config, principal.userId)).toBe(true);
    vi.stubEnv("STARDUST_DESTINATION_LOOKUP", "operator");
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).reason).toBe("not_entitled");
    mocks.operator.mockResolvedValue(true);
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).source).toBe("ai");
    vi.stubEnv("STARDUST_DESTINATION_LOOKUP", "off");
    expect(await canLookupTripDestination(db.pool, config, principal.userId)).toBe(false);
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).reason).toBe("not_entitled");
  });
  it("requires active Google-bound creator identity even for an operator", async () => {
    const db = database(); db.state.active = false; db.state.eligible = false;
    mocks.operator.mockResolvedValue(true);
    expect(await canLookupTripDestination(db.pool, config, principal.userId)).toBe(false);
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).reason).toBe("not_entitled");
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("checks signup for a valid account grant without consuming it", async () => {
    const db = database(); const account = { kind: "account" as const, accountSessionId: randomUUID(), userId: principal.userId,
      issuer: principal.issuer, subject: principal.subject, displayName: "Synthetic" };
    expect((await runTripDestinationLookup(db.pool, config, account, input())).reason).toBe("not_entitled");
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true");
    expect((await runTripDestinationLookup(db.pool, config, account, input())).source).toBe("ai");
    expect(db.query.mock.calls.some(([sql]) => /UPDATE auth_account_sessions/.test(sql))).toBe(false);
  });
  it("uses only prior per-user AI cache without additional quota or provider call", async () => {
    const db = database(); const first = await runTripDestinationLookup(db.pool, config, principal, input("Tokyo"));
    db.state.daily = 10;
    const second = await runTripDestinationLookup(db.pool, config, principal, input(" TOKYO "));
    expect(second).toMatchObject({ source: "cache", lookupId: first.lookupId });
    expect(db.rows).toHaveLength(1); expect(mocks.provider).toHaveBeenCalledTimes(1);
  });
  it("replays completed IDs and rejects a changed destination or locale", async () => {
    const db = database(); const request = input();
    await runTripDestinationLookup(db.pool, config, principal, request);
    expect((await runTripDestinationLookup(db.pool, config, principal, request)).source).toBe("cache");
    await expect(runTripDestinationLookup(db.pool, config, principal, { ...request, destination: "Kyoto" })).rejects.toBeInstanceOf(AppConflictError);
    await expect(runTripDestinationLookup(db.pool, config, principal, { ...request, locale: "zh-HK" })).rejects.toBeInstanceOf(AppConflictError);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });
  it("regenerates cached display labels and refuses malformed cached codes", async () => {
    const db = database(); const request = input();
    await runTripDestinationLookup(db.pool, config, principal, request);
    db.rows[0].response_json!.countryLabels = { en: "private corrupt label", "zh-HK": "private", "zh-HK-lihkg": "private", "ja-JP": "private" };
    const safe = await runTripDestinationLookup(db.pool, config, principal, input());
    expect(safe.source).toBe("cache"); expect(safe.countryLabels?.en).toBe("Japan");
    expect(JSON.stringify(safe)).not.toContain("private");
    db.rows[0].response_json!.currencyCandidates = ["invalid-code"];
    expect((await runTripDestinationLookup(db.pool, config, principal, request)).reason).toBe("invalid_output");
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).source).toBe("ai");
    expect(mocks.provider).toHaveBeenCalledTimes(2);
  });
  it.each([["quota", 10, false, 0], ["busy", 0, true, 0], ["rate_limited", 0, false, 30]] as const)(
    "returns %s without admitting or charging a provider call", async (reason, daily, busy, attempts) => {
      const db = database(); Object.assign(db.state, { daily, busy, attempts });
      expect((await runTripDestinationLookup(db.pool, config, principal, input())).reason).toBe(reason);
      expect(mocks.provider).not.toHaveBeenCalled(); expect(db.rows).toHaveLength(0);
    });
  it("exempts operators from daily quota but not hourly throttle", async () => {
    const db = database(); db.state.daily = 100; mocks.operator.mockResolvedValue(true);
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).source).toBe("ai");
    db.state.attempts = 30;
    expect((await runTripDestinationLookup(db.pool, config, principal, input("Kyoto"))).reason).toBe("rate_limited");
  });
  it("blocks private-looking input before any database or provider work", async () => {
    const db = database();
    expect((await runTripDestinationLookup(db.pool, config, principal, input("booking number 12345"))).reason).toBe("private_text");
    expect(db.query).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it.each(["TIMEOUT", "INVALID_OUTPUT", "TOOL_BLOCKED", "secret raw error"])("terminalizes safe failure %s without raw error leakage", async (code) => {
    const db = database(); mocks.provider.mockRejectedValue({ code, message: "private provider details" });
    const result = await runTripDestinationLookup(db.pool, config, principal, input());
    expect(result.status).toBe("unavailable"); expect(db.rows[0].status).toBe("failed");
    expect(JSON.stringify([result, db.rows])).not.toMatch(/secret raw error|private provider details/);
  });
  it("aborts an unresponsive provider after 20 seconds", async () => {
    vi.useFakeTimers(); const db = database(); let signal: AbortSignal | undefined;
    mocks.provider.mockImplementation((options) => { signal = options.signal; return new Promise(() => {}); });
    const waiting = runTripDestinationLookup(db.pool, config, principal, input());
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await waiting).reason).toBe("timeout"); expect(signal?.aborted).toBe(true);
    expect(db.rows[0].error_code).toBe("TIMEOUT");
  });
  it("suppresses the output when membership or grant expires during the call", async () => {
    const db = database(); mocks.provider.mockImplementation(async () => { db.state.active = false; return providerResult; });
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).reason).toBe("not_entitled");
    expect(db.rows[0]).toMatchObject({ status: "failed", error_code: "AUTH_CHANGED", response_json: null });
  });
  it("cannot overwrite a stale request already terminalized by another worker", async () => {
    const db = database(); db.state.finished = false;
    expect((await runTripDestinationLookup(db.pool, config, principal, input())).reason).toBe("timeout");
  });
});
