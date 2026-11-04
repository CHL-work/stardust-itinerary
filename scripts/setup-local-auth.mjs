import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const ownerEmail = option("--owner-email")?.trim().toLowerCase();
const databaseUrl = option("--database-url")?.trim();
if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
  throw new Error("Pass a valid owner email with --owner-email.");
}
if (!databaseUrl?.startsWith("postgresql://")) {
  throw new Error("Pass a local PostgreSQL URL with --database-url.");
}

const target = path.resolve(".env.local");
try {
  await access(target);
  throw new Error(".env.local already exists; refusing to overwrite local credentials.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const authSecret = randomBytes(32).toString("base64url");
const bootstrapSecret = randomBytes(32).toString("base64url");
const contents = `# Generated local-only configuration. This file is gitignored.\nDATABASE_URL=${databaseUrl}\nDATABASE_DIRECT_URL=${databaseUrl}\nAPP_BASE_URL=http://localhost:3100\nDEFAULT_LOCALE=zh-HK-lihkg\n\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\nAUTH_SECRET=${authSecret}\nAUTH_TRIP_GRACE_DAYS=2\nOWNER_GOOGLE_EMAIL=${ownerEmail}\nOWNER_BOOTSTRAP_SECRET=${bootstrapSecret}\n`;

await writeFile(target, contents, { encoding: "utf8", flag: "wx" });
console.log("Created ignored .env.local with local database, owner restriction, and random secrets.");
console.log("Google sign-in remains disabled until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are filled in locally.");
