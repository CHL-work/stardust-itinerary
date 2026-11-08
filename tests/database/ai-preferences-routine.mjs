import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { saveAiCredential } from "../../src/lib/ai/credentials.ts";
import { getAiPreferences, RoutineSearchCheckError, saveAiPreferences } from "../../src/lib/ai/preferences.ts";
import { getAiUsageSummary } from "../../src/lib/ai/usage-summary.ts";
import { AppConflictError, AppInvalidInputError } from "../../src/lib/app/repository.ts";
import { insertSession, verifySession } from "../../src/lib/auth/repository.ts";
import { runDueDisruptionMonitors } from "../../src/lib/disruptions/monitor.ts";
import { runDueFlightStatusChecks } from "../../src/lib/flights/monitor.ts";

const GOOGLE = "https://accounts.google.com";

/**
 * AI preferences and routine checks on a member's own key (JOB-093, JOB-094, D-105, D-106), at migration
 * head with a scripted provider and a synthetic local key ring: constraints, the web search gate, who pays,
 * the request records and the usage summary. Synthetic data only.
 */
export async function testAiPreferencesAndRoutine(pool, connectionString) {
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const config = { authSecret: "synthetic-routine-checks-secret-only", tripGraceDays: 2,
      appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
    const tripId = randomUUID(), dayId = randomUUID();
    const person = async (name, role) => {
      const userId = randomUUID(), memberId = randomUUID();
      await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,$2)", [userId, name]);
      await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)",
        [GOOGLE, `synthetic-${randomUUID()}`, userId, `${memberId}@example.test`]);
      if (role === "owner") {
        await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
          VALUES($1,$2,'Synthetic routine trip','Asia/Tokyo','JPY','2031-05-01','2031-05-03')`, [tripId, userId]);
        await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2031-05-01')", [tripId, dayId]);
      }
      await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,$4,$5,'active')",
        [tripId, memberId, userId, name, role]);
      if (role === "owner") {
        // Unsponsored: the operator's keys never pay here, and the trip's background switch is off.
        await pool.query("INSERT INTO trip_ai_settings(trip_id,updated_by_member_id,host_subscription_enabled) VALUES($1,$2,false)", [tripId, memberId]);
        await pool.query("INSERT INTO trip_disruption_settings(trip_id,updated_by_member_id,enabled) VALUES($1,$2,false)", [tripId, memberId]);
      }
      const client = await pool.connect();
      try {
        const grant = await insertSession(client, config, { tripId, memberId, userId, role, absoluteExpiresAt: new Date(Date.now() + 86_400_000), userAgent: null });
        return { userId, memberId, session: await verifySession(pool, config, grant.rawToken) };
      } finally { client.release(); }
    };
    const owner = await person("Synthetic routine owner", "owner");
    const editor = await person("Synthetic routine editor", "editor");

    // Constraints: "on" needs a verified model, and only a system request on a member's own key names a payer.
    await assert.rejects(pool.query("INSERT INTO account_ai_preferences(user_id,routine_enabled,routine_model) VALUES($1,true,'gpt-6.1-terra')",
      [owner.userId]), (error) => error.code === "23514");
    await assert.rejects(pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,initiator_kind,feature,
        prompt_text,requested_model,status,credential_source) VALUES($1,$2,NULL,NULL,NULL,'system','system','flight_status','Synthetic','gpt-6.1-terra','started','own')`,
      [tripId, randomUUID()]), (error) => error.code === "23514");
    await assert.rejects(pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,actor_role,feature,prompt_text,requested_model,status,
        credential_source,credential_member_id) VALUES($1,$2,$3,$4,'editor','planning','Synthetic','gpt-6.1-terra','started','own',$3)`,
      [tripId, randomUUID(), editor.memberId, editor.userId]), (error) => error.code === "23514");

    // Defaults: nothing stored, nothing on, no providers.
    assert.deepEqual(await getAiPreferences(pool, editor.session, tripId), { chatEffort: null, providers: [], revision: 0,
      routine: { enabled: false, model: null, effort: "medium", active: false, lastCheckAt: null, checksToday: 0 } });
    await assert.rejects(saveAiPreferences(pool, editor.session, tripId, { expectedRevision: 0, routine: { enabled: true } }), AppInvalidInputError);

    // A key, then a failed search check: nothing is saved.
    await saveAiCredential(pool, editor.session, tripId, { provider: "anthropic", apiKey: "sk-ant-synthetic-routine-key-0001" }, async () => true);
    let checks = 0;
    const refuse = async () => { checks += 1; return { ok: false, reason: "no_search" }; };
    await assert.rejects(saveAiPreferences(pool, editor.session, tripId, { expectedRevision: 0, routine: { enabled: true } }, { verify: refuse }),
      (error) => error instanceof RoutineSearchCheckError && error.reason === "no_search");
    assert.equal((await getAiPreferences(pool, editor.session, tripId)).revision, 0);

    // A passing check turns checks on with the provider's low-cost default; changing only the effort needs no new check.
    const pass = async (input) => { checks += 1; assert.equal(input.model, "claude-haiku-5-5"); return { ok: true }; };
    let saved = await saveAiPreferences(pool, editor.session, tripId, { expectedRevision: 0, routine: { enabled: true } }, { verify: pass });
    assert.deepEqual([saved.routine.enabled, saved.routine.active, saved.routine.model, saved.providers], [true, true, "claude-haiku-5-5", ["anthropic"]]);
    saved = await saveAiPreferences(pool, editor.session, tripId, { expectedRevision: saved.revision, chatEffort: "high",
      routine: { enabled: true, effort: "low" } }, { verify: pass });
    assert.deepEqual([saved.chatEffort, saved.routine.effort, checks], ["high", "low", 2]);
    const audits = await pool.query("SELECT action FROM audit_events WHERE trip_id=$1 AND entity_type='ai_preferences' ORDER BY created_at, id", [tripId]);
    assert.deepEqual(audits.rows.map((row) => row.action), ["ai.routine.enabled", "ai.preferences.updated"]);
    await assert.rejects(saveAiPreferences(pool, editor.session, tripId, { expectedRevision: 0, chatEffort: "low" }), AppConflictError);

    // A member-funded flight check: the editor's key pays, recorded with the paying member and the chosen model.
    const flightId = randomUUID();
    await pool.query(`INSERT INTO itinerary_items(trip_id,id,trip_day_id,created_by_member_id,title,item_type,starts_at,ends_at,
        departure_location_name,destination_location_name,flight,visibility)
      VALUES($1,$2,$3,$4,'Synthetic routine flight','transport','2031-05-01T03:00:00Z','2031-05-01T06:00:00Z','HND','CTS',
        '{"flightNumber":"NH9999","airline":"Synthetic Air"}'::jsonb,'trip')`, [tripId, flightId, dayId, owner.memberId]);
    const scripted = (rawOutput) => () => ({ check: async () => ({ rawOutput, effectiveModel: "claude-haiku-5-5", inputTokens: 2000, outputTokens: 100,
      cachedInputTokens: 500, webSearchCount: 2, webSearchQueries: ["NH9999 status"] }) });
    const now = new Date("2031-05-01T00:30:00Z");
    const flights = await runDueFlightStatusChecks(pool, { funding: "member", now, memberProvider: scripted("{}") });
    assert.equal(flights.checked, 1);
    const request = (await pool.query(`SELECT provider, transport, requested_model, credential_source, credential_member_id, web_search_count, status
      FROM ai_requests WHERE trip_id=$1 AND feature='flight_status'`, [tripId])).rows;
    assert.deepEqual(request, [{ provider: "anthropic", transport: "claude_agent_sdk", requested_model: "claude-haiku-5-5", credential_source: "own",
      credential_member_id: editor.memberId, web_search_count: 2, status: "succeeded" }]);

    // The editor sees the check and its estimated cost; the owner's usage shows none of it.
    const usage = await getAiUsageSummary(pool, editor.session, tripId, new Date());
    const routine = usage.services.find((service) => service.service === "routine");
    assert.equal(routine.requests, 1);
    assert.ok(routine.costUsd > 0, "the editor's key paid");
    assert.equal(usage.models[0].payer, "mine");
    assert.equal((await getAiUsageSummary(pool, owner.session, tripId, new Date())).total.requests, 0);
    assert.equal((await getAiPreferences(pool, editor.session, tripId)).routine.checksToday, 1);

    // An owner who turns checks on pays ahead of an earlier member. The disruption monitor stamps real time,
    // so this part uses a second unsponsored trip around today with the same two people.
    await saveAiCredential(pool, owner.session, tripId, { provider: "google", apiKey: "AIza-synthetic-routine-owner-key" }, async () => true);
    await saveAiPreferences(pool, owner.session, tripId, { expectedRevision: 0, routine: { enabled: true } }, { verify: async () => ({ ok: true }) });
    const todayTripId = randomUUID(), todayDayId = randomUUID(), todayOwner = randomUUID(), todayEditor = randomUUID();
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic routine trip today','UTC','JPY',CURRENT_DATE,CURRENT_DATE+2)`, [todayTripId, owner.userId]);
    await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,CURRENT_DATE)", [todayTripId, todayDayId]);
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,'Synthetic routine owner','owner','active'),
      ($1,$4,$5,'Synthetic routine editor','editor','active')`, [todayTripId, todayOwner, owner.userId, todayEditor, editor.userId]);
    await pool.query("INSERT INTO trip_ai_settings(trip_id,updated_by_member_id,host_subscription_enabled) VALUES($1,$2,false)", [todayTripId, todayOwner]);
    // Due a minute ago: PostgreSQL's clock is finer than Node's on some systems, so a row stamped "now" can
    // look newer than the monitor's own "now" taken a moment later.
    await pool.query(`INSERT INTO trip_disruption_settings(trip_id,updated_by_member_id,enabled,next_due_at)
      VALUES($1,$2,false,CURRENT_TIMESTAMP - interval '1 minute')`, [todayTripId, todayOwner]);
    await pool.query(`INSERT INTO itinerary_items(trip_id,id,trip_day_id,created_by_member_id,title,item_type,starts_at,location_name,visibility,
        created_at,updated_at)
      VALUES($1,$2,$3,$4,'Synthetic museum visit','activity',CURRENT_TIMESTAMP + interval '3 hours','Synthetic City Museum','trip',
        CURRENT_TIMESTAMP - interval '1 minute',CURRENT_TIMESTAMP - interval '1 minute')`,
    [todayTripId, randomUUID(), todayDayId, todayOwner]);
    const disruptions = await runDueDisruptionMonitors(pool, { funding: "member", maxTrips: 5, memberProvider: scripted('{"alerts":[]}') });
    const runs = (await pool.query("SELECT status, error_code FROM disruption_monitor_runs WHERE trip_id=$1", [todayTripId])).rows;
    assert.equal(disruptions.succeededTrips, 1, JSON.stringify({ disruptions, runs }));
    const disruptionRequest = (await pool.query(`SELECT provider, requested_model, credential_source, credential_member_id, web_search_count
      FROM ai_requests WHERE trip_id=$1 AND feature='disruption_monitor'`, [todayTripId])).rows;
    assert.deepEqual(disruptionRequest, [{ provider: "google", requested_model: "gemini-3.8-flash", credential_source: "own",
      credential_member_id: todayOwner, web_search_count: 2 }]);

    // A key saved again must pass the search check again before it pays; a suspended account never pays.
    await pool.query("UPDATE user_ai_credentials SET updated_at = CURRENT_TIMESTAMP + interval '1 minute' WHERE user_id=$1", [owner.userId]);
    assert.equal((await getAiPreferences(pool, owner.session, tripId)).routine.active, false);
    await pool.query("UPDATE app_users SET suspended_at = CURRENT_TIMESTAMP WHERE id=$1", [editor.userId]);
    const later = new Date("2031-05-01T01:30:00Z");
    assert.equal((await runDueFlightStatusChecks(pool, { funding: "member", now: later, memberProvider: scripted("{}") })).checked, 0);
    await pool.query("UPDATE app_users SET suspended_at = NULL WHERE id=$1", [editor.userId]);
    assert.equal((await runDueFlightStatusChecks(pool, { funding: "member", now: later, memberProvider: scripted("{}") })).checked, 1);

    // Destination lookups accept the new funding columns.
    await pool.query(`INSERT INTO account_ai_lookups(id,user_id,client_request_id,request_payload_hash,input_hash,destination_text,display_locale,
        prompt_version,entitlement,requested_model,provider,transport,authentication_mode,credential_source)
      VALUES($1,$2,$3,$4,$4,'osaka','en',1,'trip_creator','guest-free','kilo','kilo_gateway','anonymous','free')`,
    [randomUUID(), editor.userId, randomUUID(), randomBytes(32)]);
    await assert.rejects(pool.query(`INSERT INTO account_ai_lookups(id,user_id,client_request_id,request_payload_hash,input_hash,destination_text,display_locale,
        prompt_version,entitlement,credential_source) VALUES($1,$2,$3,$4,$4,'osaka','en',1,'trip_creator','shared')`,
    [randomUUID(), editor.userId, randomUUID(), randomBytes(32)]), (error) => error.code === "23514");
  } finally {
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
  }
}
