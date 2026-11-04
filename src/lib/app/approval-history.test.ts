import { describe, expect, it, vi } from "vitest";

import {
  AppForbiddenError,
  AppInvalidInputError,
  approvalHistoryPageSize,
  getApprovalHistory,
  parseApprovalHistoryCursor,
} from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const tripId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";
const ownerSession = {
  tripId,
  memberId,
  userId: "30000000-0000-4000-8000-000000000001",
  role: "owner",
} as AuthenticatedSession;

function historyRow(index: number) {
  const suffix = String(index + 1).padStart(12, "0");
  const microseconds = String(900_000 - index).padStart(6, "0");
  return {
    id: `40000000-0000-4000-8000-${suffix}`,
    pending_priority: 0 as const,
    requested_by_name: "Synthetic traveler",
    source: "member",
    entity_type: "itinerary_item",
    entity_id: null,
    operation: "create",
    base_revision: null,
    proposed_patch: {
      title: `Request ${index + 1}`,
      itineraryAudienceSnapshot: { visibility: "private" },
    },
    reason: `Request ${index + 1}`,
    status: index % 2 === 0 ? "approved" as const : "rejected" as const,
    review_note: "Reviewed",
    created_at: new Date(`2026-09-01T12:00:00.${microseconds.slice(0, 3)}Z`),
    cursor_created_at: `2026-09-01T12:00:00.${microseconds}Z`,
    reviewed_at: new Date("2026-09-01T13:00:00.000Z"),
  };
}

