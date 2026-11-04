import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  mocks.rename.mockImplementation(actual.rename);
  return { ...actual, rename: mocks.rename };
});
import { OsmVenueResolver } from "./osm";
import { OsmRouteResolver } from "./osm-routing";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("durable public cache publication fence", () => {
  it.each(["venues", "routes"] as const)("holds the %s queue through an aborted but still-settling rename", async (kind) => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    mocks.rename.mockClear();
    const cacheDir = await mkdtemp(join(tmpdir(), "stardust-cache-fence-")); directories.push(cacheDir);
    let finishRename: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishRename = resolve; });
    mocks.rename.mockImplementationOnce(async (...args: Parameters<typeof actual.rename>) => { await gate; return actual.rename(...args); });
    const controller = new AbortController(); let now = 1_000_000;
    const venueResolver = new OsmVenueResolver(() => now), routeResolver = new OsmRouteResolver(() => now);
    const fetcher = vi.fn(async (url: URL) => {
      now += 1001;
      return kind === "venues"
        ? Response.json({ features: [{ geometry: { type: "Point", coordinates: [139, 35] }, properties: { name: url.searchParams.get("q"), osm_key: "tourism", osm_value: "museum" } }] })
        : Response.json({ code: "Ok", routes: [{ duration: 120, distance: 1000 }], waypoints: [{ distance: 0 }, { distance: 0 }] });
    });
    const resolve = (index: number, signal: AbortSignal) => kind === "venues"
      ? venueResolver.resolve(`Synthetic Museum ${index}`, { config: { cacheDir, endpoint: "https://photon.komoot.io/api/" }, signal, fetch: fetcher as unknown as typeof fetch })
      : routeResolver.resolve({ lat: 35, lng: 139 }, { lat: 35.01 + index / 100, lng: 139.01 }, "walking", { config: { cacheDir, endpoint: "https://routing.openstreetmap.de/" }, signal, fetch: fetcher as unknown as typeof fetch });
    const first = resolve(1, controller.signal);
    await vi.waitFor(() => expect(mocks.rename).toHaveBeenCalledTimes(1));
    controller.abort(); await expect(first).rejects.toThrow("map_unavailable");
    const second = resolve(2, new AbortController().signal);
    await new Promise((done) => setTimeout(done, 20));
    expect(fetcher).toHaveBeenCalledTimes(1);
    finishRename();
    expect(await second).not.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
    const cache = JSON.parse(await readFile(join(cacheDir, `public-${kind}-v1.json`), "utf8"));
    expect(Object.keys(cache)).toHaveLength(2);
  });
});
