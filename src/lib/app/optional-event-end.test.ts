import { describe, expect, it } from "vitest";

import { aiItineraryPatchSchema, aiPendingItineraryPatchSchema } from "@/lib/ai/proposal-contract";
import { projectPendingItinerary } from "@/lib/app/repository";
import { nextUpcomingTimelinePoint, projectTimelinePoints } from "@/lib/app/timeline";
import { canonicalizeItineraryLocationPatch } from "@/lib/app/transport";
import type { ItineraryPatch } from "@/lib/app/types";
import { changeRequestSchema, itineraryPatchSchema, pendingItineraryEditSchema } from "@/lib/app/validation";
import { findCalendarConflicts } from "@/lib/domain/calendar-conflicts";
import { createOfflineItinerarySnapshot, parseOfflineItinerarySnapshot } from "@/lib/offline/itinerary-snapshot";
import { eventWeatherTargets } from "@/lib/weather/domain";

const tripDayId = "30000000-0000-4000-8000-000000000026";
const itemId = "40000000-0000-4000-8000-000000000026";
const memberId = "20000000-0000-4000-8000-000000000026";
const startsAt = "2030-04-01T14:30:00.000Z";
const knownEndsAt = "2030-04-01T15:30:00.000Z";
const tripDays = [
  { id: tripDayId, date: "2030-04-01", label: null },
  { id: "30000000-0000-4000-8000-000000000027", date: "2030-04-02", label: null },
];
const timelineOptions = { tripDays, timeZone: "Asia/Tokyo" };

function item(overrides: Partial<{
  itemType: string; startsAt: string | null; endsAt: string | null;
  departureLocationName: string | null; destinationLocationName: string | null;
}> = {}) {
  return {
    id: itemId, tripDayId, title: "Synthetic flexible visit", itemType: "activity",
    startsAt, endsAt: null, locationName: "Synthetic venue", mapUrl: null,
    departureLocationName: null, departureMapUrl: null,
    destinationLocationName: null, destinationMapUrl: null,
    status: "planned", visibility: "trip", ...overrides,
  };
}

function pending(proposedPatch: Record<string, unknown>, basePatch?: Record<string, unknown>) {
  return projectPendingItinerary({
    id: "10000000-0000-4000-8000-000000000026",
    requested_by_member_id: memberId, requested_by_name: "Synthetic member",
    created_at: new Date("2030-03-31T00:00:00.000Z"),
    proposed_patch: proposedPatch,
    ...(basePatch ? { operation: "update" as const, entity_id: itemId, base_patch: basePatch } : {}),
  });
}

describe("optional itinerary end times across backend contracts", () => {
  it.each(["activity", "meal", "lodging", "note", "transport"] as const)(
    "accepts a start-only %s create without inventing an end or persisted duration",
    (itemType) => {
      const patch: ItineraryPatch = {
        tripDayId, title: "Synthetic flexible visit", itemType, startsAt,
        ...(itemType === "transport" ? { departureLocationName: "Synthetic origin" } : {}),
      };
      for (const schema of [itineraryPatchSchema, aiItineraryPatchSchema]) {
        const parsed = schema.parse(patch);
        expect(parsed).not.toHaveProperty("endsAt");
        expect(parsed).not.toHaveProperty("durationMinutes");
        expect(canonicalizeItineraryLocationPatch(parsed)).not.toHaveProperty("endsAt");
      }
      const request = changeRequestSchema.parse({
        entityType: "itinerary_item", operation: "create", patch,
        reason: "The end time is not known yet.",
      });
      expect(request.patch).not.toHaveProperty("endsAt");
      expect(pending(patch)).toMatchObject({ startsAt, endsAt: null, itemType });
    },
  );

  it("keeps explicit end removal distinct from an omitted canonical edit", () => {
    const cleared = changeRequestSchema.parse({
      entityType: "itinerary_item", entityId: itemId, operation: "update",
      baseRevision: 4, patch: { endsAt: null }, reason: "Clear an uncertain end.",
    });
    expect(cleared.patch).toEqual({ endsAt: null });
    expect(itineraryPatchSchema.parse({ title: "Rename only" })).not.toHaveProperty("endsAt");
    expect(canonicalizeItineraryLocationPatch({ endsAt: null })).toHaveProperty("endsAt", null);
  });

  it("allows the same sparse end removal in manual and AI pending editors", () => {
    expect(pendingItineraryEditSchema.parse({ proposalRevision: 3, patch: { endsAt: null } }))
      .toEqual({ proposalRevision: 3, patch: { endsAt: null } });
    expect(aiPendingItineraryPatchSchema.parse({ endsAt: null })).toEqual({ endsAt: null });
    expect(aiPendingItineraryPatchSchema.parse({ title: "Rename only" })).not.toHaveProperty("endsAt");
  });

  it("clears a known pending-update end without restoring its base revision value", () => {
    const base = { tripDayId, title: "Original visit", itemType: "activity", startsAt, endsAt: knownEndsAt };
    expect(pending({ endsAt: null }, base)).toMatchObject({
      operation: "update", targetItemId: itemId, startsAt, endsAt: null,
    });
    expect(pending({ title: "Rename only" }, base)).toMatchObject({ startsAt, endsAt: knownEndsAt });
  });

  it("does not turn a supplied invalid end into an accepted unknown end", () => {
    for (const endsAt of ["", "not-a-time", "2030-04-01T25:00:00.000Z"]) {
      expect(itineraryPatchSchema.safeParse({ startsAt, endsAt }).success).toBe(false);
      expect(aiPendingItineraryPatchSchema.safeParse({ endsAt }).success).toBe(false);
      expect(pendingItineraryEditSchema.safeParse({ proposalRevision: 1, patch: { endsAt } }).success).toBe(false);
    }
  });
});

