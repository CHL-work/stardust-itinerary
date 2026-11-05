// Server-only orchestration; callers supply a freshly authenticated overview read.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { AppInvalidInputError } from "@/lib/app/repository";
import { projectDayMapStops, type DayMapStop, type MapSource, type PendingMapSource } from "@/lib/maps/day-stops";
import { chooseMapViewport, type MapCoordinate, type MapViewport } from "@/lib/maps/geometry";
import { fetchGoogleMapImage, mapLocationInput, resolveGoogleLocation, withMapAbort, MapProviderUnavailable, type GoogleMapsConfig, type MapLocation } from "@/lib/maps/google";
import { getOsmMapsConfig, isPublicVenueQuery, osmLocationInput, OsmLookupLimit, resolveOsmLocation, type OsmMapsConfig } from "@/lib/maps/osm";
import { getOsmRoutingConfig, resolveOsmRoute, type OsmRoutingConfig } from "@/lib/maps/osm-routing";
import type { DayMapLeg } from "@/lib/maps/client";
import { validMapTileTemplate } from "@/lib/maps/tile-template";

export const dayMapInput = z.object({
  tripDayId: z.uuid(), includePrivate: z.boolean().default(false), locale: z.enum(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"]),
}).strict();
export type DayMapInput = z.infer<typeof dayMapInput>;
export type ResolvedDayMapStop = DayMapStop & { coordinate: MapCoordinate | null; resolution: "located" | "missing" | "unresolved" | "limit" };
export type DayMapResponse = {
  status: "ready" | "not_configured" | "unavailable" | "rate_limited";
  reason?: "map_not_configured" | "map_unavailable" | "map_rate_limited" | "map_busy" | "map_changed" | "map_no_locations";
  stops: ResolvedDayMapStop[]; viewport: MapViewport | null; imageDataUrl: string | null;
  renderer?: "osm";
  tileUrlTemplate?: string;
  legs?: DayMapLeg[];
};

const LIMITS = { active: 4, perMinute: 30, userPerMinute: 4, users: 1024, queries: 24, stops: 500, deadlineMs: 20_000 } as const;
type Admission = { active: number; starts: number[] };
const identitySalt = randomBytes(32);
const users = new Map<string, Admission>();
const globalAdmission: Admission = { active: 0, starts: [] };

function acquire(userId: string, now: number, bypassRequestQuota: boolean): { release: () => void } | { reason: "map_busy" | "map_rate_limited" } {
  const recent = (times: number[]) => times.filter((at) => at > now - 60_000);
  globalAdmission.starts = recent(globalAdmission.starts);
  for (const [key, value] of users) {
    value.starts = recent(value.starts);
    if (!value.active && !value.starts.length) users.delete(key);
  }
  const key = createHmac("sha256", identitySalt).update(userId).digest("hex");
  const user = users.get(key) ?? { active: 0, starts: [] };
  // An operator has no rolling application quota, but cannot create concurrent
  // duplicate work or bypass the shared provider's actual resource protection.
  if (user.active || globalAdmission.active >= LIMITS.active || (!users.has(key) && users.size >= LIMITS.users)) return { reason: "map_busy" };
  if (!bypassRequestQuota && (user.starts.length >= LIMITS.userPerMinute || globalAdmission.starts.length >= LIMITS.perMinute)) return { reason: "map_rate_limited" };
  user.active++; users.set(key, user); globalAdmission.active++;
  if (!bypassRequestQuota) { user.starts.push(now); globalAdmission.starts.push(now); }
  return { release: () => { user.active--; globalAdmission.active--; } };
}

function projection(overview: Record<string, unknown>, input: DayMapInput): DayMapStop[] {
  const trip = overview.trip as { timeZone?: string } | undefined;
  const days = overview.days as Array<{ id: string; date: string }> | undefined;
  if (!trip?.timeZone || !Array.isArray(days) || !days.some((day) => day.id === input.tripDayId)) throw new AppInvalidInputError("map_invalid_day");
  if (!Array.isArray(overview.itinerary) || !Array.isArray(overview.pendingItinerary)) throw new AppInvalidInputError("map_invalid_day");
  return projectDayMapStops({ itinerary: overview.itinerary as MapSource[], pendingItinerary: overview.pendingItinerary as PendingMapSource[], days, timeZone: trip.timeZone, tripDayId: input.tripDayId, includePrivate: input.includePrivate });
}

function fingerprint(stops: DayMapStop[]): string { return createHash("sha256").update(JSON.stringify(stops)).digest("hex"); }
function unresolved(stops: DayMapStop[]): ResolvedDayMapStop[] {
  return stops.map((stop) => ({ ...stop, coordinate: null, resolution: !stop.locationName && !stop.mapUrl ? "missing" : "unresolved" }));
}
function fallback(stops: DayMapStop[], status: DayMapResponse["status"], reason: DayMapResponse["reason"]): DayMapResponse {
  return { status, reason, stops: unresolved(stops), viewport: null, imageDataUrl: null };
}

async function osmResponse(stops: DayMapStop[], options: {
  config: OsmMapsConfig | null; routingConfig: OsmRoutingConfig | null; signal: AbortSignal; fetch?: typeof fetch;
}): Promise<DayMapResponse> {
  const tileUrlTemplate = process.env.STARDUST_MAP_TILE_URL?.trim() || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  if (!validMapTileTemplate(tileUrlTemplate)) return fallback(stops, "unavailable", "map_unavailable");
  const resolved = unresolved(stops);
  const jobs = new Map<string, number[]>();
  for (const [index, stop] of stops.entries()) {
    const input = osmLocationInput(stop); if (!input) continue;
    if ("coordinate" in input) { resolved[index] = { ...stop, coordinate: input.coordinate, resolution: "located" }; continue; }
    // A private stop is here only because its viewer chose to include private
    // places (the default, D-081). Its place text alone may be looked up, but
    // never written to the shared cache.
    if (!options.config || !isPublicVenueQuery(input.query)) continue;
    const existing = jobs.get(input.query);
    if (existing) { existing.push(index); continue; }
    if (jobs.size >= LIMITS.queries) { resolved[index].resolution = "limit"; continue; }
    jobs.set(input.query, [index]);
  }
  let lookups = 0;
  const shared = (indices: number[]) => indices.some((index) => stops[index].visibility === "trip");
  const results = new Map<string, MapCoordinate | null>();
  for (const [query, indices] of jobs) {
    if (options.signal.aborted) break;
    try {
      const coordinate = await withMapAbort(resolveOsmLocation(query, { ...options, config: options.config!, allowLookup: () => ++lookups <= 6, persist: shared(indices) }), options.signal);
      results.set(query, coordinate);
      if (coordinate) for (const index of indices) resolved[index] = { ...resolved[index], coordinate, resolution: "located" };
    } catch (error) {
      if (error instanceof OsmLookupLimit) for (const index of indices) resolved[index].resolution = "limit";
      // An unavailable venue never prevents the remaining basemap.
    }
  }
  // Saved Google searches often contain an address as well as a venue. If
  // that exact text is unresolved, the separately saved public place name is
  // another explicit source, not an invented shortened/transliterated query.
  const alternateJobs = new Map<string, number[]>();
  for (const [index, stop] of stops.entries()) {
    if (resolved[index].coordinate || !options.config) continue;
    const alternate = osmLocationInput({ locationName: stop.locationName, mapUrl: null });
    if (!alternate || !("query" in alternate) || !isPublicVenueQuery(alternate.query)) continue;
    if (results.has(alternate.query)) {
      const coordinate = results.get(alternate.query);
      if (coordinate) resolved[index] = { ...stop, coordinate, resolution: "located" };
      continue;
    }
    if (jobs.has(alternate.query)) continue;
    const existing = alternateJobs.get(alternate.query);
    if (existing) { existing.push(index); continue; }
    if (jobs.size + alternateJobs.size >= LIMITS.queries) continue;
    alternateJobs.set(alternate.query, [index]);
  }
  for (const [query, indices] of alternateJobs) {
    if (options.signal.aborted) break;
    try {
      const coordinate = await withMapAbort(resolveOsmLocation(query, { ...options, config: options.config!, allowLookup: () => ++lookups <= 6, persist: shared(indices) }), options.signal);
      if (coordinate) for (const index of indices) resolved[index] = { ...resolved[index], coordinate, resolution: "located" };
    } catch (error) {
      if (error instanceof OsmLookupLimit) for (const index of indices) resolved[index].resolution = "limit";
    }
  }
  let routeLookups = 0;
  const legs: DayMapLeg[] = [];
  for (let index = 0; index + 1 < resolved.length && index < 24 && !options.signal.aborted; index++) {
    const from = resolved[index], to = resolved[index + 1];
    if (!options.routingConfig || !from.coordinate || !to.coordinate) continue;
    if ([from, to].some((stop) => stop.locationName && !isPublicVenueQuery(stop.locationName))) continue;
    const leg: DayMapLeg = { fromKey: from.key, toKey: to.key };
    for (const mode of ["walking", "driving"] as const) {
      if (options.signal.aborted) break;
      try {
        const estimate = await withMapAbort(resolveOsmRoute(from.coordinate, to.coordinate, mode, {
          config: options.routingConfig, signal: options.signal, fetch: options.fetch, allowLookup: () => ++routeLookups <= 8,
          persist: from.visibility === "trip" && to.visibility === "trip",
        }), options.signal);
        if (estimate && (mode !== "walking" || estimate.seconds <= 5 * 3600)) leg[mode] = estimate;
      } catch { /* A missing mode stays unknown, not a guessed speed. */ }
    }
    if (leg.walking || leg.driving) legs.push(leg);
  }
  const coordinates = resolved.flatMap((stop) => stop.coordinate ? [stop.coordinate] : []);
  return { renderer: "osm", tileUrlTemplate, status: "ready", ...(coordinates.length ? {} : { reason: "map_no_locations" as const }),
    stops: resolved, legs, viewport: chooseMapViewport(coordinates), imageDataUrl: null };
}

/** OSM is the ordinary zero-credit path. Its bounded cache contains only public
 * venue hashes/results, never private stops or itinerary metadata. The legacy
 * Google path is reachable only through an explicit test/adapter dependency. */
export async function generateDayMap(options: {
  userId: string; input: DayMapInput; loadOverview: () => Promise<Record<string, unknown>>; signal?: AbortSignal;
  /** Server-derived verified platform operator only; never a body field or trip role. */
  bypassRequestQuota?: boolean;
}, dependencies: { config?: GoogleMapsConfig | null; osmConfig?: OsmMapsConfig | null; routingConfig?: OsmRoutingConfig | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<DayMapResponse> {
  const now = dependencies.now ?? Date.now;
  const started = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIMITS.deadlineMs);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  let release: (() => void) | null = null;
  try {
  const stops = projection(await withMapAbort(options.loadOverview(), signal), options.input);
  if (stops.length > LIMITS.stops) return fallback([], "unavailable", "map_unavailable");
  // A configured Google key/spending flag cannot silently select paid maps.
  // Retain the adapter for isolated legacy tests, not automatic fallback.
  const osm = dependencies.config === undefined;
  const config = osm ? null : dependencies.config;
  if (!osm && !config) return fallback(stops, "not_configured", "map_not_configured");
  const admission = acquire(options.userId, now(), options.bypassRequestQuota === true);
  if ("reason" in admission) return fallback(stops, "rate_limited", admission.reason);
  release = admission.release;
  let response: DayMapResponse;
  try {
    if (osm) {
      // Reserve time for the mandatory current audience read. Provider budget
      // exhaustion returns already-known positions/estimates, not stale data.
      const providerController = new AbortController();
      const providerTimeout = setTimeout(() => providerController.abort(), 16_000);
      try {
        response = await osmResponse(stops, {
          config: dependencies.osmConfig === undefined ? getOsmMapsConfig() : dependencies.osmConfig,
          routingConfig: dependencies.routingConfig === undefined ? getOsmRoutingConfig() : dependencies.routingConfig,
          signal: AbortSignal.any([signal, providerController.signal]), fetch: dependencies.fetch,
        });
      } finally { clearTimeout(providerTimeout); }
    }
    else {
    const transport = { config: config!, locale: options.input.locale, signal, fetch: dependencies.fetch };
    const resolved = unresolved(stops);
    const jobs = new Map<string, { input: MapLocation; indices: number[] }>();
    for (const [index, stop] of stops.entries()) {
      const input = mapLocationInput(stop);
      if (!input) continue;
      if (input.kind === "coordinate") { resolved[index] = { ...stop, coordinate: input.coordinate, resolution: "located" }; continue; }
      const key = JSON.stringify(input);
      const existing = jobs.get(key);
      if (existing) { existing.indices.push(index); continue; }
      if (jobs.size >= LIMITS.queries) { resolved[index].resolution = "limit"; continue; }
      jobs.set(key, { input, indices: [index] });
    }
    const work = [...jobs.values()];
    let cursor = 0;
    let providerFailed = false;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (cursor < work.length && !signal.aborted && now() - started < 15_000) {
        const job = work[cursor++];
        try {
          const jobSignal = AbortSignal.any([signal, AbortSignal.timeout(3500)]);
          const location = await withMapAbort(resolveGoogleLocation(job.input, { ...transport, signal: jobSignal }), jobSignal);
          if (location) for (const index of job.indices) resolved[index] = { ...resolved[index], coordinate: location, resolution: "located" };
        } catch { providerFailed = true; }
      }
    }));
    const viewport = chooseMapViewport(resolved.flatMap((stop) => stop.coordinate ? [stop.coordinate] : []));
    if (!viewport) response = providerFailed || signal.aborted || resolved.some((stop) => stop.coordinate !== null)
      ? fallback(stops, "unavailable", "map_unavailable")
      : { status: "ready", reason: "map_no_locations", stops: resolved, viewport: null, imageDataUrl: null };
    else response = { status: "ready", stops: resolved, viewport, imageDataUrl: await withMapAbort(fetchGoogleMapImage(viewport, transport), signal) };
    }
  } catch {
    response = fallback(stops, "unavailable", "map_unavailable");
  }
  // Do not return even an old title/location after an audience, item or identity
  // change during network I/O. The caller also reauthenticates here.
  const currentStops = projection(await withMapAbort(options.loadOverview(), signal), options.input);
  if (fingerprint(currentStops) !== fingerprint(stops)) return fallback([], "unavailable", "map_changed");
  return response;
  } catch (error) {
    if (error instanceof MapProviderUnavailable) return fallback([], "unavailable", "map_unavailable");
    throw error;
  } finally { clearTimeout(timeout); release?.(); }
}
