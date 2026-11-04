import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import {
  AppConflictError, AppForbiddenError, createTrip, createTripMember, getAppOverview,
} from "../../src/lib/app/repository.ts";
import { getAiInstructions, saveAiInstructions } from "../../src/lib/ai/custom-instructions.ts";
import { listAiConversations, listAiConversationMessages, resumeAiConversation } from "../../src/lib/ai/conversation-history.ts";

const retiredTables = [
  "preference_revisions", "preferences", "ai_personal_memory_revisions", "ai_personal_memories",
  "user_catalog_preference_evidence", "user_catalog_preference_revisions", "preference_import_rows",
  "user_catalog_preferences", "preference_import_batches", "preference_catalog_relations",
  "preference_catalog_aliases", "preference_catalog_categories", "preference_catalog_entities",
];
const retiredFunctions = [
  "app_validate_preference_revision()", "app_purge_user_preference_data(uuid)",
  "app_reject_preference_history_mutation()", "app_preference_relation_reject_group_cycle()",
  "app_preference_import_batch_guard()", "app_preference_import_row_guard()",
  "app_preference_evidence_insert_guard()", "app_valid_preference_details(jsonb,integer)",
];

async function preservedState(pool) {
  const names = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of names) {
    if (retiredTables.includes(tablename) || ["app_users", "ai_conversations", "app_schema_migrations"].includes(tablename)) continue;
    assert.match(tablename, /^[a-z_]+$/u);
    result[tablename] = (await pool.query(`SELECT count(*)::int AS count,
      md5(coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text)::text,'[]')) AS digest
      FROM "${tablename}" row`)).rows[0];
  }
  return result;
}

