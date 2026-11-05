// Server-only venue resolver. No trip, member, title, date or private location
// is written to the durable cache. OSM tiles load in the browser.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import type { MapCoordinate } from "@/lib/maps/geometry";
import { mapLocationInput, MapProviderUnavailable, withMapAbort } from "@/lib/maps/google";
import { osmCacheDirectory } from "@/lib/maps/osm-cache-path";

export type OsmMapsConfig = { endpoint: string; cacheDir: string };
/** `persist: false` reads the shared cache but never writes to it (private stops). */
export type OsmLookupOptions = { config: OsmMapsConfig; signal: AbortSignal; fetch?: typeof fetch; allowLookup?: () => boolean; persist?: boolean };
export type OsmRouteEstimate = { seconds: number; meters: number };
export type OsmLocation = { coordinate: MapCoordinate } | { query: string };
export class OsmLookupLimit extends Error {}
const ENDPOINT = "https://photon.komoot.io/api/";
export const OSM_USER_AGENT = "StardustItinerary/1.0 (+https://github.com/CHL-work/stardust-itinerary)";
const CACHE_BYTES = 256 * 1024;
const CACHE_ENTRIES = 1024;
type CacheEntry = { expiresAt: number; coordinate: MapCoordinate | null; estimate?: OsmRouteEstimate | null };
export type OsmPublicCache = Record<string, CacheEntry>;

export function getOsmMapsConfig(env: Readonly<Record<string, string | undefined>> = process.env): OsmMapsConfig | null {
  if (env.STARDUST_MAP_GEOCODER === "off") return null;
  const cacheDir = osmCacheDirectory(env);
  if (!cacheDir) return null;
  try {
    const endpoint = new URL(env.STARDUST_MAP_GEOCODER_URL?.trim() || ENDPOINT);
    // Only operator configuration can select an alternate Photon-compatible
    // service. User-supplied map URLs are never network destinations.
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    return { endpoint: endpoint.href, cacheDir };
  } catch { return null; }
}

function point(lat: unknown, lng: unknown): MapCoordinate | null {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 85.05112878 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Saved venue coordinates are evidence; an @camera center is not. */
export function osmLocationInput(input: { locationName: string | null; mapUrl: string | null }): OsmLocation | null {
  let urlQuery: string | null = null;
  if (input.mapUrl && input.mapUrl.length <= 2048 && isTrustedGoogleMapsUrl(input.mapUrl)) {
    try {
      const url = new URL(input.mapUrl);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port) {
        if (url.searchParams.getAll("query").length <= 1 && url.searchParams.getAll("q").length <= 1
          && !(url.searchParams.has("query") && url.searchParams.has("q"))) {
          urlQuery = url.searchParams.get("query") ?? url.searchParams.get("q");
          const saved = mapLocationInput({ locationName: urlQuery, mapUrl: null });
          if (saved?.kind === "coordinate") return { coordinate: saved.coordinate };
        }
        if (url.pathname.startsWith("/maps/place/")) {
          const pairs = [...decodeURIComponent(url.pathname).matchAll(/!3d(-?\d{1,3}(?:\.\d{1,12})?)!4d(-?\d{1,3}(?:\.\d{1,12})?)(?=!|\/|$)/gu)];
          if (pairs.length === 1) {
            const coordinate = point(Number(pairs[0][1]), Number(pairs[0][2]));
            if (coordinate) return { coordinate };
          }
        }
      }
    } catch { /* Fall back only to separately saved place text. */ }
  }
  const savedName = mapLocationInput({ locationName: input.locationName, mapUrl: null });
  if (savedName?.kind === "coordinate") return { coordinate: savedName.coordinate };
  const location = mapLocationInput({ locationName: urlQuery ?? input.locationName, mapUrl: null });
  return location?.kind === "coordinate" ? { coordinate: location.coordinate }
    : location?.kind === "query" ? { query: location.query } : null;
}

/** Conservative accidental-secret guard; trip visibility is separately checked
 * by the caller. It is not a claim that arbitrary location text is public. */
