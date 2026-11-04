import { afterEach, describe, expect, it, vi } from "vitest";
import { createDayMapLoader, dayMapDirectionsLink, dayMapLink, dayMapResponseMatches, DayMapRequestError, groupDayMapMarkers, requestDayMap, validDayMapLegs, validMapTileTemplate, visibleDayMapStops, type DayMapRequest, type DayMapResponse, type LocatedDayMapStop } from "./client";
import { chooseMapViewport } from "./geometry";
import type { DayMapStop } from "./day-stops";

const publicStop: DayMapStop = { key: "synthetic:event", number: 1, title: "Synthetic museum", at: "2030-04-01T01:00:00Z", kind: "event", locationName: "Synthetic museum, Tokyo", mapUrl: null, visibility: "trip", pending: false, allDay: false };
const privateStop: DayMapStop = { ...publicStop, key: "private:event", number: 2, title: "Synthetic private appointment", visibility: "private" };
const lastStop: DayMapStop = { ...publicStop, key: "last:event", number: 3, title: "Synthetic return visit" };
const located: LocatedDayMapStop = { ...publicStop, coordinate: { lat: 35.7, lng: 139.7 }, resolution: "located" };
const ready: DayMapResponse = { status: "ready", stops: [located], viewport: chooseMapViewport([located.coordinate!]), imageDataUrl: "data:image/png;base64,aGVsbG8=" };
const input = { tripId: "synthetic-trip", tripDayId: "synthetic-day", includePrivate: false, locale: "en" as const };
const callbacks = () => ({ start: vi.fn(), success: vi.fn(), failure: vi.fn(), complete: vi.fn() });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("daily map client boundaries", () => {
  it("accepts keyless HTTPS raster templates without arbitrary browser requests", () => {
    expect(validMapTileTemplate("https://tile.openstreetmap.org/{z}/{x}/{y}.png")).toBe(true);
    expect(validMapTileTemplate("https://tiles.example.org/osm/{z}/{x}/{y}.webp")).toBe(true);
    for (const url of ["http://tile.openstreetmap.org/{z}/{x}/{y}.png", "https://user:password@tiles.example.org/{z}/{x}/{y}.png", "https://tiles.example.org/{z}/{x}/{y}.png?key=secret", "https://127.0.0.1/{z}/{x}/{y}.png", "https://localhost/{z}/{x}/{y}.png", "https://tiles.internal/{z}/{x}/{y}.png", "https://tiles.example.org/{z}/{x}.png", "https://tiles.example.org/{z}/{x}/{y}/{z}.png", "https://tiles.example.org:8000/{z}/{x}/{y}.png", "javascript:alert(1)"]) expect(validMapTileTemplate(url)).toBe(false);
  });
  it("accepts the OSM renderer with real coordinates and rejects malformed positions or tile endpoints", async () => {
    const result = { ...ready, renderer: "osm", tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", viewport: null, imageDataUrl: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
    expect(await requestDayMap(input, new AbortController().signal)).toEqual(result);
    for (const invalid of [{ ...result, tileUrlTemplate: "http://localhost/tiles/{z}/{x}/{y}" }, { ...result, renderer: "unknown" }, { ...result, imageDataUrl: ready.imageDataUrl }, ...[{ lat: 91, lng: 0 }, { lat: 1, lng: 181 }, { lat: null, lng: 1 }, { lat: "35", lng: 139 }].map(coordinate => ({ ...result, stops: [{ ...located, coordinate }] })), { ...result, stops: [{ ...located, resolution: "missing" }] }, { ...result, stops: [located, located] }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid))));
      await expect(requestDayMap(input, new AbortController().signal)).rejects.toMatchObject({ kind: "unavailable" });
    }
  });
  it("excludes private stops by default without leaving number gaps and restores order only on explicit inclusion", () => {
    const source = [publicStop, privateStop, lastStop];
    expect(visibleDayMapStops(source, false).map(stop => [stop.key, stop.number])).toEqual([[publicStop.key, 1], [lastStop.key, 2]]);
    expect(visibleDayMapStops(source, true)).toEqual(source);
    expect(lastStop.number).toBe(3);
  });
  it("uses only Google HTTPS links without embedded credentials, otherwise a place-only escaped search", () => {
    expect(dayMapLink({ mapUrl: "javascript:alert(1)", locationName: null })).toBeNull();
    expect(dayMapLink({ mapUrl: "https://evil.test/maps", locationName: null })).toBeNull();
    expect(dayMapLink({ mapUrl: "https://secret@www.google.com/maps", locationName: null })).toBeNull();
    expect(dayMapLink({ mapUrl: "https://www.google.com/maps?q=museum", locationName: null })).toBe("https://www.google.com/maps?q=museum");
    expect(dayMapLink({ mapUrl: null, locationName: "Museum & Park" })).toBe("https://www.google.com/maps/search/?api=1&query=Museum%20%26%20Park");
  });
  it("sends only scoped choices, never client place/title/member/Calendar text", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(ready), { status: 200 })); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    expect(await requestDayMap(input, controller.signal)).toEqual(ready);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/trips/synthetic-trip/map");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal });
    expect(JSON.parse(String(options.body))).toEqual({ tripDayId: input.tripDayId, includePrivate: false, locale: "en" });
    expect(JSON.stringify(options)).not.toContain(publicStop.title);
  });
  it.each([[401, "access"], [403, "access"], [409, "changed"], [429, "rate_limited"], [502, "unavailable"]] as const)("maps HTTP %s to neutral %s without exposing upstream text", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Sensitive provider content", { status })));
    await expect(requestDayMap(input, new AbortController().signal)).rejects.toMatchObject({ kind });
  });
  it("rejects a changed server projection and remote/non-PNG image sources", async () => {
    expect(dayMapResponseMatches(ready, [publicStop])).toBe(true);
    for (const stops of [[], [{ ...publicStop, title: "Renamed" }], [{ ...publicStop, visibility: "private" as const }], [{ ...publicStop, pending: true }], [{ ...publicStop, number: 9 }]]) expect(dayMapResponseMatches(ready, stops)).toBe(false);
    for (const imageDataUrl of ["https://maps.googleapis.com/map?key=never", "data:image/svg+xml;base64,aGVsbG8=", "javascript:alert(1)"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...ready, imageDataUrl }))));
      await expect(requestDayMap(input, new AbortController().signal)).rejects.toMatchObject({ kind: "unavailable" });
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...ready, status: "unavailable", reason: "map_changed" }))));
    await expect(requestDayMap(input, new AbortController().signal)).rejects.toMatchObject({ kind: "changed" });
  });
  it("strips image and viewport from non-ready results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...ready, status: "not_configured" }))));
    expect(await requestDayMap(input, new AbortController().signal)).toMatchObject({ status: "not_configured", viewport: null, imageDataUrl: null });
  });
  it("distinguishes active map work from an exhausted retry quota", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...ready, status: "rate_limited", reason: "map_busy" }))));
    await expect(requestDayMap(input, new AbortController().signal)).rejects.toMatchObject({ kind: "busy" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...ready, status: "rate_limited", reason: "map_rate_limited" }))));
    expect(await requestDayMap(input, new AbortController().signal)).toMatchObject({ status: "rate_limited", reason: "map_rate_limited" });
  });
  it("groups repeated/nearby visits without dropping their original numbers", () => {
    const visits: LocatedDayMapStop[] = [located, { ...located, key: lastStop.key, number: 3 }, { ...located, key: "near", number: 4, pending: true, coordinate: { lat: 35.70001, lng: 139.70001 } }, { ...located, key: "missing", number: 2, resolution: "missing", coordinate: null }];
    const groups = groupDayMapMarkers(visits, ready.viewport!, 280);
    expect(groups).toHaveLength(1); expect(groups[0].stops.map(stop => stop.number)).toEqual([1, 3, 4]);
    expect(groups[0].xPercent).toBeGreaterThan(0); expect(groups[0].yPercent).toBeLessThan(84);
  });
});

