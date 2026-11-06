import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyOwnKeyAiCreateWithClient, createAiCreateRequestsWithClient, createChangeRequestWithClient, inTransaction, ownKeyDirectAddScope,
} from "../../src/lib/app/repository.ts";
import { insertSession, verifySession } from "../../src/lib/auth/repository.ts";

const GOOGLE = "https://accounts.google.com";

/**
 * Own-key AI (JOB-070): a new event or expense from the requester's own-key AI request is added at
 * once exactly when the requester could add it by hand; everything else stays pending. Synthetic
 * data only, at migration head.
 */
export async function testOwnKeyAi(pool, connectionString) {
  const config = { authSecret: "synthetic-own-key-ai-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const tripId = randomUUID(), dayId = randomUUID();
  const person = async (name, role, permissions) => {
    const userId = randomUUID(), memberId = randomUUID();
    await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,$2)", [userId, name]);
    await pool.query("INSERT INTO oidc_identities(issuer,subject,user_id,email_hint) VALUES($1,$2,$3,$4)",
      [GOOGLE, `synthetic-${randomUUID()}`, userId, `${memberId}@example.test`]);
    if (role === "owner") {
      await pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_currency,starts_on,ends_on)
        VALUES($1,$2,'Synthetic own-key trip','Asia/Tokyo','JPY','2031-03-10','2031-03-12')`, [tripId, userId]);
      await pool.query("INSERT INTO trip_days(trip_id,id,day_date) VALUES($1,$2,'2031-03-10')", [tripId, dayId]);
    }
    await pool.query("INSERT INTO trip_members(trip_id,id,user_id,display_name,role,status) VALUES($1,$2,$3,$4,$5,'active')",
      [tripId, memberId, userId, name, role]);
    if (permissions) {
      await pool.query(`INSERT INTO member_permissions(trip_id,member_id,can_edit_itinerary,itinerary_requires_approval,
          can_edit_expenses,expense_requires_approval,can_sync_calendar,updated_by_member_id)
        VALUES($1,$2,$3,$4,$5,$6,false,$2)`, [tripId, memberId, permissions.itinerary, permissions.itineraryApproval,
        permissions.expenses, permissions.expenseApproval]);
    }
    const client = await pool.connect();
    try {
      const grant = await insertSession(client, config, { tripId, memberId, userId, role, absoluteExpiresAt: new Date(Date.now() + 86_400_000), userAgent: null });
      return { userId, memberId, session: await verifySession(pool, config, grant.rawToken) };
    } finally { client.release(); }
  };
  const owner = await person("Synthetic owner", "owner");
  const direct = await person("Synthetic direct editor", "editor", { itinerary: true, itineraryApproval: false, expenses: true, expenseApproval: true });
  const reviewed = await person("Synthetic reviewed editor", "editor", { itinerary: true, itineraryApproval: true, expenses: true, expenseApproval: true });

  assert.deepEqual(await ownKeyDirectAddScope(pool, owner.session), { events: true, expenses: true });
  assert.deepEqual(await ownKeyDirectAddScope(pool, direct.session), { events: true, expenses: false });
  assert.deepEqual(await ownKeyDirectAddScope(pool, reviewed.session), { events: false, expenses: false });

  const event = (title, extra = {}) => ({ entityType: "itinerary_item", operation: "create", source: "ai", reason: "Synthetic own-key AI request",
    patch: { tripDayId: dayId, title, startsAt: "2031-03-10T03:00:00.000Z", ...extra } });
  const propose = (who, input) => inTransaction(pool, async (client) => (await createAiCreateRequestsWithClient(client, who.session, tripId, [input]))[0].id);
  const apply = (who, requestId) => inTransaction(pool, (client) => applyOwnKeyAiCreateWithClient(client, who.session, tripId, requestId));
  const state = async (requestId) => (await pool.query("SELECT status, entity_id, review_note FROM change_requests WHERE trip_id = $1 AND id = $2", [tripId, requestId])).rows[0];

  // The owner's own-key event is added through the ordinary owner review.
  const ownerEvent = await propose(owner, event("Synthetic owner meetup"));
  const ownerApplied = await apply(owner, ownerEvent);
  assert.equal(ownerApplied.status, "approved");
  assert.equal((await pool.query("SELECT title FROM itinerary_items WHERE trip_id = $1 AND id = $2", [tripId, ownerApplied.entityId])).rows[0].title,
    "Synthetic owner meetup");
  assert.equal((await state(ownerEvent)).review_note, "Added from the owner's own-key AI request");

  // A member with direct itinerary permission gets the same, recorded as an own-key addition.
  const memberEvent = await propose(direct, event("Synthetic member dinner"));
  const memberApplied = await apply(direct, memberEvent);
  assert.equal(memberApplied.status, "approved");
  const audit = await pool.query(`SELECT metadata->>'approvalMode' AS mode FROM audit_events
    WHERE trip_id = $1 AND entity_type = 'itinerary_item' AND entity_id = $2 AND action = 'created'`, [tripId, memberApplied.entityId]);
  assert.deepEqual(audit.rows, [{ mode: "own_key_ai" }]);

  // A linked expense needs direct expense permission too; when expenses need approval the event stays pending.
  const withExpense = await propose(direct, event("Synthetic member lunch", { linkedExpense: {
    description: "Synthetic lunch", amountMinor: 1200, currency: "JPY", payerMemberId: direct.memberId, splitMemberIds: [direct.memberId],
  } }));
  assert.deepEqual(await apply(direct, withExpense), { status: "pending", entityId: null });
  assert.equal((await state(withExpense)).status, "pending");

  // A member whose changes need approval, another member's request, and a non-AI request all stay pending.
  const needsReview = await propose(reviewed, event("Synthetic reviewed walk"));
  assert.deepEqual(await apply(reviewed, needsReview), { status: "pending", entityId: null });
  assert.deepEqual(await apply(direct, needsReview), { status: "pending", entityId: null });
  const manual = await inTransaction(pool, (client) => createChangeRequestWithClient(client, reviewed.session, tripId,
    { ...event("Synthetic manual request"), source: "member" }, randomUUID()));
  assert.deepEqual(await apply(reviewed, manual.id), { status: "pending", entityId: null });
  // Applying twice is harmless: an approved request is left as it is.
  assert.deepEqual(await apply(owner, ownerEvent), { status: "pending", entityId: null });
  assert.equal((await state(ownerEvent)).status, "approved");
}
