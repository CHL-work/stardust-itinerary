import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { AuthenticatedSession } from "@/lib/auth/repository";
import { readCurrentSessionCeiling } from "@/lib/auth/session-lifetime";
import { isPlatformOperator } from "@/lib/auth/operator-access";
import { lockCurrentTripActor, requireAnotherBoundOwner } from "@/lib/app/trip-authorization";
import {
  DEFAULT_OWNER_MODEL,
  MEMBER_MODEL,
  ownerModelRegistry,
  providerDefaultModels,
  type ApprovalHistoryPage,
  type ApprovalRequest,
  type ChangeRequestInput,
  type CreateTripInput,
  type EventWeatherForecast,
  type EventWeatherTargetRole,
  type ExpensePatch,
  type ItineraryPatch,
  type OwnerModel,
  type PendingItineraryDraft,
  type PendingItineraryEditDetail,
  type PendingItineraryEditInput,
  type PendingItineraryEditPatch,
  type PendingItineraryProjection,
  type PendingExpenseProjection,
  type TripSettingsInput,
} from "@/lib/app/types";
import {
  createTripSchema,
  expensePatchSchema,
  itineraryPatchSchema,
  pendingItineraryEditSchema,
  tripSettingsSchema,
} from "@/lib/app/validation";
import { tripDateErrors } from "@/lib/app/trip-date-range";
import { normalizeDestination } from "@/lib/app/trip-destination-defaults";
import { validatedStoredDestinationDefaults } from "@/lib/app/trip-destination-cache";
import {
  canonicalizeItineraryLocationPatch,
  resolveItineraryLocationState,
  transportEndpointRequiredMessage,
  transportHasEndpoint,
  type ItineraryLocationState,
} from "@/lib/app/transport";
import { calculateMemberBalances, calculateSettlements } from "@/lib/domain/expense-ledger";
import { resolveExpenseSplits, type ExpenseAllocation } from "@/lib/domain/expenses";
import { expenseSplitsForPatch } from "@/lib/app/expense-split-patch";
import { approvalPresentationMemberIds, projectApprovalDisplay } from "@/lib/app/approval-presentation";
import { parseLocalizedDisruptionDetails } from "@/lib/disruptions/localization";
import { loadMemberPayments } from "@/lib/app/member-payments";
import { calendarSourceMetadata } from "@/lib/calendar/import-source";
import { loadActivityEntries } from "@/lib/app/activity-repository";

type Queryable = Pick<Pool | PoolClient, "query">;

type EventWeatherForecastRow = {
  itinerary_item_id: string;
  target_role: EventWeatherTargetRole;
  forecast_at: Date;
  sampled_at: Date;
  fetched_at: Date;
  stale_after: Date;
  weather_is_stale: boolean;
  location_label: string;
  location_precision: "event" | "trip_destination";
  provider: "open-meteo";
  weather_code: number;
  condition_key: string;
  icon_key: string;
  temperature_celsius: string | null;
  apparent_temperature_celsius: string | null;
  precipitation_probability_percent: number | null;
};

function eventWeatherForecast(row: EventWeatherForecastRow): EventWeatherForecast {
  return {
    targetRole: row.target_role,
    forecastAt: row.forecast_at.toISOString(),
    sampledAt: row.sampled_at.toISOString(),
    fetchedAt: row.fetched_at.toISOString(),
    staleAfter: row.stale_after.toISOString(),
    stale: row.weather_is_stale,
    locationLabel: row.location_label,
    locationPrecision: row.location_precision,
    provider: row.provider,
    weatherCode: row.weather_code,
    condition: row.condition_key,
    icon: row.icon_key,
    temperatureCelsius: row.temperature_celsius === null
      ? null : Number(row.temperature_celsius),
    apparentTemperatureCelsius: row.apparent_temperature_celsius === null
      ? null : Number(row.apparent_temperature_celsius),
    precipitationProbabilityPercent: row.precipitation_probability_percent,
  };
}

export class AppConflictError extends Error {}
export class AppForbiddenError extends Error {}
export class AppInvalidInputError extends Error {}
export class AppNotFoundError extends Error {}

