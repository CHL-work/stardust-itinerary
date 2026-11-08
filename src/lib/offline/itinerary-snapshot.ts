import { resolveFlightPresentation } from "@/lib/app/flight-presentation";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

const OFFLINE_ITINERARY_VERSION = 2 as const;

export const OFFLINE_ITINERARY_STORAGE_KEY = "stardust.offline-itinerary.v2";

// Versioned cache payloads are intentionally not migrated in place. A v1
// record contains only whichever day happened to be selected when it was
// saved, so presenting it as a complete trip would be misleading during an
// outage. Remove it once v2 code has had a chance to run instead.
const LEGACY_OFFLINE_ITINERARY_STORAGE_KEYS = ["stardust.offline-itinerary.v1"] as const;
const MAX_OFFLINE_TRIP_DAYS = 370;
const MAX_OFFLINE_ITINERARY_ITEMS = 500;

const itineraryItemTypes = new Set(["activity", "meal", "transport", "lodging", "note"]);
const itineraryStatuses = new Set(["draft", "planned", "cancelled", "completed"]);

export type OfflineFallbackFailure =
  | { kind: "network-error" }
  | { kind: "http-error"; status: number };

export type OfflineItineraryItem = Readonly<{
  id: string;
  tripDayId: string;
  title: string;
  itemType: "activity" | "meal" | "transport" | "lodging" | "note";
  startsAt: string | null;
  endsAt: string | null;
  locationName: string | null;
  mapUrl: string | null;
  departureLocationName: string | null;
  departureMapUrl: string | null;
  destinationLocationName: string | null;
  destinationMapUrl: string | null;
  status: "draft" | "planned" | "cancelled" | "completed";
  visibility: "trip";
  /** Presentation only; flight numbers, booking facts, terminals and notes stay online. */
  flightPresentation?: Readonly<{ isFlight: boolean; departureTimeZone: string | null; arrivalTimeZone: string | null }>;
}>;

export type OfflineTripDay = Readonly<{
  id: string;
  date: string;
  label: string | null;
}>;

export type OfflineItinerarySnapshot = Readonly<{
  version: typeof OFFLINE_ITINERARY_VERSION;
  savedAt: string;
  session: Readonly<{
    memberId: string;
    displayName: string;
  }>;
  trip: Readonly<{
    id: string;
    name: string;
    destinationName: string;
    timeZone: string;
    defaultLocale: string;
    startsOn: string;
    endsOn: string;
  }>;
  days: readonly OfflineTripDay[];
  itinerary: readonly OfflineItineraryItem[];
}>;

export type OfflineItinerarySource = {
  session: {
    memberId: string;
    displayName: string;
  };
  trip: {
    id: string;
    name: string;
    destinationName: string;
    timeZone: string;
    defaultLocale: string;
    startsOn: string;
    endsOn: string;
  };
  days: ReadonlyArray<{
    id: string;
    date: string;
    label: string | null;
  }>;
  visibleItinerary: ReadonlyArray<{
    id: string;
    tripDayId: string;
    title: string;
    itemType: string;
    startsAt: string | null;
    endsAt: string | null;
    locationName: string | null;
    mapUrl: string | null;
    departureLocationName: string | null;
    departureMapUrl: string | null;
    destinationLocationName: string | null;
    destinationMapUrl: string | null;
    status: string;
    visibility: string;
    flight?: unknown;
  }>;
};

export type OfflineSnapshotIdentity = {
  memberId: string;
  tripId: string;
};

export type OfflineStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximumLength = 4_096): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    ? value
    : null;
}

function nullableBoundedString(value: unknown, maximumLength = 4_096): string | null | undefined {
  if (value === null) return null;
  return boundedString(value, maximumLength) ?? undefined;
}

function isoTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  const stringValue = boundedString(value, 80);
  return stringValue && Number.isFinite(Date.parse(stringValue)) ? stringValue : undefined;
}

function calendarDate(value: unknown): string | null {
  const stringValue = boundedString(value, 10);
  return stringValue && /^\d{4}-\d{2}-\d{2}$/.test(stringValue) ? stringValue : null;
}

function httpsUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  const stringValue = boundedString(value, 2_048);
  if (!stringValue) return undefined;
  try {
    return new URL(stringValue).protocol === "https:" ? stringValue : undefined;
  } catch {
    return undefined;
  }
}

function parseDay(value: unknown): OfflineTripDay | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, 200);
  const date = calendarDate(value.date);
  const label = nullableBoundedString(value.label, 500);
  if (!id || !date || label === undefined) return null;
  return Object.freeze({ id, date, label });
}

function parseItem(value: unknown, dayIds: ReadonlySet<string>): OfflineItineraryItem | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, 200);
  const tripDayId = boundedString(value.tripDayId, 200);
  const title = boundedString(value.title, 500);
  const startsAt = isoTimestamp(value.startsAt);
  const endsAt = isoTimestamp(value.endsAt);
  const locationName = nullableBoundedString(value.locationName, 500);
  const mapUrl = httpsUrl(value.mapUrl);
  const departureLocationName = nullableBoundedString(value.departureLocationName, 500);
  const departureMapUrl = httpsUrl(value.departureMapUrl);
  const destinationLocationName = nullableBoundedString(value.destinationLocationName, 500);
  const destinationMapUrl = httpsUrl(value.destinationMapUrl);
  const savedFlight = isRecord(value.flightPresentation) && value.flightPresentation.isFlight === true
    ? Object.freeze({ isFlight: true, departureTimeZone: canonicalTripTimeZone(boundedString(value.flightPresentation.departureTimeZone, 80) ?? ""),
      arrivalTimeZone: canonicalTripTimeZone(boundedString(value.flightPresentation.arrivalTimeZone, 80) ?? "") })
    : undefined;

  if (
    !id
    || !tripDayId
    || !dayIds.has(tripDayId)
    || !title
    || !itineraryItemTypes.has(String(value.itemType))
    || !itineraryStatuses.has(String(value.status))
    || value.visibility !== "trip"
    || startsAt === undefined
    || endsAt === undefined
    || locationName === undefined
    || mapUrl === undefined
    || departureLocationName === undefined
    || departureMapUrl === undefined
    || destinationLocationName === undefined
    || destinationMapUrl === undefined
  ) {
    return null;
  }

  return Object.freeze({
    id,
    tripDayId,
    title,
    itemType: value.itemType as OfflineItineraryItem["itemType"],
    startsAt,
    endsAt,
    locationName,
    mapUrl,
    departureLocationName,
    departureMapUrl,
    destinationLocationName,
    destinationMapUrl,
    status: value.status as OfflineItineraryItem["status"],
    visibility: "trip",
    ...(savedFlight ? { flightPresentation: savedFlight } : {}),
  });
}

