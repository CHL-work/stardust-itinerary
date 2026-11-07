import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
}

const fixturePath = path.resolve(process.env.LOCAL_TRIP_FIXTURE ?? "database/fixtures/local-ikebukuro.sql");
const fixture = await readFile(fixturePath, "utf8");
const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(fixture);
  // The first operator account owns the local trip when several are listed (JOB-078).
  const ownerEmail = process.env.OWNER_GOOGLE_EMAIL?.split(",")[0]?.trim().toLowerCase();
  if (ownerEmail) {
    const identity = await client.query(
      `SELECT user_id
         FROM oidc_identities
        WHERE lower(email_hint) = $1
        ORDER BY last_authenticated_at DESC
        LIMIT 1`,
      [ownerEmail],
    );
    const ownerUserId = identity.rows[0]?.user_id;
    if (ownerUserId) {
      await client.query(
        `UPDATE trips
            SET owner_user_id = $1
          WHERE id = '11000000-0000-4000-8000-000000000001'`,
        [ownerUserId],
      );
      const linked = await client.query(
        `UPDATE trip_members
            SET user_id = $1
          WHERE trip_id = '11000000-0000-4000-8000-000000000001'
            AND id = '21000000-0000-4000-8000-000000000001'
            AND user_id IS DISTINCT FROM $1
        RETURNING id`,
        [ownerUserId],
      );
      if (linked.rowCount) {
        await client.query(
          `INSERT INTO audit_events (
             trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
           ) VALUES (
             '11000000-0000-4000-8000-000000000001', $1,
             '21000000-0000-4000-8000-000000000001', 'trip_member',
             '21000000-0000-4000-8000-000000000001', 'owner_identity_linked_local',
             '{"source":"local_fixture_loader"}'::jsonb
           )`,
          [randomUUID()],
        );
      }
    }
  }
  await client.query("COMMIT");
  console.log("Loaded ignored local trip fixture.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