function validatedExpenseSplits(patch: ExpensePatch, current?: { amountMinor: number; splits: readonly ExpenseAllocation[] }): ExpenseAllocation[] | null {
  try { return expenseSplitsForPatch(patch, current); }
  catch {
    throw new AppConflictError("Expense shares must match the selected participants and total exactly. Supply reconciled shares or explicitly choose equal splitting when changing an unequal total.");
  }
}
export class AiPolicyDeniedError extends AppForbiddenError {
  constructor(
    message: string,
    readonly reasonCode: "ai_disabled" | "daily_limit_reached" | "ai_key_required",
    readonly model: OwnerModel,
  ) {
    super(message);
    this.name = "AiPolicyDeniedError";
  }
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function assertTrip(session: AuthenticatedSession, tripId: string): void {
  if (session.tripId !== tripId) {
    throw new AppForbiddenError("This trip is not available to the current member.");
  }
}

type ItineraryAudience = {
  createdByMemberId: string;
  visibility: "trip" | "private";
  viewerMemberIds: string[];
  removed?: boolean;
};

type StoredExpensePatch = ExpensePatch & {
  itineraryAudienceSnapshot?: (ItineraryAudience & { itineraryItemId: string }) | null;
};

async function getItineraryAudience(
  client: Queryable,
  tripId: string,
  itemId: string,
  lock = false,
): Promise<ItineraryAudience | null> {
  const result = await client.query<{
    created_by_member_id: string;
    visibility: "trip" | "private";
    viewer_member_ids: string[];
    removed_at: string | null;
  }>(
    `SELECT i.created_by_member_id, i.visibility, to_jsonb(i)->>'removed_at' AS removed_at,
            COALESCE(ARRAY(
              SELECT iv.member_id
                FROM itinerary_item_viewers iv
               WHERE iv.trip_id = i.trip_id AND iv.itinerary_item_id = i.id
               ORDER BY iv.member_id
            ), ARRAY[]::uuid[]) AS viewer_member_ids
       FROM itinerary_items i
      WHERE i.trip_id = $1 AND i.id = $2${lock ? " FOR UPDATE OF i" : ""}`,
    [tripId, itemId],
  );
  const row = result.rows[0];
  return row ? {
    createdByMemberId: row.created_by_member_id,
    visibility: row.visibility,
    viewerMemberIds: row.viewer_member_ids,
    removed: Boolean(row.removed_at),
  } : null;
}

function audienceMemberIds(audience: ItineraryAudience): Set<string> | null {
  return audience.visibility === "private"
    ? new Set([audience.createdByMemberId, ...audience.viewerMemberIds])
    : null;
}

function canViewAudience(audience: ItineraryAudience, memberId: string): boolean {
  const members = audienceMemberIds(audience);
  return members === null || members.has(memberId);
}

function changeRequestPatchForClient(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const clientPatch = { ...patch };
  delete clientPatch.itineraryAudienceSnapshot;
  return clientPatch;
}

export const approvalHistoryPageSize = 25;

type ApprovalHistoryCursor = {
  version: 2;
  tripId: string;
  priority: 0 | 1;
  createdAt: string;
  id: string;
};

type ApprovalHistoryRow = {
  id: string;
  pending_priority: 0 | 1;
  requested_by_name: string;
  source: string;
  entity_type: string;
  entity_id: string | null;
  operation: string;
  base_revision: number | null;
  proposed_patch: Record<string, unknown>;
  reason: string;
  status: ApprovalRequest["status"];
  review_note: string | null;
  created_at: Date;
  cursor_created_at: string;
  reviewed_at: Date | null;
  requested_by_member_id?: string;
  base_patch?: Record<string, unknown> | null;
  applied_patch?: Record<string, unknown> | null;
  day_date?: string | null;
  proposal_revision?: number;
  updated_at?: Date;
  invalidated_reason?: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
// Keep the keyset boundary identical to the global ordering, including on
// historical schemas before proposal invalidation was introduced.
const approvalPendingPrioritySql = "CASE WHEN cr.status = 'pending' AND to_jsonb(cr)->>'invalidated_at' IS NULL THEN 1 ELSE 0 END";

function encodeApprovalHistoryCursor(tripId: string, row: ApprovalHistoryRow): string {
  const cursor: ApprovalHistoryCursor = {
    version: 2,
    tripId,
    priority: row.pending_priority,
    createdAt: row.cursor_created_at,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function parseApprovalHistoryCursor(
  rawCursor: string | null | undefined,
  tripId: string,
): { priority: 0 | 1; createdAt: string; id: string } | null {
  if (!rawCursor) return null;
  if (rawCursor.length > 768 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) {
    throw new AppInvalidInputError("The approval history cursor is invalid.");
  }

  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as Partial<ApprovalHistoryCursor>;
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
    const date = new Date(createdAt);
    if (
      parsed.version !== 2
      || parsed.tripId !== tripId
      || (parsed.priority !== 0 && parsed.priority !== 1)
      || !uuidPattern.test(parsed.id ?? "")
      || !cursorTimestampPattern.test(createdAt)
      || Number.isNaN(date.getTime())
      || date.toISOString() !== `${createdAt.slice(0, 23)}Z`
    ) {
      throw new Error("invalid cursor payload");
    }
    return { priority: parsed.priority, createdAt, id: parsed.id! };
  } catch (error) {
    if (error instanceof AppInvalidInputError) throw error;
    throw new AppInvalidInputError("The approval history cursor is invalid.");
  }
}

function approvalHistoryRowForClient(row: ApprovalHistoryRow, members: ReadonlyMap<string, string>): ApprovalRequest {
  return {
    id: row.id,
    requestedByName: row.requested_by_name,
    source: row.source,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    baseRevision: row.base_revision,
    patch: changeRequestPatchForClient(row.proposed_patch),
    reason: row.reason,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    proposalRevision: row.proposal_revision ?? 1,
    updatedAt: (row.updated_at ?? row.created_at).toISOString(),
    ...(row.invalidated_reason === "member_removed" ? { reviewBlockedReason: "member_removed" as const } : {}),
    display: projectApprovalDisplay(row, members),
  };
}

export async function getApprovalHistory(
  client: Queryable,
  session: AuthenticatedSession,
  tripId: string,
  rawCursor?: string | null,
  onlyRequestId?: string,
): Promise<ApprovalHistoryPage> {
  assertTrip(session, tripId);
  if (session.role !== "owner") {
    throw new AppForbiddenError("Only the owner can view approval history.");
  }
  const cursor = parseApprovalHistoryCursor(rawCursor, tripId);
  const result = await client.query<ApprovalHistoryRow>(
    `SELECT cr.id, tm.display_name AS requested_by_name, cr.source, cr.entity_type,
            ${approvalPendingPrioritySql} AS pending_priority,
            cr.entity_id, cr.operation, cr.base_revision, cr.proposed_patch,
            cr.reason, cr.status, cr.review_note, cr.created_at,
            to_char(cr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
            cr.reviewed_at, cr.requested_by_member_id,
            CASE WHEN cr.entity_type = 'itinerary_item' THEN itinerary_base.snapshot
                 WHEN cr.entity_type = 'expense' THEN expense_base.snapshot END AS base_patch,
            expense_applied.snapshot AS applied_patch,
            day.day_date::text AS day_date,
            COALESCE(NULLIF(to_jsonb(cr)->>'proposal_revision', '')::integer, 1) AS proposal_revision,
            COALESCE(NULLIF(to_jsonb(cr)->>'updated_at', '')::timestamptz, cr.created_at) AS updated_at,
            to_jsonb(cr)->>'invalidated_reason' AS invalidated_reason
       FROM change_requests cr
       JOIN trip_members tm
         ON tm.trip_id = cr.trip_id AND tm.id = cr.requested_by_member_id
       LEFT JOIN itinerary_revisions itinerary_base
         ON cr.entity_type = 'itinerary_item' AND itinerary_base.trip_id = cr.trip_id
        AND itinerary_base.itinerary_item_id = cr.entity_id AND itinerary_base.revision = cr.base_revision
       LEFT JOIN expense_revisions expense_base
         ON cr.entity_type = 'expense' AND expense_base.trip_id = cr.trip_id
       AND expense_base.expense_id = cr.entity_id AND expense_base.revision = cr.base_revision
       LEFT JOIN expense_revisions expense_applied
         ON cr.entity_type = 'expense' AND cr.status = 'approved' AND expense_applied.trip_id = cr.trip_id
        AND expense_applied.expense_id = cr.entity_id AND expense_applied.revision = cr.applied_revision
       LEFT JOIN trip_days day
         ON cr.entity_type = 'itinerary_item' AND day.trip_id = cr.trip_id
        AND day.id::text = COALESCE(cr.proposed_patch->>'tripDayId', itinerary_base.snapshot->>'tripDayId')
      WHERE cr.trip_id = $1
        AND app_member_can_view_change_request(cr.trip_id, cr.id, $2)
        ${onlyRequestId ? "AND cr.id = $7::uuid" : ""}
        AND ($3::integer IS NULL OR (${approvalPendingPrioritySql}, cr.created_at, cr.id) < ($3::integer, $4::timestamptz, $5::uuid))
      ORDER BY pending_priority DESC, cr.created_at DESC, cr.id DESC
      LIMIT $6`,
    [tripId, session.memberId, cursor?.priority ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, approvalHistoryPageSize + 1, ...(onlyRequestId ? [onlyRequestId] : [])],
  );
  const hasMore = result.rows.length > approvalHistoryPageSize;
  const pageRows = hasMore ? result.rows.slice(0, approvalHistoryPageSize) : result.rows;
  const memberIds = approvalPresentationMemberIds(pageRows);
  const memberRows = memberIds.length ? await client.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM trip_members WHERE trip_id = $1 AND id = ANY($2::uuid[])`,
    [tripId, memberIds],
  ) : { rows: [] };
  const members = new Map(memberRows.rows.map((member) => [member.id, member.display_name]));
  return {
    requests: pageRows.map((row) => approvalHistoryRowForClient(row, members)),
    nextCursor: hasMore && pageRows.length > 0
      ? encodeApprovalHistoryCursor(tripId, pageRows[pageRows.length - 1]!)
      : null,
  };
}

async function assertValidAudienceMembers(
  client: Queryable,
  tripId: string,
  memberIds: string[],
): Promise<void> {
  const uniqueMemberIds = [...new Set(memberIds)];
  if (uniqueMemberIds.length === 0) return;
  const members = await client.query<{ id: string }>(
    `SELECT id FROM trip_members
      WHERE trip_id = $1 AND id = ANY($2::uuid[])
        AND status NOT IN ('revoked', 'removed')`,
    [tripId, uniqueMemberIds],
  );
  if (members.rowCount !== uniqueMemberIds.length) {
    throw new AppNotFoundError("One or more selected members are unavailable.");
  }
}

function assertExpenseMembersInsideAudience(
  audience: ItineraryAudience,
  memberIds: string[],
): void {
  const allowed = audienceMemberIds(audience);
  if (!allowed) return;
  if (memberIds.some((memberId) => !allowed.has(memberId))) {
    throw new AppForbiddenError("A private event expense can only include people who can view that event.");
  }
}

export type MemberPermissions = {
  canEditItinerary: boolean;
  itineraryRequiresApproval: boolean;
  canEditExpenses: boolean;
  expenseRequiresApproval: boolean;
  canSyncCalendar: boolean;
};

export function memberCanDirectlyApplyChangeRequest(input: {
  entityType: "itinerary_item" | "expense";
  hasLinkedExpense: boolean;
  hasNonRequesterProposalEdit: boolean;
  permissions: MemberPermissions;
}): boolean {
  if (input.entityType === "itinerary_item" && input.hasNonRequesterProposalEdit) {
    return false;
  }
  return input.entityType === "itinerary_item"
    ? input.permissions.canEditItinerary && !input.permissions.itineraryRequiresApproval
      && (!input.hasLinkedExpense
        || (input.permissions.canEditExpenses && !input.permissions.expenseRequiresApproval))
    : input.permissions.canEditExpenses && !input.permissions.expenseRequiresApproval;
}

type PendingItineraryRequestRow = {
  id: string;
  operation?: "create" | "update" | "cancel" | "restore";
  entity_id?: string | null;
  requested_by_member_id: string;
  requested_by_name: string;
  source?: "member" | "owner" | "ai" | "import";
  reason?: string;
  base_patch?: Record<string, unknown> | null;
  current_patch?: Record<string, unknown> | null;
  proposed_patch: Record<string, unknown>;
  proposal_revision?: number;
  created_at: Date;
  updated_at?: Date;
};

export function projectPendingItinerary(
  row: PendingItineraryRequestRow,
): PendingItineraryProjection | null {
  const createdByMemberId = pendingItineraryCreatorId(row);
  const operation = row.operation ?? "create";
  const patch = materializePendingItineraryDraft(
    {
      ...(row.current_patch ?? {}),
      ...(row.base_patch ?? {}),
      ...row.proposed_patch,
      ...(operation === "cancel"
        ? { status: "cancelled" }
        : operation === "restore"
          ? { status: "planned" }
          : {}),
    },
    createdByMemberId,
  );
  if (!patch) return null;
  return {
    requestId: row.id,
    status: "pending",
    operation,
    targetItemId: row.entity_id ?? null,
    createdByMemberId,
    requestedByMemberId: row.requested_by_member_id,
    requestedByName: row.requested_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: (row.updated_at ?? row.created_at).toISOString(),
    proposalRevision: row.proposal_revision ?? 1,
    tripDayId: patch.tripDayId,
    title: patch.title,
    itemType: patch.itemType,
    startsAt: patch.startsAt,
    endsAt: patch.endsAt,
    locationName: patch.locationName,
    mapUrl: patch.mapUrl,
    departureLocationName: patch.departureLocationName,
    departureMapUrl: patch.departureMapUrl,
    destinationLocationName: patch.destinationLocationName,
    destinationMapUrl: patch.destinationMapUrl,
    notes: patch.notes,
    visibility: patch.visibility,
    viewerMemberIds: patch.viewerMemberIds,
  };
}

type PendingExpenseRequestRow = {
  id: string;
  proposal_revision: number;
  requested_by_member_id: string;
  requested_by_name: string;
  proposed_patch: Record<string, unknown>;
  created_at: Date;
};

export function projectPendingExpense(
  row: PendingExpenseRequestRow,
  members: ReadonlyMap<string, string>,
  visibleItinerary: ReadonlyMap<string, string>,
): PendingExpenseProjection | null {
  const parsed = expensePatchSchema.safeParse(row.proposed_patch);
  if (!parsed.success) return null;
  const patch = parsed.data;
  if (!patch.description || !patch.amountMinor || !patch.currency
      || !patch.payerMemberId || !patch.occurredAt || !patch.splitMemberIds?.length) {
    return null;
  }
  const payerName = members.get(patch.payerMemberId);
  const splitMemberIds = [...new Set(patch.splitMemberIds)];
  if (!payerName || splitMemberIds.some((memberId) => !members.has(memberId))) return null;
  let splitAmounts: ExpenseAllocation[];
  try { splitAmounts = resolveExpenseSplits(patch.amountMinor, patch.splitAmounts === undefined ? splitMemberIds : patch.splitMemberIds, patch.splitAmounts); }
  catch { return null; }
  return {
    requestId: row.id,
    proposalRevision: row.proposal_revision,
    status: "pending",
    requestedByMemberId: row.requested_by_member_id,
    requestedByName: row.requested_by_name,
    createdAt: row.created_at.toISOString(),
    description: patch.description,
    amountMinor: patch.amountMinor,
    currency: patch.currency,
    payerMemberId: patch.payerMemberId,
    payerName,
    itineraryItemId: patch.itineraryItemId ?? null,
    itineraryItemTitle: patch.itineraryItemId
      ? visibleItinerary.get(patch.itineraryItemId) ?? null
      : null,
    occurredAt: patch.occurredAt,
    splits: splitAmounts.map((split) => ({
      memberId: split.participantId,
      memberName: members.get(split.participantId)!,
      shareMinor: split.amountMinor,
    })),
  };
}

function materializePendingItineraryDraft(
  proposedPatch: Record<string, unknown>,
  requestedByMemberId: string,
): PendingItineraryDraft | null {
  const parsed = itineraryPatchSchema.safeParse(proposedPatch);
  if (!parsed.success) return null;

  const patch = parsed.data;
  const { tripDayId, title } = patch;
  if (!tripDayId || !title) return null;
  const locations = resolveItineraryLocationState(patch);
  if (!transportHasEndpoint(locations)) return null;
  const visibility = patch.visibility ?? "trip";
  const viewerMemberIds = visibility === "private"
    ? [...new Set(patch.viewerMemberIds ?? [])]
        .filter((memberId) => memberId !== requestedByMemberId)
    : [];
  if (patch.linkedExpense) {
    try { expenseSplitsForPatch(patch.linkedExpense); } catch { return null; }
  }
  const linkedExpense = patch.linkedExpense
    ? {
        ...patch.linkedExpense,
        splitMemberIds: [...new Set(patch.linkedExpense.splitMemberIds)],
      }
    : null;

  return {
    tripDayId,
    title,
    itemType: locations.itemType,
    startsAt: patch.startsAt ?? null,
    endsAt: patch.endsAt ?? null,
    locationName: locations.locationName,
    mapUrl: locations.mapUrl,
    departureLocationName: locations.departureLocationName,
    departureMapUrl: locations.departureMapUrl,
    destinationLocationName: locations.destinationLocationName,
    destinationMapUrl: locations.destinationMapUrl,
    notes: patch.notes ?? null,
    visibility,
    viewerMemberIds,
    status: patch.status ?? "planned",
    isLocked: patch.isLocked ?? false,
    linkedExpense,
  };
}

function pendingItineraryCreatorId(
  row: {
    operation?: string;
    requested_by_member_id: string;
    base_patch?: Record<string, unknown> | null;
    current_patch?: Record<string, unknown> | null;
  },
): string {
  const baseCreator = row.base_patch?.createdByMemberId ?? row.current_patch?.createdByMemberId;
  return row.operation !== undefined && row.operation !== "create" && typeof baseCreator === "string"
    ? baseCreator
    : row.requested_by_member_id;
}

const pendingItineraryCurrentPatchProjection = `CASE WHEN target.id IS NULL THEN NULL ELSE jsonb_build_object(
  'tripDayId', target.trip_day_id,
  'title', target.title,
  'itemType', target.item_type,
  'startsAt', target.starts_at,
  'endsAt', target.ends_at,
  'locationName', target.location_name,
  'mapUrl', target.map_url,
  'departureLocationName', target.departure_location_name,
  'departureMapUrl', target.departure_map_url,
  'destinationLocationName', target.destination_location_name,
  'destinationMapUrl', target.destination_map_url,
  'notes', target.notes,
  'createdByMemberId', target.created_by_member_id,
  'visibility', target.visibility,
  'viewerMemberIds', COALESCE((
    SELECT jsonb_agg(viewer.member_id ORDER BY viewer.member_id)
      FROM itinerary_item_viewers viewer
     WHERE viewer.trip_id = target.trip_id
       AND viewer.itinerary_item_id = target.id
  ), '[]'::jsonb),
  'status', target.status,
  'isLocked', target.is_locked
) END`;

export async function getMemberPermissions(
  client: Queryable,
  tripId: string,
  memberId: string,
): Promise<MemberPermissions> {
  const result = await client.query<{
    role: string;
    can_edit_itinerary: boolean | null;
    itinerary_requires_approval: boolean | null;
    can_edit_expenses: boolean | null;
    expense_requires_approval: boolean | null;
    can_sync_calendar: boolean | null;
  }>(
    `SELECT tm.role, mp.can_edit_itinerary, mp.itinerary_requires_approval,
            mp.can_edit_expenses, mp.expense_requires_approval, mp.can_sync_calendar
       FROM trip_members tm
       LEFT JOIN member_permissions mp
         ON mp.trip_id = tm.trip_id AND mp.member_id = tm.id
      WHERE tm.trip_id = $1 AND tm.id = $2 AND tm.status NOT IN ('revoked', 'removed')`,
    [tripId, memberId],
  );
  const row = result.rows[0];
  if (!row) throw new AppForbiddenError("Trip membership is unavailable.");
  if (row.role === "owner") {
    return {
      canEditItinerary: true,
      itineraryRequiresApproval: false,
      canEditExpenses: true,
      expenseRequiresApproval: false,
      canSyncCalendar: true,
    };
  }
  const editable = row.role === "editor";
  return {
    canEditItinerary: editable && (row.can_edit_itinerary ?? true),
    itineraryRequiresApproval: row.itinerary_requires_approval ?? editable,
    canEditExpenses: editable && (row.can_edit_expenses ?? true),
    expenseRequiresApproval: row.expense_requires_approval ?? false,
    canSyncCalendar: row.can_sync_calendar ?? editable,
  };
}

async function appendAudit(
  client: Queryable,
  input: {
    tripId: string;
    actorMemberId: string;
    entityType: string;
    entityId?: string | null;
    action: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (
       trip_id, id, actor_member_id, entity_type, entity_id, action,
       before_state, after_state, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
    [
      input.tripId,
      randomUUID(),
      input.actorMemberId,
      input.entityType,
      input.entityId ?? null,
      input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function getAppOverview(
  pool: Pool,
  session: AuthenticatedSession,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const overview = await readAppOverviewSnapshot(client, session);
    await client.query("COMMIT");
    return overview;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readAppOverviewSnapshot(
  client: PoolClient,
  session: AuthenticatedSession,
): Promise<Record<string, unknown>> {
  // Keep the overview readable while a freshly built local server is started
  // just before the additive live-context migration is applied. This also
  // makes interrupted local upgrades fail soft instead of taking the origin
  // down and surfacing as a Cloudflare 502.
  const liveContextResult = await client.query<{
    weather_available: boolean;
    disruptions_available: boolean;
    disruption_localizations_available: boolean;
    member_payments_available: boolean;
    calendar_imports_available: boolean;
  }>(
    `SELECT EXISTS (
              SELECT 1
                FROM pg_attribute
               WHERE attrelid = to_regclass('event_weather_forecasts')
                 AND attname = 'target_role'
                 AND NOT attisdropped
            ) AS weather_available,
            to_regclass('event_disruption_current') IS NOT NULL AS disruptions_available,
            to_regclass('event_disruption_localizations') IS NOT NULL AS disruption_localizations_available,
            to_regclass('member_payments') IS NOT NULL AS member_payments_available,
            to_regclass('calendar_import_receipts') IS NOT NULL AS calendar_imports_available`,
  );
  const liveContext = liveContextResult.rows[0] ?? {
    weather_available: false,
    disruptions_available: false,
    disruption_localizations_available: false,
    member_payments_available: false,
    calendar_imports_available: false,
  };
  const localizedDisruptionProjection = liveContext.disruptions_available && liveContext.disruption_localizations_available
    ? "dl.details AS disruption_localized_details"
    : "NULL::jsonb AS disruption_localized_details";
  const disruptionProjection = liveContext.disruptions_available
    ? `dc.observation_id AS disruption_observation_id,
       dc.evidence_fingerprint AS disruption_evidence_fingerprint,
       dc.state AS disruption_state,
       dc.reason_code AS disruption_reason_code,
       dc.severity AS disruption_severity,
       dc.detail AS disruption_detail,
       dc.source_urls AS disruption_source_urls,
       dc.first_seen_at AS disruption_first_seen_at,
       dc.last_seen_at AS disruption_last_seen_at,
       dc.checked_at AS disruption_checked_at,
       dc.stale_after AS disruption_stale_after`
    : `NULL::uuid AS disruption_observation_id,
       NULL::text AS disruption_evidence_fingerprint,
       NULL::text AS disruption_state,
       NULL::text AS disruption_reason_code,
       NULL::text AS disruption_severity,
       NULL::text AS disruption_detail,
       NULL::jsonb AS disruption_source_urls,
       NULL::timestamptz AS disruption_first_seen_at,
       NULL::timestamptz AS disruption_last_seen_at,
       NULL::timestamptz AS disruption_checked_at,
       NULL::timestamptz AS disruption_stale_after`;
  const disruptionJoin = liveContext.disruptions_available
    ? `LEFT JOIN event_disruption_current dc
         ON dc.trip_id = i.trip_id
        AND dc.itinerary_item_id = i.id
        AND dc.item_revision = i.current_revision
        AND dc.state = 'confirmed'
        AND dc.severity IN ('warning', 'critical')
        AND dc.stale_after > CURRENT_TIMESTAMP
        AND EXISTS (
          SELECT 1 FROM event_disruption_observations qualified
           WHERE qualified.trip_id = dc.trip_id
             AND qualified.id = dc.observation_id
             AND qualified.itinerary_item_id = dc.itinerary_item_id
             AND COALESCE(to_jsonb(qualified)->>'qualification_policy_version', '0') = '1'
        )
        ${liveContext.disruption_localizations_available
          ? `LEFT JOIN event_disruption_localizations dl
               ON dl.trip_id = dc.trip_id
              AND dl.itinerary_item_id = dc.itinerary_item_id
              AND dl.observation_id = dc.observation_id`
          : ""}`
    : "";
  const availableTripResult = await client.query<{
    id: string;
    name: string;
    destination_name: string;
    starts_on: string;
    ends_on: string;
    role: string;
  }>(
    `SELECT t.id, t.name, t.destination_name, t.starts_on::text, t.ends_on::text, tm.role
       FROM trip_members tm
       JOIN trips t ON t.id = tm.trip_id
      WHERE tm.user_id = $1 AND tm.status = 'active'
      ORDER BY (tm.trip_id = $2) DESC, t.starts_on DESC, t.name`,
    [session.userId, session.tripId],
  );
  const tripResult = await client.query<{
        id: string;
        name: string;
        destination_name: string;
        time_zone: string;
        default_locale: string;
        default_currency: string;
        starts_on: string;
        ends_on: string;
        max_members: number;
        member_count: number;
        join_link_active: boolean;
      }>(
        `SELECT id, name, destination_name, time_zone, default_locale,
                default_currency, starts_on::text, ends_on::text, max_members,
                (
                  SELECT count(*)::integer
                    FROM trip_members tm
                   WHERE tm.trip_id = trips.id AND tm.status <> 'removed'
                ) AS member_count,
                EXISTS (
                  SELECT 1
                    FROM trip_join_links tjl
                   WHERE tjl.trip_id = trips.id
                     AND tjl.revoked_at IS NULL
                     AND tjl.exhausted_at IS NULL
                ) AS join_link_active
           FROM trips WHERE id = $1`,
        [session.tripId],
  );
  const memberResult = await client.query<{ id: string; display_name: string; role: string; status: string; current_revision: number; identity_bound: boolean; can_remove: boolean }>(
        `SELECT tm.id, tm.display_name, tm.role, tm.status, tm.current_revision,
                (tm.user_id IS NOT NULL) AS identity_bound,
                (tm.role <> 'owner' OR EXISTS (
                  SELECT 1 FROM trip_members remaining WHERE remaining.trip_id = tm.trip_id AND remaining.id <> tm.id
                    AND remaining.role = 'owner' AND remaining.status = 'active' AND remaining.user_id IS NOT NULL
                )) AS can_remove
           FROM trip_members tm
          WHERE tm.trip_id = $1 AND tm.status <> 'removed'
          ORDER BY tm.role = 'owner' DESC, tm.created_at`,
        [session.tripId],
  );
  const permissionResult = await client.query<{
        member_id: string;
        can_edit_itinerary: boolean;
        itinerary_requires_approval: boolean;
        can_edit_expenses: boolean;
        expense_requires_approval: boolean;
        can_sync_calendar: boolean;
      }>(
        `SELECT member_id, can_edit_itinerary, itinerary_requires_approval,
                can_edit_expenses, expense_requires_approval, can_sync_calendar
           FROM member_permissions WHERE trip_id = $1`,
        [session.tripId],
  );
  const dayResult = await client.query<{ id: string; day_date: string; label: string | null }>(
        `SELECT d.id, d.day_date::text, d.label FROM trip_days d
          JOIN trips t ON t.id = d.trip_id
         WHERE d.trip_id = $1 AND d.day_date BETWEEN t.starts_on AND t.ends_on ORDER BY d.day_date`,
        [session.tripId],
  );
  const itemResult = await client.query<{
        id: string;
        trip_day_id: string;
        title: string;
        item_type: string;
        starts_at: Date | null;
        ends_at: Date | null;
        location_name: string | null;
        map_url: string | null;
        departure_location_name: string | null;
        departure_map_url: string | null;
        destination_location_name: string | null;
        destination_map_url: string | null;
        notes: string | null;
        status: string;
        is_locked: boolean;
        current_revision: number;
        created_by_member_id: string;
        creator_name: string;
        visibility: "trip" | "private";
        viewer_member_ids: string[];
        disruption_observation_id: string | null;
        disruption_evidence_fingerprint: string | null;
        disruption_state: "possible" | "confirmed" | null;
        disruption_reason_code: string | null;
        disruption_severity: "info" | "warning" | "critical" | null;
        disruption_detail: string | null;
        disruption_localized_details: unknown;
        disruption_source_urls: string[] | null;
        disruption_first_seen_at: Date | null;
        disruption_last_seen_at: Date | null;
        disruption_checked_at: Date | null;
        disruption_stale_after: Date | null;
      }>(
        `SELECT i.id, i.trip_day_id, i.title, i.item_type, i.starts_at, i.ends_at,
                i.location_name, i.map_url,
                i.departure_location_name, i.departure_map_url,
                i.destination_location_name, i.destination_map_url,
                i.notes, i.status, i.is_locked,
                i.current_revision,
                i.created_by_member_id, creator.display_name AS creator_name,
                i.visibility,
                ${disruptionProjection},
                ${localizedDisruptionProjection},
                COALESCE(ARRAY(
                  SELECT iv.member_id
                    FROM itinerary_item_viewers iv
                   WHERE iv.trip_id = i.trip_id AND iv.itinerary_item_id = i.id
                   ORDER BY iv.member_id
                ), ARRAY[]::uuid[]) AS viewer_member_ids
           FROM itinerary_items i
           JOIN trip_members creator
             ON creator.trip_id = i.trip_id AND creator.id = i.created_by_member_id
            ${disruptionJoin}
          WHERE i.trip_id = $1
            AND to_jsonb(i)->>'removed_at' IS NULL
            AND app_member_can_view_itinerary_item(i.trip_id, i.id, $2)
          ORDER BY i.starts_at NULLS LAST, i.created_at, i.id`,
    [session.tripId, session.memberId],
  );
  const weatherRows = liveContext.weather_available
    ? (await client.query<EventWeatherForecastRow>(
        `SELECT ew.itinerary_item_id, ew.target_role, ew.forecast_at,
                ew.sampled_at, ew.fetched_at, ew.stale_after,
                ew.stale_after <= CURRENT_TIMESTAMP AS weather_is_stale,
                ew.location_label, ew.location_precision, ew.provider,
                ew.weather_code, ew.condition_key, ew.icon_key,
                ew.temperature_celsius::text AS temperature_celsius,
                ew.apparent_temperature_celsius::text AS apparent_temperature_celsius,
                ew.precipitation_probability_percent
           FROM event_weather_forecasts ew
           JOIN itinerary_items i
             ON i.trip_id = ew.trip_id AND i.id = ew.itinerary_item_id
          WHERE ew.trip_id = $1
            AND to_jsonb(i)->>'removed_at' IS NULL
            AND ew.item_revision = i.current_revision
            AND ew.forecast_at >= CURRENT_TIMESTAMP - interval '3 hours'
            AND ew.forecast_at <= CURRENT_TIMESTAMP + interval '7 days'
            AND app_member_can_view_itinerary_item(i.trip_id, i.id, $2)
          ORDER BY ew.itinerary_item_id,
                   CASE ew.target_role
                     WHEN 'departure' THEN 1
                     WHEN 'destination' THEN 2
                     ELSE 3
                   END`,
        [session.tripId, session.memberId],
      )).rows
    : [];
  const expenseResult = await client.query<{
        id: string;
        description: string;
        amount_minor: string;
        currency: string;
        status: string;
        occurred_at: Date;
        current_revision: number;
        payer_member_id: string;
        itinerary_item_id: string | null;
        itinerary_item_title: string | null;
        itinerary_item_removed: boolean;
        itinerary_item_creator_id: string | null;
        itinerary_item_visibility: "trip" | "private" | null;
        itinerary_item_viewer_ids: string[];
        payer_name: string;
      }>(
        `SELECT e.id, e.description, e.amount_minor, e.currency, e.status,
                e.occurred_at, e.current_revision, e.payer_member_id,
                e.itinerary_item_id, i.title AS itinerary_item_title,
                (to_jsonb(i)->>'removed_at' IS NOT NULL) AS itinerary_item_removed,
                i.created_by_member_id AS itinerary_item_creator_id,
                i.visibility AS itinerary_item_visibility,
                COALESCE(ARRAY(
                  SELECT viewer.member_id FROM itinerary_item_viewers viewer
                   WHERE viewer.trip_id = i.trip_id AND viewer.itinerary_item_id = i.id
                   ORDER BY viewer.member_id
                ), ARRAY[]::uuid[]) AS itinerary_item_viewer_ids,
                tm.display_name AS payer_name
           FROM expenses e
           JOIN trip_members tm ON tm.trip_id = e.trip_id AND tm.id = e.payer_member_id
           LEFT JOIN itinerary_items i ON i.trip_id = e.trip_id AND i.id = e.itinerary_item_id
          WHERE e.trip_id = $1
            AND app_member_can_view_expense(e.trip_id, e.id, $2)
          ORDER BY e.occurred_at DESC`,
        [session.tripId, session.memberId],
  );
  const splitResult = await client.query<{ expense_id: string; member_id: string; member_name: string; share_minor: string }>(
        `SELECT es.expense_id, es.member_id, tm.display_name AS member_name, es.share_minor
           FROM expense_splits es
           JOIN expenses e ON e.trip_id = es.trip_id AND e.id = es.expense_id
           JOIN trip_members tm ON tm.trip_id = es.trip_id AND tm.id = es.member_id
          WHERE es.trip_id = $1
            AND app_member_can_view_expense(es.trip_id, es.expense_id, $2)
          ORDER BY es.expense_id, es.member_id`,
        [session.tripId, session.memberId],
  );
  const approvalPendingCountResult = await client.query<{ pending_count: string }>(
    `SELECT count(*)::text AS pending_count
       FROM change_requests cr
      WHERE cr.trip_id = $1
        AND cr.status = 'pending'
        AND to_jsonb(cr)->>'invalidated_at' IS NULL
        AND $3::boolean
        AND app_member_can_view_change_request(cr.trip_id, cr.id, $2)`,
    [session.tripId, session.memberId, session.role === "owner"],
  );
  const pendingItineraryRequestResult = await client.query<PendingItineraryRequestRow>(
        `SELECT cr.id, cr.operation, cr.entity_id, cr.requested_by_member_id,
                requester.display_name AS requested_by_name,
                base.snapshot AS base_patch,
                ${pendingItineraryCurrentPatchProjection} AS current_patch,
                cr.proposed_patch,
                COALESCE(
                  NULLIF(to_jsonb(cr)->>'proposal_revision', '')::integer,
                  1
                ) AS proposal_revision,
                cr.created_at,
                COALESCE(
                  NULLIF(to_jsonb(cr)->>'updated_at', '')::timestamptz,
                  cr.created_at
                ) AS updated_at
           FROM change_requests cr
           JOIN trip_members requester
             ON requester.trip_id = cr.trip_id
            AND requester.id = cr.requested_by_member_id
           LEFT JOIN itinerary_revisions base
             ON base.trip_id = cr.trip_id
            AND base.itinerary_item_id = cr.entity_id
            AND base.revision = cr.base_revision
           LEFT JOIN itinerary_items target
             ON target.trip_id = cr.trip_id
            AND target.id = cr.entity_id
          WHERE cr.trip_id = $1
            AND cr.status = 'pending'
            AND to_jsonb(cr)->>'invalidated_at' IS NULL
            AND cr.entity_type = 'itinerary_item'
            AND (cr.entity_id IS NULL OR to_jsonb(target)->>'removed_at' IS NULL)
            AND (
              (cr.operation = 'create' AND cr.entity_id IS NULL)
              OR (cr.operation IN ('update', 'cancel', 'restore') AND cr.entity_id IS NOT NULL)
            )
            AND app_member_can_view_change_request(cr.trip_id, cr.id, $2)
          ORDER BY cr.created_at, cr.id`,
        [session.tripId, session.memberId],
  );
  const pendingExpenseRequestResult = await client.query<PendingExpenseRequestRow>(
    `SELECT cr.id, cr.requested_by_member_id,
            requester.display_name AS requested_by_name,
            cr.proposed_patch, cr.created_at,
            COALESCE(NULLIF(to_jsonb(cr)->>'proposal_revision', '')::integer, 1) AS proposal_revision
       FROM change_requests cr
       JOIN trip_members requester
         ON requester.trip_id = cr.trip_id
        AND requester.id = cr.requested_by_member_id
      WHERE cr.trip_id = $1
        AND cr.status = 'pending'
        AND to_jsonb(cr)->>'invalidated_at' IS NULL
        AND cr.entity_type = 'expense'
        AND cr.operation = 'create'
        AND cr.entity_id IS NULL
        AND app_member_can_view_change_request(cr.trip_id, cr.id, $2)
      ORDER BY cr.created_at, cr.id`,
    [session.tripId, session.memberId],
  );
  const settingsResult = await client.query<{
        enabled: boolean;
        owner_default_model: OwnerModel;
        member_daily_limit: number;
        host_subscription_enabled: boolean;
        entitlement_available: boolean;
      }>(
        `SELECT enabled, owner_default_model, member_daily_limit,
                COALESCE((to_jsonb(settings)->>'host_subscription_enabled')::boolean, true) AS host_subscription_enabled,
                to_jsonb(settings) ? 'host_subscription_enabled' AS entitlement_available
           FROM trip_ai_settings settings WHERE trip_id = $1`,
        [session.tripId],
  );
  const latestWeatherRunResult = session.role === "owner" && liveContext.weather_available
    ? await client.query<{
        status: "succeeded" | "partial" | "failed";
        candidate_count: number;
        cache_hit_count: number;
        refreshed_count: number;
        failed_count: number;
        error_code: string | null;
        started_at: Date;
        completed_at: Date;
        last_success_at: Date | null;
      }>(
        `SELECT status, candidate_count, cache_hit_count, refreshed_count,
                failed_count, error_code, started_at, completed_at,
                (SELECT max(succeeded.completed_at)
                   FROM weather_refresh_runs succeeded
                  WHERE succeeded.trip_id = latest.trip_id
                    AND succeeded.status = 'succeeded') AS last_success_at
           FROM weather_refresh_runs latest
          WHERE latest.trip_id = $1
          ORDER BY latest.started_at DESC, latest.id DESC
          LIMIT 1`,
        [session.tripId],
      )
    : null;
  const disruptionOperationsResult = session.role === "owner" && liveContext.disruptions_available
    ? await client.query<{
        enabled: boolean;
        interval_minutes: number;
        next_due_at: Date;
        last_attempt_at: Date | null;
        last_success_at: Date | null;
        last_error_code: string | null;
        latest_run_status: "running" | "succeeded" | "failed" | "skipped" | null;
        latest_run_completed_at: Date | null;
      }>(
        `SELECT settings.enabled, settings.interval_minutes, settings.next_due_at,
                settings.last_attempt_at, settings.last_success_at,
                settings.last_error_code,
                latest.status AS latest_run_status,
                latest.completed_at AS latest_run_completed_at
           FROM trip_disruption_settings settings
           LEFT JOIN LATERAL (
             SELECT run.status, run.completed_at
               FROM disruption_monitor_runs run
              WHERE run.trip_id = settings.trip_id
              ORDER BY run.scheduled_for DESC, run.id DESC
              LIMIT 1
           ) latest ON true
          WHERE settings.trip_id = $1`,
        [session.tripId],
      )
    : null;
  const quotaResult = await client.query<{ used: string }>(
        `SELECT count(*)::text AS used
           FROM ai_requests
          WHERE trip_id = $1 AND actor_member_id = $2
            AND created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            AND status <> 'rejected'`,
        [session.tripId, session.memberId],
  );
  const activity = await loadActivityEntries(client, session);
  const aiResult = await client.query<{
        id: string;
        actor_name: string;
        prompt_text: string;
        result_text: string | null;
        requested_model: string;
        effective_model: string | null;
        feature: string;
        provider: string | null;
        transport: string | null;
        billing_basis: string | null;
        status: string;
        input_tokens: number | null;
        output_tokens: number | null;
        latency_ms: number | null;
        error_message: string | null;
        created_at: Date;
      }>(
        `SELECT ar.id, COALESCE(tm.display_name, 'Stardust monitor') AS actor_name,
                ar.prompt_text, ar.result_text,
                ar.requested_model, ar.effective_model, ar.feature, ar.provider,
                ar.transport, ar.billing_basis, ar.status, ar.input_tokens,
                ar.output_tokens, ar.latency_ms, ar.error_message, ar.created_at
           FROM ai_requests ar
            LEFT JOIN trip_members tm
              ON tm.trip_id = ar.trip_id AND tm.id = ar.actor_member_id
           WHERE ar.trip_id = $1
             AND $2::boolean
           ORDER BY ar.created_at DESC LIMIT 50`,
        [session.tripId, session.role === "owner"],
  );
  const calendarConnectionResult = await client.query<{ connected: boolean }>(
        `SELECT true AS connected FROM calendar_connections
          WHERE trip_id = $1 AND member_id = $2 AND provider = 'google_calendar'
            AND refresh_token_encrypted IS NOT NULL`,
        [session.tripId, session.memberId],
  );
  const calendarLinkResult = await client.query<{
        itinerary_item_id: string;
        member_id: string;
        provider_event_id: string;
        provider_html_link: string | null;
        last_synced_item_revision: number;
        sync_status: string;
      }>(
        `SELECT itinerary_item_id, member_id, provider_event_id, provider_html_link,
                last_synced_item_revision, sync_status
           FROM calendar_event_links WHERE trip_id = $1 AND member_id = $2`,
        [session.tripId, session.memberId],
  );

  const ownerMemberEmailResult = session.role === "owner"
    ? await client.query<{ id: string; google_email: string }>(
      `SELECT tm.id, google_identity.email_hint AS google_email
         FROM trip_members tm
         JOIN LATERAL (
           SELECT oi.email_hint
             FROM oidc_identities oi
            WHERE oi.user_id = tm.user_id
              AND oi.issuer = 'https://accounts.google.com'
              AND oi.email_hint IS NOT NULL
            ORDER BY oi.last_authenticated_at DESC NULLS LAST,
                     oi.created_at DESC,
                     oi.subject
            LIMIT 1
         ) google_identity ON true
        WHERE tm.trip_id = $1 AND tm.status <> 'removed'`,
      [session.tripId],
    )
    : null;

  const trip = tripResult.rows[0];
  if (!trip) throw new AppNotFoundError("Trip not found.");
  const settings = settingsResult.rows[0] ?? {
    enabled: false,
    owner_default_model: DEFAULT_OWNER_MODEL,
    member_daily_limit: 20,
    host_subscription_enabled: false,
    entitlement_available: true,
  };
  const canSelectAiModel = session.role === "owner"
    && (!settings.entitlement_available || await isPlatformOperator(client, session.userId));
  const used = Number(quotaResult.rows[0]?.used ?? 0);
  const permissionRows = new Map(permissionResult.rows.map((row) => [row.member_id, row]));
  const currentPermissions = await getMemberPermissions(client, session.tripId, session.memberId);
  const splitsByExpense = new Map<string, Array<{ memberId: string; memberName: string; shareMinor: number }>>();
  for (const row of splitResult.rows) {
    const splits = splitsByExpense.get(row.expense_id) ?? [];
    splits.push({ memberId: row.member_id, memberName: row.member_name, shareMinor: Number(row.share_minor) });
    splitsByExpense.set(row.expense_id, splits);
  }
  const postedLedger = expenseResult.rows
    .filter((row) => row.status === "posted")
    .map((row) => ({
      id: row.id,
      currency: row.currency,
      amountMinor: Number(row.amount_minor),
      payerMemberId: row.payer_member_id,
      splits: (splitsByExpense.get(row.id) ?? []).map((split) => ({ memberId: split.memberId, shareMinor: split.shareMinor })),
    }));
  const memberPayments = liveContext.member_payments_available
    ? await loadMemberPayments(client, {
      tripId: session.tripId, memberId: session.memberId, isOwner: session.role === "owner",
      canEditExpenses: currentPermissions.canEditExpenses,
      expenseRequiresApproval: currentPermissions.expenseRequiresApproval,
    }) : [];
  const balances = calculateMemberBalances(postedLedger, memberPayments
    .filter((payment) => payment.status === "posted")
    .map((payment) => ({
      currency: payment.currency, amountMinor: payment.amountMinor,
      fromMemberId: payment.accountingFromMemberId, toMemberId: payment.accountingToMemberId,
    })));
  const settlements = calculateSettlements(balances);
  const memberNames = new Map(memberResult.rows.map((member) => [member.id, member.display_name]));
  const visibleItineraryNames = new Map(itemResult.rows.map((item) => [item.id, item.title]));
  const ownerMemberEmails = new Map(
    (ownerMemberEmailResult?.rows ?? []).map((member) => [member.id, member.google_email]),
  );
  const calendarLinks = new Map(calendarLinkResult.rows.map((link) => [link.itinerary_item_id, link]));
  const sourceReceipts = liveContext.calendar_imports_available ? await client.query<{
    itinerary_item_id: string | null; change_request_id: string; source_snapshot: unknown;
  }>(`SELECT itinerary_item_id, change_request_id, source_snapshot FROM calendar_import_receipts
       WHERE trip_id = $1 AND (itinerary_item_id = ANY($2::uuid[]) OR change_request_id = ANY($3::uuid[]))`,
    [session.tripId, itemResult.rows.map((row) => row.id), pendingItineraryRequestResult.rows.map((row) => row.id)]) : null;
  const sourceByItem = new Map((sourceReceipts?.rows ?? []).filter((row) => row.itinerary_item_id).map((row) => [row.itinerary_item_id, row.source_snapshot]));
  const sourceByRequest = new Map((sourceReceipts?.rows ?? []).map((row) => [row.change_request_id, row.source_snapshot]));
  const weatherForecastsByItem = new Map<string, EventWeatherForecast[]>();
  for (const row of weatherRows) {
    const forecasts = weatherForecastsByItem.get(row.itinerary_item_id) ?? [];
    forecasts.push(eventWeatherForecast(row));
    weatherForecastsByItem.set(row.itinerary_item_id, forecasts);
  }

  return {
    session: {
      memberId: session.memberId,
      userId: session.userId,
      displayName: session.displayName,
      role: session.role,
      isOwner: session.role === "owner",
    },
    availableTrips: availableTripResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      destinationName: row.destination_name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      role: row.role,
      current: row.id === session.tripId,
    })),
    trip: {
      id: trip.id,
      name: trip.name,
      destinationName: trip.destination_name,
      timeZone: trip.time_zone,
      defaultLocale: trip.default_locale,
      defaultCurrency: trip.default_currency,
      startsOn: trip.starts_on,
      endsOn: trip.ends_on,
      maxMembers: trip.max_members,
      memberCount: trip.member_count,
      joinLinkActive: trip.join_link_active,
    },
    members: memberResult.rows.map((row) => {
      const permission = permissionRows.get(row.id);
      return {
        id: row.id,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        identityBound: row.identity_bound,
        ...(session.role === "owner" ? { googleEmail: ownerMemberEmails.get(row.id) ?? null } : {}),
        canRemove: row.can_remove,
        currentRevision: row.current_revision,
        permissions: row.role === "owner" ? {
          canEditItinerary: true,
          itineraryRequiresApproval: false,
          canEditExpenses: true,
          expenseRequiresApproval: false,
          canSyncCalendar: true,
        } : {
          canEditItinerary: row.role === "editor" && (permission?.can_edit_itinerary ?? true),
          itineraryRequiresApproval: permission?.itinerary_requires_approval ?? row.role === "editor",
          canEditExpenses: row.role === "editor" && (permission?.can_edit_expenses ?? true),
          expenseRequiresApproval: permission?.expense_requires_approval ?? false,
          canSyncCalendar: permission?.can_sync_calendar ?? row.role === "editor",
        },
      };
    }),
    permissions: currentPermissions,
    days: dayResult.rows.map((row) => ({ id: row.id, date: row.day_date, label: row.label })),
    itinerary: itemResult.rows.map((row) => {
      const sourceCalendar = calendarSourceMetadata(sourceByItem.get(row.id), row.starts_at?.toISOString(), row.ends_at?.toISOString());
      const weatherForecasts = weatherForecastsByItem.get(row.id) ?? [];
      const weather = weatherForecasts.find((forecast) => forecast.targetRole === "destination")
        ?? weatherForecasts.find((forecast) => forecast.targetRole === "departure")
        ?? weatherForecasts.find((forecast) => forecast.targetRole === "location")
        ?? null;
      return {
        id: row.id,
        tripDayId: row.trip_day_id,
        title: row.title,
        itemType: row.item_type,
        startsAt: row.starts_at?.toISOString() ?? null,
        endsAt: row.ends_at?.toISOString() ?? null,
        ...(sourceCalendar ? { sourceCalendar } : {}),
        locationName: row.location_name,
        mapUrl: row.map_url,
        departureLocationName: row.departure_location_name,
        departureMapUrl: row.departure_map_url,
        destinationLocationName: row.destination_location_name,
        destinationMapUrl: row.destination_map_url,
        notes: row.notes,
        createdByMemberId: row.created_by_member_id,
        creatorName: row.creator_name,
        visibility: row.visibility,
        viewerMemberIds: row.viewer_member_ids,
        status: row.status,
        isLocked: row.is_locked,
        currentRevision: row.current_revision,
        weather,
        weatherForecasts,
        disruption: row.disruption_observation_id && row.disruption_evidence_fingerprint
          && row.disruption_state
          && row.disruption_reason_code && row.disruption_severity
          && row.disruption_detail && row.disruption_source_urls
          && row.disruption_first_seen_at && row.disruption_last_seen_at
          && row.disruption_checked_at && row.disruption_stale_after
            ? {
              observationId: row.disruption_observation_id,
              evidenceFingerprint: row.disruption_evidence_fingerprint,
              state: row.disruption_state,
              reasonCode: row.disruption_reason_code,
              severity: row.disruption_severity,
              detail: row.disruption_detail,
              localizedDetails: parseLocalizedDisruptionDetails(row.disruption_localized_details),
              sourceUrls: row.disruption_source_urls,
              firstSeenAt: row.disruption_first_seen_at.toISOString(),
              lastSeenAt: row.disruption_last_seen_at.toISOString(),
              checkedAt: row.disruption_checked_at.toISOString(),
              staleAfter: row.disruption_stale_after.toISOString(),
            }
            : null,
        calendarLink: calendarLinks.has(row.id) ? {
          eventId: calendarLinks.get(row.id)!.provider_event_id,
          htmlLink: calendarLinks.get(row.id)!.provider_html_link,
          syncedRevision: calendarLinks.get(row.id)!.last_synced_item_revision,
          status: calendarLinks.get(row.id)!.last_synced_item_revision === row.current_revision
            ? calendarLinks.get(row.id)!.sync_status
            : "stale",
        } : null,
      };
    }),
    expenses: expenseResult.rows.map((row) => ({
      id: row.id,
      description: row.description,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: row.status,
      occurredAt: row.occurred_at.toISOString(),
      currentRevision: row.current_revision,
      payerMemberId: row.payer_member_id,
      payerName: row.payer_name,
      itineraryItemId: row.itinerary_item_id,
      itineraryItemTitle: row.itinerary_item_title,
      itineraryItemRemoved: row.itinerary_item_removed === true,
      itineraryItemAudience: row.itinerary_item_id && row.itinerary_item_creator_id && row.itinerary_item_visibility ? {
        createdByMemberId: row.itinerary_item_creator_id,
        visibility: row.itinerary_item_visibility,
        viewerMemberIds: row.itinerary_item_viewer_ids,
      } : null,
      splits: splitsByExpense.get(row.id) ?? [],
      currentMemberShareMinor: (splitsByExpense.get(row.id) ?? []).find((split) => split.memberId === session.memberId)?.shareMinor ?? 0,
    })),
    memberPayments,
    expenseLedger: {
      balances: balances.map((balance) => ({
        ...balance,
        memberName: memberNames.get(balance.memberId) ?? "Unknown member",
      })),
      settlements: settlements.map((settlement) => ({
        ...settlement,
        fromMemberName: memberNames.get(settlement.fromMemberId) ?? "Unknown member",
        toMemberName: memberNames.get(settlement.toMemberId) ?? "Unknown member",
      })),
    },
    calendar: {
      connected: calendarConnectionResult.rowCount === 1,
      connectionUrl: "/api/integrations/google-calendar/start",
    },
    approvalPendingCount: session.role === "owner"
      ? Number(approvalPendingCountResult.rows[0]?.pending_count ?? 0)
        + memberPayments.filter((payment) => payment.status === "pending").length
      : 0,
    pendingItinerary: pendingItineraryRequestResult.rows.flatMap((row) => {
      const projection = projectPendingItinerary(row);
      const sourceCalendar = projection ? calendarSourceMetadata(sourceByRequest.get(row.id), projection.startsAt, projection.endsAt) : undefined;
      return projection ? [{ ...projection, ...(sourceCalendar ? { sourceCalendar } : {}) }] : [];
    }),
    pendingExpenses: pendingExpenseRequestResult.rows.flatMap((row) => {
      const projection = projectPendingExpense(row, memberNames, visibleItineraryNames);
      return projection ? [projection] : [];
    }),
    ai: {
      enabled: settings.enabled && settings.host_subscription_enabled,
      hostSubscriptionEnabled: settings.host_subscription_enabled,
      canSelectModel: canSelectAiModel,
      ownerDefaultModel: settings.owner_default_model,
      effectiveModel: canSelectAiModel ? settings.owner_default_model : MEMBER_MODEL,
      memberDailyLimit: settings.member_daily_limit,
      usedToday: used,
      remainingToday: canSelectAiModel ? null : Math.max(0, settings.member_daily_limit - used),
    },
    liveOperations: session.role === "owner" ? {
      weather: latestWeatherRunResult?.rows[0]
        ? {
            status: latestWeatherRunResult.rows[0].status,
            candidateCount: Number(latestWeatherRunResult.rows[0].candidate_count),
            cacheHitCount: Number(latestWeatherRunResult.rows[0].cache_hit_count),
            refreshedCount: Number(latestWeatherRunResult.rows[0].refreshed_count),
            failedCount: Number(latestWeatherRunResult.rows[0].failed_count),
            errorCode: latestWeatherRunResult.rows[0].error_code,
            startedAt: latestWeatherRunResult.rows[0].started_at.toISOString(),
            completedAt: latestWeatherRunResult.rows[0].completed_at.toISOString(),
            lastSuccessAt: latestWeatherRunResult.rows[0].last_success_at?.toISOString() ?? null,
          }
        : null,
      disruption: disruptionOperationsResult?.rows[0]
        ? {
            enabled: disruptionOperationsResult.rows[0].enabled,
            intervalMinutes: Number(disruptionOperationsResult.rows[0].interval_minutes),
            nextDueAt: disruptionOperationsResult.rows[0].next_due_at.toISOString(),
            lastAttemptAt: disruptionOperationsResult.rows[0].last_attempt_at?.toISOString() ?? null,
            lastSuccessAt: disruptionOperationsResult.rows[0].last_success_at?.toISOString() ?? null,
            lastErrorCode: disruptionOperationsResult.rows[0].last_error_code,
            latestRunStatus: disruptionOperationsResult.rows[0].latest_run_status,
            latestRunCompletedAt: disruptionOperationsResult.rows[0].latest_run_completed_at?.toISOString() ?? null,
          }
        : null,
    } : null,
    activity,
    aiLogs: (session.role === "owner" ? aiResult.rows : []).map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      prompt: row.prompt_text,
      result: row.result_text,
      requestedModel: row.requested_model,
      effectiveModel: row.effective_model,
      feature: row.feature,
      provider: row.provider,
      transport: row.transport,
      billingBasis: row.billing_basis,
      status: row.status,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      latencyMs: row.latency_ms,
      error: row.error_message,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

export async function createTrip(
  pool: Pool,
  session: AuthenticatedSession | import("@/lib/auth/account-session").AccountPrincipal,
  input: CreateTripInput,
  options?: { config: import("@/lib/auth/config").AuthConfig; userAgent: string | null },
): Promise<{ tripId: string; memberId: string; sessionGrant?: import("@/lib/auth/repository").SessionGrant }> {
  const parsed = createTripSchema.parse(input);
  const startMs = Date.parse(`${parsed.startsOn}T00:00:00Z`);
  const endMs = Date.parse(`${parsed.endsOn}T00:00:00Z`);
  const tripDates: string[] = [];
  for (let value = startMs; value <= endMs; value += 86_400_000) {
    tripDates.push(new Date(value).toISOString().slice(0, 10));
  }

  return inTransaction(pool, async (client) => {
    const accountSession = "kind" in session && session.kind === "account";
    let authenticationCeiling: Date;
    if ("tripId" in session) {
      const { lockCurrentTripActor } = await import("@/lib/app/trip-authorization");
      await lockCurrentTripActor(client,session);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify([session.userId,"trip-creation"])]);
    if ("tripId" in session) {
      // The account lock may wait: check source expiry only after acquiring it.
      authenticationCeiling = await readCurrentSessionCeiling(client,session);
    }
    const capabilities = await client.query<{enabled:boolean}>(
      `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='trip_ai_settings'::regclass
         AND attname='host_subscription_enabled' AND NOT attisdropped) AS enabled`,
    );
    const accountCreationEnabled = capabilities.rows[0]?.enabled === true;
    if (!("tripId" in session)) {
      if (!options || !accountCreationEnabled) throw new AppForbiddenError("Account onboarding is not configured.");
      const { consumeAccountOnboarding } = await import("@/lib/auth/account-session");
      authenticationCeiling = await consumeAccountOnboarding(client,session);
    }
    if (accountCreationEnabled) {
      const usage = await client.query<{count:number}>(
        `SELECT count(*)::integer AS count FROM account_trip_creations WHERE user_id=$1
         AND created_at>=date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,[session.userId],
      );
      if ((usage.rows[0]?.count ?? 0) >= 10) throw new AppConflictError("The daily limit of 10 new trips has been reached.");
    }
    const { isPlatformOperator } = await import("@/lib/auth/operator-access");
    const hostEntitlement = accountCreationEnabled ? await isPlatformOperator(client,session.userId) : true;
    const dateEligibility = await client.query<{ current_local_date: string }>(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date::text AS current_local_date`,
      [parsed.timeZone],
    );
    if (parsed.endsOn < dateEligibility.rows[0]!.current_local_date) {
      throw new AppInvalidInputError("A new trip cannot end before today in its local time zone.");
    }

    const tripId = randomUUID();
    const memberId = randomUUID();
    await client.query(
      `INSERT INTO trips (
         id, owner_user_id, name, destination_name, time_zone, default_locale,
         default_currency, starts_on, ends_on, max_members
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tripId, session.userId, parsed.name, parsed.destinationName, parsed.timeZone,
        parsed.defaultLocale, parsed.defaultCurrency, parsed.startsOn, parsed.endsOn,
        parsed.maxMembers],
    );
    await client.query(
      `INSERT INTO trip_members (
         trip_id, id, user_id, display_name, role, status
       ) VALUES ($1,$2,$3,$4,'owner','active')`,
      [tripId, memberId, session.userId, session.displayName],
    );
    await client.query(
      `INSERT INTO member_permissions (
         trip_id, member_id, can_edit_itinerary, itinerary_requires_approval,
         can_edit_expenses, expense_requires_approval, can_sync_calendar,
         updated_by_member_id
       ) VALUES ($1,$2,true,false,true,false,true,$2)`,
      [tripId, memberId],
    );
    await client.query(
      `INSERT INTO trip_ai_settings (
         trip_id, enabled, owner_default_model,
         member_daily_limit, updated_by_member_id${accountCreationEnabled ? ", host_subscription_enabled" : ""}
       ) VALUES ($1,$3,'gpt-6.1-sol',20,$2${accountCreationEnabled ? ",$3" : ""})`,
      [tripId, memberId,hostEntitlement],
    );
    const disruptionSettingsAvailable = await client.query<{ available: boolean }>(
      "SELECT to_regclass('trip_disruption_settings') IS NOT NULL AS available",
    );
    if (disruptionSettingsAvailable.rows[0]?.available) {
      await client.query(
        `INSERT INTO trip_disruption_settings (
           trip_id, enabled, interval_minutes, lookahead_hours,
           next_due_at, updated_by_member_id
         ) VALUES ($1,$3,30,168,CURRENT_TIMESTAMP,$2)`,
        [tripId, memberId,hostEntitlement],
      );
    }
    await client.query(
      `INSERT INTO trip_days (trip_id, id, day_date, label)
       SELECT $1, generated.id, generated.day_date, NULL
         FROM unnest($2::uuid[], $3::date[]) AS generated(id, day_date)`,
      [tripId, tripDates.map(() => randomUUID()), tripDates],
    );
    let destinationLookup: Record<string, unknown> | null = null;
    if (parsed.destinationLookupId) {
      const destination = normalizeDestination(parsed.destinationName);
      const lookup = await client.query<{ id: string; response_json: unknown }>(
        `SELECT id,response_json FROM account_ai_lookups WHERE id=$1 AND user_id=$2 AND destination_text=$3 AND status='succeeded'`,
        [parsed.destinationLookupId, session.userId, destination],
      );
      const row = lookup.rows[0];
      const suggested = row ? validatedStoredDestinationDefaults(row.response_json, destination) : null;
      if (row && suggested) destinationLookup = { id: row.id, suggestedTimeZone: suggested.timeZone,
        suggestedCurrency: suggested.currency, timeZoneAccepted: suggested.timeZone === parsed.timeZone,
        currencyAccepted: suggested.currency === parsed.defaultCurrency };
    }
    await appendAudit(client, {
      tripId,
      actorMemberId: memberId,
      entityType: "trip",
      entityId: tripId,
      action: "created",
      after: {
        name: parsed.name,
        destinationName: parsed.destinationName,
        timeZone: parsed.timeZone,
        defaultLocale: parsed.defaultLocale,
        defaultCurrency: parsed.defaultCurrency,
        startsOn: parsed.startsOn,
        endsOn: parsed.endsOn,
        maxMembers: parsed.maxMembers,
      },
      metadata: { sourceTripId: "tripId" in session ? session.tripId : null, source: accountSession ? "account_onboarding" : "trip_member", destinationLookup },
    });
    if (accountCreationEnabled) {
      await client.query("INSERT INTO account_trip_creations (user_id,trip_id) VALUES ($1,$2)",[session.userId,tripId]);
    }
    if (options) {
      const { issueCreatedTripSession } = await import("@/lib/auth/account-session");
      const sessionGrant = await issueCreatedTripSession(client,options.config,{ tripId,memberId,userId:session.userId,userAgent:options.userAgent,absoluteExpiresAt:authenticationCeiling! });
      if ("sessionId" in session) {
        await client.query(`UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revoke_reason='trip_created'
          WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,[session.sessionId,session.userId]);
      }
      return { tripId,memberId,sessionGrant };
    }
    return { tripId, memberId };
  });
}

export async function updateTripSettings(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  input: TripSettingsInput,
): Promise<void> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only the owner can change trip settings.");
  const parsed = tripSettingsSchema.parse(input);
  await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: true });
    const result = await client.query<{
      destination_name: string;
      time_zone: string;
      max_members: number;
      member_count: number;
      starts_on: string;
      ends_on: string;
    }>(
      `SELECT destination_name, time_zone, max_members,
              starts_on::text, ends_on::text,
              (
                SELECT count(*)::integer
                  FROM trip_members tm
                 WHERE tm.trip_id = trips.id AND tm.status <> 'removed'
              ) AS member_count
         FROM trips WHERE id = $1 FOR UPDATE`,
      [tripId],
    );
    const before = result.rows[0];
    if (!before) throw new AppNotFoundError("Trip not found.");
    if (parsed.expectedStartsOn !== undefined && (parsed.expectedStartsOn !== before.starts_on
      || parsed.expectedEndsOn !== before.ends_on)) throw new AppConflictError(tripDateErrors.stale);
    const next = {
      destinationName: parsed.destinationName ?? before.destination_name,
      timeZone: parsed.timeZone ?? before.time_zone,
      maxMembers: parsed.maxMembers ?? before.max_members,
      startsOn: parsed.startsOn ?? before.starts_on,
      endsOn: parsed.endsOn ?? before.ends_on,
    };
    if (next.maxMembers < before.member_count) {
      throw new AppConflictError(
        `The member limit cannot be lower than the current ${before.member_count} trip members.`,
      );
    }
    if (next.endsOn < next.startsOn) throw new AppConflictError(tripDateErrors.order);
    const tripLengthDays = (
      Date.parse(`${next.endsOn}T00:00:00Z`) - Date.parse(`${next.startsOn}T00:00:00Z`)
    ) / 86_400_000;
    if (tripLengthDays > 365) {
      throw new AppConflictError(tripDateErrors.length);
    }
    // A timezone-only edit and unchanged/expanded travel dates do not newly
    // invalidate old data. Contractions inspect private records without exposing
    // their identities, titles or times in the conflict response.
    if (next.startsOn > before.starts_on || next.endsOn < before.ends_on) {
      // Keep timestamp comparisons in PostgreSQL: JS Date truncates the stored
      // microseconds and could admit an end just beyond the final midnight.
      const impact = await client.query<{ would_exclude: boolean }>(
        `WITH effective AS (
           SELECT jsonb_build_object('tripDayId', i.trip_day_id, 'startsAt', i.starts_at, 'endsAt', i.ends_at) AS patch
             FROM itinerary_items i WHERE i.trip_id = $1
           UNION ALL
           SELECT COALESCE(jsonb_build_object('tripDayId', target.trip_day_id,
                    'startsAt', target.starts_at, 'endsAt', target.ends_at), '{}'::jsonb)
                  || COALESCE(base.snapshot, '{}'::jsonb) || cr.proposed_patch
             FROM change_requests cr
             LEFT JOIN itinerary_items target ON target.trip_id = cr.trip_id AND target.id = cr.entity_id
             LEFT JOIN itinerary_revisions base ON base.trip_id = cr.trip_id
               AND base.itinerary_item_id = cr.entity_id AND base.revision = cr.base_revision
            WHERE cr.trip_id = $1 AND cr.entity_type = 'itinerary_item'
              AND cr.status IN ('pending', 'rejected') AND to_jsonb(cr)->>'invalidated_at' IS NULL
              AND ((cr.operation = 'create' AND cr.entity_id IS NULL)
                OR (cr.operation IN ('update', 'cancel', 'restore')
                  AND target.current_revision = cr.base_revision AND to_jsonb(target)->>'removed_at' IS NULL))
         ), timed AS (
           SELECT d.day_date,
             CASE WHEN pg_input_is_valid(effective.patch->>'startsAt', 'timestamp with time zone')
               THEN (effective.patch->>'startsAt')::timestamptz END AS starts_at,
             CASE WHEN pg_input_is_valid(effective.patch->>'endsAt', 'timestamp with time zone')
               THEN (effective.patch->>'endsAt')::timestamptz END AS ends_at
           FROM effective LEFT JOIN trip_days d ON d.trip_id = $1
             AND d.id::text = lower(effective.patch->>'tripDayId')
         ), windows AS (
           SELECT $2::date::timestamp AT TIME ZONE $4 AS old_start,
             ($3::date + 1)::timestamp AT TIME ZONE $4 AS old_end,
             $5::date::timestamp AT TIME ZONE $7 AS next_start,
             ($6::date + 1)::timestamp AT TIME ZONE $7 AS next_end
         )
         SELECT EXISTS (SELECT 1 FROM timed CROSS JOIN windows
           WHERE (day_date BETWEEN $2::date AND $3::date AND NOT day_date BETWEEN $5::date AND $6::date)
             OR (starts_at >= old_start AND starts_at < old_end AND NOT (starts_at >= next_start AND starts_at < next_end))
             OR (ends_at >= old_start AND ends_at <= old_end AND NOT (ends_at >= next_start AND ends_at <= next_end))
         ) AS would_exclude`,
        [tripId, before.starts_on, before.ends_on, before.time_zone, next.startsOn, next.endsOn, next.timeZone],
      );
      if (impact.rows[0]?.would_exclude) {
        throw new AppConflictError(tripDateErrors.occupied);
      }
    }
    await client.query(
      `UPDATE trips
          SET destination_name = $2, time_zone = $3, max_members = $4, ends_on = $5, starts_on = $6
        WHERE id = $1`,
      [tripId, next.destinationName, next.timeZone, next.maxMembers, next.endsOn, next.startsOn],
    );
    const tripDates: string[] = [];
    for (
      let value = Date.parse(`${next.startsOn}T00:00:00Z`);
      value <= Date.parse(`${next.endsOn}T00:00:00Z`);
      value += 86_400_000
    ) {
      tripDates.push(new Date(value).toISOString().slice(0, 10));
    }
    await client.query(
      `INSERT INTO trip_days (trip_id, id, day_date, label)
       SELECT $1, generated.id, generated.day_date, NULL
         FROM unnest($2::uuid[], $3::date[]) AS generated(id, day_date)
       ON CONFLICT (trip_id, day_date) DO NOTHING`,
      [tripId, tripDates.map(() => randomUUID()), tripDates],
    );

    // Travel dates and destination time zones do not alter authentication grants.
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "trip",
      entityId: tripId,
      action: "settings_updated",
      before: {
        destinationName: before.destination_name,
        timeZone: before.time_zone,
        maxMembers: before.max_members,
        startsOn: before.starts_on,
        endsOn: before.ends_on,
      },
      after: next,
    });
  });
}

/** Recheck the live range under the trip lock, including after provider work.
 * Existing unchanged legacy timestamps may be retained by non-date edits.
 * New creates and changed dates must use the current selectable range. */
async function assertCurrentItineraryDates(
  client: Queryable,
  tripId: string,
  patch: Pick<ItineraryPatch, "tripDayId" | "startsAt" | "endsAt">,
  current?: { tripDayId?: string; entityId: string },
): Promise<void> {
  const dayId = patch.tripDayId ?? current?.tripDayId;
  const day = await client.query<{ dates_valid: boolean }>(
    `SELECT 1, ((COALESCE(original.trip_day_id = d.id, false) OR d.day_date BETWEEN t.starts_on AND t.ends_on)
        AND ($3::timestamptz IS NULL OR $3::timestamptz = original.starts_at
          OR ($3::timestamptz >= t.starts_on::timestamp AT TIME ZONE t.time_zone
            AND $3::timestamptz < (t.ends_on + 1)::timestamp AT TIME ZONE t.time_zone))
        AND ($4::timestamptz IS NULL OR $4::timestamptz = original.ends_at
          OR ($4::timestamptz >= t.starts_on::timestamp AT TIME ZONE t.time_zone
            AND $4::timestamptz <= (t.ends_on + 1)::timestamp AT TIME ZONE t.time_zone))) AS dates_valid
       FROM trip_days d JOIN trips t ON t.id = d.trip_id
       LEFT JOIN itinerary_items original ON original.trip_id = d.trip_id AND original.id = $5
       WHERE d.trip_id = $1 AND d.id = $2`,
    [tripId, dayId, patch.startsAt ?? null, patch.endsAt ?? null, current?.entityId ?? null],
  );
  if (day.rowCount !== 1) throw new AppNotFoundError("Trip day not found.");
  if (day.rows[0]?.dates_valid !== true) throw new AppConflictError(tripDateErrors.event);
}

export async function createChangeRequestWithClient(
  client: PoolClient,
  session: AuthenticatedSession,
  tripId: string,
  input: ChangeRequestInput,
  id: string,
): Promise<{ id: string; status: "pending" }> {
    assertTrip(session, tripId);
    await lockCurrentTripActor(client, session);
    let proposedPatch: ItineraryPatch | StoredExpensePatch = input.patch;
    const permissions = await getMemberPermissions(client, tripId, session.memberId);
    if (input.entityType === "itinerary_item" && !permissions.canEditItinerary) {
      throw new AppForbiddenError("You do not have permission to change the itinerary.");
    }
    if (input.entityType === "expense" && !permissions.canEditExpenses) {
      throw new AppForbiddenError("You do not have permission to change expenses.");
    }
    if (input.operation === "create") {
      if (input.entityId || input.baseRevision) {
        throw new AppConflictError("A create request cannot reference an existing revision.");
      }
    } else if (!input.entityId || !input.baseRevision) {
      throw new AppConflictError("An existing item and revision are required.");
    }

    if (input.entityType === "itinerary_item") {
      const patch = input.patch as ItineraryPatch;
      let currentLocationState: ItineraryLocationState | undefined;
      let currentDates: { tripDayId: string; entityId: string } | undefined;
      let currentApprovalAudience: ItineraryAudience | null = null;
      let audience: ItineraryAudience = {
        createdByMemberId: session.memberId,
        visibility: patch.visibility ?? "trip",
        viewerMemberIds: patch.viewerMemberIds ?? [],
      };
      if (input.operation === "create" && (!patch.tripDayId || !patch.title)) {
        throw new AppConflictError("A day and title are required for a new plan item.");
      }
      if (input.entityId) {
        const item = await client.query<{
          trip_day_id: string;
          current_revision: number;
          is_locked: boolean;
          item_type: ItineraryLocationState["itemType"];
          location_name: string | null;
          map_url: string | null;
          departure_location_name: string | null;
          departure_map_url: string | null;
          destination_location_name: string | null;
          destination_map_url: string | null;
          created_by_member_id: string;
          visibility: "trip" | "private";
          viewer_member_ids: string[];
        }>(
          `SELECT i.current_revision, i.is_locked, i.item_type, i.trip_day_id,
                  i.location_name, i.map_url,
                  i.departure_location_name, i.departure_map_url,
                  i.destination_location_name, i.destination_map_url,
                  i.created_by_member_id, i.visibility,
                  COALESCE(ARRAY(
                    SELECT iv.member_id
                      FROM itinerary_item_viewers iv
                     WHERE iv.trip_id = i.trip_id AND iv.itinerary_item_id = i.id
                     ORDER BY iv.member_id
                  ), ARRAY[]::uuid[]) AS viewer_member_ids
             FROM itinerary_items i
            WHERE i.trip_id = $1 AND i.id = $2
              AND to_jsonb(i)->>'removed_at' IS NULL
            FOR UPDATE OF i`,
          [tripId, input.entityId],
        );
        const row = item.rows[0];
        if (!row) throw new AppNotFoundError("Plan item not found.");
        currentLocationState = {
          itemType: row.item_type,
          locationName: row.location_name,
          mapUrl: row.map_url,
          departureLocationName: row.departure_location_name,
          departureMapUrl: row.departure_map_url,
          destinationLocationName: row.destination_location_name,
          destinationMapUrl: row.destination_map_url,
        };
        const currentAudience: ItineraryAudience = {
          createdByMemberId: row.created_by_member_id,
          visibility: row.visibility,
          viewerMemberIds: row.viewer_member_ids,
        };
        currentApprovalAudience = currentAudience;
        if (!canViewAudience(currentAudience, session.memberId)) {
          throw new AppNotFoundError("Plan item not found.");
        }
        if (row.current_revision !== input.baseRevision) throw new AppConflictError("The plan item changed. Reload and try again.");
        currentDates = { tripDayId: row.trip_day_id, entityId: input.entityId };
        if (row.is_locked && session.role !== "owner") throw new AppForbiddenError("The owner locked this plan item.");
        if ((patch.visibility !== undefined || patch.viewerMemberIds !== undefined)
            && session.memberId !== row.created_by_member_id) {
          throw new AppForbiddenError("Only the event creator can change its privacy or audience.");
        }
        audience = {
          createdByMemberId: row.created_by_member_id,
          visibility: patch.visibility ?? row.visibility,
          viewerMemberIds: patch.viewerMemberIds ?? row.viewer_member_ids,
        };
      }
      await assertCurrentItineraryDates(client, tripId, patch, currentDates);
      audience.viewerMemberIds = [...new Set(audience.viewerMemberIds)]
        .filter((memberId) => memberId !== audience.createdByMemberId);
      const normalizedPatch = canonicalizeItineraryLocationPatch(patch, currentLocationState);
      const locations = resolveItineraryLocationState(normalizedPatch, currentLocationState);
      if (!transportHasEndpoint(locations)) {
        throw new AppConflictError(transportEndpointRequiredMessage);
      }
      proposedPatch = {
        ...normalizedPatch,
        visibility: audience.visibility,
        viewerMemberIds: audience.visibility === "private" ? audience.viewerMemberIds : [],
      };
      await assertValidAudienceMembers(client, tripId, audience.viewerMemberIds);
      if (input.entityId && (patch.visibility !== undefined || patch.viewerMemberIds !== undefined)) {
        const linkedExpenseMembers = await client.query<{ member_id: string }>(
          `SELECT e.payer_member_id AS member_id
             FROM expenses e
            WHERE e.trip_id = $1 AND e.itinerary_item_id = $2
           UNION
           SELECT es.member_id
             FROM expenses e
             JOIN expense_splits es
               ON es.trip_id = e.trip_id AND es.expense_id = e.id
            WHERE e.trip_id = $1 AND e.itinerary_item_id = $2`,
          [tripId, input.entityId],
        );
        assertExpenseMembersInsideAudience(
          audience,
          linkedExpenseMembers.rows.map((row) => row.member_id),
        );
      }
      if (patch.isLocked !== undefined && session.role !== "owner") {
        throw new AppForbiddenError("Only the owner can lock a plan item.");
      }
      if (patch.linkedExpense) {
        validatedExpenseSplits(patch.linkedExpense);
        if (!permissions.canEditExpenses) {
          throw new AppForbiddenError("You do not have permission to add the linked expense.");
        }
        const memberIds = [
          patch.linkedExpense.payerMemberId,
          ...patch.linkedExpense.splitMemberIds,
        ];
        const uniqueMemberIds = [...new Set(memberIds)];
        const members = await client.query<{ id: string }>(
          `SELECT id FROM trip_members
            WHERE trip_id = $1 AND id = ANY($2::uuid[])
              AND status NOT IN ('revoked', 'removed')`,
          [tripId, uniqueMemberIds],
        );
        if (members.rowCount !== uniqueMemberIds.length) {
          throw new AppNotFoundError("One or more linked-expense members are invalid.");
        }
        assertExpenseMembersInsideAudience(audience, uniqueMemberIds);
      }
      const needsOwnerApproval = session.role !== "owner" && (
        input.source === "ai"
        || permissions.itineraryRequiresApproval
        || Boolean(patch.linkedExpense && permissions.expenseRequiresApproval)
      );
      const usesTemporaryOwnerReviewAudience = (
        input.operation === "create" && !input.entityId
      ) || (
        input.operation === "update" && Boolean(input.entityId)
      );
      if (needsOwnerApproval && !usesTemporaryOwnerReviewAudience && (
        audience.visibility === "private" || currentApprovalAudience?.visibility === "private"
      )) {
        const owner = await client.query<{ id: string }>(
          `SELECT id FROM trip_members
            WHERE trip_id = $1 AND role = 'owner' AND status = 'active'`,
          [tripId],
        );
        if (!owner.rows.some(({ id }) => (!currentApprovalAudience || canViewAudience(currentApprovalAudience, id))
          && canViewAudience(audience, id))) {
          throw new AppForbiddenError(
            "This approval-required private event change cannot be reviewed safely. The owner must be able to view both the current and proposed event audience; ask the owner to change the approval setting before changing access.",
          );
        }
      }
    } else {
      const patch = input.patch as ExpensePatch;
      let currentLinkedAudience: ItineraryAudience | null = null;
      let effectiveLinkedAudience: ItineraryAudience | null = null;
      let effectiveLinkedItemId = patch.itineraryItemId ?? null;
      if (input.operation === "create" && (!patch.description || !patch.amountMinor || !patch.payerMemberId || !patch.splitMemberIds)) {
        throw new AppConflictError("Description, amount, payer, and split members are required.");
      }
      if (input.operation === "create") validatedExpenseSplits(patch);
      const memberIds = [patch.payerMemberId, ...(patch.splitMemberIds ?? []), ...(patch.splitAmounts?.map((split) => split.memberId) ?? [])].filter(Boolean) as string[];
      if (memberIds.length > 0) {
        const members = await client.query<{ id: string }>(
          `SELECT id FROM trip_members WHERE trip_id = $1 AND id = ANY($2::uuid[]) AND status NOT IN ('revoked', 'removed')`,
          [tripId, [...new Set(memberIds)]],
        );
        if (members.rowCount !== new Set(memberIds).size) throw new AppNotFoundError("One or more expense members are invalid.");
      }
      if (patch.itineraryItemId && !input.entityId) {
        const audience = await getItineraryAudience(client, tripId, patch.itineraryItemId, true);
        if (!audience || audience.removed || !canViewAudience(audience, session.memberId)) {
          throw new AppNotFoundError("Linked itinerary item not found.");
        }
        effectiveLinkedAudience = audience;
        assertExpenseMembersInsideAudience(audience, memberIds);
      }
      if (input.entityId) {
        const expense = await client.query<{ current_revision: number; itinerary_item_id: string | null; amount_minor: string | number }>(
          `SELECT current_revision, itinerary_item_id, amount_minor FROM expenses
            WHERE trip_id = $1 AND id = $2
              AND app_member_can_view_expense(trip_id, id, $3)`,
          [tripId, input.entityId, session.memberId],
        );
        if (!expense.rows[0]) throw new AppNotFoundError("Expense not found.");
        if (expense.rows[0].current_revision !== input.baseRevision) {
          throw new AppConflictError("The expense changed. Reload and try again.");
        }
        if (patch.amountMinor !== undefined || patch.splitMemberIds !== undefined || patch.splitAmounts !== undefined) {
          const storedSplits = await getExpenseSplits(client, tripId, input.entityId);
          validatedExpenseSplits(patch, { amountMinor: Number(expense.rows[0].amount_minor),
            splits: storedSplits.map((split) => ({ participantId: split.memberId, amountMinor: split.shareMinor })) });
        }
        const effectiveItemId = patch.itineraryItemId !== undefined
          ? patch.itineraryItemId
          : expense.rows[0].itinerary_item_id;
        effectiveLinkedItemId = effectiveItemId;
        const audienceIds = [...new Set([
          expense.rows[0].itinerary_item_id,
          effectiveItemId,
        ].filter(Boolean) as string[])].sort();
        const lockedAudiences = new Map<string, ItineraryAudience | null>();
        for (const itemId of audienceIds) {
          lockedAudiences.set(
            itemId,
            await getItineraryAudience(client, tripId, itemId, true),
          );
        }
        currentLinkedAudience = expense.rows[0].itinerary_item_id
          ? lockedAudiences.get(expense.rows[0].itinerary_item_id) ?? null
          : null;
        effectiveLinkedAudience = effectiveItemId
          ? lockedAudiences.get(effectiveItemId) ?? null
          : null;
        if (effectiveLinkedAudience?.removed && effectiveItemId !== expense.rows[0].itinerary_item_id) {
          throw new AppNotFoundError("Linked itinerary item not found.");
        }
        if (expense.rows[0].itinerary_item_id && patch.itineraryItemId !== undefined
            && patch.itineraryItemId !== expense.rows[0].itinerary_item_id) {
          if (currentLinkedAudience?.visibility === "private") {
            throw new AppForbiddenError(
              "An expense linked to a private event must stay linked to that event. Void it and create a separate public expense instead.",
            );
          }
        }
        if (effectiveItemId) {
          const audience = effectiveLinkedAudience;
          if (!audience || !canViewAudience(audience, session.memberId)) {
            throw new AppNotFoundError("Linked itinerary item not found.");
          }
          effectiveLinkedAudience = audience;
          const currentExpenseMembers = (await client.query<{
            payer_member_id: string;
            split_member_ids: string[];
          }>(
            `SELECT e.payer_member_id,
                    COALESCE(ARRAY(
                      SELECT es.member_id FROM expense_splits es
                       WHERE es.trip_id = e.trip_id AND es.expense_id = e.id
                       ORDER BY es.member_id
                    ), ARRAY[]::uuid[]) AS split_member_ids
               FROM expenses e WHERE e.trip_id = $1 AND e.id = $2`,
            [tripId, input.entityId],
          )).rows[0];
          const effectiveMemberIds = [
            patch.payerMemberId ?? currentExpenseMembers?.payer_member_id,
            ...(patch.splitMemberIds ?? currentExpenseMembers?.split_member_ids ?? []),
          ].filter(Boolean) as string[];
          assertExpenseMembersInsideAudience(audience, effectiveMemberIds);
        }
      }

      proposedPatch = {
        ...patch,
        itineraryItemId: effectiveLinkedItemId,
        itineraryAudienceSnapshot: effectiveLinkedAudience && effectiveLinkedItemId
          ? {
              itineraryItemId: effectiveLinkedItemId,
              createdByMemberId: effectiveLinkedAudience.createdByMemberId,
              visibility: effectiveLinkedAudience.visibility,
              viewerMemberIds: effectiveLinkedAudience.visibility === "private"
                ? effectiveLinkedAudience.viewerMemberIds
                : [],
            }
          : null,
      };

      const needsOwnerApproval = session.role !== "owner" && (
        input.source === "ai" || permissions.expenseRequiresApproval
      );
      const usesTemporaryAiCreateReviewAudience = input.source === "ai"
        && input.operation === "create"
        && !input.entityId;
      if (needsOwnerApproval && !usesTemporaryAiCreateReviewAudience && (
        currentLinkedAudience?.visibility === "private"
        || effectiveLinkedAudience?.visibility === "private"
      )) {
        const owner = await client.query<{ id: string }>(
          `SELECT id FROM trip_members
            WHERE trip_id = $1 AND role = 'owner' AND status = 'active'`,
          [tripId],
        );
        if (!owner.rows.some(({ id }) => (!currentLinkedAudience || canViewAudience(currentLinkedAudience, id))
          && (!effectiveLinkedAudience || canViewAudience(effectiveLinkedAudience, id)))) {
          throw new AppForbiddenError(
            "This private event expense requires approval. Share the event with the owner before submitting it.",
          );
        }
      }
    }

    const source = input.source === "ai" ? "ai" : session.role === "owner" ? "owner" : "member";
    await client.query(
      `INSERT INTO change_requests (
         trip_id, id, requested_by_member_id, source, entity_type, entity_id,
         operation, base_revision, proposed_patch, reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        tripId,
        id,
        session.memberId,
        source,
        input.entityType,
        input.entityId ?? null,
        input.operation,
        input.baseRevision ?? null,
        JSON.stringify(proposedPatch),
        input.reason,
      ],
    );
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "change_request",
      entityId: id,
      action: "requested",
      after: { ...input, source },
    });
  return { id, status: "pending" };
}

