import { createHash } from "node:crypto";

import type { Pool } from "pg";

import { parseDisruptionLocalizations } from "@/lib/disruptions/schema";

export const MAX_DISRUPTION_BACKFILL_BYTES = 1_048_576;
const MAX_REVIEWED_TRANSLATIONS = 100;

type LocalizedDetails = NonNullable<ReturnType<typeof parseDisruptionLocalizations>>;
type ReviewedTranslation = { sourceHash: string; localizedDetails: LocalizedDetails };

export type DisruptionBackfillOptions = {
  connectionString: string;
  apply?: boolean;
  confirmDatabase?: string;
};

export function validateDisruptionBackfillTarget(options: DisruptionBackfillOptions): void {
  let target: URL;
  try {
    target = new URL(options.connectionString);
  } catch {
    throw new Error("A valid loopback PostgreSQL URL is required.");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol)
      || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname.toLowerCase())
      || target.search || target.hash) {
    throw new Error("Only loopback PostgreSQL URLs without query options are allowed.");
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(target.pathname.slice(1));
  } catch {
    throw new Error("A valid database name is required.");
  }
  if (!databaseName || databaseName.includes("/") || /[\u0000-\u001f\u007f]/u.test(databaseName)) {
    throw new Error("A valid database name is required.");
  }
  if (options.apply && options.confirmDatabase !== databaseName) {
    throw new Error("Applying translations requires exact database-name confirmation.");
  }
}

export function parseDisruptionBackfillInput(rawInput: string): ReviewedTranslation[] {
  if (Buffer.byteLength(rawInput, "utf8") > MAX_DISRUPTION_BACKFILL_BYTES) {
    throw new Error("Reviewed translation input exceeds the size limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    throw new Error("Reviewed translations must be valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_REVIEWED_TRANSLATIONS) {
    throw new Error("Reviewed translations must be an array of at most 100 records.");
  }
  const seen = new Set<string>();
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).length !== 2
        || !("sourceHash" in value) || !("localizedDetails" in value)
        || typeof value.sourceHash !== "string" || !/^[0-9a-f]{64}$/u.test(value.sourceHash)
        || seen.has(value.sourceHash)) {
      throw new Error("Each reviewed translation needs one unique source hash and localized details.");
    }
    const localizedDetails = parseDisruptionLocalizations(value.localizedDetails);
    if (!localizedDetails) throw new Error("Each translation must include all three valid languages.");
    seen.add(value.sourceHash);
    return { sourceHash: value.sourceHash, localizedDetails };
  });
}

export async function backfillDisruptionLocalizations(
  pool: Pick<Pool, "connect">,
  rawInput: string,
  options: DisruptionBackfillOptions,
): Promise<{ selected: number; matched: number; inserted: number; skipped: number }> {
  validateDisruptionBackfillTarget(options);
  const reviewed = new Map(parseDisruptionBackfillInput(rawInput)
    .map((entry) => [entry.sourceHash, entry.localizedDetails]));
  const client = await pool.connect();
  try {
    await client.query(options.apply ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const selected = await client.query<{
      trip_id: string;
      observation_id: string;
      itinerary_item_id: string;
      detail: string;
    }>(
      `SELECT current_warning.trip_id, current_warning.observation_id,
              current_warning.itinerary_item_id, current_warning.detail
         FROM event_disruption_current current_warning
         JOIN itinerary_items item
           ON item.trip_id = current_warning.trip_id
          AND item.id = current_warning.itinerary_item_id
          AND item.current_revision = current_warning.item_revision
        WHERE current_warning.state IN ('possible', 'confirmed')
          AND current_warning.stale_after > CURRENT_TIMESTAMP
          AND item.visibility = 'trip' AND item.status = 'planned'
          AND NOT EXISTS (
            SELECT 1 FROM event_disruption_localizations localized
             WHERE localized.trip_id = current_warning.trip_id
               AND localized.observation_id = current_warning.observation_id
          )
        ORDER BY current_warning.trip_id, current_warning.observation_id
        LIMIT 200${options.apply ? " FOR SHARE OF current_warning, item" : ""}`,
    );
    let matched = 0;
    let inserted = 0;
    for (const warning of selected.rows) {
      const sourceHash = createHash("sha256").update(warning.detail, "utf8").digest("hex");
      const localizedDetails = reviewed.get(sourceHash);
      if (!localizedDetails) continue;
      matched += 1;
      if (!options.apply) continue;
      const result = await client.query(
        `INSERT INTO event_disruption_localizations (
           trip_id, observation_id, itinerary_item_id, details, origin
         ) VALUES ($1,$2,$3,$4::jsonb,'maintenance')
         ON CONFLICT (trip_id, observation_id) DO NOTHING`,
        [warning.trip_id, warning.observation_id, warning.itinerary_item_id,
          JSON.stringify(localizedDetails)],
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return {
      selected: selected.rows.length,
      matched,
      inserted,
      skipped: selected.rows.length - (options.apply ? inserted : matched),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
