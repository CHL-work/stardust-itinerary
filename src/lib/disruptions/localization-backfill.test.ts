import { createHash } from "node:crypto";

import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  backfillDisruptionLocalizations,
  parseDisruptionBackfillInput,
  validateDisruptionBackfillTarget,
} from "@/lib/disruptions/localization-backfill";

const target = "postgresql://synthetic:placeholder@127.0.0.1:54329/stardust_test_backfill";
const details = {
  en: "The official operator reports a possible delay.",
  "zh-HK": "營運機構公告指可能出現延誤。",
  "ja-JP": "運営者の公式発表によると、遅延の可能性があります。",
};
const original = "A sourced synthetic warning about a possible service delay.";
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const input = JSON.stringify([{ sourceHash: hash(original), localizedDetails: details }]);
const row = {
  trip_id: "10000000-0000-4000-8000-000000000001",
  observation_id: "20000000-0000-4000-8000-000000000001",
  itinerary_item_id: "30000000-0000-4000-8000-000000000001",
  detail: original,
};

function fakePool(options: { rows?: typeof row[]; inserted?: number; failInsert?: boolean } = {}) {
  const query = vi.fn<(sql: string, values?: unknown[]) => Promise<{
    rows: typeof row[];
    rowCount: number;
  }>>(async (sql) => {
    if (sql.includes("SELECT current_warning")) return { rows: options.rows ?? [row], rowCount: 1 };
    if (sql.includes("INSERT INTO")) {
      if (options.failInsert) throw new Error("Synthetic insert failure");
      return { rows: [], rowCount: options.inserted ?? 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pool, query, connect, release };
}

describe("reviewed disruption localization maintenance", () => {
  it.each([
    "postgresql://localhost/stardust_test_backfill",
    "postgres://127.0.0.1:54329/stardust_test_backfill",
    "postgresql://[::1]/stardust_test_backfill",
  ])("accepts a loopback dry-run target: %s", (connectionString) => {
    expect(() => validateDisruptionBackfillTarget({ connectionString })).not.toThrow();
  });

  it.each([
    "", "not a URL", "https://localhost/test", "postgresql://database.example.test/test",
    "postgresql://127.0.0.1/test?host=database.example.test",
    "postgresql://localhost/test?options=-csearch_path=other",
    "postgresql://localhost/test#fragment", "postgresql://localhost/",
    "postgresql://localhost/test%2Fother", "postgresql://localhost/test%00",
  ])("rejects an unsafe target without connecting: %s", async (connectionString) => {
    const database = fakePool();
    await expect(backfillDisruptionLocalizations(database.pool, input, { connectionString }))
      .rejects.toThrow();
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("requires exact database confirmation for apply and never treats confirmation alone as apply", async () => {
    for (const confirmDatabase of [undefined, "different", "STARDUST_TEST_BACKFILL"]) {
      const database = fakePool();
      await expect(backfillDisruptionLocalizations(database.pool, input, {
        connectionString: target, apply: true, confirmDatabase,
      })).rejects.toThrow(/exact database-name confirmation/u);
      expect(database.connect).not.toHaveBeenCalled();
    }
    const dryRun = fakePool();
    const result = await backfillDisruptionLocalizations(dryRun.pool, input, {
      connectionString: target, confirmDatabase: "stardust_test_backfill",
    });
    expect(result).toEqual({ selected: 1, matched: 1, inserted: 0, skipped: 0 });
    expect(dryRun.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  });

  it("accepts only complete unique reviewed records and validates before connecting", async () => {
    expect(parseDisruptionBackfillInput(input)).toEqual([
      { sourceHash: hash(original), localizedDetails: details },
    ]);
    const valid = { sourceHash: hash(original), localizedDetails: details };
    for (const invalid of [
      "malformed JSON", "null", "{}", JSON.stringify([null]),
      JSON.stringify([valid, valid]),
      JSON.stringify(Array.from({ length: 101 }, () => valid)),
      JSON.stringify([{ ...valid, sourceHash: "bad hash" }]),
      JSON.stringify([{ ...valid, extra: "unexpected" }]),
      JSON.stringify([{ ...valid, localizedDetails: { en: "Incomplete." } }]),
      JSON.stringify([{ ...valid, localizedDetails: { ...details, "zh-HK": " " } }]),
      JSON.stringify([{ ...valid, localizedDetails: { ...details, en: "x".repeat(801) } }]),
      "あ".repeat(350_000),
    ]) {
      const database = fakePool();
      await expect(backfillDisruptionLocalizations(database.pool, invalid, {
        connectionString: target,
      })).rejects.toThrow();
      expect(database.connect).not.toHaveBeenCalled();
    }
  });

  it("uses exact original-text hashes and performs a bounded read-only preview", async () => {
    const database = fakePool({ rows: [row, { ...row, detail: `${original} ` }] });
    const result = await backfillDisruptionLocalizations(database.pool, input, {
      connectionString: target,
    });
    expect(result).toEqual({ selected: 2, matched: 1, inserted: 0, skipped: 1 });
    expect(database.query).toHaveBeenCalledWith("BEGIN READ ONLY");
    const select = database.query.mock.calls.find(([sql]) => sql.includes("SELECT current_warning"))![0];
    expect(select).toContain("LIMIT 200");
    expect(select).toContain("current_warning.state IN ('possible', 'confirmed')");
    expect(select).toContain("current_warning.stale_after > CURRENT_TIMESTAMP");
    expect(select).toContain("item.visibility = 'trip' AND item.status = 'planned'");
    expect(select).toContain("item.current_revision = current_warning.item_revision");
    expect(select).toContain("NOT EXISTS");
    expect(select).not.toContain("FOR SHARE");
    expect(database.query.mock.calls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b/u.test(sql)))
      .toBe(false);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("locks the exact current/item state and inserts only its matched display translations", async () => {
    const database = fakePool();
    const result = await backfillDisruptionLocalizations(database.pool, input, {
      connectionString: target, apply: true, confirmDatabase: "stardust_test_backfill",
    });
    expect(result).toEqual({ selected: 1, matched: 1, inserted: 1, skipped: 0 });
    const select = database.query.mock.calls.find(([sql]) => sql.includes("SELECT current_warning"))![0];
    expect(select).toContain("FOR SHARE OF current_warning, item");
    const writes = database.query.mock.calls.filter(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b/u.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toContain("INSERT INTO event_disruption_localizations");
    expect(writes[0]![0]).toContain("'maintenance'");
    expect(writes[0]![0]).toContain("ON CONFLICT (trip_id, observation_id) DO NOTHING");
    expect(writes[0]![1]).toEqual([
      row.trip_id, row.observation_id, row.itinerary_item_id, JSON.stringify(details),
    ]);
    expect(database.query).toHaveBeenLastCalledWith("COMMIT");
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("retains a concurrent prior translation and counts an idempotent conflict as skipped", async () => {
    const database = fakePool({ inserted: 0 });
    const result = await backfillDisruptionLocalizations(database.pool, input, {
      connectionString: target, apply: true, confirmDatabase: "stardust_test_backfill",
    });
    expect(result).toEqual({ selected: 1, matched: 1, inserted: 0, skipped: 1 });
  });

  it("rolls back failures and releases the client without mutating source evidence", async () => {
    const database = fakePool({ failInsert: true });
    await expect(backfillDisruptionLocalizations(database.pool, input, {
      connectionString: target, apply: true, confirmDatabase: "stardust_test_backfill",
    })).rejects.toThrow("Synthetic insert failure");
    expect(database.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(database.release).toHaveBeenCalledOnce();
    expect(database.query.mock.calls.some(([sql]) => /\b(?:UPDATE|DELETE)\b/u.test(sql))).toBe(false);
  });
});
