import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { projectActivityEntry, type ActivityRow } from "./activity-presentation";
import { loadActivityEntries } from "./activity-repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const id = "c9390000-0000-4000-8000-000000000001";
const row: ActivityRow = {
  id, entity_type: "itinerary_item", action: "update", actor_name: "Synthetic editor", created_at: new Date("2030-04-01T00:00:00Z"),
  target_id: id, target_kind: "itinerary", target_removed: false, target_title: "Current public venue", target_starts_at: "2030-04-02T10:00:00Z",
  target_ends_at: null, target_amount_minor: null, target_currency: null, target_status: "planned",
  changed_keys: ["title", "notes", "startsAt", "endsAt", "secretInternalKey", "viewerMemberIds"],
};
describe("safe activity presentation", () => {
  it("projects only known location zones for authorized events, without exposing geometry or booking details", () => {
    const output = projectActivityEntry({ ...row, changed_keys: ["timeZones"], target_event_clock: {
      itemType: "lodging", locationName: "Synthetic confidential hotel, Salt Lake City, Utah", mapUrl: "https://www.google.com/maps/search/?api=1&query=Salt%20Lake%20City%2CUtah",
      notes: "Secret booking detail", timeZones: null } });
    expect(output).toMatchObject({ eventTimeZones: { start: "America/Denver", end: "America/Denver" }, changedFields: ["time"] });
    expect(JSON.stringify(output)).not.toMatch(/confidential hotel|Salt Lake City|booking detail|maps\/search|locationName|target_event_clock/u);
  });
  it("keeps transport zones independent and sparse proposals explicitly unresolved without looking up a canonical base", () => {
    const output = projectActivityEntry({ ...row, target_event_clock: { itemType: "transport", departureLocationName: "DFW", destinationLocationName: "SLC" } });
    expect(output.eventTimeZones).toEqual({ start: "America/Chicago", end: "America/Denver" });
    expect(projectActivityEntry({ ...row, entity_type: "change_request", target_kind: "request", target_event_clock: {} }).eventTimeZones)
      .toEqual({ start: null, end: null });
  });
  it.each([{ target_removed: true }, { target_id: null }, { target_kind: "expense", entity_type: "expense" }])("does not project event zones for removed, inaccessible or financial targets", (hidden) => {
    expect(projectActivityEntry({ ...row, ...hidden, target_event_clock: { itemType: "meal", timeZones: { start: "America/Denver" } } }).eventTimeZones).toBeNull();
  });
  it("only publishes current safe fields and changed field names, never unknown/raw audit data", () => {
    const output = projectActivityEntry({ ...row, before_state: { title: "Former private title" }, metadata: { secret: "booking-pin" },
      after_state: { notes: "Unrelated private booking" } } as ActivityRow);
    expect(output).toMatchObject({ title: "Current public venue", action: "updated", category: "event", target: { kind: "itinerary", id }, changedFields: ["title", "notes", "time", "audience"] });
    expect(JSON.stringify(output)).not.toMatch(/Former private|booking|before_state|after_state|metadata|secretInternalKey/u);
  });
  it("redacts removed targets rather than linking to a vanished or private tombstone", () => {
    const output = projectActivityEntry({ ...row, target_removed: true });
    expect(output).toMatchObject({ title: null, startsAt: null, status: null, amount: null, changedFields: [], target: null, targetState: "removed" });
  });
  it.each([null, "not-an-id"])("does not expose facts without a usable authorized target (%s)", (target_id) => {
    expect(projectActivityEntry({ ...row, target_id })).toMatchObject({ title: null, startsAt: null, target: null, targetState: "unavailable" });
  });
  it("keeps proposal-only access distinct from canonical event access", () => {
    expect(projectActivityEntry({ ...row, entity_type: "change_request", target_kind: "request", target_status: "rejected" }))
      .toMatchObject({ category: "request", status: "rejected", target: { kind: "request", id } });
  });
  it("maps unknown actions/types to neutral copy, never model/provider error text", () => {
    const output = projectActivityEntry({ ...row, entity_type: "raw-private-error", action: "secret-token=unexpected", target_id: null, target_kind: null });
    expect(output).toMatchObject({ category: "system", action: "changed", targetState: "none" });
    expect(JSON.stringify(output)).not.toContain("secret-token");
  });
  it.each(["ai_personal_memory", "ai_request", "ai_conversation"])("keeps %s activity generic and excludes private subjects", (entity_type) => {
    expect(projectActivityEntry({ ...row, entity_type, action: "edited", target_id: null, target_kind: null }))
      .toMatchObject({ category: "ai", action: "updated", title: null, target: null, changedFields: [] });
  });
  it("retains exact safe integer amount including zero and suppresses invalid money", () => {
    const bill = { ...row, entity_type: "expense", target_kind: "expense", target_currency: "HKD" };
    expect(projectActivityEntry({ ...bill, target_amount_minor: "9007199254740991" }).amount).toEqual({ amountMinor: Number.MAX_SAFE_INTEGER, currency: "HKD" });
    expect(projectActivityEntry({ ...bill, target_amount_minor: 0 }).amount?.amountMinor).toBe(0);
    for (const amount of ["9007199254740992", "1.5", -2, NaN]) expect(projectActivityEntry({ ...bill, target_amount_minor: amount }).amount).toBeNull();
    expect(projectActivityEntry({ ...bill, target_amount_minor: 100, target_currency: "BAD" }).amount).toBeNull();
  });
  it("drops invalid or excessive display values without leaking fallback audit state", () => {
    expect(projectActivityEntry({ ...row, target_title: "x".repeat(501), target_starts_at: "not-a-date", target_ends_at: {}, target_status: "private-internal-state" }))
      .toMatchObject({ title: null, startsAt: null, endsAt: null, status: null });
  });
});

describe("activity repository authorization query contract", () => {
  const session = { tripId: id, memberId: "member", userId: "user", role: "owner" } as AuthenticatedSession;
  it("denies nonowners before an audit query", async () => {
    const query = vi.fn();
    expect(await loadActivityEntries({ query } as unknown as Pool, { ...session, role: "editor" })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
  it("checks current exact owner, trip and each target predicate; bounds order and projects only safe values", async () => {
    const query = vi.fn(async () => ({ rows: [row] }));
    expect(await loadActivityEntries({ query } as unknown as Pool, session, { activityId: id })).toHaveLength(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(parameters).toEqual([id, "member", "user", id]);
    for (const fragment of ["actor.trip_id=$1", "actor.id=$2", "actor.user_id=$3", "actor.status='active'", "actor.role='owner'",
      "app_member_can_view_itinerary_item", "app_member_can_view_expense", "app_member_can_view_change_request", "ae.id = $4", "LIMIT 50", "ae.created_at DESC,ae.id DESC"])
      expect(sql).toContain(fragment);
    const resultColumns = sql.slice(sql.indexOf("SELECT ae.id,ae.entity_type"));
    expect(resultColumns).not.toContain("ae.metadata");
    expect(resultColumns).not.toContain("AS before_state");
    expect(resultColumns).not.toContain("AS after_state");
    expect(resultColumns).not.toContain("cr.base_patch");
    expect(resultColumns).not.toContain("cr.entity_id=i.id");
    expect(resultColumns).toContain("ae.entity_type IN ('itinerary_item','calendar_event_link') AND i.trip_id=ae.trip_id AND i.id=ae.entity_id");
    expect(resultColumns).toContain("END AS target_event_clock");
  });
});
