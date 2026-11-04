import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { SessionUnavailableError } from "@/lib/auth/errors";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { freshAuthenticationCeiling, readCurrentSessionCeiling, rollingSessionExpiry } from "@/lib/auth/session-lifetime";

const now = new Date("2030-03-01T12:34:56.789Z");
const session: AuthenticatedSession = {
  sessionId: "session", tripId: "trip", memberId: "member", userId: "user", role: "editor",
  displayName: "Synthetic member", issuer: "https://accounts.google.com", subject: "synthetic",
  generation: 7, expiresAt: now, absoluteExpiresAt: new Date("2099-01-01T00:00:00Z"),
};

describe("authentication-age session bounds", () => {
  it("grants exactly 30 elapsed days from fresh authentication, independent of travel dates/DST", () => {
    const ceiling = freshAuthenticationCeiling(now);
    expect(ceiling.toISOString()).toBe("2030-03-31T12:34:56.789Z");
    expect(ceiling.getTime() - now.getTime()).toBe(30 * 86_400_000);
    expect(now.toISOString()).toBe("2030-03-01T12:34:56.789Z");
  });
  it("rolls for 24 hours without extending a nearly exhausted authentication ceiling", () => {
    expect(rollingSessionExpiry(freshAuthenticationCeiling(now), now).toISOString()).toBe("2030-03-02T12:34:56.789Z");
    const ceiling = new Date(now.getTime() + 5 * 60_000);
    expect(rollingSessionExpiry(ceiling, now)).toEqual(ceiling);
  });
  it.each([new Date("invalid"), now, new Date(now.getTime() - 1)])("rejects invalid or exhausted caps (%s)", (cap) => {
    expect(() => rollingSessionExpiry(cap, now)).toThrow(SessionUnavailableError);
  });
  it("rejects invalid authentication clocks", () => {
    expect(() => freshAuthenticationCeiling(new Date("invalid"))).toThrow(SessionUnavailableError);
    expect(() => rollingSessionExpiry(freshAuthenticationCeiling(now), new Date("invalid"))).toThrow(SessionUnavailableError);
  });
  it("inherits the persisted cap rather than a forged or stale session snapshot", async () => {
    const persisted = new Date("2030-03-03T01:00:00Z");
    const query = vi.fn(async () => ({ rows: [{ absolute_expires_at: persisted }], rowCount: 1 }));
    expect(await readCurrentSessionCeiling({ query } as unknown as PoolClient, session)).toEqual(persisted);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(parameters).toEqual(["session", "trip", "member", "user", 7, "editor", session.issuer, "synthetic"]);
    expect(sql).toContain("MATERIALIZED");
    expect(sql.indexOf("FOR UPDATE OF s")).toBeLessThan(sql.indexOf("expires_at > clock_timestamp()"));
    for (const clause of ["tm.status = 'active'", "tm.user_id = s.user_id", "tm.role = $6",
      "s.trip_id = $2", "s.member_id = $3", "s.user_id = $4", "s.generation = $5",
      "s.revoked_at IS NULL", "oi.issuer = $7 AND oi.subject = $8", "absolute_expires_at > clock_timestamp()"])
      expect(sql).toContain(clause);
    expect(sql).not.toContain("ends_on");
  });
  it("rejects a revoked, expired, rotated or rebound source instead of issuing a replacement", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    await expect(readCurrentSessionCeiling({ query } as unknown as PoolClient, session)).rejects.toThrow(SessionUnavailableError);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
