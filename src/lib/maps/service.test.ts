import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapSource } from "./day-stops";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), image: vi.fn(), osm: vi.fn(), route: vi.fn() }));
vi.mock("./google", async (original) => ({ ...await original<typeof import("./google")>(), resolveGoogleLocation: mocks.resolve, fetchGoogleMapImage: mocks.image }));
vi.mock("./osm", async (original) => ({ ...await original<typeof import("./osm")>(), resolveOsmLocation: mocks.osm }));
vi.mock("./osm-routing", async (original) => ({ ...await original<typeof import("./osm-routing")>(), resolveOsmRoute: mocks.route }));
import { OsmLookupLimit } from "./osm";
import { dayMapInput, generateDayMap } from "./service";

const dayId = "10000000-0000-4000-8000-000000000001";
const input = { tripDayId: dayId, locale: "en", includePrivate: false } as const;
const config = { apiKey: "synthetic-key" };
let testNow = 1_000_000;
function item(overrides: Partial<MapSource> = {}): MapSource {
  return { id: "synthetic-event", tripDayId: dayId, title: "PRIVATE BOOKING TITLE", itemType: "activity", status: "confirmed", startsAt: "2026-09-27T10:00:00Z", endsAt: null, locationName: "Synthetic Museum Tokyo", mapUrl: null, visibility: "trip", ...overrides };
}
function overview(items = [item()]): Record<string, unknown> {
  return { trip: { id: "trip", timeZone: "UTC" }, days: [{ id: dayId, date: "2026-09-27" }], itinerary: items, pendingItinerary: [], personalCalendar: [{ title: "RAW PRIVATE CALENDAR", locationName: "never sent" }] };
}
function run(data = overview(), options: { userId?: string; loadOverview?: () => Promise<Record<string, unknown>>; includePrivate?: boolean; now?: () => number; bypassRequestQuota?: boolean } = {}) {
  const loadOverview = options.loadOverview ?? vi.fn().mockResolvedValue(data);
  return generateDayMap({ userId: options.userId ?? randomUUID(), input: { ...input, includePrivate: options.includePrivate ?? false }, loadOverview, bypassRequestQuota: options.bypassRequestQuota }, { config, now: options.now ?? (() => testNow) });
}

