import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

/**
 * Links in an own-key AI request (JOB-070): the server reads the public pages a requester pasted, so
 * the model can use, say, an event page's name, time and place. Only for requests paid by the
 * requester's own key. The page text goes to the model as untrusted data, never as instructions.
 *
 * Fetching is the server's own outbound request, so it is guarded against reaching anything but the
 * public internet: http(s) on ports 80 and 443 only, every resolved address must be public (no
 * loopback, private, link-local, metadata, carrier-grade NAT, multicast or reserved ranges, for IPv4
 * and IPv6 alike), the connection uses exactly the checked address, redirects are followed by hand
 * and checked again, and time, size and content type are bounded.
 */
export const MAX_LINKED_PAGES = 3;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const MAX_TEXT = 6_000;
const MAX_STRUCTURED = 3_000;
const USER_AGENT = "StardustItinerary/0.1 (reads a link a user pasted into their own AI request; +https://github.com/CHL-work/stardust-itinerary)";

export type LinkedPage =
  | { url: string; finalUrl: string; title: string | null; description: string | null; structuredData: string | null; text: string }
  | { url: string; error: "blocked" | "unreachable" | "too_large" | "not_text" | "http_error" };

/** Distinct http(s) links in the request, without trailing punctuation, at most three. */
export function extractLinkedUrls(prompt: string): URL[] {
  const found: URL[] = [];
  for (const match of prompt.matchAll(/https?:\/\/[^\s<>"'`「」『』（）()\[\]{}]+/giu)) {
    const raw = match[0].replace(/[.,;:!?。、，；：！？]+$/u, "");
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    url.hash = "";
    if (!found.some((seen) => seen.href === url.href)) found.push(url);
    if (found.length === MAX_LINKED_PAGES) break;
  }
  return found;
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function publicIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, including the metadata server
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase();
  const zone = value.indexOf("%");
  if (zone >= 0) return null; // scoped (link-local) addresses are never public
  // An embedded IPv4 tail becomes two groups.
  const tail = value.match(/(\d+\.\d+\.\d+\.\d+)$/u);
  if (tail) {
    const parts = ipv4Parts(tail[1]!);
    if (!parts) return null;
    value = value.slice(0, -tail[1]!.length) + `${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function publicIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const [g0, g1, , , , g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses are judged by their IPv4 part.
  if (groups.slice(0, 5).every((group) => group === 0) && g5 === 0xffff) {
    return publicIpv4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  }
  if (g0 === 0x64 && g1 === 0xff9b) return publicIpv4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  // Only global unicast (2000::/3) is public, minus documentation, Teredo, ORCHID and 6to4 of private space.
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && (g1 === 0x0db8 || g1 === 0x0000 || (g1 & 0xfff0) === 0x0010 || (g1 & 0xfff0) === 0x0020)) return false;
  if (g0 === 0x2002) return publicIpv4(`${g1 >> 8}.${g1 & 0xff}.${groups[2]! >> 8}.${groups[2]! & 0xff}`);
  return true;
}

/** Whether an IP address is on the public internet, for IPv4 and IPv6 alike. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? publicIpv4(address) : family === 6 ? publicIpv6(address) : false;
}

class BlockedLink extends Error {}

/** A DNS lookup that only ever answers with public addresses, refusing a name with any other one. */
export function publicLookup(hostname: string, options: { all?: boolean } | number | undefined,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) { callback(error, ""); return; }
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      callback(Object.assign(new BlockedLink("blocked"), { code: "ESTARDUSTBLOCKED" }), "");
      return;
    }
    const wantsAll = typeof options === "object" && options?.all === true;
    if (wantsAll) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

function permitted(url: URL): boolean {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) return false;
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  return isIP(host) ? isPublicAddress(host) : host.includes(".");
}

type Fetched = { status: number; location: string | null; contentType: string; body: Buffer };

function decoded(response: http.IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase().trim();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(createGunzip());
  if (encoding === "deflate") return response.pipe(createInflate());
  if (encoding === "br") return response.pipe(createBrotliDecompress());
  return response;
}

function request(url: URL, signal: AbortSignal): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const outgoing = client.request(url, {
      method: "GET", signal, lookup: publicLookup as never,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "Accept-Encoding": "gzip, deflate, br" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = typeof response.headers.location === "string" ? response.headers.location : null;
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400) { response.resume(); resolve({ status, location, contentType, body: Buffer.alloc(0) }); return; }
      if (status !== 200 || !/^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/u.test(contentType)) {
        response.resume();
        resolve({ status, location: null, contentType, body: Buffer.alloc(0) });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = decoded(response);
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { stream.destroy(); outgoing.destroy(); reject(new Error("too_large")); return; }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve({ status, location: null, contentType, body: Buffer.concat(chunks) }));
      stream.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}|#39);/giu, (entity, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#x")) { const code = Number.parseInt(lower.slice(2), 16); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity; }
    if (lower.startsWith("#")) { const code = Number(lower.slice(1)); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity; }
    return ENTITIES[lower] ?? entity;
  });
}

function clean(value: string, limit: number): string {
  return decodeEntities(value).replace(/\s+/gu, " ").trim().slice(0, limit);
}

function meta(html: string, key: string): string | null {
  // Keys are fixed names such as og:title; only "." needs escaping (":" may not be escaped under /u).
  const pattern = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${key.replace(/\./gu, "\\.")}["'][^>]*>`, "iu");
  const tag = html.match(pattern)?.[0];
  const content = tag?.match(/\bcontent=["']([^"']*)["']/iu)?.[1];
  return content ? clean(content, 600) || null : null;
}

/** Event, place and organizer facts from JSON-LD, the structured data event pages publish. */
function structuredEvents(html: string): string | null {
  const facts: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    let parsed: unknown;
    try { parsed = JSON.parse(match[1]!); } catch { continue; }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length && facts.length < 5) {
      const item = queue.shift() as Record<string, unknown> | null;
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
      const type = String(item["@type"] ?? "");
      if (/Event|Place|Organization|LocalBusiness|Restaurant|Hotel/iu.test(type)) {
        const pick = (value: unknown) => value === undefined ? undefined : value;
        facts.push({
          type, name: pick(item.name), startDate: pick(item.startDate), endDate: pick(item.endDate),
          eventStatus: pick(item.eventStatus), attendanceMode: pick(item.eventAttendanceMode),
          location: pick(item.location), address: pick(item.address), organizer: pick(item.organizer),
          url: pick(item.url), description: typeof item.description === "string" ? item.description.slice(0, 600) : undefined,
        });
      }
    }
  }
  if (!facts.length) return null;
  const text = JSON.stringify(facts);
  return text.length > MAX_STRUCTURED ? `${text.slice(0, MAX_STRUCTURED)}…` : text;
}