export function isPublicVenueQuery(query: string): boolean {
  return query.length >= 3 && query.length <= 300
    && !/[\u0000-\u001f\u007f@]|https?:\/\/|www\./iu.test(query)
    && !/\b(?:home|private|apartment|room|booking|reservation|confirmation|password|token|secret|pin|phone|email)\b|自宅|住所非公開|予約番号|密碼|預約編號|私人住宅/iu.test(query)
    && !/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b\d{7,}\b|(?:\+\d{1,3}[\s-])?\d{3}[\s-]\d{3}[\s-]\d{4}/iu.test(query);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function identity(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, ""); }
function normalized(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("en").replace(/丁目|番地?|号/gu, "").replace(/[^\p{L}\p{N}]+/gu, ""); }

/** A unique matching venue/address only, never a city, street or region center. */
export function photonCoordinate(data: unknown, query: string): MapCoordinate | null {
  const features = record(data)?.features;
  if (!Array.isArray(features) || features.length > 2) return null;
  const matches = features.flatMap((feature) => {
    const coordinate = matchingPhotonFeature(feature, query);
    const name = record(record(feature)?.properties)?.name;
    return coordinate ? [{ coordinate, exact: typeof name === "string" && identity(name) === identity(query) }] : [];
  });
  // An exact mall name is not ambiguous merely because a similarly named
  // tenant is also returned. Two exact identities still remain ambiguous.
  const exact = matches.filter((match) => match.exact);
  return exact.length === 1 ? exact[0].coordinate : exact.length === 0 && matches.length === 1 ? matches[0].coordinate : null;
}

function matchingPhotonFeature(value: unknown, query: string): MapCoordinate | null {
  const feature = record(value); const properties = record(feature?.properties); const geometry = record(feature?.geometry);
  if (!properties || geometry?.type !== "Point" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 2) return null;
  const osmKey = properties.osm_key;
  const precise = ["amenity", "tourism", "shop", "leisure", "historic", "office", "building", "railway", "aeroway", "public_transport"].includes(String(osmKey))
    || osmKey === "man_made" && ["tower", "lighthouse"].includes(String(properties.osm_value));
  if (!precise) return null;
  if (["residential", "house", "apartments", "platform", "rail"].includes(String(properties.osm_value))) return null;
  if (typeof properties.name !== "string" || identity(properties.name).length < 2) return null;
  const field = (key: string): string => typeof properties[key] === "string" ? properties[key] : "";
  // Address suffix normalization must never erase part of a venue identity,
  // such as distinguishing 一番館 from 一館 or 一号館 from 一館.
  const queryIdentity = identity(query), nameIdentity = identity(properties.name);
  if (queryIdentity === nameIdentity) return point(geometry.coordinates[1], geometry.coordinates[0]);
  // A city token must never complete a different venue name (e.g. "Tokyo
  // Station" must not match Ueno Railway Station merely located in Tokyo).
  const street = normalized(field("street")), house = normalized(field("housenumber"));
  const detailedAddress = street.length >= 2 && queryIdentity.includes(street)
    || house.length > 0 && queryIdentity.includes(house) && normalized(field("locality")).length >= 2 && queryIdentity.includes(normalized(field("locality")));
  if (!queryIdentity.includes(nameIdentity) || (!queryIdentity.startsWith(nameIdentity) && !detailedAddress)) return null;
  if (savedAddressConfirms(query, nameIdentity, field)) return point(geometry.coordinates[1], geometry.coordinates[0]);
  const address = [...new Set(["country", "state", "city", "district", "locality", "street", "housenumber"].map(field).filter(Boolean))];
  const geography = normalized([address.join(""), [...address].reverse().join(""), field("postcode")].join(" "));
  const queryParts = query.normalize("NFKC").split(/[\s,，、]+/u).filter(Boolean);
  // CJK venue names normally do not contain spaces. Permit a full name at an
  // explicit token boundary followed only by matching geographic context;
  // do not truncate branch suffixes, infer aliases or match name substrings.
  const cjkNameWithContext = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(properties.name)
    && queryParts.length > 1 && identity(queryParts[0]) === nameIdentity
    && queryParts.slice(1).every((part) => normalized(part).length > 0 && geography.includes(normalized(part)));
  if (properties.name.trim().split(/\s+/u).length < 2 && !detailedAddress && !cjkNameWithContext) return null;
  const candidate = normalized(field("name")) + geography;
  const terms = queryParts.map(normalized).filter(Boolean);
  if (!terms.length || !terms.every((term) => candidate.includes(term))) return null;
  return point(geometry.coordinates[1], geometry.coordinates[0]);
}

