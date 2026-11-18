import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";

const replacements = [
  ["gpt-6.1-sol", "gpt-6.2-sol"],
  ["gpt-6-astra", "gpt-6.2-astra"],
  ["gpt-6.1-terra", "gpt-6.2-sol"],
  ["gpt-6-luna", "gpt-6.2-sol"],
  ["claude-opus-5-5", "claude-opus-5-5"],
  ["gemini-4-argon", "gemini-4-argon"],
  [null, null],
];

/** Guarded disposable suite only: prove the actual 0070 -> 0071 upgrade, not a fresh-schema substitute. */
export async function testGpt62Migration(pool, connectionString) {
  await migrate({ connectionString, through: "0070_trip_destinations.sql" });
  assert.equal((await pool.query("SELECT max(name) AS head FROM app_schema_migrations")).rows[0].head,
    "0070_trip_destinations.sql");
  // The earlier worker behavior suite temporarily admits its current 6.2 model
  // at an old schema stage. Restore the exact pre-0071 write restriction here,
  // without rewriting those synthetic completed runs; NOT VALID skips existing
  // fixture rows but still enforces the old restriction on every new write.
  await pool.query(`ALTER TABLE feedback_triage_runs DROP CONSTRAINT feedback_triage_runs_model_check,
    ADD CONSTRAINT feedback_triage_runs_model_check CHECK (model='gpt-6-astra') NOT VALID`);
  await assert.rejects(pool.query(`INSERT INTO feedback_triage_runs(id,run_date,state,model)
    SELECT $1,COALESCE(min(run_date),'2000-01-01'::date)-1,'succeeded','gpt-6.2-astra' FROM feedback_triage_runs`,
  [randomUUID()]), /model_check/u);
  const records = [];
  for (const [legacy, current] of replacements) {
    const userId = randomUUID(), tripId = randomUUID(), memberId = randomUUID(), requestId = randomUUID(), lookupId = randomUUID();
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic model upgrade owner')", [userId]);
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic model upgrade','Asia/Tokyo','JPY','2031-04-01','2031-04-02')`, [tripId, userId]);
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic model upgrade owner','owner','active')`, [tripId, memberId, userId]);
    await pool.query(`INSERT INTO trip_ai_settings(trip_id,owner_default_model,member_model,updated_by_member_id)
      VALUES($1,$2,'gpt-6.1-sol',$3)`, [tripId, legacy ?? "gpt-6.1-sol", memberId]);
    await pool.query(`INSERT INTO account_ai_preferences(user_id,routine_enabled,routine_model,routine_verified_model,
        routine_check_model,routine_verified_at,routine_enabled_at,routine_check_at,routine_check_result,routine_opted_out)
      VALUES($1,$2,$3,$3,$3,CASE WHEN $2 THEN CURRENT_TIMESTAMP END,CASE WHEN $2 THEN CURRENT_TIMESTAMP END,
        CASE WHEN $2 THEN CURRENT_TIMESTAMP END,CASE WHEN $2 THEN 'ok' END,false)`, [userId, legacy !== null, legacy]);
    if (legacy !== null) {
      await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,prompt_text,
          requested_model,effective_model,status,completed_at)
        VALUES($1,$2,$3,$4,'owner','Synthetic historical model request',$5,$5,'succeeded',CURRENT_TIMESTAMP)`,
      [tripId, requestId, memberId, userId, legacy]);
      await pool.query(`INSERT INTO account_ai_lookups(id,user_id,client_request_id,request_payload_hash,input_hash,
          destination_text,display_locale,prompt_version,entitlement,requested_model,effective_model,status,error_code,completed_at)
        VALUES($1,$2,$3,$4,$4,'Synthetic destination','en',1,'trip_creator',$5,$5,'failed','PROVIDER_UNAVAILABLE',CURRENT_TIMESTAMP)`,
      [lookupId, userId, randomUUID(), Buffer.alloc(32, 7), legacy]);
    }
    records.push({ userId, tripId, memberId, requestId, lookupId, legacy, current });
  }
  // A disabled/opted-out setting and a pending check must remain disabled/pending.
  await pool.query(`UPDATE account_ai_preferences SET routine_enabled=false,routine_opted_out=true,
      routine_check_result=NULL WHERE user_id=$1`, [records[3].userId]);
  const runId = randomUUID();
  await pool.query(`INSERT INTO feedback_triage_runs(id,run_date,state,model)
    SELECT $1,COALESCE(min(run_date),'2000-01-01'::date)-1,'succeeded','gpt-6-astra' FROM feedback_triage_runs`, [runId]);
  const history = async () => ({
    requests: (await pool.query("SELECT to_jsonb(r) AS record FROM ai_requests r WHERE id=ANY($1::uuid[]) ORDER BY id", [records.map(r => r.requestId)])).rows,
    lookups: (await pool.query("SELECT to_jsonb(r) AS record FROM account_ai_lookups r WHERE id=ANY($1::uuid[]) ORDER BY id", [records.map(r => r.lookupId)])).rows,
    feedback: (await pool.query("SELECT to_jsonb(r) AS record FROM feedback_triage_runs r ORDER BY id")).rows,
  });
  const beforeHistory = await history();
  const beforePreferences = new Map((await pool.query("SELECT * FROM account_ai_preferences WHERE user_id=ANY($1::uuid[])",
    [records.map(r => r.userId)])).rows.map(row => [row.user_id, row]));
  assert.deepEqual(await migrate({ connectionString, through: "0071_gpt_6_2.sql" }), ["0071_gpt_6_2.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0071_gpt_6_2.sql" }), []);
  assert.deepEqual(await history(), beforeHistory, "all request, lookup and completed feedback history is byte-for-byte unchanged");

  for (const record of records) {
    const settings = (await pool.query("SELECT owner_default_model,member_model FROM trip_ai_settings WHERE trip_id=$1", [record.tripId])).rows[0];
    assert.deepEqual(settings, { owner_default_model: record.current ?? "gpt-6.2-sol", member_model: "gpt-6.2-sol" });
    const preferences = (await pool.query("SELECT * FROM account_ai_preferences WHERE user_id=$1", [record.userId])).rows[0];
    const changed = record.legacy !== record.current;
    const expected = { ...beforePreferences.get(record.userId), routine_model: record.current,
      routine_verified_model: record.current, routine_check_model: record.current };
    if (changed) {
      expected.revision += 1;
      expected.updated_at = preferences.updated_at;
    }
    assert.deepEqual(preferences, expected, "only retired model IDs, revision and update time change");
  }
  const defaults = (await pool.query(`SELECT table_name,column_name,column_default FROM information_schema.columns
    WHERE table_schema='public' AND ((table_name='trip_ai_settings' AND column_name IN ('owner_default_model','member_model'))
      OR (table_name='account_ai_lookups' AND column_name='requested_model') OR (table_name='feedback_triage_runs' AND column_name='model'))`)).rows;
  for (const row of defaults) assert.equal(row.column_default,
    row.table_name === "feedback_triage_runs" ? "'gpt-6.2-astra'::text" : "'gpt-6.2-sol'::text");
  assert.equal(defaults.length, 4);
  // Legacy member writes remain compatible during rolling deployment; other tiers are never member defaults.
  await pool.query("UPDATE trip_ai_settings SET member_model='gpt-6.1-sol' WHERE trip_id=$1", [records[0].tripId]);
  await pool.query("UPDATE trip_ai_settings SET member_model='gpt-6.2-sol' WHERE trip_id=$1", [records[0].tripId]);
  await assert.rejects(pool.query("UPDATE trip_ai_settings SET member_model='gpt-6.2-astra' WHERE trip_id=$1", [records[0].tripId]), /member_model_check/u);
  await assert.rejects(pool.query("UPDATE feedback_triage_runs SET model='gpt-6.2-sol' WHERE id=$1", [runId]), /model_check/u);
  const newRun = (await pool.query(`INSERT INTO feedback_triage_runs(id,run_date,state)
    SELECT $1,COALESCE(min(run_date),'2000-01-01'::date)-1,'succeeded' FROM feedback_triage_runs RETURNING model`, [randomUUID()])).rows[0];
  assert.equal(newRun.model, "gpt-6.2-astra");
}
