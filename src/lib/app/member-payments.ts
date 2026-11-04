import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { AppConflictError, AppForbiddenError, AppInvalidInputError, AppNotFoundError,
  appendAudit, assertTrip, getMemberPermissions, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { AuthenticatedSession } from "@/lib/auth/repository";

export type MemberPaymentStatus = "pending" | "posted" | "rejected" | "void";
export type MemberPayment = {
  id: string; fromMemberId: string; toMemberId: string;
  accountingFromMemberId: string; accountingToMemberId: string;
  fromMemberName: string; toMemberName: string;
  accountingFromMemberName: string; accountingToMemberName: string;
  currency: string; amountMinor: number; occurredAt: string; note: string | null;
  status: MemberPaymentStatus; revision: number; createdByMemberId: string; createdAt: string;
  canVoid: boolean; canReview: boolean;
};
export type MemberPaymentActor = {
  tripId: string; memberId: string; isOwner: boolean; canEditExpenses: boolean; expenseRequiresApproval: boolean;
};
export type MemberPaymentRow = {
  trip_id: string; id: string; from_member_id: string; to_member_id: string;
  accounting_from_member_id: string; accounting_to_member_id: string;
  currency: string; amount_minor: string | number; occurred_at: Date | string; note: string | null;
  status: MemberPaymentStatus; current_revision: number; created_by_member_id: string; created_by_user_id: string;
  created_at: Date | string; updated_at: Date | string;
  from_member_name?: string; to_member_name?: string;
  accounting_from_member_name?: string; accounting_to_member_name?: string;
};
type Queryable = Pick<PoolClient, "query">;
const memberPaymentUuid = z.uuid().transform((value) => value.toLowerCase());

export const memberPaymentCreateSchema = z.strictObject({
  fromMemberId: memberPaymentUuid, toMemberId: memberPaymentUuid, currency: z.string().regex(/^[A-Z]{3}$/u),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.iso.datetime({ offset: true }), note: z.string().trim().max(1000).optional(),
  clientRequestId: memberPaymentUuid, confirmation: z.literal(true),
}).refine((input) => input.fromMemberId !== input.toMemberId, {
  message: "Payment sender and recipient must be different members.", path: ["toMemberId"],
});
export const memberPaymentActionSchema = z.strictObject({
  action: z.enum(["approve", "reject", "void"]), expectedRevision: z.number().int().positive().max(2147483647),
  confirmation: z.literal(true), reason: z.string().trim().max(500).optional(), clientRequestId: memberPaymentUuid,
});
export type MemberPaymentCreateInput = z.infer<typeof memberPaymentCreateSchema>;
export type MemberPaymentActionInput = z.infer<typeof memberPaymentActionSchema>;

function iso(value: Date | string): string { return new Date(value).toISOString(); }
function amount(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new AppConflictError("Payment amount is outside the supported numeric range.");
  return result;
}

/** Original cash facts never change, including when bookkeeping is reassigned. */
export function memberPaymentSnapshot(row: MemberPaymentRow): Record<string, unknown> {
  return {
    id: row.id, fromMemberId: row.from_member_id, toMemberId: row.to_member_id,
    accountingFromMemberId: row.accounting_from_member_id, accountingToMemberId: row.accounting_to_member_id,
    currency: row.currency, amountMinor: amount(row.amount_minor), occurredAt: iso(row.occurred_at), note: row.note,
    status: row.status, currentRevision: row.current_revision,
    createdByMemberId: row.created_by_member_id, createdByUserId: row.created_by_user_id,
  };
}

export function memberPaymentCapabilities(row: Pick<MemberPaymentRow, "status" | "created_by_member_id">, actor: MemberPaymentActor) {
  const creator = row.created_by_member_id === actor.memberId;
  return {
    canReview: actor.isOwner && (row.status === "pending" || row.status === "rejected"),
    canVoid: row.status !== "void" && (actor.isOwner || (creator &&
      (row.status === "pending" || row.status === "rejected" || (actor.canEditExpenses && !actor.expenseRequiresApproval)))),
  };
}

function project(row: MemberPaymentRow, actor: MemberPaymentActor): MemberPayment {
  return {
    id: row.id, fromMemberId: row.from_member_id, toMemberId: row.to_member_id,
    accountingFromMemberId: row.accounting_from_member_id, accountingToMemberId: row.accounting_to_member_id,
    fromMemberName: row.from_member_name ?? "Removed member", toMemberName: row.to_member_name ?? "Removed member",
    accountingFromMemberName: row.accounting_from_member_name ?? "Removed member",
    accountingToMemberName: row.accounting_to_member_name ?? "Removed member",
    currency: row.currency, amountMinor: amount(row.amount_minor), occurredAt: iso(row.occurred_at), note: row.note,
    status: row.status, revision: row.current_revision, createdByMemberId: row.created_by_member_id,
    createdAt: iso(row.created_at), ...memberPaymentCapabilities(row, actor),
  };
}

const paymentSelect = `SELECT payment.*, sender.display_name AS from_member_name,
  recipient.display_name AS to_member_name, accounting_sender.display_name AS accounting_from_member_name,
  accounting_recipient.display_name AS accounting_to_member_name
  FROM member_payments payment
  JOIN trip_members sender ON sender.trip_id = payment.trip_id AND sender.id = payment.from_member_id
  JOIN trip_members recipient ON recipient.trip_id = payment.trip_id AND recipient.id = payment.to_member_id
  JOIN trip_members accounting_sender ON accounting_sender.trip_id = payment.trip_id AND accounting_sender.id = payment.accounting_from_member_id
  JOIN trip_members accounting_recipient ON accounting_recipient.trip_id = payment.trip_id AND accounting_recipient.id = payment.accounting_to_member_id`;
const paymentAudience = `EXISTS (SELECT 1 FROM trip_members viewer WHERE viewer.trip_id = payment.trip_id
  AND viewer.id = $2 AND viewer.status = 'active' AND (viewer.role = 'owner'
    OR viewer.id IN (payment.from_member_id, payment.to_member_id, payment.accounting_from_member_id,
      payment.accounting_to_member_id, payment.created_by_member_id)))`;

/** No expense join: reading a repayment never expands private-expense access. */
export async function loadMemberPayments(client: Queryable, actor: MemberPaymentActor): Promise<MemberPayment[]> {
  const result = await client.query<MemberPaymentRow>(`${paymentSelect}
    WHERE payment.trip_id = $1 AND ${paymentAudience} ORDER BY payment.occurred_at DESC, payment.id`, [actor.tripId, actor.memberId]);
  return result.rows.map((row) => project(row, actor));
}

async function loadPayment(client: Queryable, actor: MemberPaymentActor, paymentId: string): Promise<MemberPaymentRow> {
  const result = await client.query<MemberPaymentRow>(`${paymentSelect}
    WHERE payment.trip_id = $1 AND ${paymentAudience} AND payment.id = $3 FOR UPDATE OF payment`,
  [actor.tripId, actor.memberId, paymentId]);
  if (!result.rows[0]) throw new AppNotFoundError("Payment not found.");
  return result.rows[0];
}

async function actorFor(client: Queryable, session: AuthenticatedSession): Promise<MemberPaymentActor> {
  return { tripId: session.tripId, memberId: session.memberId, isOwner: session.role === "owner",
    ...await getMemberPermissions(client, session.tripId, session.memberId) };
}

async function assertEligibleParticipants(client: Queryable, tripId: string, memberIds: string[]): Promise<void> {
  const ids = [...new Set(memberIds)];
  const result = await client.query<{ id: string }>(`SELECT id FROM trip_members
    WHERE trip_id = $1 AND id = ANY($2::uuid[]) AND status IN ('active', 'invited')
    AND length(btrim(display_name)) > 0 ORDER BY id FOR UPDATE`, [tripId, ids]);
  if (result.rows.length !== ids.length) throw new AppInvalidInputError("Choose current, enabled trip members for this payment.");
}

/** A conservative gross bound keeps every authorized subset, net balance and
 * personal sent/received total representable without revealing private amounts.
 * Call only while holding the trip mutation lock; retries return before this. */
async function assertPostedPaymentCapacity(client: Queryable, tripId: string, currency: string, candidateAmountMinor: number): Promise<void> {
  const result = await client.query<{ committed_minor: string }>(`SELECT (
    (SELECT COALESCE(sum(amount_minor), 0) FROM expenses WHERE trip_id = $1 AND currency = $2 AND status = 'posted')
    + (SELECT COALESCE(sum(amount_minor), 0) FROM member_payments WHERE trip_id = $1 AND currency = $2 AND status = 'posted')
    )::text AS committed_minor`, [tripId, currency]);
  const committed = BigInt(result.rows[0].committed_minor);
  if (committed < 0n || committed + BigInt(candidateAmountMinor) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppInvalidInputError("This record exceeds the supported financial range. Check the amount or ask a trip owner to review it.");
  }
}

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function replay(client: Queryable, actor: MemberPaymentActor, clientRequestId: string, requestHash: string): Promise<MemberPayment | null> {
  const result = await client.query<{ payment_id: string; request_hash: string }>(
    `SELECT payment_id, request_hash FROM member_payment_actions WHERE trip_id = $1 AND actor_member_id = $2 AND client_request_id = $3`,
    [actor.tripId, actor.memberId, clientRequestId]);
  const previous = result.rows[0];
  if (!previous) return null;
  if (previous.request_hash !== requestHash) throw new AppConflictError("This payment request key was already used with different values.");
  // Return current truth, not an obsolete posted snapshot after a later void/removal.
  return project(await loadPayment(client, actor, previous.payment_id), actor);
}

async function recordRevision(client: Queryable, session: AuthenticatedSession, row: MemberPaymentRow,
  action: "create" | MemberPaymentActionInput["action"], clientRequestId: string, requestHash: string,
  before: Record<string, unknown> | null, reason: string | null): Promise<void> {
  const snapshot = memberPaymentSnapshot(row);
  await client.query(`INSERT INTO member_payment_revisions
    (trip_id, payment_id, revision, changed_by_member_id, changed_by_user_id, snapshot, action, reason)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
  [session.tripId, row.id, row.current_revision, session.memberId, session.userId, JSON.stringify(snapshot), action, reason]);
  await client.query(`INSERT INTO member_payment_actions
    (trip_id,id,actor_member_id,client_request_id,request_hash,payment_id,result_revision)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [session.tripId, randomUUID(), session.memberId, clientRequestId, requestHash, row.id, row.current_revision]);
  await appendAudit(client, { tripId: session.tripId, actorMemberId: session.memberId, entityType: "member_payment",
    entityId: row.id, action: `payment_${action}`, before, after: snapshot,
    metadata: { clientRequestId, ...(reason ? { reason } : {}), recordsExternalPaymentOnly: true } });
}

export async function createMemberPayment(pool: Pool, session: AuthenticatedSession, tripId: string,
  rawInput: MemberPaymentCreateInput): Promise<MemberPayment> {
  assertTrip(session, tripId);
  const input = memberPaymentCreateSchema.parse(rawInput);
  const requestHash = digest({ action: "create", fromMemberId: input.fromMemberId, toMemberId: input.toMemberId,
    currency: input.currency, amountMinor: input.amountMinor, occurredAt: iso(input.occurredAt), note: input.note || null });
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const actor = await actorFor(client, session);
    const previous = await replay(client, actor, input.clientRequestId, requestHash);
    if (previous) return previous;
    if (!actor.isOwner && (!actor.canEditExpenses || input.fromMemberId !== actor.memberId)) {
      throw new AppForbiddenError("You can only record your own repayments with expense editing permission.");
    }
    if (new Date(input.occurredAt).getTime() > Date.now() + 5 * 60_000) {
      throw new AppInvalidInputError("A repayment must already have happened; its time cannot be in the future.");
    }
    await assertEligibleParticipants(client, tripId, [input.fromMemberId, input.toMemberId]);
    const status = !actor.isOwner && actor.expenseRequiresApproval ? "pending" : "posted";
    if (status === "posted") await assertPostedPaymentCapacity(client, tripId, input.currency, input.amountMinor);
    const result = await client.query<MemberPaymentRow>(`INSERT INTO member_payments
      (trip_id,id,from_member_id,to_member_id,accounting_from_member_id,accounting_to_member_id,
       currency,amount_minor,occurred_at,note,status,created_by_member_id,created_by_user_id,client_request_id,request_hash)
      VALUES ($1,$2,$3,$4,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [tripId, randomUUID(), input.fromMemberId, input.toMemberId, input.currency, input.amountMinor,
      input.occurredAt, input.note || null, status, session.memberId, session.userId, input.clientRequestId, requestHash]);
    const row = result.rows[0];
    await recordRevision(client, session, row, "create", input.clientRequestId, requestHash, null, null);
    return project(await loadPayment(client, actor, row.id), actor);
  });
}

export async function updateMemberPayment(pool: Pool, session: AuthenticatedSession, tripId: string,
  paymentId: string, rawInput: MemberPaymentActionInput): Promise<MemberPayment> {
  assertTrip(session, tripId);
  z.uuid().parse(paymentId);
  const input = memberPaymentActionSchema.parse(rawInput);
  const requestHash = digest({ action: input.action, paymentId, expectedRevision: input.expectedRevision, reason: input.reason || null });
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const actor = await actorFor(client, session);
    const previous = await replay(client, actor, input.clientRequestId, requestHash);
    if (previous) return previous;
    const row = await loadPayment(client, actor, paymentId);
    if (row.current_revision !== input.expectedRevision) throw new AppConflictError("This payment changed. Refresh and review it again.");
    const capabilities = memberPaymentCapabilities(row, actor);
    if (input.action === "void") {
      if (!capabilities.canVoid) throw new AppForbiddenError("You cannot void this payment. Ask a trip owner to review it.");
    } else {
      if (!actor.isOwner) throw new AppForbiddenError("Only a trip owner can approve or reject repayments.");
      if (!capabilities.canReview || (input.action === "reject" && row.status !== "pending")) {
        throw new AppConflictError("This payment is not available for that review action.");
      }
    }
    if (input.action === "approve") {
      await assertEligibleParticipants(client, tripId, [row.from_member_id, row.to_member_id,
        row.accounting_from_member_id, row.accounting_to_member_id, row.created_by_member_id]);
      await assertPostedPaymentCapacity(client, tripId, row.currency, amount(row.amount_minor));
    }
    const status = input.action === "approve" ? "posted" : input.action === "reject" ? "rejected" : "void";
    const result = await client.query<MemberPaymentRow>(`UPDATE member_payments SET status = $4
      WHERE trip_id = $1 AND id = $2 AND current_revision = $3 RETURNING *`,
    [tripId, paymentId, input.expectedRevision, status]);
    if (result.rowCount !== 1) throw new AppConflictError("This payment changed. Refresh and review it again.");
    await recordRevision(client, session, result.rows[0], input.action, input.clientRequestId, requestHash,
      memberPaymentSnapshot(row), input.reason || null);
    return project(await loadPayment(client, actor, paymentId), actor);
  });
}
