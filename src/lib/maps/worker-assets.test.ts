import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bundled MapLibre worker deployment", () => {
  it("prepares official version-matched worker/shared assets before dev and build", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.predev).toBe("node scripts/prepare-map-assets.mjs");
    expect(pkg.scripts.prebuild).toBe(pkg.scripts.predev);
    const source = readFileSync("scripts/prepare-map-assets.mjs", "utf8");
    expect(source).toContain('installed.version !== app.dependencies["maplibre-gl"]');
    expect(source).toContain('"maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"');
    expect(source).toContain('"LICENSE.txt"');
    expect(source).not.toMatch(/fetch\(|https:\/\//u);
    expect(readFileSync(".gitignore", "utf8")).toContain("public/vendor/maplibre/");
    expect(readFileSync("scripts/prepare-standalone.mjs", "utf8")).toContain('path.join(root, "public")');
  });
});
