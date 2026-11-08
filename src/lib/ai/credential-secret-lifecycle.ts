import type { Pool } from "pg";
import { inTransaction } from "@/lib/app/repository";
import { deleteCredentialSecret, secretManagerSettings, type SecretManagerSettings } from "@/lib/ai/credential-secret-manager";

/** Delete-only worker: no KMS or provider keys required. Active references always win. */
export async function cleanupCredentialSecrets(pool: Pool, options: {
  settings?: SecretManagerSettings;
  remove?: typeof deleteCredentialSecret;
  limit?: number;
} = {}): Promise<{ deleted: number; failed: number; active: number }> {
  const settings = options.settings ?? secretManagerSettings();
  if (!settings || settings === "invalid") throw new Error("credential_cleanup_unconfigured");
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const counts = { deleted: 0, failed: 0, active: 0 };
  // Snapshot names once so a failed/deferred row cannot starve later work in this run.
  const candidates = await pool.query<{ secret_name: string }>(
    `SELECT resource.secret_name FROM ai_credential_secret_resources resource
      WHERE cleanup_after <= CURRENT_TIMESTAMP
        AND NOT EXISTS (SELECT 1 FROM user_ai_credentials credential
          WHERE credential.secret_name = resource.secret_name)
      ORDER BY cleanup_after, secret_name LIMIT $1`, [limit]);
  for (const { secret_name: name } of candidates.rows) {
    await inTransaction(pool, async (client) => {
      const locked = await client.query(`SELECT secret_name FROM ai_credential_secret_resources
        WHERE secret_name = $1 AND cleanup_after <= CURRENT_TIMESTAMP FOR UPDATE SKIP LOCKED`, [name]);
      if (!locked.rowCount) return;
      // Re-check after the lock: a save may have committed since the candidate snapshot.
      const active = await client.query(`SELECT 1 FROM user_ai_credentials
        WHERE secret_name = $1`, [name]);
      if (active.rowCount) { counts.active += 1; return; }
      try {
        await (options.remove ?? deleteCredentialSecret)(name, settings);
      } catch {
        // Retry without recording cloud response bodies or resource/user identifiers.
        await client.query(`UPDATE ai_credential_secret_resources SET cleanup_after = CURRENT_TIMESTAMP + interval '1 hour'
          WHERE secret_name = $1`, [name]);
        counts.failed += 1;
        return;
      }
      await client.query("DELETE FROM ai_credential_secret_resources WHERE secret_name = $1", [name]);
      counts.deleted += 1;
    });
  }
  return counts;
}