describe("map-only journey data and Google handoff", () => {
  const second: LocatedDayMapStop = { ...located, key: "second:event", number: 2, locationName: "Park & café 日本", coordinate: { lat: 35.71, lng: 139.72 } };
  const third: LocatedDayMapStop = { ...located, key: "third:event", number: 3 };
  const stops = [located, second, third];
  const leg = { fromKey: located.key, toKey: second.key, walking: { seconds: 540, meters: 650 }, driving: { seconds: 420, meters: 1200 } };

  it("keeps one exact adjacent leg and no mode, waypoints or inferred current location in Google's URL", () => {
    const url = new URL(dayMapDirectionsLink(located, second)!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe(located.locationName);
    expect(url.searchParams.get("destination")).toBe(second.locationName);
    for (const key of ["travelmode", "waypoints", "dir_action", "key"]) expect(url.searchParams.has(key)).toBe(false);
    expect(url.href).not.toContain(located.title);
  });
  it("retains a documented exact query/place ID, never camera positions or unsafe URLs", () => {
    const from = { ...located, mapUrl: "https://www.google.com/maps/search/?api=1&query=Station%20A&query_place_id=ChIJ_example" };
    const url = new URL(dayMapDirectionsLink(from, second)!);
    expect(url.searchParams.get("origin")).toBe("Station A");
    expect(url.searchParams.get("origin_place_id")).toBe("ChIJ_example");
    const unknown = { ...located, locationName: null, coordinate: null, resolution: "unresolved" as const };
    for (const mapUrl of ["https://evil.test/maps?q=wrong", "https://www.google.com/maps/@35,139,10z", "https://maps.app.goo.gl/short", "javascript:alert(1)"]) {
      expect(dayMapDirectionsLink({ ...unknown, mapUrl }, second)).toBeNull();
    }
    const pair = new URL(dayMapDirectionsLink({ ...located, locationName: null, mapUrl: null }, second)!);
    expect(pair.searchParams.get("origin")).toBe("35.7,139.7");
  });
  it("does not infer a missing origin from the event title or send excessively long URLs", () => {
    expect(dayMapDirectionsLink({ ...located, locationName: null, coordinate: null, mapUrl: null }, second)).toBeNull();
    expect(dayMapDirectionsLink({ ...located, locationName: "旅".repeat(300) }, { ...second, locationName: "程".repeat(300) })).toBeNull();
  });
  it("accepts only sourced numeric fields; empty estimates stay unknown", () => {
    expect(validDayMapLegs([leg], stops)).toBe(true);
    expect(validDayMapLegs([], stops)).toBe(true);
    expect(validDayMapLegs([{ fromKey: located.key, toKey: second.key }], stops)).toBe(true);
    for (const walking of [null, { seconds: -1, meters: 1 }, { seconds: Infinity, meters: 1 }, { seconds: NaN, meters: 1 }, { seconds: "540", meters: 1 }, { seconds: 540 }, { seconds: 540, meters: -1 }, { seconds: 540, meters: 1, live: true }, { seconds: 30 * 86400 + 1, meters: 1 }]) {
      expect(validDayMapLegs([{ ...leg, walking }], stops)).toBe(false);
    }
  });
  it("rejects skipped/unseen, duplicate, backwards and self-referential journey data", () => {
    for (const legs of [[{ ...leg, toKey: third.key }], [{ ...leg, fromKey: second.key, toKey: located.key }], [{ ...leg, toKey: located.key }], [{ ...leg, fromKey: "private:hidden" }], [leg, leg], [{ ...leg, extra: "untrusted" }]]) {
      expect(validDayMapLegs(legs, stops)).toBe(false);
    }
  });
  it("checks optional journey data before returning a ready response and strips it on failure", async () => {
    const data = { ...ready, stops, legs: [leg] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    expect((await requestDayMap(input, new AbortController().signal)).legs).toEqual([leg]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...data, legs: [{ ...leg, toKey: third.key }] }))));
    await expect(requestDayMap(input, new AbortController().signal)).rejects.toMatchObject({ kind: "unavailable" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...data, status: "unavailable" }))));
    expect((await requestDayMap(input, new AbortController().signal)).legs).toEqual([]);
  });
});

