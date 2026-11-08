import { describe, expect, it } from "vitest";
import { projectTimelinePoints } from "@/lib/app/timeline";

import {
  clearOfflineItinerarySnapshot,
  createOfflineItinerarySnapshot,
  isOfflineFallbackEligible,
  loadLastOfflineItinerarySnapshot,
  loadOfflineItinerarySnapshot,
  OFFLINE_ITINERARY_STORAGE_KEY,
  parseOfflineItinerarySnapshot,
  replaceOfflineItinerarySnapshot,
  saveOfflineItinerarySnapshot,
  type OfflineStorage,
} from "./itinerary-snapshot";

class MemoryStorage implements OfflineStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class RejectingStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("quota exceeded");
  }
}

const source = {
  session: {
    memberId: "member-owner",
    displayName: "Owner",
    isOwner: true,
    googleEmail: "must-not-be-cached@example.com",
  },
  trip: {
    id: "trip-japan",
    name: "Japan",
    destinationName: "Tokyo",
    timeZone: "Asia/Tokyo",
    defaultLocale: "zh-HK-lihkg",
    defaultCurrency: "JPY",
    startsOn: "2026-09-03",
    endsOn: "2026-09-17",
    inviteLink: "must-not-be-cached",
  },
  days: [
    {
      id: "day-1",
      date: "2026-09-03",
      label: "Tokyo day one",
      internalNote: "must-not-be-cached-day-secret",
    },
    {
      id: "day-2",
      date: "2026-09-04",
      label: "Tokyo day two",
    },
    {
      id: "day-3",
      date: "2026-09-05",
      label: null,
    },
  ],
  visibleItinerary: [
    {
      id: "item-visible",
      tripDayId: "day-1",
      title: "Train to Akihabara",
      itemType: "transport",
      startsAt: "2026-09-03T01:00:00.000Z",
      endsAt: "2026-09-03T01:20:00.000Z",
      locationName: null,
      mapUrl: null,
      departureLocationName: "Tokyo Station",
      departureMapUrl: "https://www.google.com/maps/search/?api=1&query=Tokyo%20Station",
      destinationLocationName: "Akihabara Station",
      destinationMapUrl: "https://www.google.com/maps/search/?api=1&query=Akihabara%20Station",
      notes: "reservation 123456",
      status: "planned",
      visibility: "trip",
      currentRevision: 4,
      calendarLink: { eventId: "provider-secret" },
    },
    {
      id: "item-private",
      tripDayId: "day-1",
      title: "must-not-be-cached-private-event",
      itemType: "activity",
      startsAt: "2026-09-03T04:00:00.000Z",
      endsAt: "2026-09-03T05:00:00.000Z",
      locationName: "must-not-be-cached-private-place",
      mapUrl: null,
      departureLocationName: null,
      departureMapUrl: null,
      destinationLocationName: null,
      destinationMapUrl: null,
      notes: null,
      status: "planned",
      visibility: "private",
    },
    {
      id: "item-other-day",
      tripDayId: "day-2",
      title: "Other day",
      itemType: "meal",
      startsAt: null,
      endsAt: null,
      locationName: "Somewhere",
      mapUrl: null,
      departureLocationName: null,
      departureMapUrl: null,
      destinationLocationName: null,
      destinationMapUrl: null,
      notes: null,
      status: "planned",
      visibility: "trip",
    },
  ],
  expenses: [{ description: "must-not-be-cached-expense" }],
  aiLogs: [{ prompt: "must-not-be-cached-prompt" }],
  activity: [{ metadata: "must-not-be-cached-activity" }],
  approvals: [{ patch: "must-not-be-cached-approval" }],
  calendar: { token: "must-not-be-cached-calendar" },
  preferences: [{ subject: "must-not-be-cached-preference" }],
};