export async function createChangeRequest(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  input: ChangeRequestInput,
): Promise<{ id: string; status: "pending" }> {
  assertTrip(session, tripId);
  const id = randomUUID();
  return inTransaction(pool, (client) =>
    createChangeRequestWithClient(client, session, tripId, input, id));
}

export async function createChangeRequestsAtomically(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  inputs: readonly ChangeRequestInput[],
): Promise<Array<{ id: string; status: "pending" }>> {
  return inTransaction(pool, (client) =>
    createAiCreateRequestsWithClient(client, session, tripId, inputs));
}

export async function createAiItineraryCreateRequestsWithClient(
  client: PoolClient,
  session: AuthenticatedSession,
  tripId: string,
  inputs: readonly ChangeRequestInput[],
): Promise<Array<{ id: string; status: "pending" }>> {
  if (inputs.some((input) => input.entityType !== "itinerary_item")) {
    throw new AppInvalidInputError(
      "This compatibility helper supports only AI-created itinerary items.",
    );
  }
  return createAiCreateRequestsWithClient(client, session, tripId, inputs);
}

export async function createAiCreateRequestsWithClient(
  client: PoolClient,
  session: AuthenticatedSession,
  tripId: string,
  inputs: readonly ChangeRequestInput[],
): Promise<Array<{ id: string; status: "pending" }>> {
  assertTrip(session, tripId);
  if (inputs.length < 1 || inputs.length > 20) {
    throw new AppInvalidInputError("Submit between 1 and 20 change requests at once.");
  }
  if (inputs.some((input) => (
    input.source !== "ai"
    || !["itinerary_item", "expense"].includes(input.entityType)
    || input.operation !== "create"
  ))) {
    throw new AppInvalidInputError(
      "Atomic change-request batches support only AI-created itinerary items or expenses.",
    );
  }
  const ids = inputs.map(() => randomUUID());
  const created: Array<{ id: string; status: "pending" }> = [];
  for (let index = 0; index < inputs.length; index += 1) {
    created.push(await createChangeRequestWithClient(
      client,
      session,
      tripId,
      inputs[index]!,
      ids[index]!,
    ));
  }
  return created;
}

