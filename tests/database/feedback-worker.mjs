import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { claimFeedbackRun, completeFeedbackRun, failFeedbackRun, claimFeedbackIssue,
  beginFeedbackDelivery, completeFeedbackDelivery, blockFeedbackIssue } from "../../src/lib/feedback/worker-repository.ts";
import { postFeedbackIssue, reconcileFeedbackIssue } from "../../src/lib/feedback/github-publisher.ts";

const issueUrl = (number) => `https://github.com/CHL-work/stardust-itinerary/issues/${number}`;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Hold a synthetic row until the tested operation really waits, then expire its lease. */
async function expireWhileWaiting(pool, table, id, run) {
  assert.ok(["feedback_triage_runs", "feedback_issue_outbox"].includes(table));
  const blocker = await pool.connect();
  const worker = await pool.connect();
  let pending;
  try {
    await blocker.query("BEGIN");
    await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
    const pid = (await worker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const adapter = { connect: async () => ({ query: worker.query.bind(worker), release() {} }) };
    pending = run(adapter).then((value) => ({ value }), (error) => ({ error }));
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
      if (state.rows[0]?.wait_event_type === "Lock") { waiting = true; break; }
      await pause(25);
    }
    assert.equal(waiting, true, "The synthetic worker must wait on the held row before expiry");
    await blocker.query(`UPDATE ${table} SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, [id]);
    await blocker.query("COMMIT");
    return await pending;
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    if (pending) await pending;
    blocker.release();
    worker.release();
  }
}

/** Disposable database and injected network doubles only; never creates a real issue. */
export async function testFeedbackWorker(pool, connectionString) {
  const target = new URL(connectionString);
  const database = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(database, /^stardust_test_[a-z0-9_]+$/u);
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, database);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, database);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_schema_migrations")).rows[0].count, 44);
  const canonicalCounts = async () => (await pool.query(`SELECT
    (SELECT count(*)::int FROM itinerary_items) AS events,
    (SELECT count(*)::int FROM expenses) AS expenses,
    (SELECT count(*)::int FROM change_requests) AS proposals,
    (SELECT count(*)::int FROM member_payments) AS payments`)).rows[0];
  const tripId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Fixture Private Person')", [userId]);
  await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Fixture Private Journey','Pacific/Auckland','JPY',CURRENT_DATE,CURRENT_DATE+1)`, [tripId, userId]);
  await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
    VALUES($1,$2,$3,'Fixture Private Person','owner','active')`, [tripId, memberId, userId]);
  const proposalSecrets = ["Fixture Hidden Outing", "Fixture Hidden Venue", "Fixture Hidden Departure",
    "Fixture Hidden Arrival", "Fixture Hidden Charge", "Fixture Hidden Linked Charge"];
  await pool.query(`INSERT INTO change_requests(trip_id,id,requested_by_member_id,source,entity_type,operation,proposed_patch,reason)
    VALUES($1,$2,$3,'member','itinerary_item','create',$4::jsonb,'Synthetic redaction fixture')`,
  [tripId, randomUUID(), memberId, JSON.stringify({ visibility: "private", title: proposalSecrets[0],
    locationName: proposalSecrets[1], departureLocationName: proposalSecrets[2], destinationLocationName: proposalSecrets[3],
    description: proposalSecrets[4], linkedExpense: { description: proposalSecrets[5] } })]);
  const beforeCanonical = await canonicalCounts();
  let reportOrder = 0;
  const seed = async (title, description, consent = true) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO feedback_reports(id,trip_id,actor_member_id,actor_user_id,client_request_id,payload_hash,
      title,description,kind,allow_issue_publication,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'bug',$9,clock_timestamp()+$10*interval '1 millisecond')`,
    [id, tripId, memberId, userId, randomUUID(), createHash("sha256").update(id).digest(), title, description, consent, reportOrder++]);
    return id;
  };
  const result = (claim, overrides = new Map()) => ({ inputTokens: 12, outputTokens: 8,
    decisions: claim.reports.map((report) => ({ key: report.key, decision: "issue", duplicateKey: null,
      title: report.title, evidence: [report.description], reproductionSteps: [], expected: "", actual: "",
      hypotheses: [], missingInformation: [], ...overrides.get(report.key) })) });
  const shiftFinishedDay = async (id, daysAgo) => {
    assert.equal((await pool.query("SELECT state FROM feedback_triage_runs WHERE id=$1", [id])).rows[0].state, "succeeded");
    await pool.query(`UPDATE feedback_triage_runs SET run_date=(clock_timestamp() AT TIME ZONE 'UTC')::date-$2::int,
      last_attempt_date=(clock_timestamp() AT TIME ZONE 'UTC')::date-$2::int WHERE id=$1`, [id, daysAgo]);
  };
  const receiptRows = async (ids) => (await pool.query("SELECT id,status FROM feedback_reports WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows;

  assert.equal(await claimFeedbackRun(pool), null, "Private opt-out reports and already claimed history do not invoke the reviewer");
  const firstId = await seed("Settings save stays open", `Fixture Private Person opens Settings and Save stays open. ${proposalSecrets.join("; ")}.`);
  const secondId = await seed("Settings confirmation remains visible", "The confirmation remains visible after Save.");
  const privateId = await seed("Private diagnosis only", "Do not forward this report.", false);
  const concurrent = await Promise.all([claimFeedbackRun(pool), claimFeedbackRun(pool)]);
  assert.equal(concurrent.filter(Boolean).length, 1, "Parallel workers share one UTC daily admission");
  const first = concurrent.find(Boolean);
  assert.deepEqual(first.reportIds, [firstId, secondId]);
  assert.equal(first.reports[0].description.includes("Fixture Private Person"), false);
  for (const secret of [tripId, userId, memberId, firstId, secondId, "Fixture Private Journey", ...proposalSecrets]) {
    assert.equal(JSON.stringify(first.reports).includes(secret), false, "Provider projection excludes identities and private context");
  }
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_triage_items WHERE report_id=$1", [privateId])).rows[0].count, 0);
  assert.equal(await claimFeedbackRun(pool), null);
  const firstOutput = result(first, new Map([["R2", { decision: "duplicate", duplicateKey: "R1" }]]));
  await assert.rejects(completeFeedbackRun(pool, { ...first, leaseOwner: randomUUID() }, firstOutput), /lease_expired/u);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_triage_items WHERE run_id=$1 AND processed_at IS NOT NULL", [first.id])).rows[0].count, 0);
  assert.equal(await completeFeedbackRun(pool, first, firstOutput), 1);
  await assert.rejects(completeFeedbackRun(pool, first, firstOutput), /lease_expired/u);
  const firstRun = (await pool.query("SELECT * FROM feedback_triage_runs WHERE id=$1", [first.id])).rows[0];
  assert.equal(firstRun.model, "gpt-6-astra");
  assert.equal(firstRun.effort, "medium");
  assert.equal(firstRun.attempt_count, 1);
  assert.equal(firstRun.input_tokens, "12");
  assert.equal(firstRun.output_tokens, "8");
  assert.equal(firstRun.lease_owner, null);
  const firstOutbox = (await pool.query("SELECT * FROM feedback_issue_outbox WHERE run_id=$1", [first.id])).rows[0];
  assert.equal((await pool.query("SELECT structured_result->>'duplicateOutboxId' AS id FROM feedback_triage_items WHERE report_id=$1", [secondId])).rows[0].id, firstOutbox.id);
  await assert.rejects(pool.query("UPDATE feedback_triage_items SET structured_result='{}' WHERE report_id=$1", [secondId]), /immutable/u);
  await assert.rejects(pool.query("UPDATE feedback_issue_outbox SET body=body||' altered' WHERE id=$1", [firstOutbox.id]), /immutable/u);
  assert.equal(await claimFeedbackRun(pool), null, "Completion does not release a second same-day model allowance");

  await shiftFinishedDay(first.id, 10);
  const thirdId = await seed("Settings dialog fails to dismiss", "Save completes but the dialog does not dismiss.");
  const second = await claimFeedbackRun(pool);
  assert.deepEqual(second.reportIds, [thirdId]);
  const knownIndex = second.knownRows.findIndex((row) => row.id === firstOutbox.id);
  assert.ok(knownIndex >= 0);
  assert.equal(await completeFeedbackRun(pool, second, result(second, new Map([["R1", {
    decision: "duplicate", duplicateKey: second.known[knownIndex].key,
  }]]))), 0);
  assert.equal((await pool.query("SELECT structured_result->>'duplicateOutboxId' AS id FROM feedback_triage_items WHERE report_id=$1", [thirdId])).rows[0].id, firstOutbox.id);
  assert.ok((await receiptRows([firstId, secondId, thirdId])).every((row) => row.status === "triaged"));

  const issueClaims = await Promise.all([claimFeedbackIssue(pool), claimFeedbackIssue(pool)]);
  assert.equal(issueClaims.filter(Boolean).length, 1);
  const delivery = issueClaims.find(Boolean);
  assert.equal(delivery.id, firstOutbox.id);
  assert.equal(delivery.postAttempts, 0);
  assert.equal(await beginFeedbackDelivery(pool, { ...delivery, leaseOwner: randomUUID() }), false);
  assert.equal(await beginFeedbackDelivery(pool, delivery), true);
  assert.equal(await beginFeedbackDelivery(pool, delivery), false, "The initial durable POST marker cannot be acquired twice");
  const methods = [];
  const lostResponse = await postFeedbackIssue(delivery, "synthetic-issue-token", async (_url, options) => {
    methods.push(options.method);
    const durable = (await pool.query("SELECT state,post_attempts FROM feedback_issue_outbox WHERE id=$1", [delivery.id])).rows[0];
    assert.deepEqual(durable, { state: "uncertain", post_attempts: 1 });
    throw new Error("Synthetic response lost after dispatch");
  });
  assert.equal(lostResponse.state, "uncertain");
  await completeFeedbackDelivery(pool, delivery, lostResponse);
  assert.equal(await claimFeedbackIssue(pool), null, "Uncertain delivery has a one-hour reconciliation backoff");
  await pool.query("UPDATE feedback_issue_outbox SET updated_at=clock_timestamp()-interval '2 hours' WHERE id=$1", [delivery.id]);
  const recovery = await claimFeedbackIssue(pool);
  assert.equal(recovery.postAttempts, 1);
  assert.equal(await beginFeedbackDelivery(pool, recovery), true);
  const recovered = await reconcileFeedbackIssue(recovery, "synthetic-issue-token", async (url, options) => {
    methods.push(options.method);
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/CHL-work\/stardust-itinerary\/issues\?/u);
    assert.equal(options.method, "GET");
    return Response.json([{ number: 4242, html_url: issueUrl(4242), title: recovery.title, body: recovery.body }]);
  });
  assert.equal(recovered.state, "published");
  await completeFeedbackDelivery(pool, recovery, recovered);
  assert.deepEqual(methods, ["POST", "GET"], "Recovery reads the fixed repository and never creates a second issue");
  assert.ok((await receiptRows([firstId, secondId, thirdId])).every((row) => row.status === "published"), "Both same-batch and known-issue duplicates follow the durable publication receipt");
  const published = (await pool.query("SELECT * FROM feedback_issue_outbox WHERE id=$1", [delivery.id])).rows[0];
  assert.equal(published.post_attempts, 1);
  assert.equal(published.reconciliation_attempts, 1);
  assert.equal(published.issue_number, "4242");
  assert.equal(published.body, firstOutbox.body);
  assert.deepEqual(published.payload_hash, firstOutbox.payload_hash);
  assert.equal(await claimFeedbackIssue(pool), null);
  await assert.rejects(completeFeedbackDelivery(pool, recovery, recovered), /lease_expired/u);

  await shiftFinishedDay(second.id, 9);
  const fourthId = await seed("Expense summary alignment issue", "The summary labels overlap on the phone.");
  const fifthId = await seed("Itinerary heading wraps unexpectedly", "The heading wraps into the adjacent control.");
  const third = await claimFeedbackRun(pool);
  assert.deepEqual(third.reportIds, [fourthId, fifthId]);
  assert.equal(await completeFeedbackRun(pool, third, result(third)), 2);
  const expiringDelivery = await claimFeedbackIssue(pool);
  const expiredDispatch = await expireWhileWaiting(pool, "feedback_issue_outbox", expiringDelivery.id,
    (adapter) => beginFeedbackDelivery(adapter, expiringDelivery));
  assert.equal(expiredDispatch.error, undefined);
  assert.equal(expiredDispatch.value, false, "Dispatch expiry is checked after a blocking row lock");
  assert.equal((await pool.query("SELECT post_attempts FROM feedback_issue_outbox WHERE id=$1", [expiringDelivery.id])).rows[0].post_attempts, 0);
  const reclaimed = await claimFeedbackIssue(pool);
  assert.equal(reclaimed.id, expiringDelivery.id);
  assert.notEqual(reclaimed.leaseOwner, expiringDelivery.leaseOwner);
  assert.equal(await beginFeedbackDelivery(pool, expiringDelivery), false);
  await blockFeedbackIssue(pool, reclaimed);
  const exhaustedDelivery = await claimFeedbackIssue(pool);
  assert.notEqual(exhaustedDelivery.id, expiringDelivery.id);
  assert.equal(await beginFeedbackDelivery(pool, exhaustedDelivery), true);
  await completeFeedbackDelivery(pool, exhaustedDelivery, { state: "uncertain", errorCode: "delivery_uncertain" });
  await pool.query(`UPDATE feedback_issue_outbox SET reconciliation_attempts=11,updated_at=clock_timestamp()-interval '2 hours'
    WHERE id=$1`, [exhaustedDelivery.id]);
  const lastRecovery = await claimFeedbackIssue(pool);
  assert.equal(lastRecovery.reconciliationAttempts, 11);
  assert.equal(await beginFeedbackDelivery(pool, lastRecovery), true);
  await completeFeedbackDelivery(pool, lastRecovery, { state: "uncertain", errorCode: "delivery_uncertain" });
  assert.deepEqual((await pool.query("SELECT state,error_code,post_attempts,reconciliation_attempts FROM feedback_issue_outbox WHERE id=$1", [lastRecovery.id])).rows[0],
    { state: "blocked", error_code: "reconciliation_exhausted", post_attempts: 1, reconciliation_attempts: 12 });
  assert.equal(await claimFeedbackIssue(pool), null);

  await shiftFinishedDay(third.id, 8);
  const retryReportId = await seed("Dialog focus regression", "Focus leaves the dialog after a keyboard action.");
  const retryFirst = await claimFeedbackRun(pool);
  assert.deepEqual(retryFirst.reportIds, [retryReportId]);
  const expiredRun = await expireWhileWaiting(pool, "feedback_triage_runs", retryFirst.id,
    (adapter) => completeFeedbackRun(adapter, retryFirst, result(retryFirst)));
  assert.match(expiredRun.error?.message ?? "", /lease_expired/u);
  assert.equal((await pool.query("SELECT processed_at FROM feedback_triage_items WHERE report_id=$1", [retryReportId])).rows[0].processed_at, null);
  assert.equal(await claimFeedbackRun(pool), null, "An expired lease cannot spend a second attempt on the same UTC date");
  await pool.query("UPDATE feedback_triage_runs SET last_attempt_date=(clock_timestamp() AT TIME ZONE 'UTC')::date-1 WHERE id=$1", [retryFirst.id]);
  const retrySecond = await claimFeedbackRun(pool);
  assert.equal(retrySecond.id, retryFirst.id);
  assert.deepEqual(retrySecond.reportIds, retryFirst.reportIds);
  assert.notEqual(retrySecond.leaseOwner, retryFirst.leaseOwner);
  await failFeedbackRun(pool, retryFirst, "worker_failed");
  assert.equal((await pool.query("SELECT state FROM feedback_triage_runs WHERE id=$1", [retryFirst.id])).rows[0].state, "running", "An earlier lease cannot terminate the current attempt");
  await failFeedbackRun(pool, retrySecond, "provider_unavailable");
  assert.equal(await claimFeedbackRun(pool), null);
  await pool.query("UPDATE feedback_triage_runs SET last_attempt_date=(clock_timestamp() AT TIME ZONE 'UTC')::date-1 WHERE id=$1", [retryFirst.id]);
  const retryThird = await claimFeedbackRun(pool);
  assert.equal(retryThird.id, retryFirst.id);
  assert.equal((await pool.query("SELECT attempt_count FROM feedback_triage_runs WHERE id=$1", [retryFirst.id])).rows[0].attempt_count, 3);
  await pool.query("UPDATE feedback_triage_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [retryFirst.id]);
  assert.equal(await claimFeedbackRun(pool), null);
  const exhaustedRun = (await pool.query("SELECT state,error_code,attempt_count,lease_owner FROM feedback_triage_runs WHERE id=$1", [retryFirst.id])).rows[0];
  assert.deepEqual(exhaustedRun, { state: "failed", error_code: "lease_expired", attempt_count: 3, lease_owner: null });
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_events WHERE run_id=$1 AND event_type='triage.exhausted'", [retryFirst.id])).rows[0].count, 1);
  assert.equal(await claimFeedbackRun(pool), null);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_events WHERE run_id=$1 AND event_type='triage.exhausted'", [retryFirst.id])).rows[0].count, 1, "Exhaustion receipt is not repeated");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM feedback_triage_items WHERE report_id=$1", [privateId])).rows[0].count, 0);
  assert.deepEqual(await canonicalCounts(), beforeCanonical, "Triage and issue delivery never mutate canonical events, money or proposals");
}
