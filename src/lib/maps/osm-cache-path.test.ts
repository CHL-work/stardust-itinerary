import { afterEach, describe, expect, it, vi } from "vitest";
import { osmCacheDirectory } from "./osm-cache-path";
import { getOsmMapsConfig } from "./osm";
import { getOsmRoutingConfig } from "./osm-routing";

afterEach(() => { vi.restoreAllMocks(); });

describe("persistent public-map cache directory", () => {
  it.each([
    "C:\\Code\\stardust-itinerary",
    "C:\\Code\\stardust-itinerary\\.next\\standalone",
    "C:/Code/stardust-itinerary/.next/standalone/",
    "C:\\Code\\stardust-itinerary\\.NEXT\\STANDALONE",
    "C:\\Code\\stardust-daily-map",
  ])("keeps Windows runtime %s outside the replaceable build", (cwd) => {
    expect(osmCacheDirectory({}, cwd)).toBe("C:\\Code\\.local\\day-map-cache");
  });

  it.each(["/srv/stardust", "/srv/stardust/.next/standalone", "/srv/stardust/.next/standalone/"])("supports the same repository/standalone contract on POSIX: %s", (cwd) => {
    expect(osmCacheDirectory({}, cwd)).toBe("/srv/.local/day-map-cache");
  });

  it("recognizes only the exact adjacent .next/standalone directory components", () => {
    expect(osmCacheDirectory({}, "C:\\Code\\app\\standalone")).toBe("C:\\Code\\app\\.local\\day-map-cache");
    expect(osmCacheDirectory({}, "C:\\Code\\app\\.next\\standalone-other")).toBe("C:\\Code\\app\\.next\\.local\\day-map-cache");
    expect(osmCacheDirectory({}, "/srv/app/.NEXT/standalone")).toBe("/srv/app/.NEXT/.local/day-map-cache");
  });

  it("supports UNC repositories and explicit absolute operator overrides", () => {
    expect(osmCacheDirectory({}, "\\\\server\\share\\app\\.next\\standalone")).toBe("\\\\server\\share\\.local\\day-map-cache");
    expect(osmCacheDirectory({ STARDUST_MAP_CACHE_DIR: " D:/Persistent/maps " }, "C:\\Code\\app\\.next\\standalone")).toBe("D:\\Persistent\\maps");
    expect(osmCacheDirectory({ STARDUST_MAP_CACHE_DIR: "/var/cache/stardust" }, "/srv/app/.next/standalone")).toBe("/var/cache/stardust");
  });

  it("rejects relative or drive-relative overrides instead of putting caches in the build", () => {
    for (const value of ["cache", ".local/cache", "C:cache", "\\cache"]) expect(osmCacheDirectory({ STARDUST_MAP_CACHE_DIR: value }, "C:\\Code\\app\\.next\\standalone")).toBeNull();
    expect(osmCacheDirectory({ STARDUST_MAP_CACHE_DIR: "cache" }, "/srv/app/.next/standalone")).toBeNull();
    expect(osmCacheDirectory({}, "relative/app")).toBeNull();
  });

  it("uses the shared persistent root for both provider configurations after standalone chdir", () => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\Code\\stardust-itinerary\\.next\\standalone");
    expect(getOsmMapsConfig({})?.cacheDir).toBe("C:\\Code\\.local\\day-map-cache");
    expect(getOsmRoutingConfig({})?.cacheDir).toBe("C:\\Code\\.local\\day-map-cache");
  });
});