type ChangeRequestRow = {
  id: string;
  requested_by_member_id: string;
  source: "member" | "owner" | "ai" | "import";
  entity_type: "itinerary_item" | "expense";
  entity_id: string | null;
  operation: "create" | "update" | "cancel" | "restore" | "void";
  base_revision: number | null;
  proposed_patch: ItineraryPatch | ExpensePatch;
  reason: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  proposal_revision?: number;
};

type PendingItineraryEditRequestRow = ChangeRequestRow & {
  requested_by_name: string;
  base_patch: Record<string, unknown> | null;
  current_patch: Record<string, unknown> | null;
  target_revision: number | null;
  proposal_revision: number;
  created_at: Date;
  updated_at: Date;
};

function storedPendingItineraryPatch(draft: PendingItineraryDraft): ItineraryPatch {
  const { linkedExpense, ...event } = draft;
  return linkedExpense ? { ...event, linkedExpense } : event;
}

function pendingItineraryEditDetail(
  row: PendingItineraryEditRequestRow,
): PendingItineraryEditDetail | null {
  const createdByMemberId = pendingItineraryCreatorId(row);
  const patch = materializePendingItineraryDraft(
    {
      ...(row.current_patch ?? {}),
      ...(row.base_patch ?? {}),
      ...row.proposed_patch as Record<string, unknown>,
    },
    createdByMemberId,
  );
  if (!patch) return null;
  return {
    requestId: row.id,
    status: "pending",
    operation: row.operation === "update" ? "update" : "create",
    targetItemId: row.entity_id,
    createdByMemberId,
    requestedByMemberId: row.requested_by_member_id,
    requestedByName: row.requested_by_name,
    source: row.source,
    reason: row.reason,
    proposalRevision: row.proposal_revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    patch,
  };
}

