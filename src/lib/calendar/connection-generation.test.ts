import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { getCalendarAccessToken, listCalendarState, storeCalendarConnection, verifyLegacyCalendarLink } from "./repository";
import { googleCalendarScope } from "./google-auth";
import { decryptCalendarToken, encryptCalendarToken } from "./tokens";

const secret = "synthetic-calendar-generation-test-secret-long-enough";
const config = { authSecret: secret, googleClientId: "client", googleClientSecret: "secret", appBaseUrl: new URL("http://localhost:3100") } as AuthConfig;
const session = { tripId: "trip", memberId: "member", userId: "user", role: "owner" } as AuthenticatedSession;
const generation = "10000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());
describe("Calendar connection identity fencing", () => {
  it("adopts a legacy identity only with an exact read-only remote Stardust trip/item marker", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "legacy123", extendedProperties: { private: { stardustTripId: "trip", stardustItemId: "item" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyLegacyCalendarLink("synthetic-access", "legacy123", "trip", "item")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls).toHaveLength(1);
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(call[1]?.method ?? "GET").toBe("GET");
    expect(call[0]).toContain("?fields=id,extendedProperties");
  });
  it.each([
    { id: "foreign-id", extendedProperties: { private: { stardustTripId: "trip", stardustItemId: "item" } } },
    { id: "legacy123" },
    { id: "legacy123", extendedProperties: { private: { stardustTripId: "other-trip", stardustItemId: "item" } } },
    { id: "legacy123", extendedProperties: { private: { stardustTripId: "trip", stardustItemId: "other-item" } } },
  ])("does not mutate or create a successor for ambiguous legacy link #%#", async (remote) => {
    const fetchMock = vi.fn(async () => Response.json(remote)); vi.stubGlobal("fetch", fetchMock);
    await expect(verifyLegacyCalendarLink("synthetic-access", "legacy123", "trip", "item")).rejects.toThrow("could not be verified");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not recreate a missing ambiguous legacy source", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 })); vi.stubGlobal("fetch", fetchMock);
    await expect(verifyLegacyCalendarLink("synthetic-access", "legacy123", "trip", "item")).rejects.toThrow("could not be verified");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an import token lookup after account or generation changed before contacting Google", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const pool = { query: vi.fn(async () => ({ rows: [{ account_subject: "different-account", connection_generation: generation }], rowCount: 1 })) } as unknown as Pool;
    await expect(getCalendarAccessToken(pool, config, session, { accountSubject: "expected-account", generation })).rejects.toThrow("connection changed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not overwrite a reconnect that occurred while a refresh request was running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "new-but-obsolete-access", expires_in: 3600 })));
    const query = vi.fn(async (sql: string) => sql.startsWith("UPDATE") ? { rows: [], rowCount: 0 } : { rows: [{
      account_subject: "account", connection_generation: generation, access_token_encrypted: null,
      refresh_token_encrypted: encryptCalendarToken(secret, "synthetic-refresh"), token_expires_at: null,
    }], rowCount: 1 });
    await expect(getCalendarAccessToken({ query } as unknown as Pool, config, session)).rejects.toThrow("connection changed");
    const update = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE"));
    expect(update?.[0]).toContain("IS NOT DISTINCT FROM $5");
  });
  it("a late invalid-grant only invalidates the exact old connection generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })));
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.startsWith("DELETE")) return { rows: [], rowCount: 0 }; // newer connection survives
      if (sql.includes("FROM trip_members tm")) return { rows: [{ role: "owner" }], rowCount: 1 };
      if (sql.includes("FROM calendar_connections")) return { rows: [{ account_subject: "account", connection_generation: generation,
        refresh_token_encrypted: encryptCalendarToken(secret, "obsolete-refresh"), token_expires_at: null }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(listCalendarState({ query } as unknown as Pool, config, session)).rejects.toThrow("access expired");
    const removal = query.mock.calls.find(([sql]) => sql.startsWith("DELETE"));
    expect(removal?.[0]).toContain("IS NOT DISTINCT FROM $3");
    expect(removal?.[1]).toEqual([session.tripId, session.memberId, generation]);
    expect(query.mock.calls.some(([sql, params]) => sql.includes("INSERT INTO audit_events") && params?.[5] === "calendar_disconnected")).toBe(false);
  });
  it.each(["same-account", "different-account"])("never reuses another account's stored refresh token (%s)", async (nextAccount) => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.includes("SELECT refresh_token_encrypted")) return { rows: [{ account_subject: "same-account", refresh_token_encrypted: encryptCalendarToken(secret, "old-refresh") }], rowCount: 1 };
      if (sql.includes("FROM trip_members")) return { rows: [{ role: "owner" }], rowCount: 1 };
      return { rows: [{ id: "trip" }], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const operation = storeCalendarConnection(pool, config, session, { access_token: "new-access", scope: `${googleCalendarScope} openid`, verified_account_subject: nextAccount });
    if (nextAccount === "different-account") {
      await expect(operation).rejects.toThrow("offline access");
      expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO calendar_connections"))).toBe(false);
    } else {
      await operation;
      const saved = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO calendar_connections"));
      expect(saved?.[1]?.[6]).toBe("same-account");
      expect(saved?.[1]?.[7]).toMatch(/^[a-f0-9-]{36}$/);
      expect(decryptCalendarToken(secret, String(saved?.[1]?.[3]))).toBe("old-refresh");
    }
  });
});