describe("explicit daily map request lifetime", () => {
  it("performs no work at creation; starts once even with double clicks", async () => {
    let resolve!: (data: DayMapResponse) => void;
    const request = vi.fn(() => new Promise<DayMapResponse>(done => { resolve = done; }));
    const loader = createDayMapLoader(request); const events = callbacks(); expect(request).not.toHaveBeenCalled();
    const run = loader.load(input, events); await loader.load(input, events); expect(request).toHaveBeenCalledOnce();
    resolve(ready); await run; expect(events.success).toHaveBeenCalledWith(ready); expect(events.complete).toHaveBeenCalledOnce();
  });
  it.each(["close", "consent change", "unmount/context change"])("aborts and ignores completion after %s without starting another provider request", async () => {
    let resolve!: (data: DayMapResponse) => void;
    const request = vi.fn<(input: DayMapRequest, signal: AbortSignal) => Promise<DayMapResponse>>(() => new Promise<DayMapResponse>(done => { resolve = done; }));
    const loader = createDayMapLoader(request); const events = callbacks();
    const run = loader.load(input, events); const signal = request.mock.calls[0][1]; loader.cancel();
    expect(signal.aborted).toBe(true); resolve(ready); await run;
    expect(events.success).not.toHaveBeenCalled(); expect(events.failure).not.toHaveBeenCalled(); expect(events.complete).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledOnce();
  });
  it("ignores stale responses after a later explicit private-choice request", async () => {
    const resolvers: Array<(data: DayMapResponse) => void> = [];
    const request = vi.fn(() => new Promise<DayMapResponse>(resolve => { resolvers.push(resolve); }));
    const loader = createDayMapLoader(request); const previous = callbacks(); const next = callbacks();
    const first = loader.load(input, previous); loader.cancel(); const second = loader.load({ ...input, includePrivate: true }, next);
    resolvers[1](ready); await second; resolvers[0](ready); await first;
    expect(previous.success).not.toHaveBeenCalled(); expect(next.success).toHaveBeenCalledWith(ready); expect(request).toHaveBeenCalledTimes(2);
  });
  it("times out at 35 seconds even if a provider ignores abort, without retries", async () => {
    vi.useFakeTimers();
    const request = vi.fn<(input: DayMapRequest, signal: AbortSignal) => Promise<DayMapResponse>>(() => new Promise<DayMapResponse>(() => undefined));
    const loader = createDayMapLoader(request); const events = callbacks(); const run = loader.load(input, events);
    await vi.advanceTimersByTimeAsync(34_999); expect(events.failure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await run;
    expect(request.mock.calls[0][1].aborted).toBe(true); expect(events.failure).toHaveBeenCalledWith("timeout"); expect(events.complete).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120_000); expect(request).toHaveBeenCalledOnce();
  });
  it("keeps safe access failures and offline failures separate", async () => {
    const denied = callbacks(); await createDayMapLoader(vi.fn().mockRejectedValue(new DayMapRequestError("access"))).load(input, denied); expect(denied.failure).toHaveBeenCalledWith("access");
    vi.stubGlobal("navigator", { onLine: false }); const offline = callbacks();
    await createDayMapLoader(vi.fn().mockRejectedValue(new Error("Sensitive upstream text"))).load(input, offline); expect(offline.failure).toHaveBeenCalledWith("offline");
  });
});
