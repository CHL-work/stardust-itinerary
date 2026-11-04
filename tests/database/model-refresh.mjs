import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";

const replacements = [
  ["gpt-5.6-sol", "gpt-6.1-sol"], ["gpt-5.6-terra", "gpt-6.1-terra"], ["gpt-5.6-luna", "gpt-6-luna"],
  ["gpt-6-astra", "gpt-6-astra"], ["claude-haiku-4-5", "claude-haiku-5-5"], ["claude-sonnet-5", "claude-sonnet-5-5"],
  ["claude-opus-5", "claude-opus-5-5"], ["claude-fable-5", "claude-fable-5-1"],
];

/** Called only from the guarded disposable PostgreSQL suite, at migration head 0050. */
export async function testModelRefreshMigration(pool, connectionString) {
  const { rows: [{ user_id: userId, trip_id: tripId, member_id: memberId, name, time_zone: timeZone, default_currency: currency, starts_on: startsOn, ends_on: endsOn }] } = await pool.query(
    `SELECT t.owner_user_id AS user_id, t.id AS trip_id, m.id AS member_id, t.name, t.time_zone, t.default_currency,
            t.starts_on::text, t.ends_on::text
       FROM trips t JOIN trip_members m ON m.trip_id = t.id AND m.user_id = t.owner_user_id LIMIT 1`);
  assert.ok(tripId);
  const trips = [];
  for (const [legacy] of replacements) {
    const id = randomUUID(), owner = randomUUID();
    await pool.query("INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, userId, name, timeZone, currency, startsOn, endsOn]);
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic model refresh','owner','active')",
      [id, owner, userId]);
    await pool.query(`INSERT INTO trip_ai_settings(trip_id,owner_default_model,member_model,updated_by_member_id)
      VALUES($1,$2,'gpt-5.6-sol',$3)
      ON CONFLICT (trip_id) DO UPDATE SET owner_default_model = EXCLUDED.owner_default_model, member_model = EXCLUDED.member_model`, [id, legacy, owner]);
    trips.push(id);
  }
  const lookupId = randomUUID();
  await pool.query(`INSERT INTO account_ai_lookups(id,user_id,client_request_id,request_payload_hash,input_hash,destination_text,
      display_locale,prompt_version,entitlement)
    VALUES($1,$2,$3,$4,$4,'Synthetic destination','en',1,'trip_creator')`, [lookupId, userId, randomUUID(), Buffer.alloc(32, 5)]);
  await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_role,prompt_text,requested_model)
    VALUES($1,$2,$3,'owner','Synthetic historical request','gpt-5.6-sol')`, [tripId, lookupId, memberId]);

  assert.deepEqual(await migrate({ connectionString, through: "0051_model_refresh.sql" }), ["0051_model_refresh.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0051_model_refresh.sql" }), []);

  const settings = await pool.query("SELECT trip_id, owner_default_model, member_model FROM trip_ai_settings WHERE trip_id = ANY($1::uuid[])", [trips]);
  const byTrip = new Map(settings.rows.map((row) => [row.trip_id, row]));
  replacements.forEach(([, current], index) => {
    assert.equal(byTrip.get(trips[index]).owner_default_model, current);
    assert.equal(byTrip.get(trips[index]).member_model, "gpt-6.1-sol");
  });
  const { rows: [{ stale }] } = await pool.query("SELECT count(*)::int AS stale FROM trip_ai_settings WHERE member_model <> 'gpt-6.1-sol'");
  assert.equal(stale, 0);

  // The audit records keep the model that actually ran.
  assert.equal((await pool.query("SELECT requested_model FROM ai_requests WHERE trip_id=$1 AND id=$2", [tripId, lookupId])).rows[0].requested_model, "gpt-5.6-sol");
  assert.equal((await pool.query("SELECT requested_model FROM account_ai_lookups WHERE id=$1", [lookupId])).rows[0].requested_model, "gpt-5.6-sol");
  await pool.query(`UPDATE account_ai_lookups SET status='failed',error_code='PROVIDER_UNAVAILABLE',completed_at=CURRENT_TIMESTAMP,effective_model='gpt-6.1-sol' WHERE id=$1`, [lookupId]);

  // New rows default to the current model, and unlisted identifiers stay rejected.
  const { rows: [defaults] } = await pool.query(`SELECT
      (SELECT column_default FROM information_schema.columns WHERE table_name='trip_ai_settings' AND column_name='owner_default_model') AS owner_default,
      (SELECT column_default FROM information_schema.columns WHERE table_name='trip_ai_settings' AND column_name='member_model') AS member_default,
      (SELECT column_default FROM information_schema.columns WHERE table_name='account_ai_lookups' AND column_name='requested_model') AS lookup_default`);
  assert.deepEqual(defaults, { owner_default: "'gpt-6.1-sol'::text", member_default: "'gpt-6.1-sol'::text", lookup_default: "'gpt-6.1-sol'::text" });
  await assert.rejects(pool.query("UPDATE trip_ai_settings SET member_model='gpt-6-luna' WHERE trip_id=$1", [trips[0]]), /member_model_check/u);
  await pool.query("UPDATE trip_ai_settings SET member_model='gpt-5.6-sol' WHERE trip_id=$1", [trips[0]]);
  await pool.query("UPDATE trip_ai_settings SET member_model='gpt-6.1-sol' WHERE trip_id=$1", [trips[0]]);
}