function sameMemberAudience(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => [...new Set(values)].sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((memberId, index) => memberId === normalizedRight[index]);
}

function sameLinkedExpense(
  left: PendingItineraryDraft["linkedExpense"],
  right: PendingItineraryDraft["linkedExpense"],
): boolean {
  const normalize = (expense: PendingItineraryDraft["linkedExpense"]) => expense
    ? { ...expense, splitMemberIds: [...new Set(expense.splitMemberIds)].sort(),
        splitAmounts: resolveExpenseSplits(expense.amountMinor, expense.splitAmounts === undefined ? [...new Set(expense.splitMemberIds)] : expense.splitMemberIds,
          expense.splitAmounts).sort((a, b) => a.participantId.localeCompare(b.participantId)) }
    : null;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

async function selectPendingItineraryRequestForEdit(
  client: Queryable,
  session: AuthenticatedSession,
  tripId: string,
  requestId: string,
  lock: boolean,
): Promise<PendingItineraryEditRequestRow> {
  const result = await client.query<PendingItineraryEditRequestRow>(
    `SELECT cr.*, requester.display_name AS requested_by_name,
            target.current_revision AS target_revision,
            base.snapshot AS base_patch,
            ${pendingItineraryCurrentPatchProjection} AS current_patch
       FROM change_requests cr
       JOIN trip_members requester
         ON requester.trip_id = cr.trip_id
        AND requester.id = cr.requested_by_member_id
       LEFT JOIN itinerary_revisions base
         ON base.trip_id = cr.trip_id
        AND base.itinerary_item_id = cr.entity_id
        AND base.revision = cr.base_revision
       LEFT JOIN itinerary_items target
         ON target.trip_id = cr.trip_id
        AND target.id = cr.entity_id
      WHERE cr.trip_id = $1 AND cr.id = $2
        AND to_jsonb(cr)->>'invalidated_at' IS NULL
        AND cr.entity_type = 'itinerary_item'
        AND (cr.entity_id IS NULL OR to_jsonb(target)->>'removed_at' IS NULL)
        AND cr.operation IN ('create', 'update')
        AND app_member_can_view_change_request(cr.trip_id, cr.id, $3)
      ${lock ? "FOR UPDATE OF cr" : ""}`,
    [tripId, requestId, session.memberId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppNotFoundError("Pending event request not found.");
  }
  if (session.role !== "owner") {
    const permissions = await getMemberPermissions(client, tripId, session.memberId);
    if (session.role !== "editor" || !permissions.canEditItinerary) {
      // Visibility and mutation authority are separate. Fail closed so a read-only
      // audience member cannot use this endpoint to confirm a request exists.
      throw new AppNotFoundError("Pending event request not found.");
    }
  }
  return row;
}

function assertPendingItineraryRequestIsEditable(
  request: PendingItineraryEditRequestRow,
): void {
  const hasEditableTargetShape = (
    request.operation === "create" && request.entity_id === null
  ) || (
    request.operation === "update" && request.entity_id !== null
  );
  if (request.status !== "pending" || !hasEditableTargetShape) {
    throw new AppConflictError("Only a pending event request can be edited.");
  }
  if (request.operation === "update" && (
    !request.current_patch || request.target_revision !== request.base_revision
  )) {
    throw new AppConflictError("The original event changed. Review the current event before editing this proposal.");
  }
}

export type AiPendingItineraryContext = {
  pendingItinerary: Array<{
    requestId: string;
    proposalRevision: number;
    operation: "create" | "update";
    targetItemId: string | null;
    createdByMemberId: string;
    hasLinkedExpense: boolean;
    patch: Omit<PendingItineraryDraft, "linkedExpense">;
  }>;
  pendingItineraryTruncated: boolean;
};

/** Read in a short actor-locked transaction; never hold it over provider work.
 * This is authorized event context, not approval history or an edit capability. */
export async function getAiPendingItineraryContext(
  client: Queryable,
  session: AuthenticatedSession,
  tripId: string,
): Promise<AiPendingItineraryContext> {
  assertTrip(session, tripId);
  const empty = { pendingItinerary: [], pendingItineraryTruncated: false };
  if (session.role !== "owner" && session.role !== "editor") return empty;
  const permissions = await getMemberPermissions(client, tripId, session.memberId);
  if (!permissions.canEditItinerary) return empty;
  const limit = 100;
  const result = await client.query<PendingItineraryEditRequestRow>(
    `SELECT cr.id, cr.requested_by_member_id, cr.operation, cr.entity_id,
            cr.base_revision, cr.proposed_patch, cr.status, cr.proposal_revision,
            base.snapshot AS base_patch,
            target.current_revision AS target_revision,
            ${pendingItineraryCurrentPatchProjection} AS current_patch
       FROM change_requests cr
       JOIN trip_members actor
         ON actor.trip_id = cr.trip_id AND actor.id = $2
        AND actor.user_id = $3 AND actor.status = 'active' AND actor.role = $4
       LEFT JOIN itinerary_revisions base
         ON base.trip_id = cr.trip_id AND base.itinerary_item_id = cr.entity_id
        AND base.revision = cr.base_revision
       LEFT JOIN itinerary_items target
         ON target.trip_id = cr.trip_id AND target.id = cr.entity_id
      WHERE cr.trip_id = $1 AND cr.entity_type = 'itinerary_item'
        AND cr.status = 'pending' AND to_jsonb(cr)->>'invalidated_at' IS NULL
        AND (cr.entity_id IS NULL OR to_jsonb(target)->>'removed_at' IS NULL)
        AND ((cr.operation = 'create' AND cr.entity_id IS NULL)
          OR (cr.operation = 'update' AND target.current_revision = cr.base_revision
            AND base.snapshot IS NOT NULL))
        AND app_member_can_view_change_request(cr.trip_id, cr.id, actor.id)
        AND ($4 = 'owner' OR (
          COALESCE(cr.proposed_patch->'isLocked', base.snapshot->'isLocked', 'false'::jsonb) <> 'true'::jsonb
          AND NOT COALESCE(target.is_locked, false)))
      ORDER BY cr.updated_at DESC, cr.id DESC
      LIMIT $5`,
    [tripId, session.memberId, session.userId, session.role, limit + 1],
  );
  const pendingItinerary: AiPendingItineraryContext["pendingItinerary"] = [];
  let pendingItineraryTruncated = result.rows.length > limit;
  const characterLimit = 60_000;
  let contextCharacters = JSON.stringify(empty).length;
  for (const row of result.rows.slice(0, limit)) {
    const createdByMemberId = pendingItineraryCreatorId(row);
    // Only immutable base/proposal fields can reach proposal-only owner reviewers.
    // Never fill incomplete legacy snapshots with a hidden current private target.
    const draft = materializePendingItineraryDraft({
      ...(row.base_patch ?? {}), ...row.proposed_patch as Record<string, unknown>,
    }, createdByMemberId);
    if (!draft || (session.role !== "owner" && draft.isLocked)) continue;
    const { linkedExpense, ...patch } = draft;
    const entry: AiPendingItineraryContext["pendingItinerary"][number] = {
      requestId: row.id,
      proposalRevision: row.proposal_revision,
      operation: row.operation === "update" ? "update" : "create",
      targetItemId: row.entity_id,
      createdByMemberId,
      hasLinkedExpense: linkedExpense !== null,
      patch,
    };
    const entryCharacters = JSON.stringify(entry).length + (pendingItinerary.length ? 1 : 0);
    if (contextCharacters + entryCharacters > characterLimit) {
      pendingItineraryTruncated = true;
      break;
    }
    pendingItinerary.push(entry);
    contextCharacters += entryCharacters;
  }
  return { pendingItinerary, pendingItineraryTruncated };
}

export async function getPendingItineraryRequestForEdit(
  client: Queryable,
  session: AuthenticatedSession,
  tripId: string,
  requestId: string,
): Promise<PendingItineraryEditDetail> {
  assertTrip(session, tripId);
  const row = await selectPendingItineraryRequestForEdit(
    client,
    session,
    tripId,
    requestId,
    false,
  );
  assertPendingItineraryRequestIsEditable(row);
  const detail = pendingItineraryEditDetail(row);
  if (!detail) throw new AppNotFoundError("Pending event request not found.");
  return detail;
}

export async function updatePendingItineraryRequest(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  requestId: string,
  input: PendingItineraryEditInput,
): Promise<PendingItineraryEditDetail> {
  return inTransaction(pool, (client) => updatePendingItineraryRequestWithClient(
    client, session, tripId, requestId, input,
  ));
}

/** The caller owns commit/rollback and must include AI completion in this transaction. */
export async function updatePendingItineraryRequestWithClient(
  client: PoolClient,
  session: AuthenticatedSession,
  tripId: string,
  requestId: string,
  input: PendingItineraryEditInput,
  options?: { aiRequestId: string },
): Promise<PendingItineraryEditDetail> {
  assertTrip(session, tripId);
  const parsedInput = pendingItineraryEditSchema.parse(input) as PendingItineraryEditInput;
  if (options && (Object.hasOwn(input.patch, "linkedExpense") || Object.hasOwn(input.patch, "isLocked"))) {
    throw new AppForbiddenError("AI pending-event edits cannot change expenses or owner locks.");
  }

    await lockCurrentTripActor(client, session);
    if (options) {
      // Provenance is supplied by the server, never the model. Revalidate it so
      // another identity's or completed request cannot authorize an AI edit.
      const provenance = await client.query(
        `SELECT request.id FROM ai_requests request
           JOIN ai_conversations conversation
             ON conversation.trip_id = request.trip_id AND conversation.id = request.conversation_id
          WHERE request.trip_id = $1 AND request.id = $2
            AND request.actor_member_id = $3 AND request.actor_user_id = $4
            AND request.status = 'started' AND request.feature = 'planning'
            AND request.created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
            AND conversation.actor_member_id = $3 AND conversation.actor_user_id = $4
            AND conversation.closed_at IS NULL AND conversation.history_revoked_at IS NULL
          FOR UPDATE OF request, conversation`,
        [tripId, options.aiRequestId, session.memberId, session.userId],
      );
      if (provenance.rowCount !== 1) throw new AppConflictError("The AI request is no longer available for editing.");
    }
    const request = await selectPendingItineraryRequestForEdit(
      client,
      session,
      tripId,
      requestId,
      true,
    );
    assertPendingItineraryRequestIsEditable(request);
    if (request.proposal_revision !== parsedInput.proposalRevision) {
      throw new AppConflictError("The pending event changed. Reload and try again.");
    }

    const createdByMemberId = pendingItineraryCreatorId(request);
    const currentDraft = materializePendingItineraryDraft(
      {
        ...(request.current_patch ?? {}),
        ...(request.base_patch ?? {}),
        ...request.proposed_patch as Record<string, unknown>,
      },
      createdByMemberId,
    );
    if (!currentDraft) throw new AppNotFoundError("Pending event request not found.");
    if (session.role !== "owner" && (currentDraft.isLocked || request.current_patch?.isLocked === true)) {
      throw new AppForbiddenError("Only the owner can change a locked plan item.");
    }

    const incoming = parsedInput.patch as PendingItineraryEditPatch;
    const { linkedExpense: incomingLinkedExpense, ...incomingEventPatch } = incoming;
    const normalizedLocationPatch = canonicalizeItineraryLocationPatch(
      incomingEventPatch,
      currentDraft,
    );
    const mergedPatch: ItineraryPatch = {
      ...storedPendingItineraryPatch(currentDraft),
      ...normalizedLocationPatch,
    };
    if (Object.hasOwn(incoming, "linkedExpense")) {
      if (incomingLinkedExpense === null) {
        delete mergedPatch.linkedExpense;
      } else if (incomingLinkedExpense) {
        mergedPatch.linkedExpense = {
          ...incomingLinkedExpense,
          splitMemberIds: [...new Set(incomingLinkedExpense.splitMemberIds)],
        };
      }
    }

    const visibility = mergedPatch.visibility ?? "trip";
    mergedPatch.visibility = visibility;
    mergedPatch.viewerMemberIds = visibility === "private"
      ? [...new Set(mergedPatch.viewerMemberIds ?? [])]
          .filter((memberId) => memberId !== createdByMemberId)
      : [];
    const validatedPatch = itineraryPatchSchema.parse(mergedPatch);
    const nextDraft = materializePendingItineraryDraft(
      validatedPatch as Record<string, unknown>,
      createdByMemberId,
    );
    if (!nextDraft) {
      throw new AppConflictError("A day, title, and valid location are required for the pending event.");
    }
    if (nextDraft.startsAt && nextDraft.endsAt
        && Date.parse(nextDraft.endsAt) <= Date.parse(nextDraft.startsAt)) {
      throw new AppConflictError("The event must end after it starts.");
    }

    const editingAsOwner = session.role === "owner";
    if (session.memberId !== createdByMemberId && (
      nextDraft.visibility !== currentDraft.visibility
      || !sameMemberAudience(nextDraft.viewerMemberIds, currentDraft.viewerMemberIds)
    )) {
      throw new AppForbiddenError("Only the event creator can change its privacy or audience.");
    }
    if (!editingAsOwner && nextDraft.isLocked !== currentDraft.isLocked) {
      throw new AppForbiddenError("Only the owner can lock a plan item.");
    }

    if (!editingAsOwner) {
      const permissions = await getMemberPermissions(client, tripId, session.memberId);
      if (!permissions.canEditItinerary) {
        throw new AppForbiddenError("You do not have permission to change the itinerary.");
      }
      if (!sameLinkedExpense(currentDraft.linkedExpense, nextDraft.linkedExpense)
          && !permissions.canEditExpenses) {
        throw new AppForbiddenError("You do not have permission to change expenses.");
      }
    }

    await assertCurrentItineraryDates(client, tripId, nextDraft,
      request.operation === "update" ? { tripDayId: request.current_patch?.tripDayId as string, entityId: request.entity_id! } : undefined);
    await assertValidAudienceMembers(client, tripId, nextDraft.viewerMemberIds);
    if (nextDraft.linkedExpense) {
      validatedExpenseSplits(nextDraft.linkedExpense);
      const expenseMemberIds = [...new Set([
        nextDraft.linkedExpense.payerMemberId,
        ...nextDraft.linkedExpense.splitMemberIds,
      ])];
      await assertValidAudienceMembers(client, tripId, expenseMemberIds);
      assertExpenseMembersInsideAudience({
        createdByMemberId,
        visibility: nextDraft.visibility,
        viewerMemberIds: nextDraft.viewerMemberIds,
      }, expenseMemberIds);
    }

    const nextReason = parsedInput.reason ?? request.reason;
    const storedPatch = storedPendingItineraryPatch(nextDraft);
    if (options && Object.hasOwn(request.proposed_patch, "linkedExpense")) {
      // Preserve the existing nested financial payload byte-for-JSON-value. The
      // model is allowed to change event fields only, not normalize a charge.
      storedPatch.linkedExpense = (request.proposed_patch as ItineraryPatch).linkedExpense;
    }
    const updated = await client.query<{ proposal_revision: number; updated_at: Date }>(
      `UPDATE change_requests
          SET proposed_patch = $3::jsonb, reason = $4,
              proposal_revision = proposal_revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1 AND id = $2
          AND to_jsonb(change_requests)->>'invalidated_at' IS NULL
          AND status = 'pending' AND proposal_revision = $5
      RETURNING proposal_revision, updated_at`,
      [
        tripId,
        requestId,
        JSON.stringify(storedPatch),
        nextReason,
        parsedInput.proposalRevision,
      ],
    );
    const updatedState = updated.rows[0];
    if (!updatedState) {
      throw new AppConflictError("The pending event changed. Reload and try again.");
    }

    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "change_request",
      entityId: requestId,
      action: "proposal_updated",
      before: {
        proposalRevision: request.proposal_revision,
        reason: request.reason,
        patch: currentDraft,
      },
      after: {
        proposalRevision: updatedState.proposal_revision,
        reason: nextReason,
        patch: nextDraft,
      },
      metadata: {
        requestedByMemberId: request.requested_by_member_id,
        source: request.source,
        ...(options ? { editSource: "ai", aiRequestId: options.aiRequestId, requiresOwnerReview: true } : {}),
      },
    });

    return {
      requestId: request.id,
      status: "pending",
      operation: request.operation === "update" ? "update" : "create",
      targetItemId: request.entity_id,
      createdByMemberId,
      requestedByMemberId: request.requested_by_member_id,
      requestedByName: request.requested_by_name,
      source: request.source,
      reason: nextReason,
      proposalRevision: updatedState.proposal_revision,
      createdAt: request.created_at.toISOString(),
      updatedAt: updatedState.updated_at.toISOString(),
      patch: nextDraft,
    };
}

