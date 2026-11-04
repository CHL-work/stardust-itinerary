import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AppConflictError, AppForbiddenError, AppNotFoundError,
  applyPermittedChangeRequest, createChangeRequest, getApprovalHistory, getAppOverview,
  removeCancelledItineraryItem, reviewChangeRequest,
  updatePendingItineraryRequest, updateTripSettings,
} from "../../src/lib/app/repository.ts";
import { createMemberPayment } from "../../src/lib/app/member-payments.ts";

const exclusionMessage = "The trip dates would exclude existing itinerary or pending changes. Move those items first.";
const staleMessage = "The trip dates changed. Refresh and try again.";

/** Synthetic fixtures only, after the harness has applied the Calendar/payment schema. */
export async function testTripDateSettings(pool, connectionString, baseSession) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(databaseName, /^stardust_test_[a-z0-9_]+$/u);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  assert.equal(process.env.TEST_DATABASE_CONFIRM_DESTROY, databaseName);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, databaseName);
  for (const variable of ["DATABASE_URL", "DATABASE_DIRECT_URL"]) {
    if (!process.env[variable]) continue;
    const other = new URL(process.env[variable]);
    assert.notEqual(`${other.hostname}:${other.port || "5432"}${other.pathname}`,
      `${target.hostname}:${target.port || "5432"}${target.pathname}`,
      "Never run trip-date fixtures against the configured application database");
  }

  const makeTrip = async (startsOn = "2030-04-01", endsOn = "2030-04-05") => {
    const tripId = randomUUID();
    const actor = (role) => ({ ...baseSession, tripId, memberId: randomUUID(), userId: randomUUID(), role });
    const owner = actor("owner"), editor = actor("editor"), viewer = actor("viewer");
    for (const member of [owner, editor, viewer]) {
      await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic date-setting traveler')", [member.userId]);
    }
    await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
      VALUES($1,$2,'Synthetic date-setting trip','Asia/Tokyo','JPY',$3,$4)`,
    [tripId, owner.userId, startsOn, endsOn]);
    for (const member of [owner, editor, viewer]) {
      await pool.query(`INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status)
        VALUES($1,$2,$3,'Synthetic date-setting traveler',$4,'active')`,
      [tripId, member.memberId, member.userId, member.role]);
    }
    await pool.query(`INSERT INTO trip_days(trip_id,id,day_date,label)
      SELECT $1,gen_random_uuid(),day::date,'Synthetic retained label'
      FROM generate_series($2::date,$3::date,interval '1 day') day`, [tripId, startsOn, endsOn]);
    const days = new Map((await pool.query("SELECT id,day_date::text FROM trip_days WHERE trip_id=$1", [tripId]))
      .rows.map((day) => [day.day_date, day.id]));
    return { tripId, owner, editor, viewer, days };
  };
  const request = (fixture, patch = {}, actor = fixture.owner, overrides = {}) => createChangeRequest(
    pool, actor, fixture.tripId, {
      entityType: "itinerary_item", operation: "create", source: actor.role === "owner" ? "owner" : "member",
      reason: "Synthetic trip-date regression", patch: {
        tripDayId: fixture.days.get("2030-04-03"), title: "Synthetic date-setting event",
        itemType: "note", visibility: "trip", viewerMemberIds: [], ...patch,
      }, ...overrides,
    },
  );
  const canonical = async (fixture, patch = {}, actor = fixture.owner) => {
    const pending = await request(fixture, patch, actor);
    return { ...await reviewChangeRequest(pool, fixture.owner, fixture.tripId, pending.id, "approve"),
      requestId: pending.id };
  };
  const change = async (fixture, item, patch, operation = "update") => {
    const pending = await request(fixture, {}, fixture.owner, {
      operation, entityId: item.entityId, baseRevision: item.revision, patch,
    });
    return reviewChangeRequest(pool, fixture.owner, fixture.tripId, pending.id, "approve");
  };
  const rows = async (table, tripId) => (await pool.query(
    `SELECT to_jsonb(row) AS value FROM ${table} row WHERE trip_id=$1 ORDER BY to_jsonb(row)::text`, [tripId],
  )).rows.map((row) => row.value);
  const state = async (tripId) => ({
    trip: (await pool.query("SELECT to_jsonb(trip) AS value FROM trips trip WHERE id=$1", [tripId])).rows[0].value,
    ...Object.fromEntries(await Promise.all([
      "trip_days", "trip_members", "auth_sessions", "itinerary_items", "itinerary_revisions", "change_requests",
      "expenses", "expense_splits", "expense_revisions", "member_payments", "member_payment_revisions",
      "member_payment_actions", "audit_events",
    ].map(async (table) => [table, await rows(table, tripId)]))),
  });
  const preserved = async (tripId) => Object.fromEntries(await Promise.all([
    "trip_members", "auth_sessions", "itinerary_items", "itinerary_revisions", "change_requests",
    "expenses", "expense_splits", "expense_revisions", "member_payments", "member_payment_revisions", "member_payment_actions",
  ].map(async (table) => [table, await rows(table, tripId)])));
  const settings = (fixture, input) => updateTripSettings(pool, fixture.owner, fixture.tripId, input);
  const unchangedRejection = async (fixture, action, expected) => {
    const before = await state(fixture.tripId);
    await assert.rejects(action, expected);
    assert.deepEqual(await state(fixture.tripId), before, "A rejected write must leave dates, records and audits unchanged");
  };
  const excluded = (fixture, input) => unchangedRejection(fixture, () => settings(fixture, input),
    (error) => error instanceof AppConflictError && error.message === exclusionMessage);
  const activeDays = async (fixture) => (await getAppOverview(pool, fixture.owner)).days.map((day) => day.date);

  // Both edge contractions retain IDs, labels, all financial dates and every session byte.
  const emptyEdges = await makeTrip();
  const center = await canonical(emptyEdges);
  for (const mode of ["live", "expired", "revoked"]) {
    await pool.query(`INSERT INTO auth_sessions(id,family_id,trip_id,member_id,user_id,token_hash,device_label,
      created_at,expires_at,absolute_expires_at,revoked_at,revoke_reason)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic date-setting session',CURRENT_TIMESTAMP-interval '2 days',
        CASE WHEN $7='expired' THEN CURRENT_TIMESTAMP-interval '1 hour' ELSE CURRENT_TIMESTAMP+interval '12 hours' END,
        CURRENT_TIMESTAMP+interval '10 days',CASE WHEN $7='revoked' THEN CURRENT_TIMESTAMP END,
        CASE WHEN $7='revoked' THEN 'synthetic_regression' END)`,
    [randomUUID(), randomUUID(), emptyEdges.tripId, emptyEdges.owner.memberId, emptyEdges.owner.userId,
      randomBytes(32), mode]);
  }
  for (const occurredAt of ["2029-12-01T00:00:00Z", "2031-01-01T00:00:00Z"]) {
    const expense = await createChangeRequest(pool, emptyEdges.owner, emptyEdges.tripId, {
      entityType: "expense", operation: "create", source: "owner", reason: "Synthetic out-of-trip expense",
      patch: { description: "Synthetic prepayment", amountMinor: 100, currency: "JPY",
        payerMemberId: emptyEdges.owner.memberId, splitMemberIds: [emptyEdges.owner.memberId, emptyEdges.editor.memberId],
        occurredAt, status: "posted" },
    });
    await applyPermittedChangeRequest(pool, emptyEdges.owner, emptyEdges.tripId, expense.id);
    await createMemberPayment(pool, emptyEdges.owner, emptyEdges.tripId, {
      fromMemberId: emptyEdges.editor.memberId, toMemberId: emptyEdges.owner.memberId, currency: "JPY",
      amountMinor: 10, occurredAt: "2000-01-01T00:00:00Z", clientRequestId: randomUUID(), confirmation: true,
    });
  }
  const beforePreserved = await preserved(emptyEdges.tripId);
  const beforeDays = await rows("trip_days", emptyEdges.tripId);
  await settings(emptyEdges, { startsOn: "2030-04-02", endsOn: "2030-04-04",
    expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-05" });
  assert.deepEqual(await preserved(emptyEdges.tripId), beforePreserved);
  assert.deepEqual(await rows("trip_days", emptyEdges.tripId), beforeDays);
  assert.deepEqual(await activeDays(emptyEdges), ["2030-04-02", "2030-04-03", "2030-04-04"]);
  const settingsAudit = (await pool.query(`SELECT before_state,after_state FROM audit_events
    WHERE trip_id=$1 AND entity_type='trip' AND action='settings_updated' ORDER BY created_at DESC LIMIT 1`, [emptyEdges.tripId])).rows[0];
  assert.equal(settingsAudit.before_state.startsOn, "2030-04-01");
  assert.equal(settingsAudit.before_state.endsOn, "2030-04-05");
  assert.equal(settingsAudit.after_state.startsOn, "2030-04-02");
  assert.equal(settingsAudit.after_state.endsOn, "2030-04-04");

  // Retained archived day IDs are not selectable by fresh/stale writes.
  for (const date of ["2030-04-01", "2030-04-05"]) {
    await unchangedRejection(emptyEdges, () => request(emptyEdges, { tripDayId: emptyEdges.days.get(date) }),
      (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
    await unchangedRejection(emptyEdges, () => request(emptyEdges, {}, emptyEdges.owner, {
      operation: "update", entityId: center.entityId, baseRevision: center.revision,
      patch: { tripDayId: emptyEdges.days.get(date) },
    }), (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
  }
  await unchangedRejection(emptyEdges, () => request(emptyEdges, { startsAt: "2030-04-04T14:00:00Z", endsAt: "2030-04-04T16:00:00Z" }),
    (error) => error instanceof AppConflictError);
  await settings(emptyEdges, { startsOn: "2030-03-31", endsOn: "2030-04-06",
    expectedStartsOn: "2030-04-02", expectedEndsOn: "2030-04-04" });
  const reactivated = await rows("trip_days", emptyEdges.tripId);
  for (const day of beforeDays) assert.deepEqual(reactivated.find((row) => row.id === day.id), day);
  assert.equal(reactivated.length, 7);
  assert.deepEqual(await preserved(emptyEdges.tripId), beforePreserved);
  assert.deepEqual(await activeDays(emptyEdges), ["2030-03-31", "2030-04-01", "2030-04-02", "2030-04-03", "2030-04-04", "2030-04-05", "2030-04-06"]);

  // Owner, current-role and same-trip checks all fail without touching either trip.
  const foreign = await makeTrip();
  for (const actor of [emptyEdges.editor, emptyEdges.viewer, { ...emptyEdges.editor, role: "owner" },
    { ...emptyEdges.owner, userId: emptyEdges.editor.userId }]) {
    await unchangedRejection(emptyEdges, () => updateTripSettings(pool, actor, emptyEdges.tripId, { startsOn: "2030-04-01" }), AppForbiddenError);
  }
  const foreignBefore = await state(foreign.tripId);
  await unchangedRejection(emptyEdges, () => updateTripSettings(pool, emptyEdges.owner, foreign.tripId, { startsOn: "2030-04-02" }), AppForbiddenError);
  assert.deepEqual(await state(foreign.tripId), foreignBefore);
  await unchangedRejection(emptyEdges, () => request(emptyEdges, { tripDayId: foreign.days.get("2030-04-03") }),
    (error) => error instanceof AppNotFoundError || error instanceof AppConflictError);
  await unchangedRejection(emptyEdges, () => settings(emptyEdges, {
    startsOn: "2030-04-02", expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-05",
  }), (error) => error instanceof AppConflictError && error.message === staleMessage);
  const concurrent = await makeTrip();
  const outcomes = await Promise.allSettled([
    settings(concurrent, { startsOn: "2030-03-31", expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-05" }),
    settings(concurrent, { endsOn: "2030-04-06", expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-05" }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.message, staleMessage);
  assert.equal((await rows("audit_events", concurrent.tripId)).length, 1);

  // Canonical private, cancelled and removed records still protect their actual dates.
  for (const mode of ["public", "private", "cancelled", "removed"]) {
    const fixture = await makeTrip();
    let item = await canonical(fixture, { tripDayId: fixture.days.get("2030-04-01"),
      title: "SYNTHETIC_PRIVATE_TITLE_NEVER_IN_ERROR", visibility: mode === "private" ? "private" : "trip" },
    mode === "private" ? fixture.editor : fixture.owner);
    if (mode === "cancelled" || mode === "removed") item = await change(fixture, item, {}, "cancel");
    if (mode === "removed") await removeCancelledItineraryItem(pool, fixture.owner, fixture.tripId, item.entityId,
      { expectedRevision: item.revision, confirm: true });
    await excluded(fixture, { startsOn: "2030-04-02", destinationName: "Must roll back", timeZone: "UTC" });
  }
  for (const patch of [
    { startsAt: "2030-04-01T00:00:00Z", endsAt: "2030-04-02T00:00:00Z" },
    { itemType: "lodging", startsAt: "2030-04-04T12:00:00Z", endsAt: "2030-04-05T01:00:00Z" },
    { itemType: "transport", departureLocationName: "Synthetic departure", destinationLocationName: "Synthetic arrival",
      startsAt: "2030-04-04T14:00:00Z", endsAt: "2030-04-04T16:00:00Z" },
    { startsAt: "2030-04-04T14:00:00Z", endsAt: "2030-04-04T15:00:00.000001Z" },
  ]) {
    const fixture = await makeTrip();
    await canonical(fixture, patch);
    await excluded(fixture, patch.startsAt.startsWith("2030-04-01") ? { startsOn: "2030-04-02" } : { endsOn: "2030-04-04" });
  }
  const midnight = await makeTrip();
  const midnightItem = await canonical(midnight, { startsAt: "2030-04-03T15:00:00Z", endsAt: "2030-04-04T15:00:00Z" });
  await settings(midnight, { endsOn: "2030-04-04" });
  assert.equal((await getAppOverview(pool, midnight.owner)).trip.endsOn, "2030-04-04",
    "An exclusive midnight end immediately after the final trip-local date is valid");
  await unchangedRejection(midnight, () => request(midnight, {}, midnight.owner, {
    operation: "update", entityId: midnightItem.entityId, baseRevision: midnightItem.revision,
    patch: { endsAt: "2030-04-04T15:00:00.000001Z" },
  }), (error) => error instanceof AppConflictError);

  // Pending and rejected creates remain approvable; all effective update fields count too.
  for (const status of ["pending", "rejected"]) {
    for (const kind of ["day", "uppercase-day", "timestamp", "microsecond", "sparse-update"]) {
      const fixture = await makeTrip();
      let pending;
      if (kind === "sparse-update") {
        const item = await canonical(fixture);
        pending = await request(fixture, {}, fixture.editor, { operation: "update", entityId: item.entityId,
          baseRevision: item.revision, patch: { tripDayId: fixture.days.get("2030-04-05") } });
        await updatePendingItineraryRequest(pool, fixture.editor, fixture.tripId, pending.id,
          { proposalRevision: 1, patch: { notes: "Sparse edit must retain the proposed edge day" } });
      } else {
        pending = await request(fixture, kind === "day" || kind === "uppercase-day"
          ? { tripDayId: kind === "uppercase-day" ? fixture.days.get("2030-04-05").toUpperCase() : fixture.days.get("2030-04-05") }
          : { startsAt: "2030-04-04T14:00:00Z",
            endsAt: kind === "microsecond" ? "2030-04-04T15:00:00.000001Z" : "2030-04-04T16:00:00Z" }, fixture.editor);
      }
      if (status === "rejected") await reviewChangeRequest(pool, fixture.owner, fixture.tripId, pending.id, "reject",
        "Synthetic rejection remains reviewable", kind === "sparse-update" ? 2 : 1);
      await excluded(fixture, { endsOn: "2030-04-04" });
    }
  }

  // Historical revisions and stale/invalidated proposals retain identities without blocking unused edges.
  const historical = await makeTrip();
  const oldItem = await canonical(historical, { tripDayId: historical.days.get("2030-04-01") });
  await request(historical, {}, historical.owner, { operation: "update", entityId: oldItem.entityId,
    baseRevision: oldItem.revision, patch: { notes: "Stale sparse historical proposal" } });
  await change(historical, oldItem, { tripDayId: historical.days.get("2030-04-03") });
  const invalidated = await request(historical, { tripDayId: historical.days.get("2030-04-05") });
  await pool.query(`UPDATE change_requests SET invalidated_at=CURRENT_TIMESTAMP,invalidated_reason='member_removed',
    invalidated_by_member_id=$3,invalidated_member_id=$4 WHERE trip_id=$1 AND id=$2`,
  [historical.tripId, invalidated.id, historical.owner.memberId, historical.editor.memberId]);
  const historyBefore = await preserved(historical.tripId);
  const historicalDays = await rows("trip_days", historical.tripId);
  await settings(historical, { startsOn: "2030-04-02", endsOn: "2030-04-04" });
  assert.deepEqual(await preserved(historical.tripId), historyBefore);
  assert.deepEqual(await rows("trip_days", historical.tripId), historicalDays);
  assert.ok((await rows("itinerary_revisions", historical.tripId)).some((row) => row.snapshot.tripDayId === historical.days.get("2030-04-01")));
  const oldApproval = (await getApprovalHistory(pool, historical.owner, historical.tripId, undefined, oldItem.requestId)).requests[0];
  assert.equal(oldApproval.display.event.dayDate, "2030-04-01", "Archived day rows still resolve historical approval dates");

  // Simulate pre-feature legacy outliers only in this synthetic fixture. Unchanged outliers
  // do not make unrelated settings or an expansion impossible, and are never rewritten.
  const legacy = await makeTrip();
  const legacyItem = await canonical(legacy, { tripDayId: legacy.days.get("2030-04-01"), startsAt: "2030-04-01T00:00:00Z" });
  await pool.query("UPDATE trips SET starts_on='2030-04-02',ends_on='2030-04-04' WHERE id=$1", [legacy.tripId]);
  const legacyBefore = await preserved(legacy.tripId);
  await settings(legacy, { startsOn: "2030-04-02", endsOn: "2030-04-04" });
  await settings(legacy, { destinationName: "Synthetic changed destination" });
  await settings(legacy, { endsOn: "2030-04-06" });
  assert.deepEqual(await preserved(legacy.tripId), legacyBefore);
  const legacyEdit = await change(legacy, legacyItem, {
    tripDayId: legacy.days.get("2030-04-01").toUpperCase(), startsAt: "2030-04-01T00:00:00Z",
    notes: "An uppercase same-day echo does not newly exclude legacy facts",
  });
  assert.equal(legacyEdit.revision, 2);
  assert.deepEqual((await pool.query("SELECT trip_day_id,starts_at='2030-04-01T00:00:00Z'::timestamptz AS unchanged_start FROM itinerary_items WHERE trip_id=$1 AND id=$2",
    [legacy.tripId, legacyItem.entityId])).rows[0], {
    trip_day_id: legacy.days.get("2030-04-01"), unchanged_start: true,
  });

  // A proposal produced with old context cannot apply an excluded day or end timestamp.
  for (const kind of ["day", "timestamp"]) {
    const stale = await makeTrip();
    const pending = await request(stale, kind === "day" ? { tripDayId: stale.days.get("2030-04-05") }
      : { startsAt: "2030-04-04T14:00:00Z", endsAt: "2030-04-04T16:00:00Z" });
    await pool.query("UPDATE trips SET ends_on='2030-04-04' WHERE id=$1", [stale.tripId]);
    await unchangedRejection(stale, () => reviewChangeRequest(pool, stale.owner, stale.tripId, pending.id, "approve"),
      (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
    await unchangedRejection(stale, () => applyPermittedChangeRequest(pool, stale.owner, stale.tripId, pending.id),
      (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
  }
  const pendingEdit = await makeTrip();
  const safePending = await request(pendingEdit);
  const safeCanonical = await canonical(pendingEdit);
  await settings(pendingEdit, { endsOn: "2030-04-04" });
  for (const patch of [
    { tripDayId: pendingEdit.days.get("2030-04-05") },
    { startsAt: "2030-04-04T14:00:00Z", endsAt: "2030-04-04T16:00:00Z" },
  ]) {
    await unchangedRejection(pendingEdit, () => updatePendingItineraryRequest(pool, pendingEdit.owner,
      pendingEdit.tripId, safePending.id, { proposalRevision: 1, patch }),
    (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
    await unchangedRejection(pendingEdit, () => request(pendingEdit, {}, pendingEdit.owner, {
      operation: "update", entityId: safeCanonical.entityId, baseRevision: safeCanonical.revision, patch,
    }), (error) => error instanceof AppConflictError || error instanceof AppNotFoundError);
  }

  // Inclusive limits work across leap day, including a one-day trip; invalid input rolls back.
  const leap = await makeTrip("2032-02-29", "2032-02-29");
  await settings(leap, { startsOn: "2032-02-29", endsOn: "2032-02-29" });
  assert.deepEqual(await activeDays(leap), ["2032-02-29"]);
  await settings(leap, { startsOn: "2032-01-01", endsOn: "2032-12-31" });
  assert.equal((await activeDays(leap)).length, 366);
  await unchangedRejection(leap, () => settings(leap, { endsOn: "2033-01-01" }),
    (error) => error instanceof AppConflictError && error.message === "A trip can contain at most 366 calendar days.");
  await unchangedRejection(leap, () => settings(leap, { startsOn: "2033-01-01" }),
    (error) => error instanceof AppConflictError && error.message === "The end date must be on or after the start date.");
  for (const input of [
    { startsOn: "2031-02-29" }, { endsOn: "2032-02-30" }, { startsOn: "0000-01-01" },
    { endsOn: "2032-12-31", expectedStartsOn: "2032-01-01" },
    { endsOn: "2032-12-31", expectedEndsOn: "2032-12-31" },
  ]) {
    await unchangedRejection(leap, () => settings(leap, input), (error) => error.name === "ZodError");
  }
}
