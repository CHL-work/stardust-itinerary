import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");

try {
  await access(path.join(standaloneRoot, "server.js"));
} catch {
  throw new Error("Standalone build not found. Run `pnpm build` before `pnpm start`.");
}

await mkdir(path.join(standaloneRoot, ".next"), { recursive: true });
await Promise.all([
  cp(path.join(root, ".next", "static"), path.join(standaloneRoot, ".next", "static"), {
    recursive: true,
    force: true,
  }),
  cp(path.join(root, "public"), path.join(standaloneRoot, "public"), {
    recursive: true,
    force: true,
  }),
]);

console.log("Prepared standalone static and public assets.");
