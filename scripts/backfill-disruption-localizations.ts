import { Pool } from "pg";

import {
  backfillDisruptionLocalizations,
  MAX_DISRUPTION_BACKFILL_BYTES,
  validateDisruptionBackfillTarget,
} from "../src/lib/disruptions/localization-backfill";

async function readReviewedInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_DISRUPTION_BACKFILL_BYTES) {
      throw new Error("Reviewed input exceeds the size limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

let pool: Pool | null = null;
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !arg.startsWith("--confirm-database="))
      || args.filter((arg) => arg === "--apply").length > 1
      || args.filter((arg) => arg.startsWith("--confirm-database=")).length > 1) {
    throw new Error("Unsupported or duplicate maintenance argument.");
  }
  const options = {
    connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? "",
    apply: args.includes("--apply"),
    confirmDatabase: args.find((arg) => arg.startsWith("--confirm-database="))
      ?.slice("--confirm-database=".length),
  };
  validateDisruptionBackfillTarget(options);
  const input = await readReviewedInput();
  pool = new Pool({
    connectionString: options.connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
  });
  const result = await backfillDisruptionLocalizations(pool, input, options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  // Never print provider text, source identities, connection URLs, or raw errors.
  process.stderr.write("Disruption localization maintenance failed; verify reviewed input and local target confirmation.\n");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
