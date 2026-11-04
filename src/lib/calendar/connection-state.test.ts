import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { listCalendarState } from "@/lib/calendar/repository";
import { encryptCalendarToken } from "@/lib/calendar/tokens";

const authSecret = "calendar-connection-state-test-secret-that-is-long-enough";

const config: AuthConfig = {
  appBaseUrl: new URL("http://localhost:3100"),
  allowedOrigins: new Set(["http://localhost:3100"]),
  authSecret,
  databaseUrl: "postgresql://unused",
  googleClientId: "client-id",
  googleClientSecret: "client-secret",
  tripGraceDays: 2,
};

const session: AuthenticatedSession = {
  sessionId: "session-1",
  tripId: "trip-1",
  memberId: "member-1",
  userId: "user-1",
  role: "editor",
  expiresAt: new Date(Date.now() + 60_000),
  absoluteExpiresAt: new Date(Date.now() + 120_000),
  displayName: "Member",
  issuer: "https://accounts.google.com",
  subject: "subject-1",
  generation: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Calendar connection state", () => {
  it("removes a rejected refresh-token connection so Settings no longer reports it as linked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })));
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.includes("FROM trip_members tm")) {
        return {
          rows: [{
            role: "editor",
            can_edit_itinerary: true,
            itinerary_requires_approval: false,
            can_edit_expenses: true,
            expense_requires_approval: false,
            can_sync_calendar: true,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM calendar_connections")) {
        return {
          rows: [{
            access_token_encrypted: null,
            refresh_token_encrypted: encryptCalendarToken(authSecret, "expired-refresh-token"),
            token_expires_at: new Date(Date.now() - 60_000),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("DELETE FROM calendar_connections")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = { query } as unknown as Pool;

    await expect(listCalendarState(pool, config, session)).rejects.toThrow(
      "Google Calendar access expired. Reconnect Google Calendar.",
    );

    expect(query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM calendar_connections"))).toBe(true);
    const disconnectedAudit = query.mock.calls.find(([sql, params]) =>
      String(sql).includes("INSERT INTO audit_events") && params?.[5] === "calendar_disconnected");
    expect(disconnectedAudit).toBeDefined();
  });
});
