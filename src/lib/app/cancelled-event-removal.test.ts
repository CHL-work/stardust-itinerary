import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppConflictError, AppForbiddenError, AppInvalidInputError, AppNotFoundError,
  removeCancelledItineraryItem } from "@/lib/app/repository";

const owner = { tripId: "trip", memberId: "owner", userId: "user", role: "owner" } as AuthenticatedSession;
const current = { id: "item", trip_id: "trip", title: "Cancelled visit", status: "cancelled",
  current_revision: 2, created_by_member_id: "owner", visibility: "private", viewer_member_ids: ["member"] };

function database(options: { item?: Record<string, unknown> | null; actualRole?: string; auditFailure?: boolean } = {}) {
  const item = options.item === undefined ? current : options.item;
  const query = vi.fn(async (sql: string) => {
    const normalized = sql.trim().replace(/\s+/gu, " ");
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [], rowCount: 0 };
    if (normalized.startsWith("SELECT id FROM trips")) return { rows: [{ id: "trip" }], rowCount: 1 };
    if (normalized.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    if (normalized.startsWith("SELECT role FROM trip_members")) return { rows: [{ role: options.actualRole ?? "owner" }], rowCount: 1 };
    if (normalized.startsWith("SELECT i.*")) return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
    if (normalized.startsWith("UPDATE itinerary_items SET removed_at")) return {
      rows: [{ ...item, removed_at: new Date("2026-09-07T10:00:00Z"), removed_by_member_id: "owner" }], rowCount: 1,
    };
    if (normalized.startsWith("UPDATE change_requests")) return { rows: [{ id: "pending-change" }], rowCount: 1 };
    if (normalized.startsWith("INSERT INTO audit_events") && options.auditFailure) throw new Error("Audit unavailable");
    if (normalized.startsWith("INSERT INTO itinerary_revisions") || normalized.startsWith("INSERT INTO audit_events")
      || normalized.startsWith("UPDATE calendar_event_links")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${normalized}`);
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pool, query, release, connect };
}

describe("cancelled event removal transaction", () => {
  it.each(["editor", "viewer"])("denies %s before opening a mutation transaction", async (role) => {
    const db = database();
    await expect(removeCancelledItineraryItem(db.pool, { ...owner, role } as AuthenticatedSession,
      "trip", "item", { expectedRevision: 2, confirm: true })).rejects.toBeInstanceOf(AppForbiddenError);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it("denies foreign trip and missing explicit confirmation before opening a transaction", async () => {
    const db = database();
    await expect(removeCancelledItineraryItem(db.pool, owner, "other-trip", "item",
      { expectedRevision: 2, confirm: true })).rejects.toBeInstanceOf(AppForbiddenError);
    await expect(removeCancelledItineraryItem(db.pool, owner, "trip", "item",
      { expectedRevision: 0, confirm: true })).rejects.toBeInstanceOf(AppInvalidInputError);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each([
    [{ item: null }, AppNotFoundError],
    [{ item: { ...current, current_revision: 3 } }, AppConflictError],
    [{ item: { ...current, status: "planned" } }, AppConflictError],
    [{ actualRole: "editor" }, AppForbiddenError],
  ])("rolls back denied removal with no item write", async (options, error) => {
    const db = database(options);
    await expect(removeCancelledItineraryItem(db.pool, owner, "trip", "item",
      { expectedRevision: 2, confirm: true })).rejects.toBeInstanceOf(error);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("SET removed_at"))).toBe(false);
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.release).toHaveBeenCalledOnce();
  });
  it("writes a tombstone revision and audit, supersedes actionable changes, and preserves finances", async () => {
    const db = database();
    await expect(removeCancelledItineraryItem(db.pool, owner, "trip", "item",
      { expectedRevision: 2, confirm: true })).resolves.toEqual({ status: "removed", itemId: "item", revision: 3 });
    const calls = db.query.mock.calls as unknown as Array<[string, unknown[]?]>;
    const revision = calls.find(([sql]) => sql.includes("INSERT INTO itinerary_revisions"));
    const snapshot = JSON.parse(revision?.[1]?.[4] as string) as Record<string, unknown>;
    expect(snapshot).toMatchObject({ status: "cancelled", currentRevision: 3, viewerMemberIds: ["member"],
      removedAt: "2026-09-07T10:00:00.000Z", removedByMemberId: "owner" });
    const supersede = calls.find(([sql]) => sql.includes("UPDATE change_requests"))?.[0];
    expect(supersede).toContain("request.status IN ('pending', 'rejected')");
    expect(supersede).toContain("request.invalidated_at IS NULL");
    expect(calls.some(([sql]) => /^\s*(?:UPDATE|DELETE FROM|INSERT INTO) (?:expenses|expense_splits|itinerary_item_viewers)\b/u.test(sql))).toBe(false);
    expect(calls.filter(([sql]) => sql.includes("INSERT INTO audit_events"))).toHaveLength(2);
    expect(db.query).toHaveBeenCalledWith("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });
  it("rolls back the tombstone and revision if any audit cannot be written", async () => {
    const db = database({ auditFailure: true });
    await expect(removeCancelledItineraryItem(db.pool, owner, "trip", "item",
      { expectedRevision: 2, confirm: true })).rejects.toThrow("Audit unavailable");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.query).not.toHaveBeenCalledWith("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });
});
