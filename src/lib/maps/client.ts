import { withStableSession } from "@/lib/auth/client-session";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import type { Locale } from "@/lib/i18n";
import type { DayMapStop } from "./day-stops";
import { projectMapPoint, type MapCoordinate, type MapViewport } from "./geometry";
import { validMapTileTemplate } from "./tile-template";
export { validMapTileTemplate } from "./tile-template";

export type LocatedDayMapStop = DayMapStop & { coordinate: MapCoordinate | null; resolution: "located" | "missing" | "unresolved" | "limit" };
/** Optional, sourced saved estimates. Absence is unknown, never a zero-minute trip. */
export type DayMapLeg = {
  fromKey: string; toKey: string;
  walking?: { seconds: number; meters: number };
  driving?: { seconds: number; meters: number };
  transit?: { seconds: number; meters: number };
};
export type DayMapResponse = {
  status: "ready" | "not_configured" | "unavailable" | "rate_limited";
  stops: LocatedDayMapStop[];
  viewport: MapViewport | null;
  imageDataUrl: string | null;
  renderer?: "osm";
  tileUrlTemplate?: string;
  legs?: DayMapLeg[];
  reason?: string;
};
export type DayMapFailure = "unavailable" | "offline" | "timeout" | "rate_limited" | "busy" | "access" | "changed";
export type DayMapRequest = { tripId: string; tripDayId: string; includePrivate: boolean; locale: Locale };
export class DayMapRequestError extends Error {
  constructor(readonly kind: DayMapFailure) { super(kind); }
}

function validLocatedStops(stops: LocatedDayMapStop[]): boolean {
  const keys = new Set<string>();
  return stops.length <= 500 && stops.every((stop, index) => {
    if (!stop || typeof stop.key !== "string" || keys.has(stop.key) || stop.number !== index + 1
      || !["located", "missing", "unresolved", "limit"].includes(stop.resolution)) return false;
    keys.add(stop.key);
    const point = stop.coordinate;
    return stop.resolution === "located"
      ? !!point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 85.05112878 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
      : point === null;
  });
}

export function visibleDayMapStops(stops: DayMapStop[], includePrivate: boolean): DayMapStop[] {
  return stops.filter(stop => includePrivate || stop.visibility === "trip").map((stop, index) => ({ ...stop, number: index + 1 }));
}