/**
 * Saved places often read "Venue, street address, city, region postcode, country".
 * The whole venue name before the first comma must equal the feature's name, and
 * a later part must confirm where it is: the feature's postcode, or its city
 * together with its state. Street spellings differ between sources (for example
 * "12 West 300 North" against "300 North"), so streets are not compared.
 */
function savedAddressConfirms(query: string, nameIdentity: string, field: (key: string) => string): boolean {
  const parts = query.normalize("NFKC").split(/[,，、]/u).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3 || identity(parts[0]) !== nameIdentity) return false;
  const later = parts.slice(1).map((part) => {
    const tokens = part.split(/\s+/u).map(normalized).filter(Boolean);
    return { whole: normalized(part), tokens: [...tokens, ...tokens.slice(1).map((token, index) => tokens[index] + token)] };
  });
  const postcode = normalized(field("postcode"));
  if (postcode.length >= 4 && later.some((part) => part.whole === postcode || part.tokens.includes(postcode))) return true;
  const city = normalized(field("city")), state = normalized(field("state"));
  const named = (value: string) => value.length >= 2 && later.some((part) => part.whole === value);
  return named(city) && named(state) && city !== state;
}

export async function osmProviderData(response: Response, signal: AbortSignal, allowBadRequest = false): Promise<unknown> {
  const length = response.headers.get("content-length");
  if ((!response.ok && !(allowBadRequest && response.status === 400)) || !response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
    || (length && (!/^\d+$/u.test(length) || Number(length) > 64 * 1024))) {
    void response.body?.cancel().catch(() => {}); throw new MapProviderUnavailable();
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await withMapAbort(reader.read(), signal); if (part.done) break;
      size += part.value.byteLength; if (size > 64 * 1024) throw new MapProviderUnavailable();
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { void reader.cancel().catch(() => {}); throw new MapProviderUnavailable(); }
  finally { reader.releaseLock(); }
}

function cacheKey(endpoint: string, query: string): string {
  return createHash("sha256").update(JSON.stringify(["photon-venue-v4", endpoint, query.normalize("NFKC").trim()])).digest("hex");
}

export function validOsmEstimate(value: unknown): value is OsmRouteEstimate {
  const estimate = record(value);
  return typeof estimate?.seconds === "number" && Number.isFinite(estimate.seconds) && estimate.seconds >= 0 && estimate.seconds <= 30 * 86400
    && typeof estimate.meters === "number" && Number.isFinite(estimate.meters) && estimate.meters >= 0 && estimate.meters <= 50_000_000;
}

export async function readOsmCache(directory: string, signal: AbortSignal, kind: "venues" | "routes" = "venues"): Promise<OsmPublicCache> {
  await withMapAbort(mkdir(directory, { recursive: true }), signal);
  const file = join(directory, `public-${kind}-v1.json`);
  let raw: unknown;
  try {
    const info = await withMapAbort(stat(file), signal);
    if (!info.isFile() || info.size > CACHE_BYTES) throw new MapProviderUnavailable();
    raw = JSON.parse(await readFile(file, { encoding: "utf8", signal }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new MapProviderUnavailable();
  }
  const rows = record(raw); if (!rows || Object.keys(rows).length > CACHE_ENTRIES) throw new MapProviderUnavailable();
  const cache: OsmPublicCache = {};
  for (const [key, value] of Object.entries(rows)) {
    const entry = record(value); const coordinate = record(entry?.coordinate);
    const valid = coordinate ? point(coordinate.lat, coordinate.lng) : null;
    if (/^[a-f0-9]{64}$/u.test(key) && typeof entry?.expiresAt === "number" && Number.isFinite(entry.expiresAt)
      && (entry.coordinate === null || valid) && (entry.estimate === undefined || entry.estimate === null || validOsmEstimate(entry.estimate))) {
      cache[key] = { expiresAt: entry.expiresAt, coordinate: valid, ...(entry.estimate !== undefined ? { estimate: entry.estimate as OsmRouteEstimate | null } : {}) };
    }
  }
  return cache;
}

export async function saveOsmCache(directory: string, cache: OsmPublicCache, signal: AbortSignal, kind: "venues" | "routes" = "venues"): Promise<void> {
  const temporary = join(directory, `public-${kind}-${randomUUID()}.tmp`);
  try {
    const content = JSON.stringify(cache); if (Buffer.byteLength(content) > CACHE_BYTES || signal.aborted) throw new MapProviderUnavailable();
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx", signal });
    if (signal.aborted) throw new MapProviderUnavailable();
    // rename cannot be canceled. Keep the internal provider queue held until
    // publication settles; only the outer caller races its abort signal.
    await rename(temporary, join(directory, `public-${kind}-v1.json`));
  } finally { await unlink(temporary).catch(() => {}); }
}

/** One shared queue serializes public work across all requests in this process.
 * This intentionally does not support multi-process/cloud deployments. */
export class OsmVenueResolver {
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  constructor(private readonly now: () => number = Date.now) {}

  resolve(query: string, options: OsmLookupOptions): Promise<MapCoordinate | null> {
    if (!isPublicVenueQuery(query)) return Promise.resolve(null);
    const work = this.queue.then(() => this.lookup(query, options));
    this.queue = work.catch(() => {});
    return withMapAbort(work, options.signal);
  }

  private async lookup(query: string, options: OsmLookupOptions): Promise<MapCoordinate | null> {
    if (options.signal.aborted) throw new MapProviderUnavailable();
    const ioSignal = () => AbortSignal.any([options.signal, AbortSignal.timeout(1500)]);
    const cache = await withMapAbort(readOsmCache(options.config.cacheDir, ioSignal()), options.signal);
    const key = cacheKey(options.config.endpoint, query); const cached = cache[key];
    if (cached && cached.expiresAt > this.now()) return cached.coordinate;
    if (options.allowLookup && !options.allowLookup()) throw new OsmLookupLimit();
    const delay = Math.max(0, this.lastStart + 1000 - this.now());
    if (delay) await withMapAbort(new Promise<void>((done) => { const timer = setTimeout(done, delay); options.signal.addEventListener("abort", () => clearTimeout(timer), { once: true }); }), options.signal);
    if (options.signal.aborted) throw new MapProviderUnavailable();
    this.lastStart = this.now();
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(3000)]);
    const url = new URL(options.config.endpoint); url.searchParams.set("q", query); url.searchParams.set("limit", "2");
    // Photon supports de/en/fr translation. Preserve native names for CJK
    // queries; English text needs explicit English result labels for matching.
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) url.searchParams.set("lang", "en");
    const response = await withMapAbort((options.fetch ?? fetch)(url, { headers: { "User-Agent": OSM_USER_AGENT, Accept: "application/json" }, redirect: "error", cache: "no-store", signal }), signal);
    const data = await osmProviderData(response, signal);
    if (!Array.isArray(record(data)?.features)) throw new MapProviderUnavailable();
    const coordinate = photonCoordinate(data, query);
    // A private stop's place text never enters the shared cache.
    if (options.persist === false) return coordinate;
    const now = this.now();
    for (const [existingKey, entry] of Object.entries(cache)) if (entry.expiresAt <= now) delete cache[existingKey];
    const entries = Object.entries(cache).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    while (entries.length >= CACHE_ENTRIES) delete cache[entries.shift()![0]];
    cache[key] = { coordinate, expiresAt: now + (coordinate ? 180 : 7) * 24 * 60 * 60 * 1000 };
    await saveOsmCache(options.config.cacheDir, cache, ioSignal());
    return coordinate;
  }
}

const publicVenues = new OsmVenueResolver();
export function resolveOsmLocation(query: string, options: OsmLookupOptions): Promise<MapCoordinate | null> {
  return publicVenues.resolve(query, options);
}