export function parseOfflineItinerarySnapshot(value: unknown): OfflineItinerarySnapshot | null {
  if (!isRecord(value) || value.version !== OFFLINE_ITINERARY_VERSION) return null;
  if (!isRecord(value.session) || !isRecord(value.trip)) return null;

  const savedAt = isoTimestamp(value.savedAt);
  const memberId = boundedString(value.session.memberId, 200);
  const displayName = boundedString(value.session.displayName, 200);
  const tripId = boundedString(value.trip.id, 200);
  const tripName = boundedString(value.trip.name, 500);
  const destinationName = boundedString(value.trip.destinationName, 500);
  const timeZone = boundedString(value.trip.timeZone, 100);
  const defaultLocale = boundedString(value.trip.defaultLocale, 40);
  const startsOn = calendarDate(value.trip.startsOn);
  const endsOn = calendarDate(value.trip.endsOn);

  if (
    !savedAt
    || !memberId
    || !displayName
    || !tripId
    || !tripName
    || !destinationName
    || !timeZone
    || !defaultLocale
    || !startsOn
    || !endsOn
    || !Array.isArray(value.days)
    || value.days.length === 0
    || value.days.length > MAX_OFFLINE_TRIP_DAYS
    || !Array.isArray(value.itinerary)
    || value.itinerary.length > MAX_OFFLINE_ITINERARY_ITEMS
  ) {
    return null;
  }

  const days = value.days.map(parseDay);
  if (days.some((day) => day === null)) return null;
  const safeDays = days as OfflineTripDay[];
  const dayIds = new Set(safeDays.map((day) => day.id));
  const dayDates = new Set(safeDays.map((day) => day.date));
  if (
    dayIds.size !== safeDays.length
    || dayDates.size !== safeDays.length
    || safeDays.some((day) => day.date < startsOn || day.date > endsOn)
  ) {
    return null;
  }
  safeDays.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

  const itinerary = value.itinerary.map((item) => parseItem(item, dayIds));
  if (itinerary.some((item) => item === null)) return null;
  const safeItinerary = itinerary as OfflineItineraryItem[];
  if (new Set(safeItinerary.map((item) => item.id)).size !== safeItinerary.length) return null;

  return Object.freeze({
    version: OFFLINE_ITINERARY_VERSION,
    savedAt,
    session: Object.freeze({ memberId, displayName }),
    trip: Object.freeze({
      id: tripId,
      name: tripName,
      destinationName,
      timeZone,
      defaultLocale,
      startsOn,
      endsOn,
    }),
    days: Object.freeze(safeDays),
    itinerary: Object.freeze(safeItinerary),
  });
}

export function createOfflineItinerarySnapshot(
  source: OfflineItinerarySource,
  now: Date = new Date(),
): OfflineItinerarySnapshot {
  const sourceDayIds = new Set(source.days.map((day) => day.id));
  const candidate = {
    version: OFFLINE_ITINERARY_VERSION,
    savedAt: now.toISOString(),
    session: {
      memberId: source.session.memberId,
      displayName: source.session.displayName,
    },
    trip: {
      id: source.trip.id,
      name: source.trip.name,
      destinationName: source.trip.destinationName,
      timeZone: source.trip.timeZone,
      defaultLocale: source.trip.defaultLocale,
      startsOn: source.trip.startsOn,
      endsOn: source.trip.endsOn,
    },
    days: source.days.map((day) => ({
      id: day.id,
      date: day.date,
      label: day.label,
    })),
    itinerary: source.visibleItinerary
      // A cold offline launch cannot re-authenticate the current Google-bound
      // member. Cache only trip-wide items so another account using the same
      // browser can never inherit creator/selected-viewer private events.
      .filter((item) => sourceDayIds.has(item.tripDayId) && item.visibility === "trip")
      .map((item) => {
        const flight = resolveFlightPresentation(item, source.trip.timeZone);
        return {
          id: item.id,
          tripDayId: item.tripDayId,
          title: item.title,
          itemType: item.itemType,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          locationName: item.locationName,
          mapUrl: item.mapUrl,
          departureLocationName: item.departureLocationName,
          departureMapUrl: item.departureMapUrl,
          destinationLocationName: item.destinationLocationName,
          destinationMapUrl: item.destinationMapUrl,
          status: item.status,
          visibility: item.visibility,
          ...(flight.isFlight ? { flightPresentation: {
            isFlight: true,
            departureTimeZone: flight.departureZoneKnown ? flight.departureTimeZone : null,
            arrivalTimeZone: flight.arrivalZoneKnown ? flight.arrivalTimeZone : null,
          } } : {}),
        };
      }),
  };
  const snapshot = parseOfflineItinerarySnapshot(candidate);
  if (!snapshot) throw new TypeError("Cannot cache an invalid itinerary snapshot.");
  return snapshot;
}