describe("unknown ends remain unknown in timeline, weather and offline projections", () => {
  it("keeps a start-only event on its scheduled day and eligible for the upcoming countdown", () => {
    const source = item();
    const points = projectTimelinePoints([source], timelineOptions);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ kind: "event", at: startsAt, tripDayId, ownsActions: true });
    expect(nextUpcomingTimelinePoint(points, Date.parse(startsAt) - 60_000)).toBe(points[0]);
    expect(source.endsAt).toBeNull();
  });

  it("keeps an unknown transport arrival untimed instead of adding a one-hour cross-day arrival", () => {
    const source = item({ itemType: "transport", departureLocationName: "Synthetic origin", destinationLocationName: "Synthetic destination" });
    const points = projectTimelinePoints([source], timelineOptions);
    expect(points.map(({ kind, at, tripDayId: day, ownsActions }) => ({ kind, at, day, ownsActions }))).toEqual([
      { kind: "departure", at: startsAt, day: tripDayId, ownsActions: true },
      { kind: "arrival", at: null, day: tripDayId, ownsActions: false },
    ]);
    expect(nextUpcomingTimelinePoint(points, Date.parse(startsAt) + 1)).toBeNull();
    expect(source.endsAt).toBeNull();
  });

  it("retains destination-only transport actions even when arrival time is unknown", () => {
    const points = projectTimelinePoints([item({
      itemType: "transport", destinationLocationName: "Synthetic destination",
    })], timelineOptions);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ kind: "arrival", at: null, tripDayId, ownsActions: true });
    expect(nextUpcomingTimelinePoint(points, Date.parse(startsAt) - 1)).toBeNull();
  });

  it("uses the known event start for weather without treating an unknown end as an indefinite active visit", () => {
    const source = item();
    const targets = eventWeatherTargets({ ...source, now: "2030-04-01T14:45:00.000Z" });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ role: "location", forecastAt: new Date(startsAt), forecastTimeKind: "scheduled" });
    expect(source.endsAt).toBeNull();
  });

  it("does not borrow departure time or an all-day fallback for arrival weather", () => {
    const targets = eventWeatherTargets({
      ...item({ itemType: "transport", departureLocationName: "Synthetic origin", destinationLocationName: "Synthetic destination" }),
      fallbackForecastAt: "2030-04-01T03:00:00.000Z",
      now: "2030-04-01T14:45:00.000Z",
    });
    expect(targets.map(({ role, forecastAt }) => ({ role, forecastAt })))
      .toEqual([{ role: "departure", forecastAt: new Date(startsAt) }]);
  });

  it.each(["activity", "transport"])("round-trips an unknown %s end in the privacy-reduced offline snapshot", (itemType) => {
    const sourceItem = item({ itemType,
      ...(itemType === "transport" ? { departureLocationName: "Synthetic origin", destinationLocationName: "Synthetic destination" } : {}),
    });
    const source = {
      session: { memberId, displayName: "Synthetic member" },
      trip: { id: "synthetic-trip", name: "Synthetic trip", destinationName: "Japan", timeZone: "Asia/Tokyo",
        defaultLocale: "en", startsOn: "2030-04-01", endsOn: "2030-04-02" },
      days: tripDays, visibleItinerary: [sourceItem],
    };
    const snapshot = createOfflineItinerarySnapshot(source, new Date("2030-04-01T00:00:00.000Z"));
    const restored = parseOfflineItinerarySnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored?.itinerary).toHaveLength(1);
    expect(restored?.itinerary[0]).toMatchObject({ id: itemId, startsAt, endsAt: null });
    expect(restored?.itinerary[0]).not.toHaveProperty("durationMinutes");
    expect(projectTimelinePoints(restored!.itinerary, timelineOptions).map(({ at }) => at))
      .toEqual(itemType === "transport" ? [startsAt, null] : [startsAt]);
    expect(sourceItem.endsAt).toBeNull();
  });
});

describe("Calendar fallback is an advisory projection, not a persisted event duration", () => {
  it("uses the documented one-hour missing-end conflict window with an exclusive boundary", () => {
    const source = item();
    const events = [
      { id: "overlap", title: "Unrelated appointment", startsAt: "2030-04-01T15:29:00.000Z", endsAt: "2030-04-01T16:00:00.000Z" },
      { id: "boundary", title: "Later appointment", startsAt: knownEndsAt, endsAt: "2030-04-01T16:00:00.000Z" },
    ];
    expect(findCalendarConflicts([source], events, new Map()).map(({ calendarEventId }) => calendarEventId))
      .toEqual(["overlap"]);
    expect(source.endsAt).toBeNull();
  });

  it("keeps a lodging stay non-blocking even when its end is unknown", () => {
    expect(findCalendarConflicts([item({ itemType: "lodging" })], [{
      id: "activity", title: "Synthetic appointment", startsAt, endsAt: knownEndsAt,
    }], new Map())).toEqual([]);
  });
});
