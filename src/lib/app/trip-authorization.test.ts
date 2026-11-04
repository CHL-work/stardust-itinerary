import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { lockCurrentTripActor, requireAnotherBoundOwner } from "@/lib/app/trip-authorization";
import { AppForbiddenError, AppNotFoundError, getMemberPermissions } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { updateMemberSchema } from "@/lib/app/validation";

const session = { tripId: "trip", memberId: "member", userId: "user", role: "owner" } as AuthenticatedSession;
function database(role: string | null = "owner", tripExists = true) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM trips")) return { rows: tripExists ? [{ id: "trip" }] : [], rowCount: Number(tripExists) };
    if (sql.includes("SELECT role")) return { rows: role ? [{ role }] : [], rowCount: Number(Boolean(role)) };
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as unknown as PoolClient, query };
}
describe("live trip authorization fence", () => {
  it("locks trip, immutable account, then exact active membership before mutation", async () => {
    const { client, query } = database();
    await lockCurrentTripActor(client, session, { owner: true });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining("FROM trips"), expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("status = 'active'"),
    ]);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("user_id = $3"), ["trip", "member", "user"]);
  });
  it.each(["editor", "viewer", null])("rejects a stale owner session after change to %s", async (role) => {
    await expect(lockCurrentTripActor(database(role).client, session, { owner: true })).rejects.toBeInstanceOf(AppForbiddenError);
  });
  it("rejects deleted trips before taking any member lock", async () => {
    const { client, query } = database("owner", false);
    await expect(lockCurrentTripActor(client, session)).rejects.toBeInstanceOf(AppNotFoundError);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("requires another active signed-in owner, not an invited role label", async () => {
    const { client, query } = database();
    await expect(requireAnotherBoundOwner(client, "trip", "member")).rejects.toBeInstanceOf(AppForbiddenError);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("user_id IS NOT NULL"), ["trip", "member"]);
  });
  it("caps viewer edits even when obsolete permission rows grant them", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ role: "viewer", can_edit_itinerary: true, can_edit_expenses: true }] })) };
    expect(await getMemberPermissions(client as unknown as PoolClient, "trip", "member"))
      .toMatchObject({ canEditItinerary: false, canEditExpenses: false });
  });
  it("requires a displayed revision for any role change", () => {
    expect(updateMemberSchema.safeParse({ role: "owner" }).success).toBe(false);
    expect(updateMemberSchema.parse({ role: "owner", expectedRevision: 2 })).toEqual({ role: "owner", expectedRevision: 2 });
    expect(updateMemberSchema.safeParse({ role: "admin", expectedRevision: 2 }).success).toBe(false);
  });
});
