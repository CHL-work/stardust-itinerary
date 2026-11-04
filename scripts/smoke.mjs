import { spawn } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";

const port = 3210;
const origin = `http://127.0.0.1:${port}`;
const serverPath = path.join(process.cwd(), ".next", "standalone", "server.js");
let output = "";
let exited = false;

const server = spawn(
  process.execPath,
  ["--env-file-if-exists=.env.local", serverPath],
  {
    env: {
      ...process.env,
      // The full gate already migrated this disposable database. Keep the
      // short-lived smoke child isolated from any operator .env.local target.
      ...(process.env.TEST_DATABASE_URL ? {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DATABASE_DIRECT_URL: process.env.TEST_DATABASE_URL,
      } : {}),
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
server.once("exit", () => {
  exited = true;
});

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (exited) {
      throw new Error(`Production server exited before it became healthy.\n${output}`);
    }

    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok" && body.service === "stardust-itinerary") {
          return;
        }
      }
    } catch {
      // The server is still starting.
    }

    await delay(250);
  }

  throw new Error(`Production server did not become healthy.\n${output}`);
}

async function stopServer() {
  if (exited) return;

  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(2_000),
  ]);

  if (!exited) {
    server.kill("SIGKILL");
  }
}

try {
  await waitForHealth();

  const packageInfo = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const mapVersion = packageInfo.dependencies["maplibre-gl"];
  for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
    const asset = await fetch(`${origin}/vendor/maplibre/${mapVersion}/${name}`);
    const source = await asset.text();
    if (!asset.ok || !/(?:javascript|ecmascript)/iu.test(asset.headers.get("content-type") ?? "") || !source.includes("MapLibre") || source.length < 1000) {
      throw new Error("Versioned local MapLibre worker asset missing or not served as JavaScript.");
    }
  }

  const pageResponse = await fetch(`${origin}/zh-HK-lihkg`);
  const html = await pageResponse.text();
  if (!pageResponse.ok || !html.includes("星塵遠征軍")) {
    throw new Error("LIHKG-style Cantonese page failed the production smoke test.");
  }

  const stylesheetPath = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
  if (!stylesheetPath) {
    throw new Error("Production HTML did not reference a stylesheet.");
  }

  const stylesheetResponse = await fetch(new URL(stylesheetPath, origin));
  if (!stylesheetResponse.ok) {
    throw new Error("Production stylesheet was not served successfully.");
  }

  const signInResponse = await fetch(`${origin}/auth/sign-in`);
  const signInHtml = await signInResponse.text();
  if (!signInResponse.ok || !signInHtml.includes("Sign in to your trip")) {
    throw new Error("The local identity sign-in page failed the production smoke test.");
  }

  console.log("Smoke test passed: health, Cantonese, identity, stylesheet and versioned MapLibre worker routes are available.");
} finally {
  await stopServer();
}
