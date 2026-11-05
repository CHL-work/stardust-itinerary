// Server-only FOSSGIS OSRM routing. Call only for public, adjacent saved stops.
import { createHash } from "node:crypto";
import type { MapCoordinate } from "@/lib/maps/geometry";
import { MapProviderUnavailable, withMapAbort } from "@/lib/maps/google";
import { OSM_USER_AGENT, OsmLookupLimit, osmProviderData, readOsmCache, saveOsmCache, validOsmEstimate, type OsmRouteEstimate } from "@/lib/maps/osm";
import { osmCacheDirectory } from "@/lib/maps/osm-cache-path";

export type OsmRoutingConfig = { endpoint: string; cacheDir: string };
export type OsmRouteMode = "walking" | "driving";
/** `persist: false` reads the shared cache but never writes to it (legs touching a private stop). */
type Options = { config: OsmRoutingConfig; signal: AbortSignal; fetch?: typeof fetch; allowLookup?: () => boolean; persist?: boolean };

export function getOsmRoutingConfig(env: Readonly<Record<string, string | undefined>> = process.env): OsmRoutingConfig | null {
  if (env.STARDUST_MAP_ROUTER === "off") return null;
  const cacheDir = osmCacheDirectory(env);
  if (!cacheDir) return null;
  try {
    const endpoint = new URL(env.STARDUST_MAP_ROUTER_URL?.trim() || "https://routing.openstreetmap.de/");
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    return { endpoint: endpoint.href.replace(/\/?$/u, "/"), cacheDir };
  } catch { return null; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function osrmEstimate(value: unknown): OsmRouteEstimate | null {
  const body = record(value);
  if (body?.code === "NoRoute" || body?.code === "NoSegment") return null;
  if (body?.code !== "Ok" || !Array.isArray(body.routes) || body.routes.length !== 1
    || !Array.isArray(body.waypoints) || body.waypoints.length !== 2) throw new MapProviderUnavailable();
  // Never accept a remote snap onto a different town/road network. Radiuses are
  // sent too, but response validation keeps a changed provider fail-closed.
  if (!body.waypoints.every((value) => {
    const waypoint = record(value);
    return typeof waypoint?.distance === "number" && Number.isFinite(waypoint.distance) && waypoint.distance >= 0 && waypoint.distance <= 250;
  })) return null;
  const route = record(body.routes[0]);
  const estimate = { seconds: route?.duration, meters: route?.distance };
  if (!validOsmEstimate(estimate)) throw new MapProviderUnavailable();
  return estimate;
}

export class OsmRouteResolver {
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  constructor(private readonly now: () => number = Date.now) {}

  resolve(from: MapCoordinate, to: MapCoordinate, mode: OsmRouteMode, options: Options): Promise<OsmRouteEstimate | null> {
    if (![from, to].every((point) => Number.isFinite(point.lat) && Math.abs(point.lat) <= 85.05112878 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180)) return Promise.resolve(null);
    const work = this.queue.then(() => this.lookup(from, to, mode, options));
    this.queue = work.catch(() => {});
    return withMapAbort(work, options.signal);
  }

  private async lookup(from: MapCoordinate, to: MapCoordinate, mode: OsmRouteMode, options: Options): Promise<OsmRouteEstimate | null> {
    if (options.signal.aborted) throw new MapProviderUnavailable();
    const ioSignal = () => AbortSignal.any([options.signal, AbortSignal.timeout(1500)]);
    const cache = await readOsmCache(options.config.cacheDir, ioSignal(), "routes");
    // Full ordered endpoints bind estimates to the exact journey, independent
    // of record identity and dates. Reversed legs are different cache entries.
    const key = createHash("sha256").update(JSON.stringify(["osrm-fossgis-v1", options.config.endpoint, mode, from.lat, from.lng, to.lat, to.lng])).digest("hex");
    const cached = cache[key];
    if (cached && cached.expiresAt > this.now() && cached.estimate !== undefined) return cached.estimate;
    if (options.allowLookup && !options.allowLookup()) throw new OsmLookupLimit();
    const delay = Math.max(0, this.lastStart + 1000 - this.now());
    if (delay) await withMapAbort(new Promise<void>((done) => { const timer = setTimeout(done, delay); options.signal.addEventListener("abort", () => clearTimeout(timer), { once: true }); }), options.signal);
    if (options.signal.aborted) throw new MapProviderUnavailable();
    this.lastStart = this.now();
    const profile = mode === "walking" ? "foot" : "car";
    const url = new URL(`routed-${profile}/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}`, options.config.endpoint);
    url.search = new URLSearchParams({ overview: "false", steps: "false", alternatives: "false", generate_hints: "false", radiuses: "250;250" }).toString();
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(3000)]);
    const response = await withMapAbort((options.fetch ?? fetch)(url, { headers: { "User-Agent": OSM_USER_AGENT, Accept: "application/json" }, redirect: "error", cache: "no-store", signal }), signal);
    // OSRM uses HTTP 400 for genuine NoRoute/NoSegment; do not cache other
    // failures as negative geographic evidence.
    const data = await osmProviderData(response, signal, true);
    const estimate = osrmEstimate(data);
    if (options.persist === false) return estimate;
    const now = this.now();
    for (const [existingKey, entry] of Object.entries(cache)) if (entry.expiresAt <= now) delete cache[existingKey];
    const entries = Object.entries(cache).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    while (entries.length >= 1024) delete cache[entries.shift()![0]];
    cache[key] = { coordinate: null, estimate, expiresAt: now + (estimate ? 30 : 7) * 24 * 60 * 60 * 1000 };
    await saveOsmCache(options.config.cacheDir, cache, ioSignal(), "routes");
    return estimate;
  }
}

const publicRoutes = new OsmRouteResolver();
export function resolveOsmRoute(from: MapCoordinate, to: MapCoordinate, mode: OsmRouteMode, options: Options): Promise<OsmRouteEstimate | null> {
  return publicRoutes.resolve(from, to, mode, options);
}
