// Server-only: node:crypto and credential reads must never enter the client bundle.
import { createHmac } from "node:crypto";
import type { MapCoordinate, MapViewport } from "@/lib/maps/geometry";

export type MapLocale = "en" | "zh-HK" | "zh-HK-lihkg" | "ja-JP";
export type GoogleMapsConfig = { apiKey: string; signingSecret?: string };
export type MapLocation =
  | { kind: "coordinate"; coordinate: MapCoordinate }
  | { kind: "place"; placeId: string }
  | { kind: "query"; query: string };

export class MapProviderUnavailable extends Error {
  constructor() { super("map_unavailable"); }
}

export function getGoogleMapsConfig(env: Readonly<Record<string, string | undefined>> = process.env): GoogleMapsConfig | null {
  // A present credential is not permission to spend map credits. Keep the
  // legacy paid adapter disabled unless the operator explicitly opts in.
  if (env.STARDUST_MAPS_ALLOW_METERED !== "true") return null;
  const apiKey = env.STARDUST_GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey || apiKey.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(apiKey)) return null;
  const signingSecret = env.STARDUST_GOOGLE_MAPS_SIGNING_SECRET?.trim();
  if (signingSecret && (signingSecret.length > 256 || !/^[A-Za-z0-9_-]+={0,2}$/u.test(signingSecret))) return null;
  return { apiKey, ...(signingSecret ? { signingSecret } : {}) };
}

function coordinate(lat: unknown, lng: unknown): MapCoordinate | null {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -85.05112878 && lat <= 85.05112878 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

function coordinatePair(value: string): MapCoordinate | null {
  const match = /^\s*(-?\d{1,3}(?:\.\d{1,12})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,12})?)\s*$/u.exec(value);
  return match ? coordinate(Number(match[1]), Number(match[2])) : null;
}

function boundedQuery(value: string | null | undefined): string | null {
  const query = value?.trim();
  if (!query || query.length > 300 || /[\r\n\t\u0000-\u001f\u007f]|https?:\/\/|www\./iu.test(query)) return null;
  return query;
}

/** Interpret only documented search parameters. Never fetch supplied URLs,
 * follow short links, or mistake /@ viewport coordinates for a venue. */
export function mapLocationInput(input: { locationName: string | null; mapUrl: string | null }): MapLocation | null {
  let query: string | null = null;
  if (input.mapUrl && input.mapUrl.length <= 2048) {
    try {
      const url = new URL(input.mapUrl);
      const allowed = new Set(["google.com", "www.google.com", "maps.google.com", "google.co.jp", "www.google.co.jp", "maps.google.co.jp", "google.com.hk", "www.google.com.hk", "maps.google.com.hk"]);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && allowed.has(url.hostname)
        && (url.pathname === "/maps" || url.pathname.startsWith("/maps/") || (url.hostname.startsWith("maps.") && url.pathname === "/"))) {
        const unique = ["query", "q", "query_place_id"].every((key) => url.searchParams.getAll(key).length <= 1);
        if (unique && !(url.searchParams.has("query") && url.searchParams.has("q"))) {
          const placeId = url.searchParams.get("query_place_id");
          if (placeId && /^[A-Za-z0-9_-]{5,256}$/u.test(placeId)) return { kind: "place", placeId };
          query = boundedQuery(url.searchParams.get("query") ?? url.searchParams.get("q"));
        }
      }
    } catch { /* An unusable link may still have a separately entered venue. */ }
  }
  query ??= boundedQuery(input.locationName);
  if (!query) return null;
  const exact = coordinatePair(query);
  if (exact) return { kind: "coordinate", coordinate: exact };
  // Coordinate-like but invalid values must not become fuzzy text searches.
  if (/^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/u.test(query)) return null;
  return { kind: "query", query };
}

function language(locale: MapLocale): string { return locale === "ja-JP" ? "ja" : locale.startsWith("zh") ? "zh-TW" : "en"; }

/** Also bound stalled response bodies; fetch cancellation alone is insufficient
 * for an injected transport that ignores AbortSignal. No raw error escapes. */
export async function withMapAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); throw new MapProviderUnavailable(); }
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new MapProviderUnavailable());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (!response.ok || !response.body || (declared && (!/^\d+$/u.test(declared) || Number(declared) > limit))) {
    void response.body?.cancel().catch(() => {});
    throw new MapProviderUnavailable();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await withMapAbort(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new MapProviderUnavailable();
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } catch {
    void reader.cancel().catch(() => {});
    throw new MapProviderUnavailable();
  } finally { reader.releaseLock(); }
}