function itinerarySnapshot(
  row: Record<string, unknown>,
  viewerMemberIds: string[] = [],
): Record<string, unknown> {
  return {
    id: row.id,
    tripDayId: row.trip_day_id,
    title: row.title,
    itemType: row.item_type,
    startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : row.starts_at,
    endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : row.ends_at,
    locationName: row.location_name,
    mapUrl: row.map_url,
    departureLocationName: row.departure_location_name,
    departureMapUrl: row.departure_map_url,
    destinationLocationName: row.destination_location_name,
    destinationMapUrl: row.destination_map_url,
    notes: row.notes,
    createdByMemberId: row.created_by_member_id,
    visibility: row.visibility,
    viewerMemberIds,
    status: row.status,
    isLocked: row.is_locked,
    currentRevision: row.current_revision,
    ...(row.removed_at ? {
      removedAt: row.removed_at instanceof Date ? row.removed_at.toISOString() : row.removed_at,
      removedByMemberId: row.removed_by_member_id,
    } : {}),
  };
}

function expenseSnapshot(
  row: Record<string, unknown>,
  splits: Array<{ memberId: string; shareMinor: number }>,
): Record<string, unknown> {
  return {
    id: row.id,
    payerMemberId: row.payer_member_id,
    itineraryItemId: row.itinerary_item_id,
    description: row.description,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    status: row.status,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
    currentRevision: Number(row.current_revision),
    splits,
  };
}

async function getExpenseSplits(
  client: PoolClient,
  tripId: string,
  expenseId: string,
): Promise<Array<{ memberId: string; shareMinor: number }>> {
  const result = await client.query<{ member_id: string; share_minor: string }>(
    `SELECT member_id, share_minor FROM expense_splits
      WHERE trip_id = $1 AND expense_id = $2 ORDER BY member_id`,
    [tripId, expenseId],
  );
  return result.rows.map((row) => ({ memberId: row.member_id, shareMinor: Number(row.share_minor) }));
}

async function applyLinkedExpense(
  client: PoolClient,
  session: AuthenticatedSession,
  request: ChangeRequestRow,
  itineraryItemId: string,
  patch: ItineraryPatch,
): Promise<void> {
  if (!patch.linkedExpense) return;
  const expenseRequest: ChangeRequestRow = {
    ...request,
    entity_type: "expense",
    entity_id: null,
    operation: "create",
    base_revision: null,
    proposed_patch: {
      ...patch.linkedExpense,
      itineraryItemId,
    },
  };
  const applied = await applyExpenseRequest(client, session, expenseRequest);
  await appendAudit(client, {
    tripId: session.tripId,
    actorMemberId: session.memberId,
    entityType: "expense",
    entityId: applied.entityId,
    action: "created",
    before: null,
    after: applied.after,
    metadata: {
      changeRequestId: request.id,
      requestedByMemberId: request.requested_by_member_id,
      linkedItineraryItemId: itineraryItemId,
      source: "itinerary_editor",
    },
  });
}

export type CancelledItineraryRemovalInput = {
  expectedRevision: number;
  confirm: true;
};

/** Removal is a separate explicit owner action, never an LLM operation. */
export async function removeCancelledItineraryItem(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  itemId: string,
  input: CancelledItineraryRemovalInput,
): Promise<{ status: "removed"; itemId: string; revision: number }> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only an owner can remove cancelled events.");
  if (input.confirm !== true || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new AppInvalidInputError("Confirm removal using the event's current revision.");
  }
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: true });
    const result = await client.query<Record<string, unknown>>(
      `SELECT i.*,
              COALESCE(ARRAY(
                SELECT viewer.member_id FROM itinerary_item_viewers viewer
                 WHERE viewer.trip_id = i.trip_id AND viewer.itinerary_item_id = i.id
                 ORDER BY viewer.member_id
              ), ARRAY[]::uuid[]) AS viewer_member_ids
         FROM itinerary_items i
        WHERE i.trip_id = $1 AND i.id = $2 AND i.removed_at IS NULL
          AND app_member_can_view_itinerary_item(i.trip_id, i.id, $3)
        FOR UPDATE OF i`,
      [tripId, itemId, session.memberId],
    );
    const current = result.rows[0];
    if (!current) throw new AppNotFoundError("Plan item not found.");
    if (current.current_revision !== input.expectedRevision) {
      throw new AppConflictError("The plan item changed. Reload and try again.");
    }
    if (current.status !== "cancelled") {
      throw new AppConflictError("Only an already cancelled event can be removed.");
    }
    const viewerMemberIds = current.viewer_member_ids as string[];
    const before = itinerarySnapshot(current, viewerMemberIds);
    const revision = Number(current.current_revision) + 1;
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE itinerary_items SET removed_at = CURRENT_TIMESTAMP, removed_by_member_id = $3
        WHERE trip_id = $1 AND id = $2 RETURNING *`,
      [tripId, itemId, session.memberId],
    );
    const after = { ...itinerarySnapshot(updated.rows[0]!, viewerMemberIds), currentRevision: revision };
    await client.query(
      `INSERT INTO itinerary_revisions (
         trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot, reason
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [tripId, itemId, revision, session.memberId, JSON.stringify(after), "Cancelled event removed from active trip views"],
    );
    // Supersede actionable changes only. Expense corrections retaining this
    // historical link remain valid; new/relinked bills cannot revive the event.
    const superseded = await client.query<{ id: string }>(
      `UPDATE change_requests request
          SET status = 'superseded', reviewed_by_member_id = $3,
              review_note = 'The linked event was removed from active trip views.',
              reviewed_at = CURRENT_TIMESTAMP
        WHERE request.trip_id = $1 AND request.status IN ('pending', 'rejected')
          AND request.invalidated_at IS NULL
          AND ((request.entity_type = 'itinerary_item' AND request.entity_id = $2)
            OR (request.entity_type = 'expense' AND request.proposed_patch->>'itineraryItemId' = $2::text
              AND NOT EXISTS (
                SELECT 1 FROM expenses expense
                 WHERE expense.trip_id = request.trip_id AND expense.id = request.entity_id
                   AND expense.itinerary_item_id = $2
              )))
        RETURNING request.id`,
      [tripId, itemId, session.memberId],
    );
    for (const request of superseded.rows) {
      await appendAudit(client, {
        tripId, actorMemberId: session.memberId, entityType: "change_request", entityId: request.id,
        action: "superseded", metadata: { reason: "event_removed", itineraryItemId: itemId },
      });
    }
    await client.query(
      `UPDATE calendar_event_links SET sync_status = 'stale', updated_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1 AND itinerary_item_id = $2`,
      [tripId, itemId],
    );
    await appendAudit(client, {
      tripId, actorMemberId: session.memberId, entityType: "itinerary_item", entityId: itemId,
      action: "removed", before, after,
      metadata: { retainedLinkedExpenses: true, remoteCalendarDeletion: false, supersededRequests: superseded.rows.length },
    });
    return { status: "removed", itemId, revision };
  });
}