/** Links are deliberate external navigation, never a browser-side provider request. */
export function dayMapLink(stop: Pick<DayMapStop, "mapUrl" | "locationName">): string | null {
  if (stop.mapUrl && isTrustedGoogleMapsUrl(stop.mapUrl)) {
    const url = new URL(stop.mapUrl);
    if (!url.username && !url.password) return url.href;
  }
  return stop.locationName?.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.locationName.trim())}` : null;
}

function directionsPlace(stop: LocatedDayMapStop): { query: string; placeId?: string } | null {
  // Read only explicit saved search parameters, not camera coordinates, arbitrary
  // redirect URLs or a browser geolocation. No Google request is made here.
  const link = dayMapLink(stop);
  if (link) {
    const url = new URL(link);
    const query = url.searchParams.get("query") ?? url.searchParams.get("q");
    if (["query", "q", "query_place_id"].every(key => url.searchParams.getAll(key).length <= 1)
      && !(url.searchParams.has("query") && url.searchParams.has("q"))
      && query?.trim() && query.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(query)) {
      const placeId = url.searchParams.get("query_place_id");
      return { query: query.trim(), ...(placeId && /^[A-Za-z0-9_-]{5,256}$/u.test(placeId) ? { placeId } : {}) };
    }
  }
  const name = stop.locationName?.trim();
  if (name && name.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(name)) return { query: name };
  const point = stop.resolution === "located" ? stop.coordinate : null;
  return point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 85.05112878 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
    ? { query: `${point.lat},${point.lng}` } : null;
}

/** One explicit Google handoff for a leg; omit travelmode so Google offers its
 * available modes. A whole-day waypoint link would prevent some transit modes. */
export function dayMapDirectionsLink(from: LocatedDayMapStop, to: LocatedDayMapStop): string | null {
  const origin = directionsPlace(from), destination = directionsPlace(to);
  if (!origin || !destination) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin.query);
  url.searchParams.set("destination", destination.query);
  if (origin.placeId) url.searchParams.set("origin_place_id", origin.placeId);
  if (destination.placeId) url.searchParams.set("destination_place_id", destination.placeId);
  return url.href.length <= 2048 ? url.href : null;
}

/** Reject malformed/stale routes as a whole instead of painting plausible but
 * unbound numbers. Only consecutive visible stops may form a journey. */
export function validDayMapLegs(value: unknown, stops: LocatedDayMapStop[]): value is DayMapLeg[] {
  if (!Array.isArray(value) || value.length > Math.max(0, stops.length - 1)) return false;
  const seen = new Set<string>();
  return value.every(leg => {
    if (!leg || typeof leg !== "object" || Array.isArray(leg)
      || Object.keys(leg).some(key => !["fromKey", "toKey", "walking", "driving", "transit"].includes(key))) return false;
    const index = stops.findIndex(stop => stop.key === leg.fromKey);
    if (index < 0 || stops[index + 1]?.key !== leg.toKey || seen.has(leg.fromKey)) return false;
    seen.add(leg.fromKey);
    return (["walking", "driving", "transit"] as const).every(mode => {
      const estimate = leg[mode];
      return estimate === undefined || (estimate !== null && typeof estimate === "object" && !Array.isArray(estimate)
        && Object.keys(estimate).length === 2 && Object.keys(estimate).every(key => key === "seconds" || key === "meters")
        && typeof estimate.seconds === "number" && Number.isFinite(estimate.seconds) && estimate.seconds >= 0 && estimate.seconds <= 30 * 86400
        && typeof estimate.meters === "number" && Number.isFinite(estimate.meters) && estimate.meters >= 0 && estimate.meters <= 50_000_000);
    });
  });
}

export async function requestDayMap(input: DayMapRequest, signal: AbortSignal): Promise<DayMapResponse> {
  const response = await withStableSession(() => fetch(`/api/trips/${encodeURIComponent(input.tripId)}/map`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripDayId: input.tripDayId, includePrivate: input.includePrivate, locale: input.locale }),
  }));
  if (response.status === 401 || response.status === 403) throw new DayMapRequestError("access");
  if (response.status === 409) throw new DayMapRequestError("changed");
  if (response.status === 429) throw new DayMapRequestError("rate_limited");
  if (!response.ok) throw new DayMapRequestError("unavailable");
  const data = await response.json() as DayMapResponse;
  if (!data || !["ready", "not_configured", "unavailable", "rate_limited"].includes(data.status) || !Array.isArray(data.stops)) throw new DayMapRequestError("unavailable");
  if (data.reason === "map_changed") throw new DayMapRequestError("changed");
  if (data.reason === "map_busy") throw new DayMapRequestError("busy");
  if (data.status !== "ready") return { ...data, viewport: null, imageDataUrl: null, ...(data.legs !== undefined ? { legs: [] } : {}) };
  if (!validLocatedStops(data.stops)) throw new DayMapRequestError("unavailable");
  if (data.legs !== undefined && !validDayMapLegs(data.legs, data.stops)) throw new DayMapRequestError("unavailable");
  if (data.renderer !== undefined && data.renderer !== "osm") throw new DayMapRequestError("unavailable");
  if (data.renderer === "osm" && (!validMapTileTemplate(data.tileUrlTemplate) || data.imageDataUrl !== null)) throw new DayMapRequestError("unavailable");
  // Only a server-returned PNG can become an image source. Never accept a remote URL/key.
  if (data.imageDataUrl !== null && (typeof data.imageDataUrl !== "string" || data.imageDataUrl.length > 8_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(data.imageDataUrl))) throw new DayMapRequestError("unavailable");
  if (data.imageDataUrl && (!data.viewport || data.viewport.width !== 640 || data.viewport.height !== 400 || !Number.isInteger(data.viewport.zoom) || data.viewport.zoom < 0 || data.viewport.zoom > 16 || !Number.isFinite(data.viewport.center?.lat) || !Number.isFinite(data.viewport.center?.lng))) throw new DayMapRequestError("unavailable");
  return data;
}

/** Never paint coordinates from a response for a changed local projection. */
export function dayMapResponseMatches(response: DayMapResponse, stops: DayMapStop[]): boolean {
  const fields = ["key", "number", "title", "at", "timeZone", "timeZoneKnown", "isFlight", "kind", "locationName", "mapUrl", "visibility", "pending", "allDay"] as const;
  return response.stops.length === stops.length && response.stops.every((stop, index) => stop && fields.every(field => stop[field] === stops[index][field]));
}

export type DayMapMarkerGroup = { key: string; xPercent: number; yPercent: number; stops: LocatedDayMapStop[] };

/** Merge overlapping touch targets at the actual displayed width; repeated visits remain distinct. */
export function groupDayMapMarkers(stops: LocatedDayMapStop[], viewport: MapViewport, displayWidth: number): DayMapMarkerGroup[] {
  const width = Math.max(160, displayWidth);
  const points = stops.flatMap(stop => {
    const point = stop.coordinate && stop.resolution === "located" ? projectMapPoint(stop.coordinate, viewport) : null;
    return point ? [{ ...point, stop }] : [];
  });
  const groups: typeof points[] = [];
  for (const point of points) {
    const connected = groups.filter(group => group.some(other => Math.abs(point.xPercent - other.xPercent) * width / 100 < 78 && Math.abs(point.yPercent - other.yPercent) * width * 0.625 / 100 < 50));
    const merged = [...connected.flat(), point];
    for (const group of connected) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups.map(group => {
    const ordered = group.map(point => point.stop).sort((a, b) => a.number - b.number);
    return { key: ordered.map(stop => stop.key).join("|"), stops: ordered, xPercent: group.reduce((sum, point) => sum + point.xPercent, 0) / group.length, yPercent: group.reduce((sum, point) => sum + point.yPercent, 0) / group.length };
  }).sort((a, b) => a.stops[0].number - b.stops[0].number);
}

type DayMapCallbacks = { start: () => void; success: (result: DayMapResponse) => void; failure: (kind: DayMapFailure) => void; complete: () => void };

/** One explicit request, with a deadline and synchronous close/consent/unmount invalidation. */
export function createDayMapLoader(request = requestDayMap, timeoutMs = 35_000) {
  let generation = 0;
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> | null } | null = null;
  return {
    cancel() {
      ++generation;
      if (active?.timer) clearTimeout(active.timer);
      active?.controller.abort();
      active = null;
    },
    async load(input: DayMapRequest, callbacks: DayMapCallbacks) {
      if (active) return;
      const current = ++generation;
      const attempt = { controller: new AbortController(), timer: null as ReturnType<typeof setTimeout> | null };
      active = attempt;
      let timedOut = false;
      callbacks.start();
      try {
        const deadline = new Promise<never>((_, reject) => {
          attempt.timer = setTimeout(() => { timedOut = true; attempt.controller.abort(); reject(new DayMapRequestError("timeout")); }, timeoutMs);
        });
        const result = await Promise.race([request(input, attempt.controller.signal), deadline]);
        if (current === generation) callbacks.success(result);
      } catch (error) {
        if (current === generation) callbacks.failure(timedOut ? "timeout" : error instanceof DayMapRequestError ? error.kind : typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unavailable");
      } finally {
        if (attempt.timer) clearTimeout(attempt.timer);
        if (current === generation) { active = null; callbacks.complete(); }
      }
    },
  };
}
