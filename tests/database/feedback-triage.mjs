import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "../../scripts/db/migration-lib.mjs";
import { AppConflictError, AppForbiddenError } from "../../src/lib/app/repository.ts";
import { getTripMemberRemovalPreview, removeTripMemberSafely } from "../../src/lib/app/member-removal.ts";
import { feedbackPayloadHash, feedbackScope, submitFeedback, listSelfFeedback, listOperatorFeedback, getFeedbackContext, getFeedbackOperatorStatus,
  FeedbackPolicyChangedError, FeedbackRateLimitError, FeedbackScopeChangedError } from "../../src/lib/feedback/repository.ts";

const secret = "synthetic-feedback-test-auth-secret-".repeat(3);

/** Exact guarded disposable database only. No provider, GitHub or production calls. */
export async function testFeedbackTriage(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const database = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(database, /^stardust_test_[a-z0-9_]+$/u);
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, database);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, database);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_schema_migrations")).rows[0].count, 43);
  assert.deepEqual(await migrate({ connectionString, through: "0044_feedback_triage.sql" }), ["0044_feedback_triage.sql"]);
  assert.deepEqual(await migrate({ connectionString, through: "0044_feedback_triage.sql" }), []);

  const tripId = randomUUID(), otherTripId = randomUUID();
  const actor = (role) => ({ ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role });
  const owner = actor("owner"), member = actor("editor"), other = actor("editor"), operator = actor("editor"), daily = actor("editor");
  const otherScope = { ...member, tripId: otherTripId, memberId: randomUUID() };
  for (const person of [owner, member, other, operator, daily]) {
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic feedback person')", [person.userId]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES('https://accounts.google.com',$1,$2,$3)",
      [`synthetic-feedback-${person.userId}`, person.userId, `${person.userId}@example.test`]);
  }
  for (const id of [tripId, otherTripId]) await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic feedback trip','Asia/Tokyo','JPY',CURRENT_DATE,CURRENT_DATE+1)`, [id, owner.userId]);
  for (const person of [owner, member, other, operator, daily, otherScope]) await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
    VALUES($1,$2,$3,'Synthetic feedback member',$4,'active')`, [person.tripId, person.memberId, person.userId, person.role]);
  const payload = (person, changes = {}) => ({ scope: feedbackScope(person, secret), clientRequestId: randomUUID(),
    kind: "bug", title: "Synthetic settings action fails", description: "Expected the settings action to complete; observed an error.",
    allowIssuePublication: true, ...changes });
  const send = (person, input) => submitFeedback(pool, person, input, secret);
  const now = new Date();
  const diagnostics = { page: "settings", locale: "en", formFactor: "phone", osFamily: "ios", browserFamily: "safari", online: true,
    breadcrumbs: [{ page: "settings", action: "settings_save", at: now.toISOString() },
      { page: "ai", action: "ai_submit", at: new Date(now.getTime() - 30 * 60_000).toISOString() }] };
  const declined = payload(member, { allowIssuePublication: false });
  await assert.rejects(send(member, declined), FeedbackPolicyChangedError);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_reports WHERE actor_user_id=$1", [member.userId])).rows[0].count, 0);
  const input = payload(member, { diagnostics });
  const first = await send(member, input);
  assert.equal(first.replayed, false);
  assert.equal(first.report.status, "queued");
  assert.equal(first.report.allowIssuePublication, true);
  assert.deepEqual(new Set(Object.keys(first.report)), new Set(["id", "status", "createdAt", "title", "kind", "allowIssuePublication"]));
  const row = (await pool.query("SELECT * FROM feedback_reports WHERE id=$1", [first.report.id])).rows[0];
  assert.equal(row.actor_user_id, member.userId);
  assert.equal(row.actor_member_id, member.memberId);
  assert.equal(row.allow_issue_publication, true);
  assert.equal(row.diagnostics.breadcrumbs.length, 1);
  assert.equal(row.description, input.description);
  assert.equal(row.payload_hash.length, 32);
  assert.deepEqual((await pool.query("SELECT metadata FROM feedback_events WHERE report_id=$1 AND event_type='submitted'", [first.report.id])).rows[0].metadata,
    { diagnosticsIncluded: true, allowIssuePublication: true });
  const replay = await send(member, input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.report, first.report);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_events WHERE report_id=$1", [first.report.id])).rows[0].count, 1);
  await assert.rejects(send(member, { ...input, description: "Different content" }), AppConflictError);
  await assert.rejects(send(otherScope, input), FeedbackScopeChangedError);
  await assert.rejects(send(other, { ...input, scope: { ...input.scope, memberId: other.memberId } }), FeedbackScopeChangedError);
  await assert.rejects(send(member, { ...input, scope: { ...input.scope, scopeKey: "0".repeat(64) } }), FeedbackScopeChangedError);
  assert.deepEqual(await listSelfFeedback(pool, other), []);
  assert.deepEqual(await listSelfFeedback(pool, owner), []);
  assert.deepEqual(await listSelfFeedback(pool, otherScope), []);
  assert.equal((await listSelfFeedback(pool, member))[0].id, first.report.id);

  const oldEmail = process.env.OWNER_GOOGLE_EMAIL;
  try {
    process.env.OWNER_GOOGLE_EMAIL = `${operator.userId}@example.test`;
    assert.equal((await getFeedbackContext(pool, owner, secret)).isOperator, false);
    assert.equal((await getFeedbackContext(pool, operator, secret)).isOperator, true);
    await assert.rejects(listOperatorFeedback(pool, owner), AppForbiddenError);
    assert.equal((await listOperatorFeedback(pool, operator)).find((report) => report.id === first.report.id).description, input.description);
    assert.equal((await getFeedbackOperatorStatus(pool, operator)).queue.reports >= 1, true);
  } finally { if (oldEmail === undefined) delete process.env.OWNER_GOOGLE_EMAIL; else process.env.OWNER_GOOGLE_EMAIL = oldEmail; }

  const concurrentInput = payload(member, { allowIssuePublication: true });
  const concurrent = await Promise.all([send(member, concurrentInput), send(member, concurrentInput)]);
  assert.equal(concurrent.filter((item) => item.replayed).length, 1);
  assert.equal(new Set(concurrent.map((item) => item.report.id)).size, 1);
  await send(otherScope, payload(otherScope));
  await send(member, payload(member));
  const cap = await Promise.allSettled([send(member, payload(member)), send(otherScope, payload(otherScope))]);
  assert.equal(cap.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(cap.filter((item) => item.status === "rejected" && item.reason instanceof FeedbackRateLimitError).length, 1);
  assert.equal((await send(member, input)).replayed, true, "Exact idempotent retries survive rate limits");

  const seeded = async (person, index, consent = false) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO feedback_reports(id,trip_id,actor_member_id,actor_user_id,client_request_id,payload_hash,title,description,kind,allow_issue_publication)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic seeded feedback','Synthetic description','feedback',$7)`,
      [id, person.tripId, person.memberId, person.userId, randomUUID(), createHash("sha256").update(`synthetic-${index}`).digest(), consent]);
    return id;
  };
  // Historical declined reports are fixtures, never created through today's API.
  const historicalInput = payload(daily, { allowIssuePublication: false, diagnostics });
  const historicalId = randomUUID();
  const historicalHash = feedbackPayloadHash(daily, historicalInput);
  await pool.query(`INSERT INTO feedback_reports(id,trip_id,actor_member_id,actor_user_id,client_request_id,payload_hash,title,description,kind,allow_issue_publication,diagnostics)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10::jsonb)`,
    [historicalId, daily.tripId, daily.memberId, daily.userId, historicalInput.clientRequestId, historicalHash,
      historicalInput.title, historicalInput.description, historicalInput.kind, JSON.stringify(diagnostics)]);
  await pool.query("INSERT INTO feedback_events(report_id,event_type,metadata) VALUES($1,'submitted',$2::jsonb)",
    [historicalId, JSON.stringify({ diagnosticsIncluded: true, allowIssuePublication: false })]);
  for (let index = 1; index < 20; index++) await seeded(daily, index);
  await assert.rejects(send(daily, payload(daily)), FeedbackRateLimitError);
  const historicalReplay = await send(daily, historicalInput);
  assert.equal(historicalReplay.replayed, true, "Historical false exact retry precedes new policy and daily quota");
  assert.equal(historicalReplay.report.id, historicalId);
  assert.equal(historicalReplay.report.allowIssuePublication, false);
  await assert.rejects(send(daily, { ...historicalInput, allowIssuePublication: true }), AppConflictError);
  await assert.rejects(send(daily, { ...historicalInput, description: "Changed historical content" }), AppConflictError);
  await assert.rejects(send(daily, payload(daily, { allowIssuePublication: false })), FeedbackPolicyChangedError);
  const unchanged = (await pool.query("SELECT allow_issue_publication,payload_hash,diagnostics FROM feedback_reports WHERE id=$1", [historicalId])).rows[0];
  assert.equal(unchanged.allow_issue_publication, false);
  assert.deepEqual(unchanged.payload_hash, historicalHash);
  assert.deepEqual(unchanged.diagnostics, diagnostics, "Exact legacy retries preserve the original 30-minute diagnostic snapshot");
  assert.deepEqual((await pool.query("SELECT metadata FROM feedback_events WHERE report_id=$1", [historicalId])).rows.map((event) => event.metadata),
    [{ diagnosticsIncluded: true, allowIssuePublication: false }]);

  for (const [column, value] of [["title", "Changed"], ["allow_issue_publication", false], ["actor_user_id", other.userId], ["description", "Changed"]]) {
    await assert.rejects(pool.query(`UPDATE feedback_reports SET ${column}=$2 WHERE id=$1`, [first.report.id, value]), /immutable/u);
  }
  await assert.rejects(pool.query("DELETE FROM feedback_reports WHERE id=$1", [first.report.id]), /retained/u);
  await assert.rejects(pool.query("UPDATE feedback_events SET metadata='{}' WHERE report_id=$1", [first.report.id]), /append-only/u);
  for (const invalid of [{ ...diagnostics, privateText: "Never persist" }, { ...diagnostics, page: null },
    { ...diagnostics, breadcrumbs: [{ page: "settings", action: "copied private prompt", at: now.toISOString() }] },
    { ...diagnostics, breadcrumbs: [{ page: "settings", action: "settings_save", at: "now" }] }]) {
    await assert.rejects(pool.query(`INSERT INTO feedback_reports(id,trip_id,actor_member_id,actor_user_id,client_request_id,payload_hash,title,description,kind,diagnostics)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic invalid','Synthetic invalid','bug',$7::jsonb)`,
      [randomUUID(), tripId, member.memberId, member.userId, randomUUID(), Buffer.alloc(32), JSON.stringify(invalid)]), (error) => error.code === "23514");
  }
  const runId = randomUUID();
  await pool.query("INSERT INTO feedback_triage_runs(id,run_date) VALUES($1,'2000-01-01')", [runId]);
  await assert.rejects(pool.query("INSERT INTO feedback_triage_items(run_id,report_id) VALUES($1,$2)", [runId, historicalId]), /opt-out/u);
  await assert.rejects(pool.query("UPDATE feedback_triage_runs SET model='gpt-6.1-sol' WHERE id=$1", [runId]), (error) => error.code === "23514");
  const consented = concurrent[0].report.id;
  await pool.query("INSERT INTO feedback_triage_items(run_id,report_id,decision,structured_result,processed_at) VALUES($1,$2,'issue','{}',clock_timestamp())", [runId, consented]);
  const outboxId = randomUUID();
  const outbox = [outboxId, runId, createHash("sha256").update("synthetic-dedupe").digest(), [consented], createHash("sha256").update("synthetic-payload").digest()];
  await pool.query(`INSERT INTO feedback_issue_outbox(id,run_id,dedupe_key,report_ids,title,body,payload_hash)
    VALUES($1,$2,$3,$4,'Synthetic actionable issue','Synthetic sanitized reproduction only',$5)`, outbox);
  await assert.rejects(pool.query("UPDATE feedback_issue_outbox SET body='Changed' WHERE id=$1", [outboxId]), /immutable/u);
  await pool.query("UPDATE feedback_issue_outbox SET state='uncertain',post_attempts=1 WHERE id=$1", [outboxId]);
  await assert.rejects(pool.query("UPDATE feedback_issue_outbox SET state='queued' WHERE id=$1", [outboxId]), /repeat/u);
  await assert.rejects(pool.query("UPDATE feedback_issue_outbox SET post_attempts=0 WHERE id=$1", [outboxId]), /repeat/u);
  await pool.query("UPDATE feedback_issue_outbox SET state='published',issue_number=1,issue_url='https://github.com/CHL-work/stardust-itinerary/issues/1' WHERE id=$1", [outboxId]);
  await assert.rejects(pool.query("UPDATE feedback_issue_outbox SET issue_number=2 WHERE id=$1", [outboxId]), /rewrite/u);
  await assert.rejects(pool.query("DELETE FROM feedback_issue_outbox WHERE id=$1", [outboxId]), /retained/u);
  // Close eligible ingestion fixtures in this historical synthetic run so the
  // following worker integration starts with only unclaimed declined history.
  await pool.query(`INSERT INTO feedback_triage_items(run_id,report_id,decision,structured_result,processed_at)
    SELECT $1,r.id,'ignore','{}',clock_timestamp() FROM feedback_reports r
    WHERE r.trip_id=ANY($2::uuid[]) AND r.allow_issue_publication
      AND NOT EXISTS(SELECT 1 FROM feedback_triage_items i WHERE i.report_id=r.id)`, [runId, [tripId, otherTripId]]);
  await pool.query("UPDATE feedback_triage_runs SET state='succeeded',completed_at=clock_timestamp() WHERE id=$1", [runId]);

  const preview = await getTripMemberRemovalPreview(pool, owner, tripId, member.memberId);
  await removeTripMemberSafely(pool, owner, tripId, member.memberId, { confirmation: true, expectedRevision: preview.member.revision,
    previewDigest: preview.previewDigest, expenseReassignments: [], paymentReassignments: [] });
  assert.equal((await pool.query("SELECT actor_user_id FROM feedback_reports WHERE id=$1", [first.report.id])).rows[0].actor_user_id, member.userId);
  await assert.rejects(listSelfFeedback(pool, member), AppForbiddenError);
  await assert.rejects(send(member, input), AppForbiddenError);
  await assert.rejects(getFeedbackContext(pool, { ...other, userId: member.userId }, secret), AppForbiddenError);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_reports WHERE actor_user_id=$1", [member.userId])).rows[0].count, 5);
}
