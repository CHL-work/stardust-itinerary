import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import {
  AppConflictError, AppForbiddenError, AppInvalidInputError, AppNotFoundError, applyPermittedChangeRequest,
  getAiPendingItineraryContext, updatePendingItineraryRequest,
  updatePendingItineraryRequestWithClient, reviewChangeRequestWithClient,
} from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";

vi.mock("@/lib/app/trip-authorization", () => ({ lockCurrentTripActor: vi.fn(), requireAnotherBoundOwner: vi.fn() }));
const id = (value: number) => `e9200000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const session = { tripId: id(1), memberId: id(2), userId: id(3), role: "editor" } as AuthenticatedSession;
const owner = { ...session, memberId: id(4), userId: id(5), role: "owner" } as AuthenticatedSession;
const expense = { description: "Synthetic admission", amountMinor: 101, currency: "JPY", payerMemberId: session.memberId,
  splitMemberIds: [session.memberId, owner.memberId], occurredAt: "2030-04-01T10:00:00Z", status: "posted" };
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: id(6), requested_by_member_id: session.memberId, requested_by_name: "Synthetic traveler", source: "member",
    entity_type: "itinerary_item", operation: "create", entity_id: null, base_revision: null, base_patch: null,
    current_patch: null, target_revision: null, status: "pending", proposal_revision: 4, reason: "Private original reason",
    created_at: new Date("2030-04-01T08:00:00Z"), updated_at: new Date("2030-04-01T09:00:00Z"),
    proposed_patch: { tripDayId: id(7), title: "Synthetic pending event", itemType: "meal", startsAt: "2030-04-01T10:00:00Z",
      endsAt: "2030-04-01T11:00:00Z", locationName: "Synthetic restaurant", notes: "Keep these notes", visibility: "private",
      viewerMemberIds: [owner.memberId], linkedExpense: expense },
    ...overrides,
  };
}
function database(options: { record?: ReturnType<typeof row>; contextRows?: ReturnType<typeof row>[]; aiEdit?: boolean; noProvenance?: boolean; noAudience?: boolean; denied?: boolean } = {}) {
  const record = options.record ?? row();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM ai_requests request")) return { rows: options.noProvenance ? [] : [{ id: id(8) }], rowCount: options.noProvenance ? 0 : 1 };
    if (sql.includes("SELECT tm.role, mp.can_edit_itinerary")) return { rows: [{ role: "editor", can_edit_itinerary: !options.denied, itinerary_requires_approval: false }] };
    if (sql.includes("SELECT cr.id, cr.requested_by_member_id")) return { rows: options.contextRows ?? [record] };
    if (sql.includes("SELECT cr.*") || sql.includes("SELECT * FROM change_requests")) return { rows: options.noAudience ? [] : [record] };
    if (sql.includes("AS edited_by_ai")) return { rows: [{ edited_by_ai: options.aiEdit ?? false }] };
    if (sql.includes("FROM trip_days")) return { rows: [{ dates_valid: true }], rowCount: 1 };
    if (sql.includes("SELECT id FROM trip_members")) return { rows: (values[1] as string[]).map((id) => ({ id })), rowCount: (values[1] as string[]).length };
    if (sql.includes("UPDATE change_requests")) return { rows: [{ proposal_revision: 5, updated_at: new Date("2030-04-01T12:00:00Z") }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client = { query, release };
  const connect = vi.fn(async () => client);
  return { client, pool: { query, connect }, query, release, connect };
}
const update = { proposalRevision: 4, patch: { title: "Corrected synthetic event" }, reason: "New reason" };
beforeEach(() => vi.clearAllMocks());

describe("transaction-aware AI pending event edits", () => {
  it("keeps existing linked custom shares byte-for-byte when AI edits only the pending event", async () => {
    const custom = { ...expense, splitAmounts: [{ memberId: owner.memberId, amountMinor: 101 }, { memberId: session.memberId, amountMinor: 0 }] };
    const original = row();
    const db = database({ record: row({ proposed_patch: { ...original.proposed_patch, linkedExpense: custom } }) });
    const result = await updatePendingItineraryRequestWithClient(db.client as never, session, session.tripId, id(6), update, { aiRequestId: id(8) });
    expect(result.patch.linkedExpense).toEqual(custom);
    const write = db.query.mock.calls.find(([sql]) => sql.includes("UPDATE change_requests"))!;
    expect(JSON.stringify(JSON.parse(write[1]![2] as string).linkedExpense)).toBe(JSON.stringify(custom));
    expect(db.query.mock.calls.some(([sql]) => /(?:UPDATE|INSERT INTO) (?:itinerary_items|expenses)/.test(sql))).toBe(false);
  });

  it("uses the supplied client, preserves audience and nested expense, keeps identity pending, and records trusted provenance", async () => {
    const db = database();
    const result = await updatePendingItineraryRequestWithClient(db.client as never, session, session.tripId, id(6), update, { aiRequestId: id(8) });
    expect(result).toMatchObject({ requestId: id(6), proposalRevision: 5, status: "pending", source: "member", requestedByMemberId: session.memberId,
      patch: { ...update.patch, notes: "Keep these notes", viewerMemberIds: [owner.memberId], linkedExpense: expense } });
    expect(lockCurrentTripActor).toHaveBeenCalledWith(db.client, session);
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))).toBe(false);
    const write = db.query.mock.calls.find(([sql]) => sql.includes("UPDATE change_requests"))!;
    expect(JSON.parse(write[1]![2] as string).linkedExpense).toEqual(expense);
    expect(write[0]).toContain("invalidated_at");
    expect(write[0]).not.toContain("requested_by_member_id =");
    expect(write[0]).not.toContain("source =");
    const audit = db.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO audit_events"))!;
    expect(JSON.parse(audit[1]![8] as string)).toMatchObject({ source: "member", editSource: "ai", aiRequestId: id(8), requiresOwnerReview: true });
    expect(JSON.parse(audit[1]![6] as string).proposalRevision).toBe(4);
    expect(JSON.parse(audit[1]![7] as string).proposalRevision).toBe(5);
    expect(db.query.mock.calls.some(([sql]) => /(?:UPDATE|INSERT INTO) (?:itinerary_items|expenses)/.test(sql))).toBe(false);
  });

  it("keeps the manual pool wrapper transactional and allows its existing expense removal", async () => {
    const db = database();
    const result = await updatePendingItineraryRequest(db.pool as never, session, session.tripId, id(6), { proposalRevision: 4, patch: { linkedExpense: null } });
    expect(result.patch.linkedExpense).toBeNull();
    expect(db.query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(db.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
    expect(db.query.mock.calls.some(([sql]) => sql.includes("FROM ai_requests"))).toBe(false);
  });

  it.each([{ linkedExpense: null }, { linkedExpense: expense }, { isLocked: false }, { isLocked: true }])("rejects model-controlled protected fields %j before a write", async (patch) => {
    const db = database();
    await expect(updatePendingItineraryRequestWithClient(db.client as never, owner, owner.tripId, id(6), { ...update, patch: patch as never }, { aiRequestId: id(8) })).rejects.toBeInstanceOf(AppForbiddenError);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each(["approved", "rejected", "superseded"])("never edits a terminal %s request", async (status) => {
    const db = database({ record: row({ status }) });
    await expect(updatePendingItineraryRequestWithClient(db.client as never, session, session.tripId, id(6), update)).rejects.toBeInstanceOf(AppConflictError);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("UPDATE change_requests"))).toBe(false);
  });

  it("rejects a stale proposal revision and rolls back the manual transaction", async () => {
    const db = database({ record: row({ proposal_revision: 5 }) });
    await expect(updatePendingItineraryRequest(db.pool as never, session, session.tripId, id(6), update)).rejects.toBeInstanceOf(AppConflictError);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it.each([null, 2])("rejects missing/stale canonical revision %s on a pending update", async (targetRevision) => {
    const db = database({ record: row({ operation: "update", entity_id: id(9), base_revision: 1, target_revision: targetRevision,
      current_patch: targetRevision ? { title: "Changed canonical target" } : null }) });
    await expect(updatePendingItineraryRequestWithClient(db.client as never, owner, owner.tripId, id(6), update)).rejects.toBeInstanceOf(AppConflictError);
  });

  it("blocks editors from locked drafts but allows an owner to change event fields without altering the lock", async () => {
    const record = row(); record.proposed_patch = { ...record.proposed_patch, isLocked: true } as never;
    const db = database({ record });
    await expect(updatePendingItineraryRequestWithClient(db.client as never, session, session.tripId, id(6), update)).rejects.toBeInstanceOf(AppForbiddenError);
    expect((await updatePendingItineraryRequestWithClient(db.client as never, owner, owner.tripId, id(6), update, { aiRequestId: id(8) })).patch.isLocked).toBe(true);
  });

  it("protects creator privacy from owner edits and rejects unbound provenance or an invisible/invalidated target", async () => {
    await expect(updatePendingItineraryRequestWithClient(database().client as never, owner, owner.tripId, id(6), { ...update, patch: { visibility: "trip" } })).rejects.toBeInstanceOf(AppForbiddenError);
    await expect(updatePendingItineraryRequestWithClient(database({ noProvenance: true }).client as never, session, session.tripId, id(6), update, { aiRequestId: id(8) })).rejects.toBeInstanceOf(AppConflictError);
    const hidden = database({ noAudience: true });
    await expect(updatePendingItineraryRequestWithClient(hidden.client as never, session, session.tripId, id(6), update)).rejects.toBeInstanceOf(AppNotFoundError);
    expect(hidden.query.mock.calls.find(([sql]) => sql.includes("SELECT cr.*"))?.[0]).toContain("app_member_can_view_change_request");
    expect(hidden.query.mock.calls.find(([sql]) => sql.includes("SELECT cr.*"))?.[0]).toContain("FOR UPDATE OF cr");
  });

  it.each([session, owner])("requires explicit review of a manual-source request edited by AI, even for $role direct-apply", async (actor) => {
    const db = database({ aiEdit: true });
    await expect(applyPermittedChangeRequest(db.pool as never, actor, actor.tripId, id(6))).rejects.toBeInstanceOf(AppForbiddenError);
    expect(lockCurrentTripActor).toHaveBeenCalledWith(db.client, actor);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(db.query.mock.calls.some(([sql]) => sql.includes("UPDATE change_requests"))).toBe(false);
  });

  it.each(["approve", "reject"] as const)("rejects a stale rendered revision before %s or canonical writes", async (decision) => {
    const db = database();
    await expect(reviewChangeRequestWithClient(db.client as never, owner, owner.tripId, id(6), decision, undefined, 3)).rejects.toBeInstanceOf(AppConflictError);
    expect(lockCurrentTripActor).toHaveBeenCalledWith(db.client, owner, { owner: true });
    expect(db.query.mock.calls.some(([sql]) => /^\s*(?:UPDATE|INSERT INTO)/.test(sql))).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid review revision %s", async (revision) => {
    const db = database();
    await expect(reviewChangeRequestWithClient(db.client as never, owner, owner.tripId, id(6), "approve", undefined, revision)).rejects.toBeInstanceOf(AppInvalidInputError);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("bounded authorized AI pending context", () => {
  it("returns stable request identities and safe event-only fields, never reasons, names, expenses or internal metadata", async () => {
    const db = database();
    const context = await getAiPendingItineraryContext(db.client as never, session, session.tripId);
    expect(context.pendingItinerary[0]).toMatchObject({ requestId: id(6), proposalRevision: 4, targetItemId: null, operation: "create",
      createdByMemberId: session.memberId, hasLinkedExpense: true, patch: { title: "Synthetic pending event", isLocked: false } });
    const serialized = JSON.stringify(context);
    for (const hidden of ["Private original reason", "requestedByName", "amountMinor", "payerMemberId", "itineraryAudienceSnapshot"]) expect(serialized).not.toContain(hidden);
    const [sql, values] = db.query.mock.calls.find(([sql]) => sql.includes("SELECT cr.id"))!;
    expect(sql).toContain("actor.user_id = $3 AND actor.status = 'active' AND actor.role = $4");
    expect(sql).toContain("target.current_revision = cr.base_revision");
    expect(sql).toContain("invalidated_at");
    expect(sql).toContain("app_member_can_view_change_request");
    expect(sql).toContain("ORDER BY cr.updated_at DESC, cr.id DESC");
    expect(values).toEqual([session.tripId, session.memberId, session.userId, session.role, 101]);
  });

  it("caps context at 100 and discloses truncation without altering IDs or revisions", async () => {
    const db = database({ contextRows: Array.from({ length: 101 }, (_, index) => row({ id: id(100 + index), proposal_revision: index + 1,
      proposed_patch: { tripDayId: id(7), title: "x", itemType: "note", visibility: "trip" } })) });
    const context = await getAiPendingItineraryContext(db.client as never, owner, owner.tripId);
    expect(context.pendingItinerary).toHaveLength(100);
    expect(context.pendingItineraryTruncated).toBe(true);
    expect(context.pendingItinerary.at(-1)).toMatchObject({ requestId: id(199), proposalRevision: 100 });
  });

  it("also caps the complete serialized context at 60,000 characters without truncating an event field", async () => {
    const fullNotes = "保留完整資料".repeat(600);
    const contextRows = Array.from({ length: 100 }, (_, index) => {
      const record = row({ id: id(100 + index) });
      record.proposed_patch = { ...record.proposed_patch, notes: fullNotes };
      return record;
    });
    const context = await getAiPendingItineraryContext(database({ contextRows }).client as never, owner, owner.tripId);
    expect(context.pendingItinerary.length).toBeGreaterThan(0);
    expect(context.pendingItinerary.length).toBeLessThan(100);
    expect(context.pendingItineraryTruncated).toBe(true);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(60_000);
    expect(context.pendingItinerary.every((entry) => entry.patch.notes === fullNotes)).toBe(true);
    expect(context.pendingItinerary.map((entry) => entry.requestId)).toEqual(
      contextRows.slice(0, context.pendingItinerary.length).map((record) => record.id),
    );
  });

  it("does not materialize missing snapshot fields from a hidden canonical target", async () => {
    const db = database({ contextRows: [row({ operation: "update", entity_id: id(9), base_revision: 1, target_revision: 1,
      proposed_patch: { title: "Incomplete legacy proposal" }, base_patch: { title: "Incomplete immutable snapshot" },
      current_patch: { tripDayId: id(7), title: "Private current title", notes: "Private current notes" } })] });
    expect((await getAiPendingItineraryContext(db.client as never, owner, owner.tripId)).pendingItinerary).toEqual([]);
  });

  it("does not query proposal context for a viewer or an editor without edit permission", async () => {
    const viewerDb = database();
    expect((await getAiPendingItineraryContext(viewerDb.client as never, { ...session, role: "viewer" }, session.tripId)).pendingItinerary).toEqual([]);
    expect(viewerDb.query).not.toHaveBeenCalled();
    const deniedDb = database({ denied: true });
    expect((await getAiPendingItineraryContext(deniedDb.client as never, session, session.tripId)).pendingItinerary).toEqual([]);
    expect(deniedDb.query).toHaveBeenCalledOnce();
  });
});