type Transport = { config: GoogleMapsConfig; locale: MapLocale; signal: AbortSignal; fetch?: typeof fetch };

async function providerJson(url: URL, init: RequestInit, transport: Transport): Promise<unknown> {
  try {
    const response = await withMapAbort((transport.fetch ?? fetch)(url, { ...init, cache: "no-store", redirect: "error", signal: transport.signal }), transport.signal);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      void response.body?.cancel().catch(() => {});
      throw new MapProviderUnavailable();
    }
    return JSON.parse((await readBounded(response, 64 * 1024, transport.signal)).toString("utf8"));
  } catch { throw new MapProviderUnavailable(); }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function precisePlace(value: unknown): MapCoordinate | null {
  const place = record(value);
  const types = place?.types;
  const point = record(place?.location);
  // Coordinates needing additional third-party credit remain unplotted until
  // the UI supports that attribution explicitly; never silently drop it.
  if (place?.attributions !== undefined && (!Array.isArray(place.attributions) || place.attributions.length > 0)) return null;
  // Require a venue/address identity, never a locality, region, route, postcode,
  // service area or an approximate city fallback.
  if (!Array.isArray(types) || !types.some((type) => ["point_of_interest", "establishment", "street_address", "premise", "subpremise"].includes(type))) return null;
  return coordinate(point?.latitude, point?.longitude);
}

function normalized(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, ""); }

function matchesQuery(query: string, place: Record<string, unknown>): boolean {
  const displayName = record(place.displayName)?.text;
  if (typeof displayName !== "string" || typeof place.formattedAddress !== "string") return false;
  const candidate = normalized(`${displayName} ${place.formattedAddress}`);
  const terms = query.normalize("NFKC").split(/[\s,，、]+/u).map(normalized).filter(Boolean);
  return normalized(query).length >= 3 && terms.length > 0 && terms.every((term) => candidate.includes(term));
}

export async function resolveGoogleLocation(input: MapLocation, transport: Transport): Promise<MapCoordinate | null> {
  if (input.kind === "coordinate") return input.coordinate;
  const headers = { "X-Goog-Api-Key": transport.config.apiKey, "X-Goog-FieldMask": "location,types,attributions" };
  if (input.kind === "place") {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(input.placeId)}`);
    url.searchParams.set("languageCode", language(transport.locale));
    return precisePlace(await providerJson(url, { headers }, transport));
  }
  const data = record(await providerJson(new URL("https://places.googleapis.com/v1/places:searchText"), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "X-Goog-FieldMask": "places.location,places.types,places.displayName,places.formattedAddress,places.attributions,nextPageToken" },
    body: JSON.stringify({ textQuery: input.query, languageCode: language(transport.locale), pageSize: 2 }),
  }, transport));
  if (!Array.isArray(data?.places) || data.places.length !== 1 || data.nextPageToken) return null;
  const place = record(data.places[0]);
  return place && matchesQuery(input.query, place) ? precisePlace(place) : null;
}

export async function fetchGoogleMapImage(viewport: MapViewport, transport: Transport): Promise<string> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
    url.search = new URLSearchParams({ center: `${viewport.center.lat.toFixed(6)},${viewport.center.lng.toFixed(6)}`, zoom: String(viewport.zoom), size: "640x400", scale: "2", format: "png", maptype: "roadmap", language: language(transport.locale), key: transport.config.apiKey }).toString();
    if (transport.config.signingSecret) {
      const signature = createHmac("sha1", Buffer.from(transport.config.signingSecret, "base64url")).update(`${url.pathname}${url.search}`).digest("base64url");
      url.searchParams.set("signature", signature);
    }
    const response = await withMapAbort((transport.fetch ?? fetch)(url, { cache: "no-store", redirect: "error", signal: transport.signal }), transport.signal);
    if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/png" || response.headers.has("x-staticmap-api-warning")) {
      void response.body?.cancel().catch(() => {});
      throw new MapProviderUnavailable();
    }
    const bytes = await readBounded(response, 3 * 1024 * 1024, transport.signal);
    if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.subarray(12, 16).toString("ascii") !== "IHDR" || bytes.readUInt32BE(16) !== 1280 || bytes.readUInt32BE(20) !== 800) throw new MapProviderUnavailable();
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch { throw new MapProviderUnavailable(); }
}
