import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { ClaimUnavailableError, JoinUnavailableError, SessionUnavailableError } from "@/lib/auth/errors";
import { consumeClaim, consumeJoinLink, signInExistingIdentity, switchSessionTrip, type AuthenticatedSession } from "@/lib/auth/repository";
import { createTrip } from "@/lib/app/repository";

const now = new Date("2030-03-01T12:00:00Z");
const config = { authSecret: "s".repeat(32), tripGraceDays: 2 } as AuthConfig;
const identity = { issuer: "https://accounts.google.com", subject: "synthetic-returning", emailHint: null, displayNameHint: null };
const session: AuthenticatedSession = {
  sessionId: "source-session", tripId: "source-trip", memberId: "source-member", userId: "synthetic-user",
  role: "owner", displayName: "Synthetic member", issuer: identity.issuer, subject: identity.subject,
  generation: 2, expiresAt: new Date("2099-01-01"), absoluteExpiresAt: new Date("2099-01-01"),
};
const selected = { trip_id: "completed-trip", member_id: "target-member", user_id: session.userId, role: "editor" };

function database(options: { sourceValid?: boolean; targetValid?: boolean; cap?: Date } = {}) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    void _values;
    if (sql.includes("locked_session AS MATERIALIZED")) return { rows: options.sourceValid === false ? [] : [{ absolute_expires_at: options.cap ?? new Date("2030-03-03T00:00:00Z") }], rowCount: options.sourceValid === false ? 0 : 1 };
    if (sql.includes("ORDER BY") && sql.includes("last_selected_trip_id")) return { rows: [selected], rowCount: 1 };
    if (sql.includes("FOR UPDATE OF tm")) return { rows: options.targetValid === false ? [] : [selected], rowCount: options.targetValid === false ? 0 : 1 };
    return { rows: [{ id: "synthetic" }], rowCount: 1 };
  });
  return { query, pool: { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool };
}

describe("completed-trip login and bounded switching", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it("keeps preference/date ranking but does not use travel dates as a membership filter", async () => {
    const db = database();
    const grant = await signInExistingIdentity(db.pool, config, { identity, userAgent: null });
    expect(grant).toMatchObject({ tripId: selected.trip_id, role: "editor", absoluteExpiresAt: new Date("2030-03-31T12:00:00Z"), expiresAt: new Date("2030-03-02T12:00:00Z") });
    const sql = db.query.mock.calls.map(([value]) => value).join("\n");
    expect(sql).toContain("(tm.trip_id = au.last_selected_trip_id) DESC");
    expect(sql).toContain("tm.status = 'active'");
    expect(sql).toContain("BETWEEN t.starts_on AND t.ends_on");
    expect(sql).not.toContain("make_interval");
    expect(sql).not.toContain("AT TIME ZONE t.time_zone)\n                +");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE OF tm"), [identity.issuer, identity.subject, selected.user_id, selected.trip_id, selected.member_id]);
  });
  it("switches to a completed active trip without extending a legacy source ceiling", async () => {
    const cap = new Date("2030-03-01T17:00:00Z");
    const db = database({ cap });
    const grant = await switchSessionTrip(db.pool, config, session, "completed-trip", null);
    expect(grant).toMatchObject({ absoluteExpiresAt: cap, expiresAt: cap, tripId: "completed-trip", role: "editor" });
    const statements = db.query.mock.calls.map(([value]) => value);
    const source = statements.findIndex((sql) => sql.includes("locked_session AS MATERIALIZED"));
    const target = statements.findIndex((sql) => sql.includes("FOR UPDATE OF tm"));
    expect(target).toBeGreaterThan(source);
    expect(statements[target]).not.toContain("ends_on");
    expect(statements[target]).not.toContain("make_interval");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("revoke_reason = 'trip_switch'"), [session.sessionId]);
  });
  it.each([{ sourceValid: false }, { targetValid: false }])("does not revive an invalid source or grant an invalid target (%j)", async (options) => {
    const db = database(options);
    await expect(switchSessionTrip(db.pool, config, session, "completed-trip", null)).rejects.toThrow(SessionUnavailableError);
    const statements = db.query.mock.calls.map(([value]) => value);
    expect(statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(false);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
  it("rechecks source expiry after the account creation lock, including calls without session-grant options", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      void _values;
      if (sql.includes("SELECT role FROM trip_members")) return { rows: [{ role: "owner" }], rowCount: 1 };
      if (sql.includes("locked_session AS MATERIALIZED")) return { rows: [], rowCount: 0 };
      return { rows: [{ id: "synthetic" }], rowCount: 1 };
    });
    const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool;
    await expect(createTrip(pool, session, {
      name: "Synthetic future trip", destinationName: "Japan", timeZone: "Asia/Tokyo",
      defaultLocale: "en", defaultCurrency: "JPY", startsOn: "2030-03-02", endsOn: "2030-03-03", maxMembers: 10,
    })).rejects.toThrow(SessionUnavailableError);
    const calls = query.mock.calls;
    const tripLock = calls.findIndex(([sql]) => sql.includes("SELECT id FROM trips"));
    const accountLock = calls.findIndex(([, values]) => values?.[0] === JSON.stringify([session.userId, "trip-creation"]));
    const sourceCheck = calls.findIndex(([sql]) => sql.includes("locked_session AS MATERIALIZED"));
    expect(accountLock).toBeGreaterThan(tripLock);
    expect(sourceCheck).toBeGreaterThan(accountLock);
    expect(calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(false);
    expect(calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
  it.each(["claim", "join"] as const)("does not admit a new %s after an identity-lock wait crosses the trip invitation cutoff", async (kind) => {
    const cutoff = new Date(now.getTime() + 1_000);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) vi.setSystemTime(new Date(cutoff.getTime() + 1));
      if (sql.includes("SELECT t.max_members")) return { rows: [{ max_members: 10, member_count: 1, absolute_expires_at: cutoff }], rowCount: 1 };
      if (sql.includes("FOR UPDATE OF tm")) return { rows: [{ role: "editor", status: "invited", user_id: null, display_name: "Synthetic invitee", absolute_expires_at: cutoff }], rowCount: 1 };
      return { rows: [{ id: "synthetic-link", trip_id: "synthetic-trip", member_id: "synthetic-member", created_by_member_id: "synthetic-owner", revoked_at: null, exhausted_at: null }], rowCount: 1 };
    });
    const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool;
    const action = kind === "claim" ? consumeClaim : consumeJoinLink;
    await expect(action(pool, config, { rawToken: "a".repeat(43), identity, userAgent: null }))
      .rejects.toThrow(kind === "claim" ? ClaimUnavailableError : JoinUnavailableError);
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(false);
    expect(statements.some((sql) => sql.includes("FROM oidc_identities"))).toBe(false);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});