async function applyItineraryRequest(
  client: PoolClient,
  session: AuthenticatedSession,
  request: ChangeRequestRow,
): Promise<{ entityId: string; revision: number; before: Record<string, unknown> | null; after: Record<string, unknown> }> {
  const patch = request.proposed_patch as ItineraryPatch;
  if (request.operation === "create") {
    if (!patch.tripDayId || !patch.title) throw new AppConflictError("The proposal is missing a day or title.");
    await assertCurrentItineraryDates(client, session.tripId, patch);
    const locations = resolveItineraryLocationState(patch);
    if (!transportHasEndpoint(locations)) {
      throw new AppConflictError(transportEndpointRequiredMessage);
    }
    const entityId = randomUUID();
    const visibility = patch.visibility ?? "trip";
    const viewerMemberIds = visibility === "private"
      ? [...new Set(patch.viewerMemberIds ?? [])].filter((memberId) => memberId !== request.requested_by_member_id)
      : [];
    await client.query(
      `INSERT INTO itinerary_items (
         trip_id, id, trip_day_id, created_by_member_id, title, item_type,
         starts_at, ends_at, location_name, map_url,
         departure_location_name, departure_map_url,
         destination_location_name, destination_map_url,
         notes, status, is_locked, visibility
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        session.tripId, entityId, patch.tripDayId, request.requested_by_member_id,
        patch.title, locations.itemType, patch.startsAt ?? null, patch.endsAt ?? null,
        locations.locationName, locations.mapUrl,
        locations.departureLocationName, locations.departureMapUrl,
        locations.destinationLocationName, locations.destinationMapUrl,
        patch.notes ?? null, patch.status ?? "planned", patch.isLocked ?? false, visibility,
      ],
    );
    for (const memberId of viewerMemberIds) {
      await client.query(
        `INSERT INTO itinerary_item_viewers (
           trip_id, itinerary_item_id, member_id, added_by_member_id
         ) VALUES ($1,$2,$3,$4)`,
        [session.tripId, entityId, memberId, session.memberId],
      );
    }
    const afterResult = await client.query<Record<string, unknown>>(
      `SELECT * FROM itinerary_items WHERE trip_id = $1 AND id = $2`,
      [session.tripId, entityId],
    );
    const after = itinerarySnapshot(afterResult.rows[0]!, viewerMemberIds);
    await client.query(
      `INSERT INTO itinerary_revisions (
         trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot, reason
       ) VALUES ($1,$2,1,$3,$4::jsonb,$5)`,
      [session.tripId, entityId, session.memberId, JSON.stringify(after), request.reason],
    );
    await applyLinkedExpense(client, session, request, entityId, patch);
    await linkApprovedCalendarImport(client, session.tripId, request.id, entityId);
    return { entityId, revision: 1, before: null, after };
  }

  const currentResult = await client.query<Record<string, unknown>>(
    `SELECT i.*,
            COALESCE(ARRAY(
              SELECT iv.member_id
                FROM itinerary_item_viewers iv
               WHERE iv.trip_id = i.trip_id AND iv.itinerary_item_id = i.id
               ORDER BY iv.member_id
            ), ARRAY[]::uuid[]) AS viewer_member_ids
       FROM itinerary_items i
      WHERE i.trip_id = $1 AND i.id = $2
        AND to_jsonb(i)->>'removed_at' IS NULL FOR UPDATE OF i`,
    [session.tripId, request.entity_id],
  );
  const current = currentResult.rows[0];
  if (!current) throw new AppNotFoundError("Plan item not found.");
  if (current.current_revision !== request.base_revision) throw new AppConflictError("The proposal is stale and cannot be applied.");
  const currentViewerMemberIds = current.viewer_member_ids as string[];
  const before = itinerarySnapshot(current, currentViewerMemberIds);
  await assertCurrentItineraryDates(client, session.tripId, patch, { tripDayId: current.trip_day_id as string, entityId: request.entity_id! });
  const nextRevision = Number(current.current_revision) + 1;
  const locations = resolveItineraryLocationState(patch, {
    itemType: current.item_type as ItineraryLocationState["itemType"],
    locationName: current.location_name as string | null,
    mapUrl: current.map_url as string | null,
    departureLocationName: current.departure_location_name as string | null,
    departureMapUrl: current.departure_map_url as string | null,
    destinationLocationName: current.destination_location_name as string | null,
    destinationMapUrl: current.destination_map_url as string | null,
  });
  if (!transportHasEndpoint(locations)) {
    throw new AppConflictError(transportEndpointRequiredMessage);
  }
  const nextStatus = request.operation === "cancel" ? "cancelled" : request.operation === "restore" ? "planned" : patch.status ?? current.status;
  const nextVisibility = patch.visibility ?? current.visibility as "trip" | "private";
  const nextViewerMemberIds = nextVisibility === "private"
    ? [...new Set(patch.viewerMemberIds ?? currentViewerMemberIds)]
      .filter((memberId) => memberId !== current.created_by_member_id)
    : [];
  await client.query(
    `UPDATE itinerary_items
        SET trip_day_id = $3, title = $4, item_type = $5, starts_at = $6,
            ends_at = $7, location_name = $8, map_url = $9,
            departure_location_name = $10, departure_map_url = $11,
            destination_location_name = $12, destination_map_url = $13,
            notes = $14, status = $15, is_locked = $16, visibility = $17
      WHERE trip_id = $1 AND id = $2`,
    [
      session.tripId, request.entity_id,
      patch.tripDayId ?? current.trip_day_id,
      patch.title ?? current.title,
      locations.itemType,
      patch.startsAt !== undefined ? patch.startsAt : current.starts_at,
      patch.endsAt !== undefined ? patch.endsAt : current.ends_at,
      locations.locationName,
      locations.mapUrl,
      locations.departureLocationName,
      locations.departureMapUrl,
      locations.destinationLocationName,
      locations.destinationMapUrl,
      patch.notes !== undefined ? patch.notes : current.notes,
      nextStatus,
      patch.isLocked !== undefined ? patch.isLocked : current.is_locked,
      nextVisibility,
    ],
  );
  if (patch.visibility !== undefined || patch.viewerMemberIds !== undefined) {
    await client.query(
      `DELETE FROM itinerary_item_viewers WHERE trip_id = $1 AND itinerary_item_id = $2`,
      [session.tripId, request.entity_id],
    );
    for (const memberId of nextViewerMemberIds) {
      await client.query(
        `INSERT INTO itinerary_item_viewers (
           trip_id, itinerary_item_id, member_id, added_by_member_id
         ) VALUES ($1,$2,$3,$4)`,
        [session.tripId, request.entity_id, memberId, session.memberId],
      );
    }
  }
  const afterResult = await client.query<Record<string, unknown>>(
    `SELECT * FROM itinerary_items WHERE trip_id = $1 AND id = $2`,
    [session.tripId, request.entity_id],
  );
  const after = {
    ...itinerarySnapshot(afterResult.rows[0]!, nextViewerMemberIds),
    currentRevision: nextRevision,
  };
  await client.query(
    `INSERT INTO itinerary_revisions (
       trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot, reason
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [session.tripId, request.entity_id, nextRevision, session.memberId, JSON.stringify(after), request.reason],
  );
  await client.query(
    `UPDATE calendar_event_links
        SET sync_status = 'stale', updated_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND itinerary_item_id = $2`,
    [session.tripId, request.entity_id],
  );
  await applyLinkedExpense(client, session, request, request.entity_id!, patch);
  return { entityId: request.entity_id!, revision: nextRevision, before, after };
}

async function applyExpenseRequest(
  client: PoolClient,
  session: AuthenticatedSession,
  request: ChangeRequestRow,
): Promise<{ entityId: string; revision: number; before: Record<string, unknown> | null; after: Record<string, unknown> }> {
  const patch = request.proposed_patch as ExpensePatch;
  if (request.operation === "create") {
    if (!patch.description || !patch.amountMinor || !patch.currency || !patch.payerMemberId || !patch.splitMemberIds) {
      throw new AppConflictError("The expense proposal is incomplete.");
    }
    const splits = validatedExpenseSplits(patch)!;
    if (patch.itineraryItemId) {
      const audience = await getItineraryAudience(client, session.tripId, patch.itineraryItemId, true);
      if (!audience || audience.removed) throw new AppNotFoundError("Linked itinerary item not found.");
    }
    const entityId = randomUUID();
    const status = patch.status ?? "posted";
    await client.query(
      `INSERT INTO expenses (
         trip_id, id, payer_member_id, itinerary_item_id, description,
         amount_minor, currency, status, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [session.tripId, entityId, patch.payerMemberId, patch.itineraryItemId ?? null,
        patch.description, patch.amountMinor, patch.currency, status, patch.occurredAt ?? new Date().toISOString()],
    );
    for (const split of splits) {
      await client.query(
        `INSERT INTO expense_splits (trip_id, expense_id, member_id, share_minor)
         VALUES ($1,$2,$3,$4)`,
        [session.tripId, entityId, split.participantId, split.amountMinor],
      );
    }
    const createdResult = await client.query<Record<string, unknown>>(
      `SELECT * FROM expenses WHERE trip_id = $1 AND id = $2`,
      [session.tripId, entityId],
    );
    const after = expenseSnapshot(createdResult.rows[0]!, splits.map((split) => ({
      memberId: split.participantId,
      shareMinor: split.amountMinor,
    })));
    await client.query(
      `INSERT INTO expense_revisions (
         trip_id, expense_id, revision, changed_by_member_id, snapshot
       ) VALUES ($1,$2,1,$3,$4::jsonb)`,
      [session.tripId, entityId, session.memberId, JSON.stringify(after)],
    );
    return { entityId, revision: 1, before: null, after };
  }

  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM expenses WHERE trip_id = $1 AND id = $2 FOR UPDATE`,
    [session.tripId, request.entity_id],
  );
  const current = result.rows[0];
  if (!current) throw new AppNotFoundError("Expense not found.");
  if (current.current_revision !== request.base_revision) throw new AppConflictError("The expense proposal is stale.");
  if (patch.itineraryItemId && patch.itineraryItemId !== current.itinerary_item_id) {
    const audience = await getItineraryAudience(client, session.tripId, patch.itineraryItemId, true);
    if (!audience || audience.removed) throw new AppNotFoundError("Linked itinerary item not found.");
  }
  const currentSplits = await getExpenseSplits(client, session.tripId, request.entity_id!);
  const nextSplits = validatedExpenseSplits(patch, { amountMinor: Number(current.amount_minor),
    splits: currentSplits.map((split) => ({ participantId: split.memberId, amountMinor: split.shareMinor })) });
  const before = expenseSnapshot(current, currentSplits);
  const nextRevision = Number(current.current_revision) + 1;
  const status = request.operation === "void" ? "void" : patch.status ?? current.status;
  if (current.status === "draft" && status !== "draft" && session.role !== "owner") {
    throw new AppForbiddenError("Only an owner can approve or reject a draft expense.");
  }
  await client.query(
    `UPDATE expenses
        SET payer_member_id = $3, itinerary_item_id = $4, description = $5,
            amount_minor = $6, currency = $7, status = $8, occurred_at = $9
      WHERE trip_id = $1 AND id = $2`,
    [session.tripId, request.entity_id, patch.payerMemberId ?? current.payer_member_id,
      patch.itineraryItemId !== undefined ? patch.itineraryItemId : current.itinerary_item_id,
      patch.description ?? current.description, patch.amountMinor ?? Number(current.amount_minor),
      patch.currency ?? current.currency, status, patch.occurredAt ?? current.occurred_at],
  );
  if (nextSplits) {
    await client.query(`DELETE FROM expense_splits WHERE trip_id = $1 AND expense_id = $2`, [session.tripId, request.entity_id]);
    for (const split of nextSplits) {
      await client.query(
        `INSERT INTO expense_splits (trip_id, expense_id, member_id, share_minor) VALUES ($1,$2,$3,$4)`,
        [session.tripId, request.entity_id, split.participantId, split.amountMinor],
      );
    }
  }
  const updatedResult = await client.query<Record<string, unknown>>(
    `SELECT * FROM expenses WHERE trip_id = $1 AND id = $2`,
    [session.tripId, request.entity_id],
  );
  const after = {
    ...expenseSnapshot(updatedResult.rows[0]!, await getExpenseSplits(client, session.tripId, request.entity_id!)),
    currentRevision: nextRevision,
  };
  await client.query(
    `INSERT INTO expense_revisions (
       trip_id, expense_id, revision, changed_by_member_id, snapshot
     ) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [session.tripId, request.entity_id, nextRevision, session.memberId, JSON.stringify(after)],
  );
  return { entityId: request.entity_id!, revision: nextRevision, before, after };
}

function addReviewAudienceItemId(targets: Set<string>, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string" || !uuidPattern.test(value)) return false;
  targets.add(value);
  return true;
}

function addReviewMemberId(targets: Set<string>, value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || !uuidPattern.test(value)) return false;
  targets.add(value);
  return true;
}

function addReviewMemberIds(targets: Set<string>, value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((memberId) => addReviewMemberId(targets, memberId));
}

function addReviewSplitAmountMemberIds(targets: Set<string>, value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return false;
  return value.every((split) => split !== null && typeof split === "object" && !Array.isArray(split)
    && addReviewMemberId(targets, (split as Record<string, unknown>).memberId));
}

function referencedReviewMemberIds(request: ChangeRequestRow): string[] {
  const memberIds = new Set<string>();
  const patch = request.proposed_patch as Record<string, unknown>;
  let validMemberReferences = true;

  if (request.entity_type === "itinerary_item") {
    validMemberReferences = addReviewMemberIds(memberIds, patch.viewerMemberIds);
    if (patch.linkedExpense !== undefined) {
      const linkedExpense = patch.linkedExpense;
      if (!linkedExpense || typeof linkedExpense !== "object" || Array.isArray(linkedExpense)) {
        validMemberReferences = false;
      } else {
        const linkedExpensePatch = linkedExpense as Record<string, unknown>;
        validMemberReferences = addReviewMemberId(
          memberIds,
          linkedExpensePatch.payerMemberId,
        ) && validMemberReferences;
        validMemberReferences = addReviewMemberIds(
          memberIds,
          linkedExpensePatch.splitMemberIds,
        ) && validMemberReferences;
        validMemberReferences = addReviewSplitAmountMemberIds(memberIds, linkedExpensePatch.splitAmounts) && validMemberReferences;
      }
    }
  } else {
    validMemberReferences = addReviewMemberId(memberIds, patch.payerMemberId);
    validMemberReferences = addReviewMemberIds(
      memberIds,
      patch.splitMemberIds,
    ) && validMemberReferences;
    validMemberReferences = addReviewSplitAmountMemberIds(memberIds, patch.splitAmounts) && validMemberReferences;
  }

  if (!validMemberReferences) throw new AppNotFoundError("Change request not found.");
  return [...memberIds].sort();
}

async function lockAndRecheckChangeRequestAudience(
  client: PoolClient,
  session: AuthenticatedSession,
  request: ChangeRequestRow,
): Promise<void> {
  const itineraryItemIds = new Set<string>();
  let validAudienceReferences = true;

  if (request.entity_type === "itinerary_item") {
    validAudienceReferences = addReviewAudienceItemId(itineraryItemIds, request.entity_id);
  } else {
    if (request.entity_id) {
      const expense = await client.query<{ itinerary_item_id: string | null }>(
        `SELECT itinerary_item_id
           FROM expenses
          WHERE trip_id = $1 AND id = $2
          FOR UPDATE`,
        [session.tripId, request.entity_id],
      );
      const currentExpense = expense.rows[0];
      if (!currentExpense) throw new AppNotFoundError("Change request not found.");
      validAudienceReferences = addReviewAudienceItemId(
        itineraryItemIds,
        currentExpense.itinerary_item_id,
      );
    }

    const patch = request.proposed_patch as StoredExpensePatch;
    validAudienceReferences = addReviewAudienceItemId(
      itineraryItemIds,
      patch.itineraryItemId,
    ) && validAudienceReferences;
    validAudienceReferences = addReviewAudienceItemId(
      itineraryItemIds,
      patch.itineraryAudienceSnapshot?.itineraryItemId,
    ) && validAudienceReferences;
  }

  if (!validAudienceReferences) throw new AppNotFoundError("Change request not found.");

  for (const itineraryItemId of [...itineraryItemIds].sort()) {
    const lockedItem = await client.query(
      `SELECT 1
         FROM itinerary_items
        WHERE trip_id = $1 AND id = $2
          AND ($3::boolean OR to_jsonb(itinerary_items)->>'removed_at' IS NULL)
        FOR UPDATE`,
      [session.tripId, itineraryItemId, request.entity_type === "expense"],
    );
    if (lockedItem.rowCount !== 1) throw new AppNotFoundError("Change request not found.");
  }

  const visibility = await client.query<{ can_view: boolean }>(
    `SELECT app_member_can_view_change_request($1, $2, $3) AS can_view`,
    [session.tripId, request.id, session.memberId],
  );
  if (visibility.rows[0]?.can_view !== true) {
    throw new AppNotFoundError("Change request not found.");
  }
}

async function lockAndRecheckChangeRequestMembers(
  client: PoolClient,
  session: AuthenticatedSession,
  request: ChangeRequestRow,
): Promise<void> {
  for (const memberId of referencedReviewMemberIds(request)) {
    const lockedMember = await client.query<{ status: string }>(
      `SELECT status
         FROM trip_members
        WHERE trip_id = $1 AND id = $2
        FOR UPDATE`,
      [session.tripId, memberId],
    );
    const status = lockedMember.rows[0]?.status;
    if (!status || status === "revoked" || status === "removed") {
      throw new AppNotFoundError("Change request not found.");
    }
  }
}

export async function reviewChangeRequest(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  requestId: string,
  decision: "approve" | "reject",
  note?: string,
  expectedProposalRevision?: number,
): Promise<{ status: "approved" | "rejected"; entityId: string | null; revision: number | null }> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only the owner can review changes.");
  return inTransaction(pool, (client) => reviewChangeRequestWithClient(client, session, tripId, requestId, decision, note, expectedProposalRevision));
}

/** Transaction-owning callers must include their own completion/audit fence. */
export async function reviewChangeRequestWithClient(
  client: PoolClient,
  session: AuthenticatedSession,
  tripId: string,
  requestId: string,
  decision: "approve" | "reject",
  note?: string,
  expectedProposalRevision?: number,
): Promise<{ status: "approved" | "rejected"; entityId: string | null; revision: number | null }> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only the owner can review changes.");
  if (expectedProposalRevision !== undefined && (
    !Number.isSafeInteger(expectedProposalRevision) || expectedProposalRevision < 1
  )) throw new AppInvalidInputError("A positive proposal revision is required for review.");

    await lockCurrentTripActor(client, session, { owner: true });
    const result = await client.query<ChangeRequestRow>(
      `SELECT * FROM change_requests cr
        WHERE trip_id = $1 AND id = $2
          AND to_jsonb(cr)->>'invalidated_at' IS NULL
          AND app_member_can_view_change_request(trip_id, id, $3)
        FOR UPDATE`,
      [tripId, requestId, session.memberId],
    );
    const request = result.rows[0];
    if (!request) throw new AppNotFoundError("Change request not found.");
    if (expectedProposalRevision !== undefined && request.proposal_revision !== expectedProposalRevision) {
      throw new AppConflictError("The proposal changed. Reload and review the latest version before deciding.");
    }
    await lockAndRecheckChangeRequestAudience(client, session, request);

    if (decision === "reject") {
      if (request.status === "approved") {
        throw new AppConflictError("An approved request cannot be rejected or reopened.");
      }
      if (request.status !== "pending") {
        throw new AppConflictError("Only a pending request can be rejected.");
      }
      await client.query(
        `UPDATE change_requests
            SET status = 'rejected', reviewed_by_member_id = $3,
                review_note = $4, reviewed_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = $2`,
        [tripId, requestId, session.memberId, note ?? null],
      );
      await appendAudit(client, {
        tripId,
        actorMemberId: session.memberId,
        entityType: "change_request",
        entityId: requestId,
        action: "rejected",
        metadata: { note: note ?? null, previousStatus: request.status },
      });
      return { status: "rejected", entityId: request.entity_id, revision: null };
    }

    if (request.status !== "pending" && request.status !== "rejected") {
      throw new AppConflictError("This request was already reviewed and cannot be approved.");
    }
    await lockAndRecheckChangeRequestMembers(client, session, request);

    const applied = request.entity_type === "itinerary_item"
      ? await applyItineraryRequest(client, session, request)
      : await applyExpenseRequest(client, session, request);
    await client.query(
      `UPDATE change_requests
          SET status = 'approved', entity_id = $3, reviewed_by_member_id = $4,
              review_note = $5, applied_revision = $6, reviewed_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1 AND id = $2`,
      [tripId, requestId, applied.entityId, session.memberId, note ?? null, applied.revision],
    );
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: request.entity_type,
      entityId: applied.entityId,
      action: request.operation === "create" ? "created" : request.operation,
      before: applied.before,
      after: applied.after,
      metadata: {
        changeRequestId: requestId,
        requestedByMemberId: request.requested_by_member_id,
        previousRequestStatus: request.status,
      },
    });
    return { status: "approved", entityId: applied.entityId, revision: applied.revision };
}

export async function applyPermittedChangeRequestWithClient(
  client: PoolClient,
  session: AuthenticatedSession,
  tripId: string,
  requestId: string,
): Promise<{ status: "approved"; entityId: string; revision: number }> {
  assertTrip(session, tripId);
    await lockCurrentTripActor(client, session);
    const result = await client.query<ChangeRequestRow>(
      `SELECT * FROM change_requests cr
        WHERE trip_id = $1 AND id = $2
          AND to_jsonb(cr)->>'invalidated_at' IS NULL
          AND app_member_can_view_change_request(trip_id, id, $3)
        FOR UPDATE`,
      [tripId, requestId, session.memberId],
    );
    const request = result.rows[0];
    if (!request) throw new AppNotFoundError("Change request not found.");
    if (request.status !== "pending") throw new AppConflictError("This request was already reviewed.");
    const aiEdit = request.entity_type === "itinerary_item"
      ? await client.query<{ edited_by_ai: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM audit_events event
              WHERE event.trip_id = $1 AND event.entity_type = 'change_request'
                AND event.entity_id = $2 AND event.action = 'proposal_updated'
                AND event.metadata->>'editSource' = 'ai'
                AND event.metadata->>'requiresOwnerReview' = 'true'
           ) AS edited_by_ai`,
          [tripId, request.id],
        )
      : null;
    if (aiEdit?.rows[0]?.edited_by_ai === true) {
      throw new AppForbiddenError("AI-edited pending events require explicit owner approval.");
    }
    if (session.role === "owner") {
      if (request.source === "ai" && request.operation === "create") {
        throw new AppForbiddenError(request.entity_type === "expense"
          ? "AI-created expenses require explicit owner approval before they are added to the ledger."
          : "AI-created events require explicit owner approval before they are added to the itinerary.");
      }
      const reviewed = await reviewChangeRequestWithClient(client, session, tripId, requestId, "approve", "Applied directly by owner");
      if (!reviewed.entityId || !reviewed.revision) throw new AppConflictError("The change could not be applied.");
      return { status: "approved", entityId: reviewed.entityId, revision: reviewed.revision };
    }
    if (request.requested_by_member_id !== session.memberId || request.proposed_patch === null) {
      throw new AppForbiddenError("Only your own eligible request can be applied directly.");
    }
    if (request.source === "ai") {
      throw new AppForbiddenError("AI plan changes always require owner approval.");
    }
    const permissions = await getMemberPermissions(client, tripId, session.memberId);
    const hasLinkedExpense = request.entity_type === "itinerary_item"
      && Boolean((request.proposed_patch as ItineraryPatch).linkedExpense);
    const proposalEdit = request.entity_type === "itinerary_item"
      ? await client.query<{ edited_by_another_member: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM audit_events event
              WHERE event.trip_id = $1
                AND event.entity_type = 'change_request'
                AND event.entity_id = $2
                AND event.action = 'proposal_updated'
                AND event.actor_member_id IS DISTINCT FROM $3
           ) AS edited_by_another_member`,
          [tripId, request.id, request.requested_by_member_id],
        )
      : null;
    const hasNonRequesterProposalEdit = proposalEdit?.rows[0]?.edited_by_another_member === true;
    const allowed = memberCanDirectlyApplyChangeRequest({
      entityType: request.entity_type,
      hasLinkedExpense,
      hasNonRequesterProposalEdit,
      permissions,
    });
    if (!allowed) {
      throw new AppForbiddenError(
        hasNonRequesterProposalEdit
          ? "Owner approval is required after another member edited this proposal."
          : "Owner approval is required for this change.",
      );
    }
    await lockAndRecheckChangeRequestAudience(client, session, request);
    await lockAndRecheckChangeRequestMembers(client, session, request);

    const applied = request.entity_type === "itinerary_item"
      ? await applyItineraryRequest(client, session, request)
      : await applyExpenseRequest(client, session, request);
    await client.query(
      `UPDATE change_requests
          SET status = 'approved', entity_id = $3, reviewed_by_member_id = $4,
              review_note = 'Auto-applied by member permission', applied_revision = $5,
              reviewed_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1 AND id = $2`,
      [tripId, requestId, applied.entityId, session.memberId, applied.revision],
    );
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: request.entity_type,
      entityId: applied.entityId,
      action: request.operation === "create" ? "created" : request.operation,
      before: applied.before,
      after: applied.after,
      metadata: { changeRequestId: requestId, approvalMode: "member_permission" },
    });
    return { status: "approved", entityId: applied.entityId, revision: applied.revision };
}

export async function applyPermittedChangeRequest(pool: Pool, session: AuthenticatedSession, tripId: string, requestId: string): Promise<{ status: "approved"; entityId: string; revision: number }> {
  return inTransaction(pool, (client) => applyPermittedChangeRequestWithClient(client, session, tripId, requestId));
}

/** Import approval uses the request creator's exact Calendar source, never the reviewing owner's account. */
async function linkApprovedCalendarImport(client: PoolClient, tripId: string, requestId: string, itemId: string): Promise<void> {
  const readiness = await client.query<{ ready: boolean }>("SELECT to_regclass('calendar_import_receipts') IS NOT NULL AS ready");
  if (!readiness.rows[0]?.ready) return;
  const receipt = await client.query<{ member_id: string; account_subject: string; provider_event_id: string; source_etag: string | null }>(
    `SELECT member_id, account_subject, provider_event_id, source_etag FROM calendar_import_receipts
      WHERE trip_id = $1 AND change_request_id = $2 FOR UPDATE`, [tripId, requestId]);
  const source = receipt.rows[0];
  if (!source) return;
  await client.query(`INSERT INTO calendar_event_links (trip_id, itinerary_item_id, member_id, provider_event_id,
      provider_etag, last_synced_item_revision, account_subject, sync_status)
    SELECT $1,$2,$3,$4,$5,1,$6,
      CASE WHEN i.title = r.source_snapshot->>'title'
         AND i.starts_at = (r.source_snapshot->>'startsAt')::timestamptz
         AND i.ends_at = (r.source_snapshot->>'endsAt')::timestamptz
         AND i.location_name IS NOT DISTINCT FROM r.source_snapshot->>'location'
         AND i.notes IS NULL THEN 'synced' ELSE 'stale' END
      FROM itinerary_items i JOIN calendar_import_receipts r ON r.trip_id = i.trip_id AND r.change_request_id = $7
     WHERE i.trip_id = $1 AND i.id = $2`, [tripId, itemId, source.member_id, source.provider_event_id, source.source_etag, source.account_subject, requestId]);
  await client.query(`UPDATE calendar_import_receipts SET itinerary_item_id = $3 WHERE trip_id = $1 AND change_request_id = $2`, [tripId, requestId, itemId]);
}

export async function updateMemberPermissions(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  memberId: string,
  permissions: MemberPermissions,
): Promise<void> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only the owner can update member permissions.");
  await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: true });
    const target = await client.query<{ role: string }>(
      `SELECT role FROM trip_members WHERE trip_id = $1 AND id = $2 AND status NOT IN ('revoked', 'removed') FOR UPDATE`,
      [tripId, memberId],
    );
    if (!target.rows[0]) throw new AppNotFoundError("Member not found.");
    if (target.rows[0].role === "owner") throw new AppForbiddenError("Owner permissions cannot be restricted.");
    if (target.rows[0].role === "viewer" && (permissions.canEditItinerary || permissions.canEditExpenses)) {
      throw new AppForbiddenError("Change this member to editor before granting edit permissions.");
    }
    const before = await getMemberPermissions(client, tripId, memberId);
    await client.query(
      `INSERT INTO member_permissions (
         trip_id, member_id, can_edit_itinerary, itinerary_requires_approval,
         can_edit_expenses, expense_requires_approval, can_sync_calendar,
         updated_by_member_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (trip_id, member_id) DO UPDATE
         SET can_edit_itinerary = EXCLUDED.can_edit_itinerary,
             itinerary_requires_approval = EXCLUDED.itinerary_requires_approval,
             can_edit_expenses = EXCLUDED.can_edit_expenses,
             expense_requires_approval = EXCLUDED.expense_requires_approval,
             can_sync_calendar = EXCLUDED.can_sync_calendar,
             updated_by_member_id = EXCLUDED.updated_by_member_id,
             updated_at = CURRENT_TIMESTAMP`,
      [tripId, memberId, permissions.canEditItinerary, permissions.itineraryRequiresApproval,
        permissions.canEditExpenses, permissions.expenseRequiresApproval,
        permissions.canSyncCalendar, session.memberId],
    );
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "member_permissions",
      entityId: memberId,
      action: "updated",
      before,
      after: permissions,
    });
  });
}

export async function createTripMember(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  input: { displayName: string },
): Promise<{ id: string }> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only the owner can add members.");
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: true });
    const tripResult = await client.query<{ max_members: number }>(
      `SELECT max_members FROM trips WHERE id = $1 FOR UPDATE`,
      [tripId],
    );
    const trip = tripResult.rows[0];
    if (!trip) throw new AppNotFoundError("Trip not found.");
    const countResult = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM trip_members
        WHERE trip_id = $1 AND status <> 'removed'`,
      [tripId],
    );
    if ((countResult.rows[0]?.count ?? 0) >= trip.max_members) {
      throw new AppConflictError(
        `This trip has reached its ${trip.max_members}-member limit, including the owner.`,
      );
    }
    const memberId = randomUUID();
    await client.query(
      `INSERT INTO trip_members (
         trip_id, id, display_name, role, status
       ) VALUES ($1, $2, $3, 'editor', 'invited')`,
      [tripId, memberId, input.displayName],
    );
    await client.query(
      `INSERT INTO member_permissions (
         trip_id, member_id, can_edit_itinerary, itinerary_requires_approval,
         can_edit_expenses, expense_requires_approval, can_sync_calendar,
         updated_by_member_id
       ) VALUES ($1, $2, true, true, true, false, true, $3)`,
      [tripId, memberId, session.memberId],
    );
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "trip_member",
      entityId: memberId,
      action: "created",
      after: { displayName: input.displayName, role: "editor", status: "invited" },
    });
    return { id: memberId };
  });
}

