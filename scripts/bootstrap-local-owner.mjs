import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const fixtureTripId = "10000000-0000-4000-8000-000000000001";
const fixtureOwnerMemberId = "20000000-0000-4000-8000-000000000001";

function parseLocalEnvironment(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function openPrivateUrl(url) {
  const target = url.href;
  const command =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

const envPath = path.resolve(".env.local");
const localEnvironment = parseLocalEnvironment(await readFile(envPath, "utf8"));
const appBaseUrl = new URL(localEnvironment.APP_BASE_URL || "http://localhost:3100");
if (!new Set(["localhost", "127.0.0.1"]).has(appBaseUrl.hostname)) {
  throw new Error("Local owner bootstrap refuses a non-local APP_BASE_URL.");
}
if (!localEnvironment.OWNER_BOOTSTRAP_SECRET) {
  throw new Error("OWNER_BOOTSTRAP_SECRET is missing from .env.local.");
}

const response = await fetch(new URL("/api/auth/bootstrap-owner", appBaseUrl), {
  method: "POST",
  headers: {
    authorization: `Bearer ${localEnvironment.OWNER_BOOTSTRAP_SECRET}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ tripId: fixtureTripId, memberId: fixtureOwnerMemberId }),
});
if (!response.ok) {
  throw new Error(`Local owner bootstrap failed with HTTP ${response.status}.`);
}
const payload = await response.json();
const claimUrl = new URL(payload.claimUrl);
if (claimUrl.origin !== appBaseUrl.origin || claimUrl.pathname !== "/claim") {
  throw new Error("Local owner bootstrap returned an unexpected claim URL.");
}

openPrivateUrl(claimUrl);
console.log("Opened the one-time owner claim in the default browser without printing the token.");
