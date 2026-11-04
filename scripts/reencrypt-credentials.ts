import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { reencryptAiCredentials } from "../src/lib/ai/credentials";

/**
 * Encryption-key rotation for users' saved AI keys: re-seal every key that is not under the current
 * CREDENTIAL_ENCRYPTION_KEY, using CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS to open the old ones. Run it
 * where the web server's secrets are mounted, for example
 * `kubectl -n stardust exec deploy/stardust-web -- /app/deploy/container/entrypoint.sh credential-reencrypt`.
 * Prints counts only, and exits non-zero while any key remains under an older version or does not open.
 */
export async function reencryptCredentialsMain() {
  if (process.argv.length > 2) throw new Error("reencrypt_arguments_invalid");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !["postgres:", "postgresql:"].includes(new URL(connectionString).protocol)) {
    throw new Error("reencrypt_database_unconfigured");
  }
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15_000 });
  try {
    const result = await reencryptAiCredentials(pool);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.remaining > 0 || result.unreadable > 0) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reencryptCredentialsMain().catch((error: unknown) => {
    // Error names only: never a key, ciphertext or connection string.
    const name = error instanceof Error ? error.name : "unknown";
    process.stderr.write(`Credential re-encryption failed safely (${name}); keys not yet moved stay readable under their old version.\n`);
    process.exitCode = 1;
  });
}