export async function updateTripMember(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  memberId: string,
  input: { displayName?: string; disabled?: boolean; role?: "owner" | "editor" | "viewer"; expectedRevision?: number },
): Promise<void> {
  assertTrip(session, tripId);
  const isSelf = session.memberId === memberId;
  if (!isSelf && session.role !== "owner") {
    throw new AppForbiddenError("Members can only change their own name.");
  }
  if ((input.disabled !== undefined || input.role !== undefined) && session.role !== "owner") {
    throw new AppForbiddenError("Only the owner can change member access.");
  }
  await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: input.disabled !== undefined || input.role !== undefined || !isSelf });
    const targetResult = await client.query<{
      display_name: string;
      role: string;
      status: string;
      user_id: string | null;
      current_revision: number;
    }>(
      `SELECT display_name, role, status, user_id, current_revision
         FROM trip_members
        WHERE trip_id = $1 AND id = $2 AND status <> 'removed'
        FOR UPDATE`,
      [tripId, memberId],
    );
    const target = targetResult.rows[0];
    if (!target) throw new AppNotFoundError("Member not found.");
    if ((input.expectedRevision !== undefined && input.expectedRevision !== target.current_revision)
      || (input.role !== undefined && input.expectedRevision === undefined)) {
      throw new AppConflictError("This member changed. Refresh before changing their role.");
    }
    if (input.role === "owner" && (!target.user_id || target.status !== "active" || input.disabled === true)) {
      throw new AppForbiddenError("Only an active member who has signed in can become an owner.");
    }
    const nextRole = input.role ?? target.role;
    if (target.role === "owner" && (input.disabled === true || nextRole !== "owner")) {
      await requireAnotherBoundOwner(client, tripId, memberId);
      await client.query(
        `UPDATE trips SET owner_user_id = (
           SELECT user_id FROM trip_members WHERE trip_id = $1 AND id <> $2
             AND role = 'owner' AND status = 'active' AND user_id IS NOT NULL
           ORDER BY created_at, id LIMIT 1
         ) WHERE id = $1 AND owner_user_id = $3`, [tripId, memberId, target.user_id],
      );
    }
    const nextStatus = input.disabled === undefined
      ? target.status
      : input.disabled
        ? "revoked"
        : target.user_id
          ? "active"
          : "invited";
    const nextName = input.displayName ?? target.display_name;
    await client.query(
      `UPDATE trip_members
          SET display_name = $3, status = $4, role = $5,
              current_revision = current_revision + 1
        WHERE trip_id = $1 AND id = $2`,
      [tripId, memberId, nextName, nextStatus, nextRole],
    );
    if (nextRole !== target.role) {
      await client.query(
        `INSERT INTO member_permissions (trip_id, member_id, can_edit_itinerary,
           itinerary_requires_approval, can_edit_expenses, expense_requires_approval,
           can_sync_calendar, updated_by_member_id)
         VALUES ($1,$2,$3,$4,$3,$4,true,$5)
         ON CONFLICT (trip_id, member_id) DO UPDATE SET
           can_edit_itinerary = EXCLUDED.can_edit_itinerary,
           itinerary_requires_approval = EXCLUDED.itinerary_requires_approval,
           can_edit_expenses = EXCLUDED.can_edit_expenses,
           expense_requires_approval = EXCLUDED.expense_requires_approval,
           can_sync_calendar = EXCLUDED.can_sync_calendar,
           updated_by_member_id = EXCLUDED.updated_by_member_id, updated_at = CURRENT_TIMESTAMP`,
        [tripId, memberId, nextRole !== "viewer", nextRole !== "owner", session.memberId],
      );
    }
    if (input.disabled) {
      await client.query(
        `UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
                revoke_reason = COALESCE(revoke_reason, 'member_disabled')
          WHERE trip_id = $1 AND member_id = $2`,
        [tripId, memberId],
      );
      await client.query(
        `UPDATE member_claim_links
            SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
          WHERE trip_id = $1 AND member_id = $2
            AND consumed_at IS NULL AND revoked_at IS NULL`,
        [tripId, memberId],
      );
    }
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "trip_member",
      entityId: memberId,
      action: nextRole !== target.role ? "role_changed" : input.disabled === undefined ? "renamed" : input.disabled ? "disabled" : "enabled",
      before: { displayName: target.display_name, status: target.status, role: target.role },
      after: { displayName: nextName, status: nextStatus, role: nextRole },
    });
  });
}

export async function removeTripMember(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  memberId: string,
  input?: import("@/lib/app/member-removal").MemberRemovalInput,
): Promise<void> {
  if (!input) throw new AppInvalidInputError("Review and explicitly confirm the member removal preview first.");
  const { removeTripMemberSafely } = await import("@/lib/app/member-removal");
  await removeTripMemberSafely(pool, session, tripId, memberId, input);
}

export async function updateAiSettings(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  input: { enabled?: boolean; ownerDefaultModel?: OwnerModel; memberDailyLimit?: number },
): Promise<void> {
  assertTrip(session, tripId);
  if (session.role !== "owner") throw new AppForbiddenError("Only the owner can change AI settings.");
  await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session, { owner: true });
    const entitlement = await client.query<{ sponsored: boolean; migrated: boolean }>(
      `SELECT COALESCE((to_jsonb(s)->>'host_subscription_enabled')::boolean, true) AS sponsored,
              to_jsonb(s) ? 'host_subscription_enabled' AS migrated
         FROM trip_ai_settings s WHERE trip_id = $1`, [tripId],
    );
    const access = entitlement.rows[0];
    if (!access?.sponsored && input.enabled === true) {
      throw new AppForbiddenError("AI funding is not configured for this trip.");
    }
    if (input.ownerDefaultModel && access?.migrated && !await isPlatformOperator(client, session.userId)) {
      throw new AppForbiddenError("Host-funded model selection is restricted to the platform operator.");
    }
    await client.query(
      `INSERT INTO trip_ai_settings (
         trip_id, enabled, owner_default_model, member_daily_limit, updated_by_member_id
       ) VALUES ($1, COALESCE($2, true), COALESCE($3, 'gpt-6.1-sol'), COALESCE($4, 20), $5)
       ON CONFLICT (trip_id) DO UPDATE
         SET enabled = COALESCE($2, trip_ai_settings.enabled),
             owner_default_model = COALESCE($3, trip_ai_settings.owner_default_model),
             member_daily_limit = COALESCE($4, trip_ai_settings.member_daily_limit),
             updated_by_member_id = $5,
             updated_at = CURRENT_TIMESTAMP`,
      [tripId, input.enabled ?? null, input.ownerDefaultModel ?? null, input.memberDailyLimit ?? null, session.memberId],
    );
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "ai_settings",
      action: "updated",
      after: input,
    });
  });
}

/**
 * A model the requester can pay for with their own key, or null. An explicitly requested model uses
 * the requester's key whenever they hold one for its provider. With no explicit choice, an
 * operator-sponsored trip keeps its free sponsorship; otherwise the trip default (or the first
 * registered model) of a provider the requester holds a key for is used.
 */
export function ownKeyModel(
  requestedModel: OwnerModel | undefined, defaultModel: OwnerModel | undefined,
  ownProviders: ReadonlySet<string>, sponsoredAvailable: boolean,
): OwnerModel | null {
  if (requestedModel) return ownProviders.has(ownerModelRegistry[requestedModel].provider) ? requestedModel : null;
  if (sponsoredAvailable || ownProviders.size === 0) return null;
  if (defaultModel && Object.hasOwn(ownerModelRegistry, defaultModel) && ownProviders.has(ownerModelRegistry[defaultModel].provider)) {
    return defaultModel;
  }
  const provider = (["openai", "anthropic", "google"] as const).find((name) => ownProviders.has(name));
  return provider ? providerDefaultModels[provider] : null;
}

export type AiPolicy = {
  enabled: boolean; model: OwnerModel; usedToday: number; limit: number | null;
  /** Whose key pays: the server operator's, or the requester's own (JOB-061). */
  credentialSource: "operator" | "own";
};

export async function getAiPolicy(
  client: Queryable,
  session: AuthenticatedSession,
  requestedModel?: OwnerModel,
  options: { serializeMemberQuota?: boolean } = {},
): Promise<AiPolicy> {
  const settings = await client.query<{
    enabled: boolean;
    owner_default_model: OwnerModel;
    member_daily_limit: number;
    sponsored: boolean;
    migrated: boolean;
  }>(`SELECT enabled, owner_default_model, member_daily_limit,
          COALESCE((to_jsonb(s)->>'host_subscription_enabled')::boolean, true) AS sponsored,
          to_jsonb(s) ? 'host_subscription_enabled' AS migrated
        FROM trip_ai_settings s WHERE trip_id = $1`, [session.tripId]);
  const row = settings.rows[0];
  const ownProviders = await aiCredentialProviders(client, session.userId);
  const ownModel = ownKeyModel(requestedModel, row?.owner_default_model, ownProviders, Boolean(row?.enabled && row.sponsored));
  if (ownModel) {
    if (!row?.enabled) throw new AiPolicyDeniedError("AI is disabled for this trip.", "ai_disabled", ownModel);
    const ownUsage = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ai_requests
        WHERE trip_id = $1 AND actor_member_id = $2
          AND created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND status <> 'rejected'`,
      [session.tripId, session.memberId],
    );
    // The requester's own provider account pays, so the trip's prompt cap does not apply.
    return { enabled: true, model: ownModel, usedToday: Number(ownUsage.rows[0]?.count ?? 0), limit: null, credentialSource: "own" };
  }
  const privileged = session.role === "owner" && (!row?.migrated || await isPlatformOperator(client, session.userId));
  if (!privileged && options.serializeMemberQuota) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      JSON.stringify([session.tripId, session.memberId, "ai-daily-quota"]),
    ]);
  }
  const model = privileged
    ? requestedModel ?? row?.owner_default_model ?? DEFAULT_OWNER_MODEL
    : MEMBER_MODEL;
  if (!row?.enabled) {
    throw new AiPolicyDeniedError("AI is disabled for this trip.", "ai_disabled", model);
  }
  if (!row.sponsored) {
    throw new AiPolicyDeniedError(
      "Add your own API key for this model's provider in Settings → AI keys to use AI in this trip.",
      "ai_key_required", model,
    );
  }
  const usage = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_requests
      WHERE trip_id = $1 AND actor_member_id = $2
        AND created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND status <> 'rejected'`,
    [session.tripId, session.memberId],
  );
  const usedToday = Number(usage.rows[0]?.count ?? 0);
  if (!privileged && usedToday >= row.member_daily_limit) {
    throw new AiPolicyDeniedError(
      `The daily AI limit of ${row.member_daily_limit} prompts has been reached.`,
      "daily_limit_reached",
      model,
    );
  }
  return {
    enabled: true,
    model,
    usedToday,
    limit: privileged ? null : row.member_daily_limit,
    credentialSource: "operator",
  };
}

/** Providers the user holds an API key for (no decryption). */
async function aiCredentialProviders(client: Queryable, userId: string): Promise<Set<string>> {
  // Like the other schema-aware reads here, tolerate a database from before migration 0054:
  // probing first avoids an undefined-table error, which would abort the caller's transaction.
  const table = await client.query<{ present: boolean }>("SELECT to_regclass('public.user_ai_credentials') IS NOT NULL AS present");
  if (!table.rows[0]?.present) return new Set();
  const result = await client.query<{ provider: string }>("SELECT provider FROM user_ai_credentials WHERE user_id = $1", [userId]);
  return new Set(result.rows.map((entry) => entry.provider));
}

export { appendAudit, assertTrip, inTransaction };
