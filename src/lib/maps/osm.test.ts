import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOsmMapsConfig, isPublicVenueQuery, osmLocationInput, OsmLookupLimit, OsmVenueResolver, photonCoordinate } from "./osm";

const directories: string[] = [];
async function context() {
  const cacheDir = await mkdtemp(join(tmpdir(), "stardust-osm-test-")); directories.push(cacheDir);
  return { config: { cacheDir, endpoint: "https://photon.komoot.io/api/" }, signal: new AbortController().signal };
}
function feature(name = "Synthetic Museum", extra: Record<string, unknown> = {}) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [139, 35] }, properties: { name, osm_key: "tourism", osm_value: "museum", city: "Tokyo", ...extra } };
}
function reply(name = "Synthetic Museum") { return Response.json({ features: [feature(name)] }); }
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("saved OSM map locations", () => {
  it("reads exact saved coordinate pairs and exact venue coordinates, never a camera center", () => {
    expect(osmLocationInput({ locationName: "35,139", mapUrl: null })).toEqual({ coordinate: { lat: 35, lng: 139 } });
    expect(osmLocationInput({ locationName: "Museum", mapUrl: "https://www.google.com/maps/search/?api=1&query=35,139&query_place_id=synthetic" })).toEqual({ coordinate: { lat: 35, lng: 139 } });
    expect(osmLocationInput({ locationName: "Museum", mapUrl: "https://www.google.com/maps/place/Museum/@30,130,10z/data=!4m2!3d35!4d139!16x" })).toEqual({ coordinate: { lat: 35, lng: 139 } });
    expect(osmLocationInput({ locationName: null, mapUrl: "https://www.google.com/maps/place/Museum/@30,130,10z" })).toBeNull();
    expect(osmLocationInput({ locationName: null, mapUrl: "https://evil.invalid/maps/place/Museum/data=!3d35!4d139" })).toBeNull();
    expect(osmLocationInput({ locationName: null, mapUrl: "https://www.google.com/maps/place/Museum/data=!3d35!4d139!3d36!4d140" })).toBeNull();
    expect(osmLocationInput({ locationName: "90,190", mapUrl: null })).toBeNull();
  });

  it("keeps private/confidential text out of the public resolver", () => {
    for (const query of ["Private Home", "Apartment 123", "Museum booking 12345678", "user@example.invalid", "Museum\nsecret", "https://example.invalid", "Room 123 Hotel", "123-456-7890", "自宅 Tokyo"]) expect(isPublicVenueQuery(query)).toBe(false);
    expect(isPublicVenueQuery("Synthetic Museum Tokyo")).toBe(true);
  });

  it("requires a unique precise matching venue and rejects city/ambiguous/malformed data", () => {
    expect(photonCoordinate({ features: [feature()] }, "Synthetic Museum Tokyo")).toEqual({ lat: 35, lng: 139 });
    for (const features of [[], [feature(), feature()], [feature("Other Museum")], [feature("Synthetic Museum", { osm_key: "place", osm_value: "city" })], [feature("Synthetic Museum", { osm_key: "building", osm_value: "house" })]]) expect(photonCoordinate({ features }, "Synthetic Museum Tokyo")).toBeNull();
    expect(photonCoordinate({ features: [{ ...feature(), geometry: { type: "Point", coordinates: [190, 95] } }] }, "Synthetic Museum")).toBeNull();
    expect(photonCoordinate({ features: [feature("Ueno Railway Station", { osm_key: "building", osm_value: "train_station" })] }, "Tokyo Station")).toBeNull();
    expect(photonCoordinate({ features: [feature("Shibuya Parco", { osm_key: "shop", osm_value: "mall" }), feature("PARCO Theatre", { osm_key: "amenity", osm_value: "theatre", district: "Shibuya" })] }, "SHIBUYA PARCO")).toEqual({ lat: 35, lng: 139 });
    expect(photonCoordinate({ features: [feature("TSUTAYA", { osm_key: "shop", osm_value: "books", district: "Shibuya" }), feature("Tsutaya Books 1", { district: "Shibuya" })] }, "SHIBUYA TSUTAYA")).toBeNull();
    expect(photonCoordinate({ features: [feature("Other Museum"), feature()] }, "Synthetic Museum Tokyo")).toEqual({ lat: 35, lng: 139 });
    expect(photonCoordinate({ features: [feature("渋谷Parco", { osm_key: "shop", osm_value: "mall", country: "日本", state: "東京都", city: "渋谷区", district: "渋谷区", locality: "宇田川町", street: "15", housenumber: "1" })] }, "渋谷Parco 東京都渋谷区宇田川町15番1号")).toEqual({ lat: 35, lng: 139 });
  });

  it("has a switchable public endpoint and rejects unsafe operator config", () => {
    expect(getOsmMapsConfig({})?.endpoint).toBe("https://photon.komoot.io/api/");
    expect(getOsmMapsConfig({ STARDUST_MAP_GEOCODER: "off" })).toBeNull();
    expect(getOsmMapsConfig({ STARDUST_MAP_CACHE_DIR: "relative" })).toBeNull();
    for (const endpoint of ["http://service.invalid/api/", "https://user:pass@service.invalid/api/", "https://service.invalid/api/?key=secret"]) expect(getOsmMapsConfig({ STARDUST_MAP_GEOCODER_URL: endpoint })).toBeNull();
    expect(getOsmMapsConfig({ STARDUST_MAP_GEOCODER_URL: "https://service.invalid/api/" })?.endpoint).toBe("https://service.invalid/api/");
  });

  it("accepts a complete CJK venue name with separated, matching geographic context", () => {
    const tower = feature("東京タワー", { osm_key: "man_made", osm_value: "tower", city: "東京都", district: "港区", country: "日本" });
    const busStop = feature("東京タワー", { osm_key: "highway", osm_value: "bus_stop", city: "東京都" });
    expect(photonCoordinate({ features: [tower, busStop] }, "東京タワー 東京都")).toEqual({ lat: 35, lng: 139 });
    expect(photonCoordinate({ features: [tower] }, "東京タワー、港区")).toEqual({ lat: 35, lng: 139 });
    expect(photonCoordinate({ features: [feature("犬吠埼灯台", { osm_key: "man_made", osm_value: "lighthouse", city: "銚子市" })] }, "犬吠埼灯台 銚子市")).toEqual({ lat: 35, lng: 139 });
    expect(photonCoordinate({ features: [feature("東京タワー", { osm_key: "man_made", osm_value: "pipeline", city: "東京都" })] }, "東京タワー 東京都")).toBeNull();
  });

  it("does not weaken full-name, token-boundary, branch, geography or ambiguity checks for CJK", () => {
    const tower = feature("東京タワー", { osm_key: "man_made", osm_value: "tower", city: "東京都" });
    for (const query of ["東京タワーホテル 東京都", "東京タワー周辺 東京都", "東京タワー 大阪市", "東京タワー タワー", "東京タワー東京都"]) expect(photonCoordinate({ features: [tower] }, query)).toBeNull();
    expect(photonCoordinate({ features: [tower, { ...tower, geometry: { type: "Point", coordinates: [140, 36] } }] }, "東京タワー 東京都")).toBeNull();
    expect(photonCoordinate({ features: [feature("上野駅", { osm_key: "railway", osm_value: "station", city: "東京都" })] }, "東京駅 東京都")).toBeNull();
    expect(photonCoordinate({ features: [feature("青空カフェ 新宿店", { city: "東京都" })] }, "青空カフェ 渋谷店 東京都")).toBeNull();
    expect(photonCoordinate({ features: [feature("青空カフェ", { district: "渋谷区", city: "東京都" })] }, "青空カフェ 渋谷店")).toBeNull();
    expect(photonCoordinate({ features: [feature("TSUTAYA", { district: "Shibuya", city: "Tokyo" })] }, "TSUTAYA Shibuya")).toBeNull();
    for (const name of ["青空一番館", "青空一号館"]) expect(photonCoordinate({ features: [feature(name)] }, "青空一館")).toBeNull();
  });

  it("accepts a saved \"venue, street, city, region postcode\" place confirmed by postcode or by city and state", () => {
    const hotel = feature("Example Harbour Hotel", { osm_value: "hotel", housenumber: "12", street: "300 North", city: "Example City", state: "Example State", country: "Exampleland", postcode: "12345" });
    expect(photonCoordinate({ features: [hotel] }, "Example Harbour Hotel, 12 West 300 North, Example City, Example State, 12345, Exampleland")).toEqual({ lat: 35, lng: 139 });
    expect(photonCoordinate({ features: [hotel] }, "Example Harbour Hotel, 12 W 300 N, Example City, ES 12345, Exampleland")).toEqual({ lat: 35, lng: 139 });
    expect(photonCoordinate({ features: [{ ...hotel, properties: { ...hotel.properties, postcode: undefined } }] }, "Example Harbour Hotel, 12 West 300 North, Example City, Example State")).toEqual({ lat: 35, lng: 139 });
  });

  it("keeps the exact venue name and real geographic confirmation for saved addresses", () => {
    const hotel = feature("Example Harbour Hotel", { osm_value: "hotel", street: "300 North", city: "Example City", state: "Example State", country: "Exampleland", postcode: "12345" });
    for (const query of [
      "Example Harbour Hotel, 12 West 300 North, Other City, Other State, 67890, Exampleland",
      "Example Harbour Hotel, 12 West 300 North, Example City, Exampleland",
      "Example Harbour Hotel Annex, 12 West 300 North, Example City, Example State, 12345",
      "Example Harbour, 12 West 300 North, Example City, Example State, 12345",
    ]) expect(photonCoordinate({ features: [hotel] }, query)).toBeNull();
    expect(photonCoordinate({ features: [hotel, { ...hotel, geometry: { type: "Point", coordinates: [140, 36] } }] }, "Example Harbour Hotel, 12 West 300 North, Example City, Example State, 12345")).toBeNull();
  });

  it("still leaves multilingual aliases and provider-missing geographic evidence unresolved", () => {
    expect(photonCoordinate({ features: [feature("Храм Сенсодзи 金龍山 浅草寺", { osm_key: "amenity", osm_value: "place_of_worship", city: "台東区" })] }, "浅草寺 東京")).toBeNull();
    expect(photonCoordinate({ features: [feature("架空店舗 秋葉原支店", { city: "千代田区" })] }, "架空店舗 秋葉原店")).toBeNull();
  });
});