describe("approval history repository", () => {
  it("carries pending priority across a full pending page without changing the database order", async () => {
    const rows = Array.from({ length: approvalHistoryPageSize + 1 }, (_, index) => ({
      ...historyRow(index), pending_priority: 1 as const, status: "pending" as const, reviewed_at: null,
    }));
    const query = vi.fn().mockResolvedValue({ rows });
    const first = await getApprovalHistory({ query } as never, ownerSession, tripId);
    expect(first.requests.map((request) => request.id)).toEqual(rows.slice(0, 25).map((row) => row.id));
    expect(first.requests.every((request) => request.status === "pending")).toBe(true);
    const boundary = parseApprovalHistoryCursor(first.nextCursor, tripId);
    expect(boundary).toEqual({ priority: 1, createdAt: rows[24]!.cursor_created_at, id: rows[24]!.id });
    const nextQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getApprovalHistory({ query: nextQuery } as never, ownerSession, tripId, first.nextCursor);
    expect(nextQuery.mock.calls[0]?.[1]).toEqual([tripId, memberId, 1, boundary!.createdAt, boundary!.id, 26]);
    expect(nextQuery.mock.calls[0]?.[0]).toContain("< ($3::integer, $4::timestamptz, $5::uuid)");
    expect(first.requests[0]).not.toHaveProperty("pending_priority");
  });

  it.each([undefined, null, -1, 2, 0.5, "1", true])("rejects invalid cursor priority %s before querying", async (priority) => {
    const query = vi.fn();
    const cursor = Buffer.from(JSON.stringify({ version: 2, tripId, priority,
      createdAt: "2030-04-01T12:00:00.123456Z", id: historyRow(0).id })).toString("base64url");
    await expect(getApprovalHistory({ query } as never, ownerSession, tripId, cursor)).rejects.toBeInstanceOf(AppInvalidInputError);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects old-order cursors instead of skipping pending requests, and resets with no cursor", () => {
    const cursor = Buffer.from(JSON.stringify({ version: 1, tripId,
      createdAt: "2030-04-01T12:00:00.123456Z", id: historyRow(0).id })).toString("base64url");
    expect(() => parseApprovalHistoryCursor(cursor, tripId)).toThrow(AppInvalidInputError);
    expect(parseApprovalHistoryCursor(null, tripId)).toBeNull();
  });

  it("returns 25 rows, strips internal audience metadata, and preserves microseconds in the cursor", async () => {
    const rows = Array.from({ length: approvalHistoryPageSize + 1 }, (_, index) => historyRow(index));
    const query = vi.fn().mockResolvedValue({ rows });

    const page = await getApprovalHistory({ query } as never, ownerSession, tripId);

    expect(page.requests).toHaveLength(approvalHistoryPageSize);
    expect(page.requests[0]?.patch).toEqual({ title: "Request 1" });
    expect(page.nextCursor).toBeTruthy();
    expect(parseApprovalHistoryCursor(page.nextCursor, tripId)).toEqual({
      priority: 0,
      createdAt: rows[approvalHistoryPageSize - 1]!.cursor_created_at,
      id: rows[approvalHistoryPageSize - 1]!.id,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY pending_priority DESC, cr.created_at DESC, cr.id DESC");
    expect(query.mock.calls[0]?.[0]).toContain("CASE WHEN cr.status = 'pending' AND to_jsonb(cr)->>'invalidated_at' IS NULL THEN 1 ELSE 0 END");
    expect(query.mock.calls[0]?.[0]).toContain("app_member_can_view_change_request");
    expect(query.mock.calls[0]?.[0]).toContain("to_char(cr.created_at AT TIME ZONE 'UTC'");
    expect(query.mock.calls[0]?.[1]).toEqual([tripId, memberId, null, null, null, approvalHistoryPageSize + 1]);
  });

  it("uses the exact six-digit cursor timestamp as the next keyset boundary", async () => {
    const firstQuery = vi.fn().mockResolvedValue({
      rows: Array.from({ length: approvalHistoryPageSize + 1 }, (_, index) => historyRow(index)),
    });
    const firstPage = await getApprovalHistory({ query: firstQuery } as never, ownerSession, tripId);
    const secondQuery = vi.fn().mockResolvedValue({ rows: [] });

    await getApprovalHistory({ query: secondQuery } as never, ownerSession, tripId, firstPage.nextCursor);

    const expectedBoundary = historyRow(approvalHistoryPageSize - 1);
    expect(secondQuery.mock.calls[0]?.[1]).toEqual([
      tripId,
      memberId,
      0,
      expectedBoundary.cursor_created_at,
      expectedBoundary.id,
      approvalHistoryPageSize + 1,
    ]);
    expect(expectedBoundary.cursor_created_at).toMatch(/\.\d{6}Z$/);
  });

  it("denies members before querying and rejects malformed or cross-trip cursors", async () => {
    const query = vi.fn();
    await expect(getApprovalHistory(
      { query } as never,
      { ...ownerSession, role: "editor" },
      tripId,
    )).rejects.toBeInstanceOf(AppForbiddenError);
    expect(query).not.toHaveBeenCalled();

    expect(() => parseApprovalHistoryCursor("not-base64!", tripId)).toThrow(AppInvalidInputError);
    const impossibleDateCursor = Buffer.from(JSON.stringify({
      version: 2,
      tripId,
      priority: 1,
      createdAt: "2026-02-31T12:00:00.123456Z",
      id: "40000000-0000-4000-8000-000000000001",
    })).toString("base64url");
    expect(() => parseApprovalHistoryCursor(impossibleDateCursor, tripId)).toThrow(AppInvalidInputError);

    const pageQuery = vi.fn().mockResolvedValue({
      rows: Array.from({ length: approvalHistoryPageSize + 1 }, (_, index) => historyRow(index)),
    });
    const page = await getApprovalHistory({ query: pageQuery } as never, ownerSession, tripId);
    expect(() => parseApprovalHistoryCursor(
      page.nextCursor,
      "10000000-0000-4000-8000-000000000099",
    )).toThrow(AppInvalidInputError);
  });

  it("projects immutable request detail, resolves removed participant names and flags invalidated history", async () => {
    const formerMemberId = "20000000-0000-4000-8000-000000000002";
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      ...historyRow(0), requested_by_member_id: memberId, entity_type: "expense", operation: "update", base_revision: 1,
      base_patch: { description: "Saved bill", amountMinor: 101, currency: "JPY", payerMemberId: formerMemberId, occurredAt: "2030-04-01T10:00:00Z", splits: [{ memberId: formerMemberId, shareMinor: 101 }] },
      proposed_patch: { description: "Corrected saved bill" }, invalidated_reason: "member_removed", proposal_revision: 2,
    }] }).mockResolvedValueOnce({ rows: [{ id: memberId, display_name: "Owner" }, { id: formerMemberId, display_name: "Former traveler" }] });
    const page = await getApprovalHistory({ query } as never, ownerSession, tripId);
    expect(page.requests[0]).toMatchObject({ status: "approved", proposalRevision: 2, reviewBlockedReason: "member_removed", display: { kind: "expense", expense: { description: "Corrected saved bill", payerName: "Former traveler", amountMinor: 101 } } });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("itinerary_base.revision = cr.base_revision");
    expect(query.mock.calls[0]?.[0]).toContain("expense_base.revision = cr.base_revision");
    expect(query.mock.calls[0]?.[0]).toContain("expense_applied.revision = cr.applied_revision");
    expect(query.mock.calls[0]?.[0]).toContain("cr.status = 'approved' AND expense_applied.trip_id = cr.trip_id");
    expect(query.mock.calls[0]?.[0]).not.toContain("JOIN itinerary_items");
    expect(query.mock.calls[0]?.[0]).not.toContain("JOIN expenses ");
    expect(query.mock.calls[1]?.[0]).toContain("WHERE trip_id = $1 AND id = ANY($2::uuid[])");
    expect(query.mock.calls[1]?.[0]).not.toContain("status");
    expect(query.mock.calls[1]?.[1]?.[0]).toBe(tripId);
  });
});