/** Synthetic-only destructive upgrade and self-only settings checks. */
export async function testCustomAiInstructions(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(databaseName, /^stardust_test_[a-z0-9_]+$/u);
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, databaseName);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, databaseName);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_schema_migrations")).rows[0].count, 44);

  const tripId = randomUUID(), otherTripId = randomUUID();
  const owner = { ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role: "owner" };
  const member = { ...owner, memberId: randomUUID(), userId: randomUUID(), role: "editor" };
  const otherTripMember = { ...member, tripId: otherTripId, memberId: randomUUID(), role: "owner" };
  for (const actor of [owner, member]) {
    actor.issuer = "https://accounts.google.com";
    actor.subject = `synthetic-instructions-${actor.userId}`;
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic instruction traveler')", [actor.userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id) VALUES('https://accounts.google.com',$1,$2)",
      [`synthetic-instructions-${actor.userId}`, actor.userId]);
  }
  for (const actor of [owner, otherTripMember]) {
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic instructions upgrade','Asia/Tokyo','JPY','2030-04-01','2030-04-02')`, [actor.tripId, actor.userId]);
  }
  for (const actor of [owner, member, otherTripMember]) {
    await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
      VALUES($1,$2,$3,'Synthetic instruction traveler',$4,'active')`, [actor.tripId, actor.memberId, actor.userId, actor.role]);
  }
  owner.sessionId = randomUUID();
  owner.generation = 1;
  await pool.query(`INSERT INTO auth_sessions(id,family_id,trip_id,member_id,user_id,token_hash,
    device_label,generation,expires_at,absolute_expires_at)
    VALUES($1,$2,$3,$4,$5,decode($6,'hex'),'Synthetic instruction settings',1,CURRENT_TIMESTAMP+interval '1 day',CURRENT_TIMESTAMP+interval '30 days')`,
  [owner.sessionId, randomUUID(), owner.tripId, owner.memberId, owner.userId, "49".repeat(32)]);
  await pool.query("UPDATE app_users SET last_selected_trip_id=$2 WHERE id=$1", [member.userId, otherTripId]);
  await seedRetiredPreferences(pool, owner);
  const activePreferences = randomUUID(), archivedPreferences = randomUUID(), tripConversation = randomUUID();
  await pool.query(`INSERT INTO ai_conversations(trip_id,id,actor_member_id,actor_user_id,purpose)
    VALUES($1,$2,$3,$4,'preferences'),($1,$5,$6,$7,'trip')`,
  [tripId, activePreferences, owner.memberId, owner.userId, tripConversation, member.memberId, member.userId]);
  await pool.query(`INSERT INTO ai_conversations(trip_id,id,actor_member_id,actor_user_id,purpose,closed_at,closed_reason)
    VALUES($1,$2,$3,$4,'preferences',CURRENT_TIMESTAMP,'user_reset')`,
  [tripId, archivedPreferences, member.memberId, member.userId]);
  const requestId = randomUUID();
  await pool.query(`INSERT INTO ai_requests(trip_id,id,actor_member_id,actor_user_id,conversation_id,actor_role,
    prompt_text,result_text,requested_model,status,completed_at)
    VALUES($1,$2,$3,$4,$5,'owner','Synthetic historical preference text','Synthetic historical reply',
    'gpt-6.1-sol','succeeded',CURRENT_TIMESTAMP)`, [tripId, requestId, owner.memberId, owner.userId, activePreferences]);
  await pool.query(`INSERT INTO ai_conversation_checkpoints(trip_id,id,conversation_id,actor_member_id,actor_user_id,
    version,through_request_id,through_completed_at,summary_text,token_estimate)
    VALUES($1,$2,$3,$4,$5,1,$6,CURRENT_TIMESTAMP,'Synthetic retained summary',5)`,
  [tripId, randomUUID(), activePreferences, owner.memberId, owner.userId, requestId]);
  const oldUsers = (await pool.query("SELECT to_jsonb(u) AS value FROM app_users u ORDER BY id")).rows;
  const oldConversations = (await pool.query("SELECT to_jsonb(c) AS value FROM ai_conversations c ORDER BY trip_id,id")).rows;
  const before = await preservedState(pool);
  for (const name of retiredTables) {
    assert.ok((await pool.query(`SELECT count(*)::int AS count FROM ${name}`)).rows[0].count > 0, `${name} has data to remove`);
  }

  // An unknown dependency must stop the forward migration atomically, not be
  // silently destroyed by a cascading drop.
  await pool.query("CREATE TABLE custom_ai_instructions_dependency_guard(memory_id uuid REFERENCES ai_personal_memories(id))");
  await assert.rejects(migrate({ connectionString, through: "0049_custom_ai_instructions.sql" }), /depend/iu);
  assert.equal((await pool.query("SELECT closed_at FROM ai_conversations WHERE id=$1", [activePreferences])).rows[0].closed_at, null);
  assert.equal((await pool.query("SELECT to_jsonb(u) ? 'ai_instructions' AS present FROM app_users u LIMIT 1")).rows[0].present, false);
  await pool.query("DROP TABLE custom_ai_instructions_dependency_guard");
  assert.deepEqual(await migrate({ connectionString, through: "0049_custom_ai_instructions.sql" }), ["0049_custom_ai_instructions.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0049_custom_ai_instructions.sql" }), []);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_schema_migrations")).rows[0].count, 45);
  assert.deepEqual(await preservedState(pool), before, "All unrelated tables and historical request/checkpoint/audit rows survive unchanged");
  for (const name of retiredTables) assert.equal((await pool.query("SELECT to_regclass($1) AS value", [name])).rows[0].value, null);
  for (const name of retiredFunctions) assert.equal((await pool.query("SELECT to_regprocedure($1) AS value", [name])).rows[0].value, null);
  assert.deepEqual((await pool.query("SELECT to_jsonb(u)-'ai_instructions'-'ai_instructions_revision' AS value FROM app_users u ORDER BY id")).rows, oldUsers);
  assert.equal((await pool.query("SELECT bool_and(ai_instructions='' AND ai_instructions_revision=1) AS empty FROM app_users")).rows[0].empty, true,
    "Retired profiles must not be converted into instruction text");
  const currentConversations = (await pool.query("SELECT to_jsonb(c) AS value FROM ai_conversations c ORDER BY trip_id,id")).rows;
  assert.deepEqual(currentConversations.map(({ value }, index) => ({ value: oldConversations[index].value.purpose === "preferences"
    && oldConversations[index].value.closed_at === null
    ? { ...value, closed_at: null, closed_reason: null } : value })), oldConversations);
  assert.equal(currentConversations.find(({ value }) => value.id === activePreferences).value.closed_reason, "user_switch");
  await assert.rejects(pool.query("UPDATE ai_conversations SET closed_at=NULL,closed_reason=NULL WHERE id=$1", [activePreferences]),
    (error) => error.constraint === "ai_conversations_retired_purpose_closed_ck");
  await assert.rejects(pool.query("UPDATE ai_conversations SET purpose='trip' WHERE id=$1", [activePreferences]), /purpose is immutable/u);
  await assert.rejects(pool.query(`INSERT INTO ai_conversations(trip_id,id,actor_member_id,actor_user_id,purpose,closed_at,closed_reason)
    VALUES($1,$2,$3,$4,'preferences',CURRENT_TIMESTAMP,'user_reset')`, [tripId, randomUUID(), owner.memberId, owner.userId]), /retired/u);
  const history = await listAiConversations(pool, owner, tripId);
  assert.equal(history.activeConversationId, null);
  assert.equal(history.conversations.find((item) => item.conversationId === activePreferences)?.canResume, false);
  assert.equal((await listAiConversationMessages(pool, owner, tripId, activePreferences)).messages[0].prompt, "Synthetic historical preference text");
  await assert.rejects(resumeAiConversation(pool, owner, tripId, activePreferences));
  await assert.rejects(resumeAiConversation(pool, member, tripId, archivedPreferences));
  assert.equal((await listAiConversations(pool, member, tripId)).activeConversationId, tripConversation);
  await testInstructionSettings(pool, { owner, member, otherTripMember });
}

async function seedRetiredPreferences(pool, owner) {
  const memoryId = randomUUID(), entityId = randomUUID(), parentId = randomUUID(), batchId = randomUUID(), preferenceId = randomUUID();
  await pool.query("INSERT INTO preferences(trip_id,member_id,profile,visibility) VALUES($1,$2,'{\"pace\":\"synthetic\"}','private')", [owner.tripId, owner.memberId]);
  await pool.query(`INSERT INTO preference_revisions(trip_id,member_id,revision,changed_by_member_id,snapshot)
    VALUES($1,$2,1,$2,'{"pace":"synthetic"}')`, [owner.tripId, owner.memberId]);
  await pool.query(`INSERT INTO ai_personal_memories(id,app_user_id,category,subject,normalized_subject,details)
    VALUES($1,$2,'other','Synthetic retired fact','synthetic retired fact','{"pace":"synthetic"}')`, [memoryId, owner.userId]);
  await pool.query(`INSERT INTO ai_personal_memory_revisions(memory_id,revision,actor_user_id,snapshot,cause)
    VALUES($1,1,$2,'{"subject":"Synthetic retired fact"}','created')`, [memoryId, owner.userId]);
  await pool.query(`INSERT INTO preference_catalog_entities(id,kind,canonical_name,normalized_name)
    VALUES($1,'media_work','Synthetic retired work','synthetic retired work'),($2,'franchise','Synthetic retired group','synthetic retired group')`, [entityId, parentId]);
  await pool.query("INSERT INTO preference_catalog_aliases(entity_id,alias,normalized_alias) VALUES($1,'Synthetic alias','synthetic alias')", [entityId]);
  await pool.query("INSERT INTO preference_catalog_categories(entity_id,category) VALUES($1,'other')", [entityId]);
  await pool.query("INSERT INTO preference_catalog_relations(child_entity_id,parent_entity_id,relation_type,source_key) VALUES($1,$2,'part_of','synthetic')", [entityId, parentId]);
  await pool.query(`INSERT INTO preference_import_batches(id,app_user_id,source_sha256,catalog_sha256,source_label,parser_version,schema_version,status)
    VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),'Synthetic retired import',1,1,'staged')`, [batchId, owner.userId, "31".repeat(32), "32".repeat(32)]);
  await pool.query(`INSERT INTO user_catalog_preferences(id,app_user_id,catalog_entity_id,source_type,confidence,source_batch_id)
    VALUES($1,$2,$3,'manual',1,$4)`, [preferenceId, owner.userId, entityId, batchId]);
  await pool.query(`INSERT INTO preference_import_rows(batch_id,app_user_id,row_number,section_key,source_label,normalized_label,
    inferred_category,evidence_type,confidence,resolution,catalog_entity_id,user_preference_id)
    VALUES($1,$2,1,'synthetic','Synthetic work','synthetic work','other','user_stated',1,'matched',$3,$4)`, [batchId, owner.userId, entityId, preferenceId]);
  await pool.query(`INSERT INTO user_catalog_preference_evidence(app_user_id,id,preference_id,batch_id,import_row_number,evidence_type,confidence)
    VALUES($1,$2,$3,$4,1,'user_stated',1)`, [owner.userId, randomUUID(), preferenceId, batchId]);
  await pool.query(`INSERT INTO user_catalog_preference_revisions(app_user_id,preference_id,revision,actor_user_id,snapshot,cause)
    VALUES($1,$2,1,$1,'{"synthetic":true}','imported')`, [owner.userId, preferenceId]);
}

async function testInstructionSettings(pool, { owner, member, otherTripMember }) {
  const empty = { instructions: "", revision: 1 };
  assert.deepEqual(await getAiInstructions(pool, member, member.tripId), empty);
  const instructions = "Synthetic private requirement: use a relaxed pace. 日本語／廣東話";
  assert.deepEqual(await saveAiInstructions(pool, member, member.tripId, { instructions, expectedRevision: 1 }), { instructions, revision: 2 });
  assert.deepEqual(await getAiInstructions(pool, otherTripMember, otherTripMember.tripId), { instructions, revision: 2 });
  assert.deepEqual(await getAiInstructions(pool, owner, owner.tripId), empty);
  await assert.rejects(getAiInstructions(pool, owner, otherTripMember.tripId), AppForbiddenError);
  await assert.rejects(getAiInstructions(pool, { ...owner, userId: member.userId }, owner.tripId), AppForbiddenError);
  await assert.rejects(saveAiInstructions(pool, member, member.tripId, { instructions: "stale", expectedRevision: 1 }), AppConflictError);
  const concurrent = await Promise.allSettled([
    saveAiInstructions(pool, member, member.tripId, { instructions: "Synthetic first concurrent write", expectedRevision: 2 }),
    saveAiInstructions(pool, otherTripMember, otherTripMember.tripId, { instructions: "Synthetic second concurrent write", expectedRevision: 2 }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(concurrent.find((result) => result.status === "rejected").reason instanceof AppConflictError);
  assert.equal((await getAiInstructions(pool, member, member.tripId)).revision, 3);
  const maximum = "語".repeat(8000);
  assert.deepEqual(await saveAiInstructions(pool, member, member.tripId, { instructions: maximum, expectedRevision: 3 }), { instructions: maximum, revision: 4 });
  await assert.rejects(saveAiInstructions(pool, member, member.tripId, { instructions: "x".repeat(8001), expectedRevision: 4 }));
  await assert.rejects(pool.query("UPDATE app_users SET ai_instructions=$2 WHERE id=$1", [member.userId, "x".repeat(8001)]),
    (error) => error.constraint === "app_users_ai_instructions_length_ck");
  await assert.rejects(pool.query("UPDATE app_users SET ai_instructions_revision=0 WHERE id=$1", [member.userId]),
    (error) => error.constraint === "app_users_ai_instructions_revision_ck");
  assert.deepEqual(await saveAiInstructions(pool, member, member.tripId, { instructions: "", expectedRevision: 4 }), { instructions: "", revision: 5 });
  assert.deepEqual(await getAiInstructions(pool, otherTripMember, otherTripMember.tripId), { instructions: "", revision: 5 });
  const audits = (await pool.query("SELECT metadata,before_state,after_state FROM audit_events WHERE trip_id=ANY($1::uuid[])",
    [[member.tripId, otherTripMember.tripId]])).rows;
  assert.doesNotMatch(JSON.stringify(audits), /Synthetic private requirement|concurrent write|relaxed pace|廣東話/u);
  await pool.query("UPDATE trip_members SET status='revoked' WHERE trip_id=$1 AND id=$2", [member.tripId, member.memberId]);
  await assert.rejects(getAiInstructions(pool, member, member.tripId), AppForbiddenError);
  await assert.rejects(saveAiInstructions(pool, member, member.tripId, { instructions: "Denied", expectedRevision: 5 }), AppForbiddenError);
  const replacementUserId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic replacement identity')", [replacementUserId]);
  await pool.query("UPDATE trip_members SET status='active',user_id=$3 WHERE trip_id=$1 AND id=$2", [member.tripId, member.memberId, replacementUserId]);
  await assert.rejects(getAiInstructions(pool, member, member.tripId), AppForbiddenError);
  await assert.rejects(saveAiInstructions(pool, member, member.tripId, { instructions: "Denied replacement", expectedRevision: 5 }), AppForbiddenError);
  assert.deepEqual(await getAiInstructions(pool, otherTripMember, otherTripMember.tripId), { instructions: "", revision: 5 });
  await pool.query("UPDATE trip_members SET user_id=$3 WHERE trip_id=$1 AND id=$2", [member.tripId, member.memberId, member.userId]);
  assert.doesNotMatch(JSON.stringify(await getAppOverview(pool, member)), /Synthetic private requirement|concurrent write/u);
  const createdMember = await createTripMember(pool, owner, owner.tripId, { displayName: "Synthetic post-removal invitee" });
  assert.ok(createdMember.id);
  const trip = await createTrip(pool, owner, { name: "Synthetic post-removal trip", destinationName: "Synthetic destination", timeZone: "Asia/Tokyo", defaultLocale: "en",
    defaultCurrency: "JPY", startsOn: "2031-04-01", endsOn: "2031-04-02", maxMembers: 4 });
  assert.ok(trip.tripId);
}