/** Title, description, structured event data and readable text of one HTML or text page. */
export function readPage(html: string, contentType: string): { title: string | null; description: string | null; structuredData: string | null; text: string } {
  if (!contentType.includes("html")) return { title: null, description: null, structuredData: null, text: clean(html, MAX_TEXT) };
  const title = meta(html, "og:title") ?? (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ? clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)![1]!, 300) : null);
  const description = meta(html, "og:description") ?? meta(html, "description") ?? meta(html, "twitter:description");
  const text = clean(html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, " "), MAX_TEXT);
  return { title: title || null, description, structuredData: structuredEvents(html), text };
}

/** Read one linked page, following up to three checked redirects. Never throws. */
export async function fetchLinkedPage(url: URL, options: { signal?: AbortSignal; fetchPage?: typeof request } = {}): Promise<LinkedPage> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  const fetchPage = options.fetchPage ?? request;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!permitted(current)) return { url: url.href, error: "blocked" };
    let fetched: Fetched;
    try {
      fetched = await fetchPage(current, signal);
    } catch (error) {
      if (error instanceof BlockedLink || (error as { code?: unknown })?.code === "ESTARDUSTBLOCKED") return { url: url.href, error: "blocked" };
      return { url: url.href, error: error instanceof Error && error.message === "too_large" ? "too_large" : "unreachable" };
    }
    if (fetched.status >= 300 && fetched.status < 400) {
      if (!fetched.location) return { url: url.href, error: "http_error" };
      try { current = new URL(fetched.location, current); } catch { return { url: url.href, error: "http_error" }; }
      continue;
    }
    if (fetched.status !== 200) return { url: url.href, error: "http_error" };
    if (!/^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/u.test(fetched.contentType)) return { url: url.href, error: "not_text" };
    const charset = fetched.contentType.match(/charset=([\w-]+)/u)?.[1]?.toLowerCase();
    let html: string;
    try { html = new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8").decode(fetched.body); }
    catch { html = fetched.body.toString("utf8"); }
    return { url: url.href, finalUrl: current.href, ...readPage(html, fetched.contentType) };
  }
  return { url: url.href, error: "http_error" };
}

/** Read every link in an own-key request at once, each within its own time limit. */
export async function fetchLinkedPages(urls: readonly URL[], signal?: AbortSignal): Promise<LinkedPage[]> {
  return Promise.all(urls.slice(0, MAX_LINKED_PAGES).map((url) => fetchLinkedPage(url, { signal })));
}
