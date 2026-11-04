// MapLibre 6's ESM worker imports its sibling shared module. Bundler chunk names
// break that default relative URL, so serve the pinned official pair locally.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageFile = fileURLToPath(import.meta.resolve("maplibre-gl/package.json"));
const installed = JSON.parse(await readFile(packageFile, "utf8"));
const app = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (installed.version !== app.dependencies["maplibre-gl"] || !/^\d+\.\d+\.\d+$/u.test(installed.version)) {
  throw new Error("MapLibre assets must match the exact installed application dependency.");
}
const source = path.dirname(packageFile);
const destination = path.join(root, "public", "vendor", "maplibre", installed.version);
await mkdir(destination, { recursive: true });
await Promise.all([
  ...["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"].map(name => copyFile(path.join(source, "dist", name), path.join(destination, name))),
  copyFile(path.join(source, "LICENSE.txt"), path.join(destination, "LICENSE.txt")),
]);
console.log(`Prepared local MapLibre ${installed.version} worker assets.`);
