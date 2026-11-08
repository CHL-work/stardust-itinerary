import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { cleanupCredentialSecrets } from "../src/lib/ai/credential-secret-lifecycle";

export async function cleanupCredentialSecretsMain() {
  if (process.argv.length > 2) throw new Error("credential_cleanup_arguments_invalid");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !["postgres:", "postgresql:"].includes(new URL(connectionString).protocol)) {
    throw new Error("credential_cleanup_database_unconfigured");
  }
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15_000 });
  try {
    const result = await cleanupCredentialSecrets(pool);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanupCredentialSecretsMain().catch(() => {
    process.stderr.write("Credential secret cleanup failed; resources will be retried.\n");
    process.exitCode = 1;
  });
}
