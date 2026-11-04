import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { purgeExpiredGuests } from "../src/lib/app/guest";

/**
 * Hourly: permanently delete guest accounts (JOB-064) whose 24 hours are over, with their demo
 * trips. Prints counts only. A guest the database refuses to purge is counted and left in place.
 */
export async function guestPurgeMain() {
  if (process.argv.length > 2) throw new Error("guest_purge_arguments_invalid");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !["postgres:", "postgresql:"].includes(new URL(connectionString).protocol)) {
    throw new Error("guest_purge_database_unconfigured");
  }
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15_000 });
  try {
    const result = await purgeExpiredGuests(pool);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.refused > 0) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  guestPurgeMain().catch(() => { process.stderr.write("Guest purge failed safely; no data was changed by the failing step.\n"); process.exitCode = 1; });
}
