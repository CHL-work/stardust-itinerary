import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";

/**
 * Migration 0058: feedback receipts may name the configured private repository (JOB-066), and still
 * have to be GitHub issue URLs whose number matches. Earlier tests may already have migrated to head.
 */
export async function testPrivateFeedbackRepository(pool, connectionString) {
  await migrate({ connectionString, through: "0058_private_feedback_repository.sql" });
  assert.deepEqual(await migrate({ connectionString, through: "0058_private_feedback_repository.sql" }), []);
  const applied = await pool.query("SELECT 1 FROM app_schema_migrations WHERE name = '0058_private_feedback_repository.sql'");
  assert.equal(applied.rowCount, 1);
  const checks = await pool.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid = 'public.feedback_issue_outbox'::regclass AND contype = 'c'`);
  assert.ok(checks.rows.every((row) => !row.definition.includes("CHL-work/stardust-itinerary")), "no check names the public repository");

  // The table's own checks, on a scratch copy: the real table only accepts processed, consented reports.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE outbox_probe (LIKE feedback_issue_outbox INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP");
    const insert = ({ state = "published", postAttempts = 1, number = 7, url }) => client.query(
      `INSERT INTO outbox_probe(id,run_id,dedupe_key,report_ids,title,body,payload_hash,state,post_attempts,issue_number,issue_url)
       VALUES($1,$2,$3,ARRAY[$4::uuid],'Synthetic','Synthetic body',$5,$6,$7,$8,$9)`,
      [randomUUID(), randomUUID(), randomBytes(32), randomUUID(), randomBytes(32), state, postAttempts, number, url]);
    await insert({ url: "https://github.com/synthetic-owner/stardust-feedback/issues/7" });
    await insert({ url: "https://github.com/CHL-work/stardust-itinerary/issues/7" });
    for (const bad of [
      { url: "https://github.com/synthetic-owner/stardust-feedback/issues/17" },
      { url: "https://github.com/synthetic-owner/stardust-feedback/issues/0", number: 0 },
      { url: "https://github.com/synthetic-owner/stardust-feedback/pull/7" },
      { url: "https://example.test/synthetic-owner/stardust-feedback/issues/7" },
      { url: "https://github.com/synthetic-owner/stardust-feedback/issues/7?x=1" },
      { url: null },
    ]) {
      await client.query("SAVEPOINT probe");
      await assert.rejects(insert(bad), /check constraint/u, String(bad.url));
      await client.query("ROLLBACK TO SAVEPOINT probe");
    }
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}