function browserStorage(): OfflineStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveOfflineItinerarySnapshot(
  snapshot: OfflineItinerarySnapshot,
  storage: OfflineStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const safeSnapshot = parseOfflineItinerarySnapshot(snapshot);
  if (!safeSnapshot) return false;

  try {
    // Keep a single identity/trip snapshot. Removing first prevents a failed
    // account switch write from leaving another member's itinerary behind.
    storage.removeItem(OFFLINE_ITINERARY_STORAGE_KEY);
    for (const key of LEGACY_OFFLINE_ITINERARY_STORAGE_KEYS) storage.removeItem(key);
    storage.setItem(OFFLINE_ITINERARY_STORAGE_KEY, JSON.stringify(safeSnapshot));
    return true;
  } catch {
    try {
      storage.removeItem(OFFLINE_ITINERARY_STORAGE_KEY);
      for (const key of LEGACY_OFFLINE_ITINERARY_STORAGE_KEYS) storage.removeItem(key);
    } catch {
      // Storage may be unavailable (private browsing, policy, or quota).
    }
    return false;
  }
}

export function replaceOfflineItinerarySnapshot(
  source: OfflineItinerarySource,
  now: Date = new Date(),
  storage: OfflineStorage | null = browserStorage(),
): boolean {
  try {
    return saveOfflineItinerarySnapshot(createOfflineItinerarySnapshot(source, now), storage);
  } catch {
    // An authenticated account/trip switch must fail closed. Never retain a
    // previous identity's otherwise valid snapshot when the replacement is
    // too large, malformed, or cannot be serialized.
    clearOfflineItinerarySnapshot(storage);
    return false;
  }
}

export function loadLastOfflineItinerarySnapshot(
  storage: OfflineStorage | null = browserStorage(),
): OfflineItinerarySnapshot | null {
  if (!storage) return null;
  try {
    for (const key of LEGACY_OFFLINE_ITINERARY_STORAGE_KEYS) storage.removeItem(key);
    const raw = storage.getItem(OFFLINE_ITINERARY_STORAGE_KEY);
    if (!raw) return null;
    const snapshot = parseOfflineItinerarySnapshot(JSON.parse(raw));
    if (snapshot) return snapshot;
    storage.removeItem(OFFLINE_ITINERARY_STORAGE_KEY);
    return null;
  } catch {
    try {
      storage.removeItem(OFFLINE_ITINERARY_STORAGE_KEY);
    } catch {
      // Fail closed even when the storage provider cannot be repaired.
    }
    return null;
  }
}

export function loadOfflineItinerarySnapshot(
  identity: OfflineSnapshotIdentity,
  storage: OfflineStorage | null = browserStorage(),
): OfflineItinerarySnapshot | null {
  const snapshot = loadLastOfflineItinerarySnapshot(storage);
  if (!snapshot) return null;
  if (snapshot.session.memberId !== identity.memberId || snapshot.trip.id !== identity.tripId) return null;
  return snapshot;
}

export function clearOfflineItinerarySnapshot(
  storage: OfflineStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(OFFLINE_ITINERARY_STORAGE_KEY);
    for (const key of LEGACY_OFFLINE_ITINERARY_STORAGE_KEYS) storage.removeItem(key);
  } catch {
    // Sign-out must continue even when browser storage is unavailable.
  }
}

export function isOfflineFallbackEligible(failure: OfflineFallbackFailure): boolean {
  return failure.kind === "network-error"
    || (failure.status >= 500 && failure.status <= 599);
}

export async function purgePrivateOfflineDataOnSignOut(
  storage: OfflineStorage | null = browserStorage(),
): Promise<void> {
  clearOfflineItinerarySnapshot(storage);
  if (typeof window === "undefined") return;

  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("stardust-shell-") || name.startsWith("stardust-private-"))
        .map((name) => window.caches.delete(name)),
    );
  } catch {
    // Cache Storage is optional; local private data has already been removed.
  }

  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const workers = new Set<ServiceWorker>();
    if (navigator.serviceWorker.controller) workers.add(navigator.serviceWorker.controller);
    for (const registration of registrations) {
      if (registration.active) workers.add(registration.active);
      if (registration.waiting) workers.add(registration.waiting);
      if (registration.installing) workers.add(registration.installing);
    }
    for (const worker of workers) worker.postMessage({ type: "CLEAR_PRIVATE_CACHE" });
  } catch {
    // A missing/stopped worker does not block sign-out.
  }
}