describe("bounded durable public venue lookup", () => {
  it("persists only a hash, point and expiry; a fresh resolver reuses the result", async () => {
    const options = await context(); const fetcher = vi.fn().mockResolvedValue(reply());
    const result = await new OsmVenueResolver().resolve("Synthetic Museum Tokyo", { ...options, fetch: fetcher });
    expect(result).toEqual({ lat: 35, lng: 139 });
    const serialized = await readFile(join(options.config.cacheDir, "public-venues-v1.json"), "utf8");
    expect(serialized).not.toContain("Synthetic"); expect(serialized).not.toContain("Tokyo");
    expect(await new OsmVenueResolver().resolve("Synthetic Museum Tokyo", { ...options, fetch: fetcher, allowLookup: () => false })).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url.origin).toBe("https://photon.komoot.io"); expect(url.searchParams.get("limit")).toBe("2");
    expect(request).toMatchObject({ redirect: "error", cache: "no-store", headers: { "User-Agent": expect.stringContaining("StardustItinerary/") } });
    expect(await readdir(options.config.cacheDir)).toEqual(["public-venues-v1.json"]);
  });

  it("reads but never writes the shared cache for a private stop's lookup", async () => {
    const options = await context(); const fetcher = vi.fn().mockImplementation(async () => reply());
    expect(await new OsmVenueResolver().resolve("Synthetic Museum Tokyo", { ...options, fetch: fetcher, persist: false })).toEqual({ lat: 35, lng: 139 });
    expect(await readdir(options.config.cacheDir)).toEqual([]);
    await new OsmVenueResolver().resolve("Synthetic Museum Tokyo", { ...options, fetch: fetcher });
    expect(await new OsmVenueResolver().resolve("Synthetic Museum Tokyo", { ...options, fetch: fetcher, persist: false, allowLookup: () => false })).toEqual({ lat: 35, lng: 139 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("caches a genuine negative and never repeats it just because a new request started", async () => {
    const options = await context(); const fetcher = vi.fn().mockResolvedValue(Response.json({ features: [] }));
    expect(await new OsmVenueResolver().resolve("Synthetic Museum", { ...options, fetch: fetcher })).toBeNull();
    expect(await new OsmVenueResolver().resolve("Synthetic Museum", { ...options, fetch: fetcher })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries an old matching-policy negative without deleting the existing cache entry", async () => {
    const options = await context(), query = "東京タワー 東京都";
    const oldKey = createHash("sha256").update(JSON.stringify(["photon-venue-v2", options.config.endpoint, query])).digest("hex");
    await writeFile(join(options.config.cacheDir, "public-venues-v1.json"), JSON.stringify({ [oldKey]: { expiresAt: Date.now() + 86400000, coordinate: null } }));
    const fetcher = vi.fn().mockResolvedValue(Response.json({ features: [feature("東京タワー", { osm_key: "man_made", osm_value: "tower", city: "東京都" })] }));
    expect(await new OsmVenueResolver().resolve(query, { ...options, fetch: fetcher })).toEqual({ lat: 35, lng: 139 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const cached = JSON.parse(await readFile(join(options.config.cacheDir, "public-venues-v1.json"), "utf8"));
    expect(cached[oldKey].coordinate).toBeNull(); expect(Object.keys(cached)).toHaveLength(2);
  });

  it("does not spend the request lookup budget for durable hits", async () => {
    const options = await context(); const fetcher = vi.fn().mockResolvedValue(reply()); const budget = vi.fn().mockReturnValue(true);
    const resolver = new OsmVenueResolver();
    await resolver.resolve("Synthetic Museum", { ...options, fetch: fetcher, allowLookup: budget });
    budget.mockReturnValue(false);
    await resolver.resolve("Synthetic Museum", { ...options, fetch: fetcher, allowLookup: budget });
    await expect(resolver.resolve("Different Museum", { ...options, fetch: fetcher, allowLookup: budget })).rejects.toBeInstanceOf(OsmLookupLimit);
    expect(budget).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent callers and leaves at least one second between new requests", async () => {
    const options = await context(); const starts: number[] = [];
    const fetcher = vi.fn(async (url: URL) => { starts.push(Date.now()); return reply(url.searchParams.get("q")!); });
    const resolver = new OsmVenueResolver();
    await Promise.all(["First Museum", "Second Museum", "First Museum"].map((query) => resolver.resolve(query, { ...options, fetch: fetcher as unknown as typeof fetch })));
    expect(starts).toHaveLength(2); expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  });

  it("does not call a provider when private-looking input or an aborted request is supplied", async () => {
    const options = await context(); const fetcher = vi.fn(); const resolver = new OsmVenueResolver();
    expect(await resolver.resolve("Private Home", { ...options, fetch: fetcher })).toBeNull();
    const controller = new AbortController(); controller.abort();
    await expect(resolver.resolve("Synthetic Museum", { ...options, signal: controller.signal, fetch: fetcher })).rejects.toThrow("map_unavailable");
    expect(fetcher).not.toHaveBeenCalled(); expect(await readdir(options.config.cacheDir)).toEqual([]);
  });

  it("rejects oversized/corrupt cache files without contacting a provider", async () => {
    const options = await context(); const fetcher = vi.fn();
    await writeFile(join(options.config.cacheDir, "public-venues-v1.json"), "x".repeat(256 * 1024 + 1));
    await expect(new OsmVenueResolver().resolve("Synthetic Museum", { ...options, fetch: fetcher })).rejects.toThrow("map_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not cache failed or oversized network responses", async () => {
    const options = await context();
    for (const response of [new Response("secret provider diagnostic", { status: 429 }), new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } }), Response.json({ x: "x".repeat(65537) })]) {
      await expect(new OsmVenueResolver().resolve("Synthetic Museum", { ...options, fetch: vi.fn().mockResolvedValue(response) })).rejects.toThrow("map_unavailable");
    }
    expect(await readdir(options.config.cacheDir)).toEqual([]);
  });

  it("does not persist late results after cancellation", async () => {
    const options = await context(); const controller = new AbortController();
    const fetcher = vi.fn(async () => { controller.abort(); return reply(); });
    await expect(new OsmVenueResolver().resolve("Synthetic Museum", { ...options, signal: controller.signal, fetch: fetcher })).rejects.toThrow("map_unavailable");
    expect(await readdir(options.config.cacheDir)).toEqual([]);
  });
});
