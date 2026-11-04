import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fetchGoogleMapImage, getGoogleMapsConfig, mapLocationInput, MapProviderUnavailable, resolveGoogleLocation } from "./google";

const config = { apiKey: "synthetic-key" };
const signal = new AbortController().signal;
const viewport = { center: { lat: 35.1, lng: 139.1 }, zoom: 13, width: 640, height: 400 } as const;
function place(overrides: Record<string, unknown> = {}) {
  return { displayName: { text: "Synthetic Museum" }, formattedAddress: "Tokyo", types: ["museum", "point_of_interest"], location: { latitude: 35.1, longitude: 139.1 }, ...overrides };
}
function png() {
  const bytes = Buffer.alloc(32);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes); bytes.write("IHDR", 12); bytes.writeUInt32BE(1280, 16); bytes.writeUInt32BE(800, 20);
  return bytes;
}

describe("server-only Google map provider", () => {
  it("requires only valid dedicated server configuration", () => {
    expect(getGoogleMapsConfig({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "public" })).toBeNull();
    expect(getGoogleMapsConfig({ STARDUST_GOOGLE_MAPS_API_KEY: "bad\nkey" })).toBeNull();
    expect(getGoogleMapsConfig({ STARDUST_GOOGLE_MAPS_API_KEY: "synthetic-key" })).toBeNull();
    expect(getGoogleMapsConfig({ STARDUST_MAPS_ALLOW_METERED: "false", STARDUST_GOOGLE_MAPS_API_KEY: "synthetic-key" })).toBeNull();
    expect(getGoogleMapsConfig({ STARDUST_MAPS_ALLOW_METERED: "true", STARDUST_GOOGLE_MAPS_API_KEY: "synthetic-key" })).toEqual(config);
    expect(getGoogleMapsConfig({ STARDUST_MAPS_ALLOW_METERED: "true", STARDUST_GOOGLE_MAPS_API_KEY: "bad\nkey" })).toBeNull();
    expect(getGoogleMapsConfig({ STARDUST_MAPS_ALLOW_METERED: "true", STARDUST_GOOGLE_MAPS_API_KEY: "synthetic-key", STARDUST_GOOGLE_MAPS_SIGNING_SECRET: "!bad" })).toBeNull();
  });

  it.each([
    ["https://www.google.com/maps/search/?api=1&query=35.1%2C139.1", { kind: "coordinate", coordinate: { lat: 35.1, lng: 139.1 } }],
    ["https://maps.google.com/?q=-10,20", { kind: "coordinate", coordinate: { lat: -10, lng: 20 } }],
    ["https://www.google.com/maps/search/?api=1&query=Museum&query_place_id=ChIJ-synthetic", { kind: "place", placeId: "ChIJ-synthetic" }],
    ["https://www.google.com/maps/@35,139,10z", null],
    ["https://www.google.com/maps/place/Museum/@35,139,10z/data=!3d34!4d138", null],
    ["https://maps.app.goo.gl/synthetic", null],
    ["https://google.com.attacker.invalid/maps?q=35,139", null],
    ["https://user@www.google.com/maps?q=35,139", null],
    ["http://www.google.com/maps?q=35,139", null],
    ["https://www.google.com:8443/maps?q=35,139", null],
    ["https://www.google.com/maps?q=35,139&q=36,140", null],
    ["https://www.google.com/maps?q=35,139&query=36,140", null],
    ["https://www.google.com/maps?q=99,999", null],
  ])("parses conservative Maps input %s", (mapUrl, expected) => {
    expect(mapLocationInput({ mapUrl, locationName: null })).toEqual(expected);
  });

  it("uses only a separately supplied location when links are unusable", () => {
    expect(mapLocationInput({ mapUrl: "https://maps.app.goo.gl/synthetic", locationName: "Synthetic Museum Tokyo" })).toEqual({ kind: "query", query: "Synthetic Museum Tokyo" });
    expect(mapLocationInput({ mapUrl: null, locationName: "9".repeat(301) })).toBeNull();
    expect(mapLocationInput({ mapUrl: null, locationName: "https://private.invalid" })).toBeNull();
  });

  it("uses documented Places text search and a minimal field mask without itinerary context", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ places: [place()] }));
    expect(await resolveGoogleLocation({ kind: "query", query: "Synthetic Museum Tokyo" }, { config, locale: "zh-HK-lihkg", signal, fetch: transport })).toEqual({ lat: 35.1, lng: 139.1 });
    const [url, init] = transport.mock.calls[0];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(JSON.parse(init.body)).toEqual({ textQuery: "Synthetic Museum Tokyo", languageCode: "zh-TW", pageSize: 2 });
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(init.headers["X-Goog-FieldMask"]).toBe("places.location,places.types,places.displayName,places.formattedAddress,places.attributions,nextPageToken");
  });

  it("uses documented Place Details only for a place ID and never calls user URLs", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(place()));
    expect(await resolveGoogleLocation({ kind: "place", placeId: "ChIJ-synthetic" }, { config, locale: "ja-JP", signal, fetch: transport })).toEqual({ lat: 35.1, lng: 139.1 });
    expect(String(transport.mock.calls[0][0])).toBe("https://places.googleapis.com/v1/places/ChIJ-synthetic?languageCode=ja");
    expect(transport.mock.calls[0][1].headers["X-Goog-FieldMask"]).toBe("location,types,attributions");
  });

  it.each([
    { places: [] }, { places: [place(), place()] }, { places: [place()], nextPageToken: "more" },
    { places: [place({ types: ["locality", "political"] })] },
    { places: [place({ types: ["route"] })] },
    { places: [place({ displayName: { text: "Other Museum" } })] },
    { places: [place({ location: { latitude: 999, longitude: 0 } })] },
    { places: [place({ location: { latitude: "35", longitude: 139 } })] },
    { places: [place({ attributions: [{ provider: "Other", providerUri: "https://example.invalid" }] })] },
  ])("leaves ambiguous, approximate, partial or unsupported attributed matches unplotted %#", async (data) => {
    const transport = vi.fn().mockResolvedValue(Response.json(data));
    expect(await resolveGoogleLocation({ kind: "query", query: "Synthetic Museum Tokyo" }, { config, locale: "en", signal, fetch: transport })).toBeNull();
  });

  it.each([
    () => new Response("raw secret diagnostic", { status: 403 }),
    () => new Response("not json", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } }),
    () => new Response(" ".repeat(65537), { headers: { "content-type": "application/json" } }),
  ])("bounds and sanitizes bad provider responses without retries %#", async (response) => {
    const transport = vi.fn().mockResolvedValue(response());
    await expect(resolveGoogleLocation({ kind: "query", query: "Synthetic Museum" }, { config, locale: "en", signal, fetch: transport })).rejects.toThrow("map_unavailable");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("never fetches for a literal coordinate", async () => {
    const transport = vi.fn();
    expect(await resolveGoogleLocation({ kind: "coordinate", coordinate: { lat: 35, lng: 139 } }, { config, locale: "en", signal, fetch: transport })).toEqual({ lat: 35, lng: 139 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns only PNG bytes and signs an exact fixed static-map request server-side", async () => {
    const signingSecret = Buffer.from("synthetic signing key").toString("base64url");
    const transport = vi.fn().mockResolvedValue(new Response(png(), { headers: { "content-type": "image/png" } }));
    const image = await fetchGoogleMapImage(viewport, { config: { ...config, signingSecret }, locale: "ja-JP", signal, fetch: transport });
    expect(image).toBe(`data:image/png;base64,${png().toString("base64")}`);
    expect(image).not.toContain(config.apiKey);
    const url = new URL(transport.mock.calls[0][0]);
    const signature = url.searchParams.get("signature"); url.searchParams.delete("signature");
    expect(signature).toBe(createHmac("sha1", Buffer.from(signingSecret, "base64url")).update(url.pathname + url.search).digest("base64url"));
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/staticmap");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ center: "35.100000,139.100000", size: "640x400", scale: "2", zoom: "13", format: "png", language: "ja" });
  });

  it.each([
    () => new Response("bad", { headers: { "content-type": "image/png" } }),
    () => new Response(png(), { headers: { "content-type": "text/html" } }),
    () => new Response(png(), { headers: { "content-type": "image/png", "x-staticmap-api-warning": "bad" } }),
    () => new Response(png(), { headers: { "content-type": "image/png", "content-length": "3145729" } }),
    () => { const bytes = png(); bytes.writeUInt32BE(640, 16); return new Response(bytes, { headers: { "content-type": "image/png" } }); },
  ])("rejects static-map errors, warnings, oversized or wrong-dimension images %#", async (response) => {
    await expect(fetchGoogleMapImage(viewport, { config, locale: "en", signal, fetch: vi.fn().mockResolvedValue(response()) })).rejects.toBeInstanceOf(MapProviderUnavailable);
  });

  it("aborts a stalled body without exposing diagnostics", async () => {
    const controller = new AbortController();
    const transport = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }));
    const request = resolveGoogleLocation({ kind: "query", query: "Museum" }, { config, locale: "en", signal: controller.signal, fetch: transport });
    controller.abort();
    await expect(request).rejects.toThrow("map_unavailable");
  });
});
