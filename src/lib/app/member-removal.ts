import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { AppConflictError, AppForbiddenError, AppNotFoundError, appendAudit, assertTrip, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import { memberPaymentSnapshot, type MemberPaymentRow } from "@/lib/app/member-payments";
import type { AuthenticatedSession } from "@/lib/auth/repository";

export const memberRemovalInputSchema = z.strictObject({
  confirmation: z.literal(true), expectedRevision: z.number().int().positive(),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  expenseReassignments: z.array(z.strictObject({
    expenseId: z.uuid(), expectedRevision: z.number().int().positive(),
    replacementPayerMemberId: z.uuid().optional(), shareRecipientMemberId: z.uuid().optional(),
  })).max(500).optional(),
  paymentReassignments: z.array(z.strictObject({
    paymentId: z.uuid(), expectedRevision: z.number().int().positive(),
    replacementAccountingFromMemberId: z.uuid().optional(), replacementAccountingToMemberId: z.uuid().optional(),
  })).max(500).optional(),
});
export type MemberRemovalInput = z.infer<typeof memberRemovalInputSchema>;
export type MemberRemovalPreview = {
  member: { id: string; displayName: string; role: string; status: string; revision: number };
  previewDigest: string;
  canRemove: boolean;
  canRemoveWithReassignment: boolean;
  blockedReason: "last_bound_owner" | "financial_links" | null;
  counts: { createdEvents: number; viewerLinks: number; expenses: number; actionableProposals: number; aiRequests: number; aiConversations: number; reusableInvites: number; payments?: number; pendingPayments?: number };
  expenses: Array<{ id: string; revision: number; currency: string; amountMinor: number; paidByTarget: boolean; shareMinor: number; description: string;
    requiresPayerReplacement: boolean; requiresShareRecipient: boolean; eligibleMembers: Array<{ id: string; displayName: string }> }>;
  hiddenPrivateExpenseCount: number;
  payments?: Array<{ id: string; revision: number; currency: string; amountMinor: number;
    fromMemberName: string; toMemberName: string; accountingFromMemberId: string; accountingToMemberId: string;
    accountingFromMemberName: string; accountingToMemberName: string;
    requiresFromReplacement: boolean; requiresToReplacement: boolean; eligibleMembers: Array<{ id: string; displayName: string }> }>;
};
type MemberRow = { id: string; display_name: string; role: string; status: string; current_revision: number; user_id: string | null };
type EventRow = Record<string, unknown> & { id: string; current_revision: number; viewer_member_ids: string[]; is_viewer: boolean };
type ExpenseRow = { id: string; current_revision: number; currency: string; amount_minor: string; payer_member_id: string; share_minor: string; description: string; status: string; can_view: boolean;
  itinerary_item_id: string | null; occurred_at: Date | string; splits: Array<{ memberId: string; shareMinor: string }>; eligible_members: Array<{ id: string; displayName: string }> };
type ProposalRow = { id: string; proposal_revision: number; status: string; proposed_patch: unknown; requested_by_member_id: string; entity_type: string; entity_id: string | null };
type RemovalPaymentRow = MemberPaymentRow & { from_member_name: string; to_member_name: string; accounting_from_member_name: string; accounting_to_member_name: string };
type RemovalState = { member: MemberRow; events: EventRow[]; expenses: ExpenseRow[]; payments: RemovalPaymentRow[]; paymentCandidates: Array<{ id: string; displayName: string }>; proposals: ProposalRow[]; reusableInvites: Array<{ id: string }>; remainingOwners: Array<{ id: string; user_id: string }>; preview: MemberRemovalPreview };

// JSON references have no foreign keys. Check structured member fields only,
// never string-replace UUIDs inside prose or mutate historical proposal payloads.
export function proposalReferencesMember(patch: unknown, memberId: string): boolean {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  const row = patch as Record<string, unknown>;
  const includes = (value: unknown) => Array.isArray(value) && value.includes(memberId);
  const customShareReferencesMember = Array.isArray(row.splitAmounts) && row.splitAmounts.some((split) =>
    split !== null && typeof split === "object" && !Array.isArray(split)
      && (split as Record<string, unknown>).memberId === memberId);
  return row.payerMemberId === memberId || row.createdByMemberId === memberId
    || includes(row.viewerMemberIds) || includes(row.splitMemberIds) || customShareReferencesMember
    || proposalReferencesMember(row.linkedExpense, memberId)
    || proposalReferencesMember(row.itineraryAudienceSnapshot, memberId);
}

function integer(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new AppConflictError("Member removal impact is outside the supported numeric range.");
  return result;
}

async function loadState(client: PoolClient, session: AuthenticatedSession, memberId: string): Promise<RemovalState> {
  const target = await client.query<MemberRow>(
    `SELECT id, display_name, role, status, current_revision, user_id FROM trip_members
      WHERE trip_id = $1 AND id = $2 AND status <> 'removed' FOR UPDATE`, [session.tripId, memberId]);
  const member = target.rows[0];
  if (!member) throw new AppNotFoundError("Member not found.");
  const owners = await client.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM trip_members WHERE trip_id = $1 AND id <> $2
      AND role = 'owner' AND status = 'active' AND user_id IS NOT NULL ORDER BY id FOR UPDATE`, [session.tripId, memberId]);
  const events = await client.query<EventRow>(
    `SELECT item.*, EXISTS (SELECT 1 FROM itinerary_item_viewers viewer
        WHERE viewer.trip_id = item.trip_id AND viewer.itinerary_item_id = item.id AND viewer.member_id = $2) AS is_viewer,
      ARRAY(SELECT viewer.member_id FROM itinerary_item_viewers viewer
        WHERE viewer.trip_id = item.trip_id AND viewer.itinerary_item_id = item.id ORDER BY viewer.member_id) AS viewer_member_ids
     FROM itinerary_items item WHERE item.trip_id = $1 AND (item.created_by_member_id = $2 OR EXISTS (
       SELECT 1 FROM itinerary_item_viewers viewer WHERE viewer.trip_id = item.trip_id AND viewer.itinerary_item_id = item.id AND viewer.member_id = $2))
     ORDER BY item.id FOR UPDATE OF item`, [session.tripId, memberId]);
  const expenses = await client.query<ExpenseRow>(
    `SELECT expense.id, expense.current_revision, expense.currency, expense.amount_minor::text, expense.payer_member_id,
      COALESCE((SELECT split.share_minor FROM expense_splits split WHERE split.trip_id = expense.trip_id
        AND split.expense_id = expense.id AND split.member_id = $2), 0)::text AS share_minor,
      expense.description, expense.status, app_member_can_view_expense(expense.trip_id, expense.id, $3) AS can_view
      ,expense.itinerary_item_id, expense.occurred_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('memberId',split.member_id,'shareMinor',split.share_minor::text) ORDER BY split.member_id)
        FROM expense_splits split WHERE split.trip_id = expense.trip_id AND split.expense_id = expense.id),'[]'::jsonb) AS splits,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',candidate.id,'displayName',candidate.display_name) ORDER BY candidate.id)
        FROM trip_members candidate WHERE candidate.trip_id = expense.trip_id AND candidate.status = 'active' AND candidate.id <> $2
          AND app_member_can_view_expense(expense.trip_id,expense.id,candidate.id)),'[]'::jsonb) AS eligible_members
     FROM expenses expense WHERE expense.trip_id = $1 AND (expense.payer_member_id = $2 OR EXISTS (
       SELECT 1 FROM expense_splits split WHERE split.trip_id = expense.trip_id AND split.expense_id = expense.id AND split.member_id = $2))
     ORDER BY expense.id FOR UPDATE OF expense`, [session.tripId, memberId, session.memberId]);
  // Historical upgrade fixtures predate payments. Do not silently bypass a
  // present table or its constraints; only the pre-0040 schema has no payments.
  const paymentSchema = await client.query<{ available: boolean }>(`SELECT to_regclass('member_payments') IS NOT NULL AS available`);
  const paymentCandidates = paymentSchema.rows[0]?.available ? (await client.query<{ id: string; displayName: string }>(
    `SELECT id, display_name AS "displayName" FROM trip_members WHERE trip_id = $1 AND id <> $2
      AND status = 'active' ORDER BY id FOR UPDATE`, [session.tripId, memberId])).rows : [];
  const payments = paymentSchema.rows[0]?.available ? (await client.query<RemovalPaymentRow>(
    `SELECT payment.*, original_from.display_name AS from_member_name, original_to.display_name AS to_member_name,
      accounting_from.display_name AS accounting_from_member_name, accounting_to.display_name AS accounting_to_member_name
     FROM member_payments payment
     JOIN trip_members original_from ON (original_from.trip_id, original_from.id) = (payment.trip_id, payment.from_member_id)
     JOIN trip_members original_to ON (original_to.trip_id, original_to.id) = (payment.trip_id, payment.to_member_id)
     JOIN trip_members accounting_from ON (accounting_from.trip_id, accounting_from.id) = (payment.trip_id, payment.accounting_from_member_id)
     JOIN trip_members accounting_to ON (accounting_to.trip_id, accounting_to.id) = (payment.trip_id, payment.accounting_to_member_id)
     WHERE payment.trip_id = $1 AND (
       (payment.status = 'posted' AND $2 IN (payment.accounting_from_member_id, payment.accounting_to_member_id)) OR
       (payment.status IN ('pending','rejected') AND $2 IN (payment.from_member_id, payment.to_member_id,
         payment.accounting_from_member_id, payment.accounting_to_member_id, payment.created_by_member_id)))
     ORDER BY payment.id FOR UPDATE OF payment`, [session.tripId, memberId])).rows : [];
  const proposals = await client.query<ProposalRow>(
    `SELECT id, proposal_revision, status, proposed_patch, requested_by_member_id, entity_type, entity_id FROM change_requests
      WHERE trip_id = $1 AND status IN ('pending','rejected') AND invalidated_at IS NULL ORDER BY id FOR UPDATE`, [session.tripId]);
  // Partial patches can omit unchanged payer/audience fields. Invalidate their
  // old base too, but not requests for retained creator-only or void history.
  const changedExpenses = new Set(expenses.rows.filter((expense) => expense.status !== "void").map((expense) => expense.id));
  const changedEvents = new Set(events.rows.filter((event) => event.is_viewer).map((event) => event.id));
  const dependent = proposals.rows.filter((proposal) => proposal.requested_by_member_id === memberId
    || proposalReferencesMember(proposal.proposed_patch, memberId)
    || (proposal.entity_id !== null && (proposal.entity_type === "expense" ? changedExpenses.has(proposal.entity_id)
      : proposal.entity_type === "itinerary_item" && changedEvents.has(proposal.entity_id))));
  const history = await client.query<{ requests: string; conversations: string }>(
    `SELECT (SELECT count(*) FROM ai_requests WHERE trip_id = $1 AND actor_member_id = $2)::text AS requests,
      (SELECT count(*) FROM ai_conversations WHERE trip_id = $1 AND actor_member_id = $2)::text AS conversations`, [session.tripId, memberId]);
  const reusableInvites = await client.query<{ id: string }>(
    `SELECT id FROM trip_join_links WHERE trip_id = $1 AND created_by_member_id = $2
      AND revoked_at IS NULL AND exhausted_at IS NULL ORDER BY id FOR UPDATE`, [session.tripId, memberId]);
  const financial = expenses.rows.filter((expense) => expense.status !== "void");
  const postedPayments = payments.filter((payment) => payment.status === "posted");
  const blockedReason = member.role === "owner" && owners.rows.length === 0 ? "last_bound_owner" : financial.length || postedPayments.length ? "financial_links" : null;
  const previewDigest = createHash("sha256").update(JSON.stringify({
    tripId: session.tripId, actorId: session.memberId, member,
    events: events.rows.map((event) => [event.id, event.current_revision, event.viewer_member_ids]),
    expenses: expenses.rows, payments, paymentCandidates, proposals: dependent, owners: owners.rows, reusableInvites: reusableInvites.rows,
  })).digest("hex");
  const preview: MemberRemovalPreview = {
    member: { id: member.id, displayName: member.display_name, role: member.role, status: member.status, revision: member.current_revision },
    previewDigest, canRemove: blockedReason === null, blockedReason,
    canRemoveWithReassignment: blockedReason !== "last_bound_owner" && financial.every((expense) => expense.can_view
      && ((expense.payer_member_id !== memberId && integer(expense.share_minor) === 0) || expense.eligible_members.length > 0))
      && (!postedPayments.length || paymentCandidates.length > 0),
    counts: { createdEvents: events.rows.filter((event) => event.created_by_member_id === memberId).length,
      viewerLinks: events.rows.filter((event) => event.is_viewer).length, expenses: financial.length,
      actionableProposals: dependent.length, aiRequests: integer(history.rows[0]?.requests ?? "0"), aiConversations: integer(history.rows[0]?.conversations ?? "0"),
      reusableInvites: reusableInvites.rows.length, payments: postedPayments.length, pendingPayments: payments.length - postedPayments.length },
    expenses: financial.filter((expense) => expense.can_view).map((expense) => ({
      id: expense.id, revision: expense.current_revision, currency: expense.currency,
      amountMinor: integer(expense.amount_minor), paidByTarget: expense.payer_member_id === memberId,
      shareMinor: integer(expense.share_minor), description: expense.description,
      requiresPayerReplacement: expense.payer_member_id === memberId, requiresShareRecipient: integer(expense.share_minor) > 0,
      eligibleMembers: expense.eligible_members,
    })),
    hiddenPrivateExpenseCount: financial.filter((expense) => !expense.can_view).length,
    payments: postedPayments.map((payment) => ({ id: payment.id, revision: payment.current_revision, currency: payment.currency,
      amountMinor: integer(payment.amount_minor), fromMemberName: payment.from_member_name, toMemberName: payment.to_member_name,
      accountingFromMemberId: payment.accounting_from_member_id, accountingToMemberId: payment.accounting_to_member_id,
      accountingFromMemberName: payment.accounting_from_member_name, accountingToMemberName: payment.accounting_to_member_name,
      requiresFromReplacement: payment.accounting_from_member_id === memberId, requiresToReplacement: payment.accounting_to_member_id === memberId,
      eligibleMembers: paymentCandidates })),
  };
  return { member, events: events.rows, expenses: expenses.rows, payments, paymentCandidates, proposals: dependent, reusableInvites: reusableInvites.rows, remainingOwners: owners.rows, preview };
}

export async function getTripMemberRemovalPreview(pool: Pool, session: AuthenticatedSession, tripId: string, memberId: string): Promise<MemberRemovalPreview> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only an owner can remove members.");
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: true });
    return (await loadState(client, session, memberId)).preview;
  });
}

function itinerarySnapshot(row: EventRow, viewerMemberIds: string[]): Record<string, unknown> {
  const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value;
  return { id: row.id, tripDayId: row.trip_day_id, title: row.title, itemType: row.item_type,
    startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), locationName: row.location_name, mapUrl: row.map_url,
    departureLocationName: row.departure_location_name, departureMapUrl: row.departure_map_url,
    destinationLocationName: row.destination_location_name, destinationMapUrl: row.destination_map_url,
    notes: row.notes, createdByMemberId: row.created_by_member_id, visibility: row.visibility,
    viewerMemberIds, status: row.status, isLocked: row.is_locked, currentRevision: row.current_revision,
    ...(row.removed_at ? { removedAt: iso(row.removed_at), removedByMemberId: row.removed_by_member_id } : {}) };
}

function financialReassignments(state: RemovalState, input: MemberRemovalInput) {
  const plans = input.expenseReassignments ?? [];
  const expenses = state.expenses.filter((expense) => expense.status !== "void");
  if (new Set(plans.map((plan) => plan.expenseId)).size !== plans.length
    || plans.length !== expenses.length || !state.preview.canRemoveWithReassignment) {
    throw new AppConflictError("Resolve this member's expense payer and split links before removal. No money was changed.");
  }
  return expenses.map((expense) => {
    const plan = plans.find((candidate) => candidate.expenseId === expense.id);
    const eligible = new Set(expense.eligible_members.map((member) => member.id));
    const changesPayer = expense.payer_member_id === state.member.id;
    const removedShare = integer(expense.share_minor);
    if (!plan || plan.expectedRevision !== expense.current_revision || !expense.can_view
      || (changesPayer ? !plan.replacementPayerMemberId || !eligible.has(plan.replacementPayerMemberId) : plan.replacementPayerMemberId !== undefined)
      || (removedShare > 0 ? !plan.shareRecipientMemberId || !eligible.has(plan.shareRecipientMemberId) : plan.shareRecipientMemberId !== undefined)) {
      throw new AppConflictError("Choose an eligible active member who can already view the expense for each required reassignment. No money was changed.");
    }
    const originalSplits = expense.splits.map((split) => ({ memberId: split.memberId, shareMinor: integer(split.shareMinor) }));
    const splits = originalSplits.filter((split) => split.memberId !== state.member.id).map((split) => ({ ...split }));
    if (removedShare > 0 && plan.shareRecipientMemberId) {
      const recipient = splits.find((split) => split.memberId === plan.shareRecipientMemberId);
      if (recipient) recipient.shareMinor = integer(recipient.shareMinor + removedShare);
      else splits.push({ memberId: plan.shareRecipientMemberId, shareMinor: removedShare });
    }
    if (splits.reduce((total, split) => integer(total + split.shareMinor), 0)
      !== originalSplits.reduce((total, split) => integer(total + split.shareMinor), 0)) {
      throw new AppConflictError("Expense reassignment must preserve the exact existing allocation.");
    }
    const payerMemberId = changesPayer ? plan.replacementPayerMemberId! : expense.payer_member_id;
    const snapshot = { id: expense.id, payerMemberId: expense.payer_member_id, itineraryItemId: expense.itinerary_item_id,
      description: expense.description, amountMinor: integer(expense.amount_minor), currency: expense.currency, status: expense.status,
      occurredAt: expense.occurred_at instanceof Date ? expense.occurred_at.toISOString() : expense.occurred_at,
      currentRevision: expense.current_revision, splits: originalSplits };
    return { expense, before: snapshot, after: { ...snapshot, payerMemberId, splits, currentRevision: expense.current_revision + 1 } };
  });
}

function paymentReassignments(state: RemovalState, input: MemberRemovalInput) {
  const plans = input.paymentReassignments ?? [];
  const payments = state.payments.filter((payment) => payment.status === "posted");
  const eligible = new Set(state.paymentCandidates.map((member) => member.id));
  if (new Set(plans.map((plan) => plan.paymentId)).size !== plans.length || plans.length !== payments.length) {
    throw new AppConflictError("Explicitly reassign every affected repayment accounting link before removal. No money was changed.");
  }
  return payments.map((payment) => {
    const plan = plans.find((candidate) => candidate.paymentId === payment.id);
    const fromRequired = payment.accounting_from_member_id === state.member.id;
    const toRequired = payment.accounting_to_member_id === state.member.id;
    if (!plan || plan.expectedRevision !== payment.current_revision
      || (fromRequired ? !plan.replacementAccountingFromMemberId || !eligible.has(plan.replacementAccountingFromMemberId) : plan.replacementAccountingFromMemberId !== undefined)
      || (toRequired ? !plan.replacementAccountingToMemberId || !eligible.has(plan.replacementAccountingToMemberId) : plan.replacementAccountingToMemberId !== undefined)) {
      throw new AppConflictError("Choose an active member of this trip for each affected repayment accounting link. No money was changed.");
    }
    return { payment, fromMemberId: fromRequired ? plan.replacementAccountingFromMemberId! : payment.accounting_from_member_id,
      toMemberId: toRequired ? plan.replacementAccountingToMemberId! : payment.accounting_to_member_id };
  });
}

export async function removeTripMemberSafely(pool: Pool, session: AuthenticatedSession, tripId: string, memberId: string, input: MemberRemovalInput): Promise<{ removed: true; invalidatedProposalCount: number; removedViewerLinkCount: number }> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only an owner can remove members.");
  const parsed = memberRemovalInputSchema.parse(input);
  return inTransaction(pool, async (client) => {
    // Shared mutation ordering is trip, acting user, then member rows. Never
    // take a second user's advisory lock during a co-owner removal.
    await lockCurrentTripActor(client, session, { owner: true });
    const state = await loadState(client, session, memberId);
    if (state.member.current_revision !== parsed.expectedRevision || state.preview.previewDigest !== parsed.previewDigest) {
      throw new AppConflictError("Member links changed. Review the removal preview again.");
    }
    if (state.preview.blockedReason === "last_bound_owner") throw new AppConflictError("Keep at least one active Google-bound owner in this trip.");
    const reallocations = financialReassignments(state, parsed);
    // Validate all financial choices before changing even one expense/payment.
    const repaymentReallocations = paymentReassignments(state, parsed);
    for (const { expense, before, after } of reallocations) {
      await client.query(`UPDATE expenses SET payer_member_id = $3 WHERE trip_id = $1 AND id = $2`, [tripId, expense.id, after.payerMemberId]);
      await client.query(`DELETE FROM expense_splits WHERE trip_id = $1 AND expense_id = $2`, [tripId, expense.id]);
      for (const split of after.splits) {
        await client.query(`INSERT INTO expense_splits (trip_id,expense_id,member_id,share_minor) VALUES ($1,$2,$3,$4)`, [tripId, expense.id, split.memberId, split.shareMinor]);
      }
      await client.query(`INSERT INTO expense_revisions (trip_id,expense_id,revision,changed_by_member_id,snapshot)
        VALUES ($1,$2,$3,$4,$5::jsonb)`, [tripId, expense.id, after.currentRevision, session.memberId, JSON.stringify(after)]);
      await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "expense", entityId: expense.id,
        action: "member_reassigned", before, after, metadata: { removedMemberId: memberId, explicitOwnerConfirmation: true } });
    }
    for (const payment of state.payments) {
      const reassignment = repaymentReallocations.find((entry) => entry.payment.id === payment.id);
      const updated = reassignment
        ? await client.query<MemberPaymentRow>(`UPDATE member_payments SET accounting_from_member_id = $3, accounting_to_member_id = $4
            WHERE trip_id = $1 AND id = $2 RETURNING *`, [tripId, payment.id, reassignment.fromMemberId, reassignment.toMemberId])
        : await client.query<MemberPaymentRow>(`UPDATE member_payments SET status = 'void' WHERE trip_id = $1 AND id = $2 RETURNING *`, [tripId, payment.id]);
      const before = memberPaymentSnapshot(payment);
      const after = memberPaymentSnapshot(updated.rows[0]);
      const action = reassignment ? "member_reassigned" : "void";
      const reason = reassignment ? "Member removed; accounting links reassigned, original payment facts retained" : "Member removed; unapproved payment permanently invalidated";
      await client.query(`INSERT INTO member_payment_revisions (trip_id,payment_id,revision,changed_by_member_id,changed_by_user_id,snapshot,action,reason)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [tripId, payment.id, updated.rows[0].current_revision, session.memberId, session.userId, JSON.stringify(after), action, reason]);
      await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "member_payment", entityId: payment.id,
        action, before, after, metadata: { removedMemberId: memberId, explicitOwnerConfirmation: true,
          originalPaymentRetained: true, accountingOnly: Boolean(reassignment), reason: "member_removed" } });
    }
    if (state.member.role === "owner" && state.member.user_id && state.remainingOwners[0]) {
      await client.query(`UPDATE trips SET owner_user_id = $3 WHERE id = $1 AND owner_user_id = $2`, [tripId, state.member.user_id, state.remainingOwners[0].user_id]);
    }
    await client.query(`UPDATE trip_members SET status = 'removed', current_revision = current_revision + 1 WHERE trip_id = $1 AND id = $2`, [tripId, memberId]);
    for (const event of state.events.filter((event) => event.is_viewer)) {
      const viewers = event.viewer_member_ids.filter((id) => id !== memberId);
      const before = itinerarySnapshot(event, event.viewer_member_ids);
      const after = itinerarySnapshot({ ...event, current_revision: event.current_revision + 1 }, viewers);
      await client.query(`DELETE FROM itinerary_item_viewers WHERE trip_id = $1 AND itinerary_item_id = $2 AND member_id = $3`, [tripId, event.id, memberId]);
      await client.query(`INSERT INTO itinerary_revisions (trip_id,itinerary_item_id,revision,changed_by_member_id,snapshot,reason)
        VALUES ($1,$2,$3,$4,$5::jsonb,'Member access removed; original authorship retained')`, [tripId, event.id, event.current_revision + 1, session.memberId, JSON.stringify(after)]);
      await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "itinerary_item", entityId: event.id,
        action: "member_access_removed", before, after, metadata: { removedMemberId: memberId } });
    }
    for (const proposal of state.proposals) {
      await client.query(`UPDATE change_requests SET invalidated_at = CURRENT_TIMESTAMP, invalidated_reason = 'member_removed',
        invalidated_by_member_id = $3, invalidated_member_id = $4 WHERE trip_id = $1 AND id = $2 AND invalidated_at IS NULL`, [tripId, proposal.id, session.memberId, memberId]);
      await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "change_request", entityId: proposal.id,
        action: "invalidated", metadata: { reason: "member_removed", removedMemberId: memberId, retainedStatus: proposal.status } });
    }
    await client.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at,CURRENT_TIMESTAMP), revoke_reason = COALESCE(revoke_reason,'member_removed') WHERE trip_id = $1 AND member_id = $2`, [tripId, memberId]);
    await client.query(`UPDATE member_claim_links SET revoked_at = COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE trip_id = $1 AND member_id = $2 AND consumed_at IS NULL AND revoked_at IS NULL`, [tripId, memberId]);
    if (state.reusableInvites.length) await client.query(`UPDATE trip_join_links SET revoked_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND created_by_member_id = $2 AND id = ANY($3::uuid[]) AND revoked_at IS NULL AND exhausted_at IS NULL`,
    [tripId, memberId, state.reusableInvites.map((link) => link.id)]);
    await client.query(`DELETE FROM calendar_connections WHERE trip_id = $1 AND member_id = $2`, [tripId, memberId]);
    await client.query(`DELETE FROM calendar_event_links WHERE trip_id = $1 AND member_id = $2`, [tripId, memberId]);
    await client.query(`DELETE FROM weather_refresh_leases WHERE trip_id = $1 AND member_id = $2`, [tripId, memberId]);
    const conversations = await client.query<{ id: string }>(`UPDATE ai_conversations SET closed_at = COALESCE(closed_at,CURRENT_TIMESTAMP),
      closed_reason = 'member_removed', history_revoked_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND actor_member_id = $2 AND history_revoked_at IS NULL RETURNING id`, [tripId, memberId]);
    for (const conversation of conversations.rows) {
      await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "ai_conversation", entityId: conversation.id,
        action: "closed", metadata: { cause: "member_removed", removedMemberId: memberId } });
    }
    await client.query(`UPDATE ai_requests SET status = 'failed', error_code = 'AiRequestInterruptedError', completed_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND actor_member_id = $2 AND status = 'started'`, [tripId, memberId]);
    await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "trip_member", entityId: memberId, action: "removed",
      before: state.preview.member, after: { ...state.preview.member, status: "removed", revision: state.member.current_revision + 1 },
      metadata: { retainedHistory: true, removedViewerLinkCount: state.preview.counts.viewerLinks, invalidatedProposalCount: state.proposals.length,
        revokedReusableInviteCount: state.reusableInvites.length, reassignedPaymentCount: repaymentReallocations.length,
        invalidatedPaymentCount: state.payments.length - repaymentReallocations.length } });
    return { removed: true, invalidatedProposalCount: state.proposals.length, removedViewerLinkCount: state.preview.counts.viewerLinks };
  });
}