describe("daily map orchestration", () => {
  beforeEach(() => { testNow += 120_000; vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ lat: 35, lng: 139 }); mocks.image.mockResolvedValue("data:image/png;base64,synthetic"); mocks.osm.mockResolvedValue({ lat: 35, lng: 139 }); mocks.route.mockResolvedValue({ seconds: 120, meters: 1000 }); });

  it("uses strict UUID/locale/private input with opt-in off by default", () => {
    expect(dayMapInput.parse({ tripDayId: dayId, locale: "en" }).includePrivate).toBe(false);
    for (const bad of [{ ...input, tripDayId: "day" }, { ...input, locale: "ko-KR" }, { ...input, includePrivate: "true" }, { ...input, location: "injected" }]) expect(dayMapInput.safeParse(bad).success).toBe(false);
  });

  it("does no provider work without configuration", async () => {
    const loadOverview = vi.fn().mockResolvedValue(overview());
    const result = await generateDayMap({ userId: randomUUID(), input, loadOverview }, { config: null });
    expect(result).toMatchObject({ status: "not_configured", reason: "map_not_configured", viewport: null, imageDataUrl: null });
    expect(result.stops[0].coordinate).toBeNull(); expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });

  it("cannot spend map credits just because an environment credential exists", async () => {
    vi.stubEnv("STARDUST_GOOGLE_MAPS_API_KEY", "synthetic-key");
    vi.stubEnv("STARDUST_MAPS_ALLOW_METERED", "false");
    try {
      const result = await generateDayMap({ userId: randomUUID(), input, loadOverview: vi.fn().mockResolvedValue(overview()) }, { now: () => testNow });
      expect(result.status).toBe("ready"); expect(result.renderer).toBe("osm"); expect(result.imageDataUrl).toBeNull();
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.image).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("defaults to OSM even with metered permission and Google credentials present", async () => {
    vi.stubEnv("STARDUST_GOOGLE_MAPS_API_KEY", "synthetic-key"); vi.stubEnv("STARDUST_MAPS_ALLOW_METERED", "true");
    try {
      const result = await generateDayMap({ userId: randomUUID(), input, loadOverview: vi.fn().mockResolvedValue(overview()) }, { now: () => testNow });
      expect(result.renderer).toBe("osm"); expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("plots exact saved coordinates without a provider and keeps world spans in the interactive renderer", async () => {
    const loadOverview = vi.fn().mockResolvedValue(overview([item({ locationName: "85,0" }), item({ id: "south", locationName: "-85,0" })]));
    const result = await generateDayMap({ userId: randomUUID(), input, loadOverview }, { osmConfig: null, routingConfig: null, now: () => testNow });
    expect(result).toMatchObject({ status: "ready", renderer: "osm", viewport: null, imageDataUrl: null, legs: [] });
    expect(result.stops.every((stop) => stop.resolution === "located")).toBe(true);
    expect(mocks.osm).not.toHaveBeenCalled(); expect(mocks.route).not.toHaveBeenCalled(); expect(loadOverview).toHaveBeenCalledTimes(2);
  });

  it("looks up and routes included private stops without caching them, and never sends private wording or titles", async () => {
    const loadOverview = vi.fn().mockResolvedValue(overview([
      item({ id: "public", locationName: "35,139", startsAt: "2026-09-27T09:00:00Z" }),
      item({ id: "private-coordinate", visibility: "private", locationName: "35.1,139.1", startsAt: "2026-09-27T10:00:00Z" }),
      item({ id: "private-venue", visibility: "private", locationName: "Synthetic Harbour Hotel, 1 Example Street, Example City", startsAt: "2026-09-27T11:00:00Z" }),
      item({ id: "private-text", visibility: "private", locationName: "Secret private address", startsAt: "2026-09-27T12:00:00Z" }),
    ]));
    const result = await generateDayMap({ userId: randomUUID(), input: { ...input, includePrivate: true }, loadOverview }, { now: () => testNow });
    expect(result.stops).toHaveLength(4); expect(result.stops.filter((stop) => stop.coordinate)).toHaveLength(3);
    expect(mocks.osm.mock.calls.map((call) => [call[0], call[1].persist])).toEqual([["Synthetic Harbour Hotel, 1 Example Street, Example City", false]]);
    expect(mocks.route).toHaveBeenCalledTimes(4); expect(mocks.route.mock.calls.every((call) => call[3].persist === false)).toBe(true);
    expect(result.legs?.map((leg) => [leg.fromKey, leg.toKey])).toEqual([["public:event", "private-coordinate:event"], ["private-coordinate:event", "private-venue:event"]]);
    expect(JSON.stringify([mocks.osm.mock.calls, mocks.route.mock.calls])).not.toContain("PRIVATE BOOKING TITLE");
  });

  it("leaves private stops out of every lookup when the viewer turns them off", async () => {
    const result = await run(overview([item({ id: "private-venue", visibility: "private", locationName: "Synthetic Harbour Hotel, Example City" })]), { includePrivate: false });
    expect(result.stops).toEqual([]); expect(mocks.osm).not.toHaveBeenCalled(); expect(mocks.route).not.toHaveBeenCalled();
  });

  it("binds walk/drive estimates only to consecutive known public endpoints without transit guesses", async () => {
    const loadOverview = vi.fn().mockResolvedValue(overview([item({ id: "a", locationName: "35,139" }), item({ id: "b", locationName: "35.1,139.1" }), item({ id: "c", locationName: null }), item({ id: "d", locationName: "35.2,139.2" })]));
    const result = await generateDayMap({ userId: randomUUID(), input, loadOverview }, { now: () => testNow });
    expect(result.legs).toEqual([{ fromKey: "a:event", toKey: "b:event", walking: { seconds: 120, meters: 1000 }, driving: { seconds: 120, meters: 1000 } }]);
    expect(mocks.route).toHaveBeenCalledTimes(2); expect(mocks.route.mock.calls.every((call) => call[3].persist === true)).toBe(true);
    expect(JSON.stringify(mocks.route.mock.calls)).not.toContain("PRIVATE BOOKING TITLE");
  });

  it("can use the separately saved public venue name when a saved full search is unresolved", async () => {
    mocks.osm.mockImplementation(async (query) => query === "Synthetic Museum" ? { lat: 35, lng: 139 } : null);
    const loadOverview = vi.fn().mockResolvedValue(overview([item({ locationName: "Synthetic Museum", mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic+Museum+full+address" })]));
    const result = await generateDayMap({ userId: randomUUID(), input, loadOverview }, { now: () => testNow });
    expect(result.stops[0].resolution).toBe("located");
    expect(mocks.osm.mock.calls.map((call) => call[0])).toEqual(["Synthetic Museum full address", "Synthetic Museum"]);
  });

  it.each([false, true])("bounds new lookups and route mode misses even with operator exemption %s", async (bypassRequestQuota) => {
    mocks.osm.mockImplementation(async (_query, options) => { if (!options.allowLookup()) throw new OsmLookupLimit(); return { lat: 35, lng: 139 }; });
    mocks.route.mockImplementation(async (_from, _to, _mode, options) => { if (!options.allowLookup()) throw new OsmLookupLimit(); return { seconds: 120, meters: 1000 }; });
    const loadOverview = vi.fn().mockResolvedValue(overview(Array.from({ length: 10 }, (_, index) => item({ id: `item-${index}`, locationName: `Synthetic Museum ${index}` }))));
    const result = await generateDayMap({ userId: randomUUID(), input, loadOverview, bypassRequestQuota }, { now: () => testNow });
    expect(result.stops.filter((stop) => stop.resolution === "located")).toHaveLength(6);
    expect(result.stops.filter((stop) => stop.resolution === "limit")).toHaveLength(4); expect(result.legs).toHaveLength(4);
  });

  it("keeps OSM basemap and known positions after partial provider failures without inventing times", async () => {
    mocks.osm.mockRejectedValue(new Error("provider secret")); mocks.route.mockRejectedValue(new Error("provider secret"));
    const loadOverview = vi.fn().mockResolvedValue(overview([item({ id: "a", locationName: "35,139" }), item({ id: "b", locationName: "35.1,139.1" }), item({ id: "c" })]));
    const result = await generateDayMap({ userId: randomUUID(), input, loadOverview }, { now: () => testNow });
    expect(result.status).toBe("ready"); expect(result.legs).toEqual([]); expect(result.stops.filter((stop) => stop.coordinate)).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("provider secret");
  });

  it("discards OSM results after an audience change", async () => {
    const loadOverview = vi.fn().mockResolvedValueOnce(overview()).mockResolvedValueOnce(overview([]));
    expect(await generateDayMap({ userId: randomUUID(), input, loadOverview }, { now: () => testNow })).toEqual({ status: "unavailable", reason: "map_changed", stops: [], viewport: null, imageDataUrl: null });
  });

  it("reserves the current authorization read and returns partial positions after an OSM deadline", async () => {
    vi.useFakeTimers();
    try {
      mocks.osm.mockImplementation(() => new Promise(() => {}));
      const loadOverview = vi.fn().mockResolvedValue(overview([item({ id: "saved", locationName: "35,139" }), item({ id: "unresolved" })]));
      const pending = generateDayMap({ userId: randomUUID(), input, loadOverview }, { now: () => testNow });
      await vi.advanceTimersByTimeAsync(16_001);
      const result = await pending;
      expect(result.status).toBe("ready"); expect(result.stops.filter((stop) => stop.coordinate)).toHaveLength(1);
      expect(loadOverview).toHaveBeenCalledTimes(2); expect(mocks.route).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("does not expose a malformed tile override or call a provider with it", async () => {
    vi.stubEnv("STARDUST_MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png?key=secret");
    try {
      const result = await generateDayMap({ userId: randomUUID(), input, loadOverview: vi.fn().mockResolvedValue(overview()) }, { now: () => testNow });
      expect(result.status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("secret"); expect(mocks.osm).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("sends only projected public location inputs, deduplicates visits and checks fresh authorization", async () => {
    const loadOverview = vi.fn().mockResolvedValue(overview([item(), item({ id: "second" }), item({ id: "private", visibility: "private", locationName: "Private Home" })]));
    const result = await run(undefined, { loadOverview });
    expect(result.status).toBe("ready"); expect(result.stops).toHaveLength(2); expect(loadOverview).toHaveBeenCalledTimes(2);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][0]).toEqual({ kind: "query", query: "Synthetic Museum Tokyo" });
    expect(JSON.stringify(mocks.resolve.mock.calls)).not.toContain("PRIVATE BOOKING TITLE");
    expect(JSON.stringify(mocks.resolve.mock.calls)).not.toContain("RAW PRIVATE CALENDAR");
  });

  it("includes private locations only on explicit opt-in and retains none across requests", async () => {
    const data = overview([item({ visibility: "private" })]);
    expect((await run(data)).stops).toHaveLength(0);
    expect((await run(data, { includePrivate: true })).stops).toHaveLength(1);
    expect((await run(data, { includePrivate: true })).stops).toHaveLength(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("rejects nonexistent or foreign trip days before provider work", async () => {
    await expect(run({ ...overview(), days: [] })).rejects.toThrow("map_invalid_day");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("returns no old payload after an edited, removed, or newly private day projection", async () => {
    const loadOverview = vi.fn().mockResolvedValueOnce(overview()).mockResolvedValueOnce(overview([item({ visibility: "private" })]));
    expect(await run(undefined, { loadOverview })).toEqual({ status: "unavailable", reason: "map_changed", stops: [], viewport: null, imageDataUrl: null });
  });

  it("propagates revoked authentication from the fresh read instead of returning an image", async () => {
    const loadOverview = vi.fn().mockResolvedValueOnce(overview()).mockRejectedValueOnce(new Error("revoked"));
    await expect(run(undefined, { loadOverview })).rejects.toThrow("revoked");
  });

  it("never returns geocoded positions without a successful Google map image", async () => {
    mocks.image.mockRejectedValue(new Error("secret provider diagnostic"));
    const result = await run();
    expect(result.status).toBe("unavailable"); expect(result.viewport).toBeNull(); expect(result.imageDataUrl).toBeNull();
    expect(result.stops.every((stop) => stop.coordinate === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret provider diagnostic");
  });

  it("bounds unique provider lookups at 24, maintains repeat visits, and runs at most two concurrently", async () => {
    let active = 0; let peak = 0;
    mocks.resolve.mockImplementation(async () => { active++; peak = Math.max(active, peak); await Promise.resolve(); active--; return { lat: 35, lng: 139 }; });
    const result = await run(overview(Array.from({ length: 30 }, (_, n) => item({ id: `item-${n}`, locationName: `Museum ${n}` }))));
    expect(mocks.resolve).toHaveBeenCalledTimes(24); expect(peak).toBe(2);
    expect(result.stops.filter((stop) => stop.resolution === "limit")).toHaveLength(6);
  });

  it("labels missing and unresolved places without invented fallback pins", async () => {
    mocks.resolve.mockResolvedValue(null);
    const result = await run(overview([item(), item({ id: "missing", locationName: null })]));
    expect(result).toMatchObject({ status: "ready", reason: "map_no_locations", viewport: null, imageDataUrl: null });
    expect(result.stops.map((stop) => stop.resolution).sort()).toEqual(["missing", "unresolved"]);
    expect(mocks.image).not.toHaveBeenCalled();
  });

  it("clears coordinates and reports unavailable when valid locations cannot fit a safe Google viewport", async () => {
    const result = await run(overview([
      item({ id: "north", locationName: "85,0" }),
      item({ id: "south", locationName: "-85,0" }),
    ]));
    expect(result).toMatchObject({ status: "unavailable", reason: "map_unavailable", viewport: null, imageDataUrl: null });
    expect(result.stops).toHaveLength(2);
    expect(result.stops.every((stop) => stop.coordinate === null)).toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.image).not.toHaveBeenCalled();
  });

  it("marks provider failure safely and releases the user concurrency slot", async () => {
    const userId = randomUUID(); mocks.resolve.mockRejectedValue(new Error("private raw provider"));
    expect((await run(undefined, { userId })).status).toBe("unavailable");
    mocks.resolve.mockResolvedValue({ lat: 35, lng: 139 });
    expect((await run(undefined, { userId })).status).toBe("ready");
  });

  it("caps one user's simultaneous requests without affecting another user", async () => {
    let unblock: (value: { lat: number; lng: number }) => void = () => {};
    mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { unblock = resolve; }));
    const userId = randomUUID(); const first = run(undefined, { userId });
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalled());
    expect((await run(undefined, { userId })).status).toBe("rate_limited");
    expect((await run()).status).toBe("ready");
    unblock({ lat: 35, lng: 139 }); expect((await first).status).toBe("ready");
  });

  it("caps four requests per user/minute and expires admission timestamps", async () => {
    const userId = randomUUID();
    for (let n = 0; n < 4; n++) expect((await run(undefined, { userId })).status).toBe("ready");
    expect((await run(undefined, { userId })).status).toBe("rate_limited");
    testNow += 60_001;
    expect((await run(undefined, { userId })).status).toBe("ready");
  });

  it("allows unlimited sequential operator retries without consuming member quotas", async () => {
    const userId = randomUUID();
    for (let n = 0; n < 40; n++) expect((await run(undefined, { userId, bypassRequestQuota: true })).status).toBe("ready");
    const memberId = randomUUID();
    for (let n = 0; n < 4; n++) expect((await run(undefined, { userId: memberId })).status).toBe("ready");
    expect(await run(undefined, { userId: memberId })).toMatchObject({ status: "rate_limited", reason: "map_rate_limited" });
  });

  it("does not apply the shared rolling application quota to the verified operator", async () => {
    for (let n = 0; n < 30; n++) expect((await run()).status).toBe("ready");
    expect((await run()).reason).toBe("map_rate_limited");
    expect((await run(undefined, { bypassRequestQuota: true })).status).toBe("ready");
  });

  it("does not retain an operator exemption after server authorization stops granting it", async () => {
    const userId = randomUUID();
    for (let n = 0; n < 8; n++) expect((await run(undefined, { userId, bypassRequestQuota: true })).status).toBe("ready");
    for (let n = 0; n < 4; n++) expect((await run(undefined, { userId })).status).toBe("ready");
    expect((await run(undefined, { userId })).reason).toBe("map_rate_limited");
  });

  it("retains duplicate-work and global active-work bounds for the operator, with an honest busy reason", async () => {
    const unblock: Array<(point: { lat: number; lng: number }) => void> = [];
    mocks.resolve.mockImplementation(() => new Promise((resolve) => { unblock.push(resolve); }));
    const userId = randomUUID();
    const first = run(undefined, { userId, bypassRequestQuota: true });
    await vi.waitFor(() => expect(unblock).toHaveLength(1));
    expect(await run(undefined, { userId, bypassRequestQuota: true })).toMatchObject({ status: "rate_limited", reason: "map_busy" });
    const rest = Array.from({ length: 3 }, () => run());
    await vi.waitFor(() => expect(unblock).toHaveLength(4));
    expect(await run(undefined, { bypassRequestQuota: true })).toMatchObject({ status: "rate_limited", reason: "map_busy" });
    unblock.forEach(resolve => resolve({ lat: 35, lng: 139 }));
    await Promise.all([first, ...rest]);
  });

  it("caps four global active requests and thirty requests per process/minute", async () => {
    const unblock: Array<(point: { lat: number; lng: number }) => void> = [];
    mocks.resolve.mockImplementation(() => new Promise((resolve) => { unblock.push(resolve); }));
    const active = Array.from({ length: 4 }, () => run());
    await vi.waitFor(() => expect(unblock).toHaveLength(4));
    expect((await run()).status).toBe("rate_limited");
    unblock.forEach((resolve) => resolve({ lat: 35, lng: 139 })); await Promise.all(active);
    mocks.resolve.mockResolvedValue({ lat: 35, lng: 139 });
    for (let n = 0; n < 26; n++) expect((await run()).status).toBe("ready");
    expect((await run()).status).toBe("rate_limited");
  });

  it("bounds a stalled provider image and returns no stale payload at the total deadline", async () => {
    vi.useFakeTimers();
    try {
      mocks.image.mockImplementation(() => new Promise(() => {}));
      const pending = run();
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await pending).toEqual({ status: "unavailable", reason: "map_unavailable", stops: [], viewport: null, imageDataUrl: null });
    } finally { vi.useRealTimers(); }
  });

  it("bounds a stalled final authorization read within the same total deadline", async () => {
    vi.useFakeTimers();
    try {
      const loadOverview = vi.fn().mockResolvedValueOnce(overview()).mockImplementationOnce(() => new Promise(() => {}));
      const pending = run(undefined, { loadOverview });
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await pending).stops).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