describe("offline itinerary snapshot", () => {
  it("keeps only safe flight presentation metadata and projects endpoint-local times offline", () => {
    const snapshot = createOfflineItinerarySnapshot({ ...source, visibleItinerary: [{ ...source.visibleItinerary[0]!,
      title: "Synthetic cross-zone flight", departureLocationName: "DFW", destinationLocationName: "SLC",
      flight: { flightNumber: "ZZ999", departureTerminal: "Secret terminal", departureGate: "Secret gate", arrivalTerminal: "Secret arrival",
        departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" } }] });
    expect(snapshot.itinerary[0]!.flightPresentation).toEqual({ isFlight: true, departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" });
    expect(JSON.stringify(snapshot)).not.toMatch(/ZZ999|Secret|flightNumber|departureGate/u);
    const points = projectTimelinePoints(snapshot.itinerary, { tripDays: snapshot.days, timeZone: snapshot.trip.timeZone });
    expect(points.map((point) => [point.timeZone, point.isFlight, point.timeZoneKnown])).toEqual([
      ["America/Chicago", true, true], ["America/Denver", true, true],
    ]);
    const parsed = parseOfflineItinerarySnapshot({ ...snapshot, itinerary: [{ ...snapshot.itinerary[0],
      departureLocationName: "Synthetic departure", destinationLocationName: "Synthetic arrival",
      flightPresentation: { isFlight: true, departureTimeZone: "Invalid/Zone", arrivalTimeZone: "CST", flightNumber: "SECRET" } }] });
    expect(parsed!.itinerary[0]!.flightPresentation).toEqual({ isFlight: true, departureTimeZone: null, arrivalTimeZone: null });
    expect(projectTimelinePoints(parsed!.itinerary, { tripDays: parsed!.days, timeZone: parsed!.trip.timeZone })[0]).toMatchObject({
      isFlight: true, timeZoneKnown: false, timeZone: "Asia/Tokyo",
    });
  });
  it("keeps every trip day and only trip-visible, explicitly allowlisted event fields", () => {
    const snapshot = createOfflineItinerarySnapshot(source, new Date("2026-09-03T00:00:00.000Z"));
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.version).toBe(2);
    expect(snapshot.days.map((day) => day.id)).toEqual(["day-1", "day-2", "day-3"]);
    expect(snapshot.itinerary.map((item) => item.id)).toEqual(["item-visible", "item-other-day"]);
    expect(snapshot.savedAt).toBe("2026-09-03T00:00:00.000Z");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.days)).toBe(true);
    expect(Object.isFrozen(snapshot.days[0])).toBe(true);
    expect(Object.isFrozen(snapshot.itinerary[0])).toBe(true);
    expect(serialized).not.toContain("must-not-be-cached");
    expect(serialized).not.toContain("reservation 123456");
    expect(serialized).not.toContain("currentRevision");
    expect(serialized).not.toContain("calendarLink");
  });

  it("saves one snapshot and requires the expected member and trip when loading", () => {
    const storage = new MemoryStorage();
    const snapshot = createOfflineItinerarySnapshot(source);

    expect(saveOfflineItinerarySnapshot(snapshot, storage)).toBe(true);
    expect(loadOfflineItinerarySnapshot({ memberId: "member-owner", tripId: "trip-japan" }, storage))
      .toEqual(snapshot);
    expect(loadOfflineItinerarySnapshot({ memberId: "another-member", tripId: "trip-japan" }, storage))
      .toBeNull();
    expect(loadOfflineItinerarySnapshot({ memberId: "member-owner", tripId: "another-trip" }, storage))
      .toBeNull();
  });

  it("fails closed and removes a corrupt or unsafe snapshot", () => {
    const storage = new MemoryStorage();
    const snapshot = createOfflineItinerarySnapshot(source);
    const unsafe = JSON.parse(JSON.stringify(snapshot)) as { itinerary: Array<{ mapUrl: string }> };
    unsafe.itinerary[0]!.mapUrl = "javascript:alert(1)";
    storage.setItem(OFFLINE_ITINERARY_STORAGE_KEY, JSON.stringify(unsafe));

    expect(loadLastOfflineItinerarySnapshot(storage)).toBeNull();
    expect(storage.getItem(OFFLINE_ITINERARY_STORAGE_KEY)).toBeNull();
    expect(parseOfflineItinerarySnapshot({ version: 99 })).toBeNull();
  });

  it("rejects items outside the cached trip days and duplicate day or item identities", () => {
    const snapshot = createOfflineItinerarySnapshot(source);
    const unknownDay = JSON.parse(JSON.stringify(snapshot)) as {
      itinerary: Array<{ id: string; tripDayId: string }>;
    };
    unknownDay.itinerary[0]!.tripDayId = "not-a-cached-day";
    expect(parseOfflineItinerarySnapshot(unknownDay)).toBeNull();

    const duplicateDay = JSON.parse(JSON.stringify(snapshot)) as {
      days: Array<{ id: string; date: string }>;
    };
    duplicateDay.days[1]!.id = duplicateDay.days[0]!.id;
    expect(parseOfflineItinerarySnapshot(duplicateDay)).toBeNull();

    const duplicateItem = JSON.parse(JSON.stringify(snapshot)) as {
      itinerary: Array<{ id: string }>;
    };
    duplicateItem.itinerary[1]!.id = duplicateItem.itinerary[0]!.id;
    expect(parseOfflineItinerarySnapshot(duplicateItem)).toBeNull();
  });

  it("purges the incompatible single-day v1 cache instead of presenting it as a full trip", () => {
    const storage = new MemoryStorage();
    const legacyKey = "stardust.offline-itinerary.v1";
    storage.setItem(legacyKey, JSON.stringify({
      version: 1,
      day: { id: "day-1", date: "2026-09-03", label: null },
      itinerary: [],
    }));

    expect(loadLastOfflineItinerarySnapshot(storage)).toBeNull();
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(OFFLINE_ITINERARY_STORAGE_KEY).toBe("stardust.offline-itinerary.v2");
  });

  it("clears the only private itinerary record without clearing unrelated storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(OFFLINE_ITINERARY_STORAGE_KEY, "private");
    storage.setItem("stardust.offline-itinerary.v1", "legacy-private");
    storage.setItem("unrelated", "keep");

    clearOfflineItinerarySnapshot(storage);

    expect(storage.getItem(OFFLINE_ITINERARY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("stardust.offline-itinerary.v1")).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("removes an older identity snapshot when a replacement write fails", () => {
    const storage = new RejectingStorage();
    storage.values.set(OFFLINE_ITINERARY_STORAGE_KEY, "old-member-private-data");

    expect(saveOfflineItinerarySnapshot(createOfflineItinerarySnapshot(source), storage)).toBe(false);
    expect(storage.getItem(OFFLINE_ITINERARY_STORAGE_KEY)).toBeNull();
  });

  it("removes an older identity snapshot when replacement validation fails", () => {
    const storage = new MemoryStorage();
    storage.setItem(OFFLINE_ITINERARY_STORAGE_KEY, JSON.stringify(createOfflineItinerarySnapshot(source)));
    const oversizedSource = {
      ...source,
      session: { ...source.session, memberId: "replacement-member" },
      visibleItinerary: Array.from({ length: 501 }, (_, index) => ({
        ...source.visibleItinerary[0]!,
        id: `replacement-${index}`,
      })),
    };

    expect(replaceOfflineItinerarySnapshot(oversizedSource, new Date(), storage)).toBe(false);
    expect(storage.getItem(OFFLINE_ITINERARY_STORAGE_KEY)).toBeNull();
  });
});

describe("offline fallback eligibility", () => {
  it("allows only network failures and server errors", () => {
    expect(isOfflineFallbackEligible({ kind: "network-error" })).toBe(true);
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 500 })).toBe(true);
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 503 })).toBe(true);
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 599 })).toBe(true);
  });

  it("never masks authentication, authorization, validation, or rate-limit responses", () => {
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 401 })).toBe(false);
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 403 })).toBe(false);
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 404 })).toBe(false);
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 422 })).toBe(false);
    expect(isOfflineFallbackEligible({ kind: "http-error", status: 429 })).toBe(false);
  });
});
