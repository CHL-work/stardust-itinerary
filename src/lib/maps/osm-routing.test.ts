import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOsmRoutingConfig, osrmEstimate, OsmRouteResolver } from "./osm-routing";
import { OsmLookupLimit } from "./osm";

const directories: string[] = [];
const from = { lat: 35, lng: 139 }, to = { lat: 35.01, lng: 139.01 };
const route = { code: "Ok", routes: [{ duration: 120, distance: 1000 }], waypoints: [{ distance: 5 }, { distance: 15 }] };
async function context() {
  const cacheDir = await mkdtemp(join(tmpdir(), "stardust-osrm-test-")); directories.push(cacheDir);
  return { config: { cacheDir, endpoint: "https://routing.openstreetmap.de/" }, signal: new AbortController().signal };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("OSRM estimates", () => {
  it("accepts bounded real route values and rejects malformed and far-snapped responses", () => {
    expect(osrmEstimate(route)).toEqual({ seconds: 120, meters: 1000 });
    expect(osrmEstimate({ code: "NoRoute" })).toBeNull();
    expect(osrmEstimate({ ...route, waypoints: [{ distance: 251 }, { distance: 0 }] })).toBeNull();
    for (const value of [{}, { code: "Error" }, { ...route, routes: [{ duration: -1, distance: 2 }] }, { ...route, routes: [{ duration: 2, distance: Infinity }] }, { ...route, routes: [route.routes[0], route.routes[0]] }]) expect(() => osrmEstimate(value)).toThrow("map_unavailable");
  });

  it("supports operator disable/switch without any browser credentials", () => {
    expect(getOsmRoutingConfig({})?.endpoint).toBe("https://routing.openstreetmap.de/");
    expect(getOsmRoutingConfig({ STARDUST_MAP_ROUTER: "off" })).toBeNull();
    expect(getOsmRoutingConfig({ STARDUST_MAP_CACHE_DIR: "relative" })).toBeNull();
    expect(getOsmRoutingConfig({ STARDUST_MAP_ROUTER_URL: "https://service.invalid/routes" })?.endpoint).toBe("https://service.invalid/routes/");
    expect(getOsmRoutingConfig({ STARDUST_MAP_ROUTER_URL: "http://service.invalid/" })).toBeNull();
  });

  it("uses dedicated real foot/car endpoints and durable exact-pair/mode cache", async () => {
    const options = await context(); const fetcher = vi.fn().mockImplementation(async () => Response.json(route));
    const first = new OsmRouteResolver();
    expect(await first.resolve(from, to, "walking", { ...options, fetch: fetcher })).toEqual({ seconds: 120, meters: 1000 });
    const [url, request] = fetcher.mock.calls[0];
    expect(url.origin).toBe("https://routing.openstreetmap.de");
    expect(url.pathname).toBe("/routed-foot/route/v1/foot/139,35;139.01,35.01");
    expect(url.searchParams.get("radiuses")).toBe("250;250"); expect(url.searchParams.get("overview")).toBe("false");
    expect(request).toMatchObject({ redirect: "error", headers: { "User-Agent": expect.stringContaining("StardustItinerary/") } });
    const fresh = new OsmRouteResolver();
    const noBudget = { ...options, fetch: fetcher, allowLookup: () => false };
    expect(await fresh.resolve(from, to, "walking", noBudget)).toEqual({ seconds: 120, meters: 1000 });
    await expect(fresh.resolve(to, from, "walking", noBudget)).rejects.toBeInstanceOf(OsmLookupLimit);
    await expect(fresh.resolve(from, to, "driving", noBudget)).rejects.toBeInstanceOf(OsmLookupLimit);
    await expect(fresh.resolve(from, { ...to, lat: 35.02 }, "walking", noBudget)).rejects.toBeInstanceOf(OsmLookupLimit);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const cache = await readFile(join(options.config.cacheDir, "public-routes-v1.json"), "utf8");
    expect(cache).not.toContain("139"); expect(cache).not.toContain("walking");
    await new OsmRouteResolver().resolve(from, to, "driving", { ...options, fetch: fetcher });
    expect(fetcher.mock.calls[1][0].pathname).toContain("/routed-car/route/v1/car/");
  });

  it("persists genuine unavailable routes, including OSRM HTTP 400 NoSegment", async () => {
    const options = await context(); const fetcher = vi.fn().mockResolvedValue(Response.json({ code: "NoSegment" }, { status: 400 }));
    expect(await new OsmRouteResolver().resolve(from, to, "driving", { ...options, fetch: fetcher })).toBeNull();
    expect(await new OsmRouteResolver().resolve(from, to, "driving", { ...options, fetch: fetcher })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serializes both modes under one global service rate limit", async () => {
    const options = await context(); const starts: number[] = [];
    const fetcher = vi.fn(async () => { starts.push(Date.now()); return Response.json(route); });
    const resolver = new OsmRouteResolver();
    await Promise.all([resolver.resolve(from, to, "walking", { ...options, fetch: fetcher }), resolver.resolve(from, to, "driving", { ...options, fetch: fetcher })]);
    expect(starts).toHaveLength(2); expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  });

  it("rejects invalid coordinates, aborts and diagnostic errors without a fabricated estimate", async () => {
    const options = await context(); const fetcher = vi.fn().mockResolvedValue(Response.json({ code: "InvalidQuery", message: "secret" }, { status: 400 }));
    expect(await new OsmRouteResolver().resolve({ lat: 90, lng: 0 }, to, "walking", { ...options, fetch: fetcher })).toBeNull();
    await expect(new OsmRouteResolver().resolve(from, to, "walking", { ...options, fetch: fetcher })).rejects.toThrow("map_unavailable");
    const controller = new AbortController(); controller.abort();
    await expect(new OsmRouteResolver().resolve(from, to, "walking", { ...options, fetch: fetcher, signal: controller.signal })).rejects.toThrow("map_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
