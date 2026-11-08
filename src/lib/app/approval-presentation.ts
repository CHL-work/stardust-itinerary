import { z } from "zod";
import type { ApprovalDisplay, ApprovalExpenseDisplay } from "@/lib/app/approval-presentation-types";
import { expensePatchSchema, itineraryPatchSchema } from "@/lib/app/validation";
import { resolveItineraryLocationState, transportHasEndpoint } from "@/lib/app/transport";
import { expenseSplitsForPatch } from "@/lib/app/expense-split-patch";
import { resolveFlightPresentation } from "@/lib/app/flight-presentation";

export type ApprovalPresentationSource = {
  entity_type: string;
  operation: string;
  status?: string;
  requested_by_member_id?: string;
  proposed_patch: Record<string, unknown>;
  base_patch?: Record<string, unknown> | null;
  applied_patch?: Record<string, unknown> | null;
  day_date?: string | null;
};

const unavailable: ApprovalDisplay = { kind: "unavailable" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const snapshotSplitsSchema = z.array(z.object({ memberId: z.uuid(), shareMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).min(1).max(20);

/** Only referenced member labels are fetched; removed tombstones remain meaningful history. */
export function approvalPresentationMemberIds(sources: readonly ApprovalPresentationSource[]): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string" && uuid.test(value)) ids.add(value); };
  const collect = (value: unknown) => {
    if (!isRecord(value)) return;
    add(value.createdByMemberId); add(value.payerMemberId);
    for (const key of ["viewerMemberIds", "splitMemberIds"]) {
      if (Array.isArray(value[key])) for (const id of value[key].slice(0, 20)) add(id);
    }
    if (Array.isArray(value.splits)) for (const split of value.splits.slice(0, 20)) if (isRecord(split)) add(split.memberId);
    if (Array.isArray(value.splitAmounts)) for (const split of value.splitAmounts.slice(0, 20)) if (isRecord(split)) add(split.memberId);
  };
  for (const source of sources) {
    add(source.requested_by_member_id);
    collect(source.base_patch); collect(source.proposed_patch);
    if (source.status === "approved") collect(source.applied_patch);
    collect(source.proposed_patch.linkedExpense);
  }
  return [...ids];
}

function safeMapUrl(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.username || url.password ? null : value; } catch { return null; }
}

function expenseDisplay(
  proposed: Record<string, unknown>,
  base: Record<string, unknown> | null,
  operation: string,
  members: ReadonlyMap<string, string>,
): ApprovalExpenseDisplay | null {
  const parsed = expensePatchSchema.safeParse({ ...(base ?? {}), ...proposed });
  if (!parsed.success) return null;
  const patch = parsed.data;
  if (!patch.description || !patch.amountMinor || !patch.currency || !patch.payerMemberId) return null;
  let splits: Array<{ memberId: string; shareMinor: number }>;
  try {
    if (operation === "create") {
      splits = expenseSplitsForPatch(patch)!.map((split) => ({ memberId: split.participantId, shareMinor: split.amountMinor }));
    } else {
      const stored = snapshotSplitsSchema.safeParse(base?.splits);
      const baseAmount = base?.amountMinor;
      if (!stored.success || !Number.isSafeInteger(baseAmount) || Number(baseAmount) <= 0
        || new Set(stored.data.map((split) => split.memberId)).size !== stored.data.length
        || stored.data.reduce((total, split) => total + BigInt(split.shareMinor), 0n) !== BigInt(Number(baseAmount))) return null;
      const changes = expensePatchSchema.parse(proposed);
      const resolved = expenseSplitsForPatch(changes, { amountMinor: Number(baseAmount),
        splits: stored.data.map((split) => ({ participantId: split.memberId, amountMinor: split.shareMinor })) });
      splits = resolved?.map((split) => ({ memberId: split.participantId, shareMinor: split.amountMinor })) ?? stored.data;
    }
  } catch { return null; }
  return {
    description: patch.description, amountMinor: patch.amountMinor, currency: patch.currency,
    payerName: members.get(patch.payerMemberId) ?? null,
    occurredAt: patch.occurredAt ?? null,
    status: operation === "void" ? "void" : patch.status ?? "posted",
    hasLinkedEvent: Boolean(patch.itineraryItemId),
    splits: splits.map((split) => ({ memberName: members.get(split.memberId) ?? null, shareMinor: split.shareMinor })),
  };
}

/** Review/history is an immutable proposal projection, never a read of today's private target. */
export function projectApprovalDisplay(source: ApprovalPresentationSource, members: ReadonlyMap<string, string>): ApprovalDisplay {
  const base = isRecord(source.base_patch) ? source.base_patch : null;
  if (source.entity_type === "expense") {
    if (!["create", "update", "void"].includes(source.operation)) return unavailable;
    // Approved history uses the exact immutable applied revision, including legacy
    // allocation rules. Never reconstruct it from today's canonical expense.
    if (source.status === "approved" && isRecord(source.applied_patch)) {
      const applied = expenseDisplay({}, source.applied_patch, source.operation === "void" ? "void" : "update", members);
      return applied ? { kind: "expense", expense: applied } : unavailable;
    }
    if (source.operation !== "create" && !base) return unavailable;
    const expense = expenseDisplay(source.proposed_patch, base, source.operation, members);
    return expense ? { kind: "expense", expense } : unavailable;
  }
  if (source.operation !== "create" && !base) return unavailable;
  if (source.entity_type !== "itinerary_item" || !["create", "update", "cancel", "restore"].includes(source.operation)) return unavailable;
  const displaySchema = itineraryPatchSchema.omit({ linkedExpense: true });
  const parsed = displaySchema.safeParse({ ...(base ?? {}), ...source.proposed_patch });
  const submitted = displaySchema.safeParse(source.proposed_patch);
  const before = displaySchema.safeParse(base ?? {});
  if (!parsed.success || !submitted.success || !before.success) return unavailable;
  const patch = parsed.data;
  if (!patch.title || !patch.tripDayId) return unavailable;
  const locations = resolveItineraryLocationState(submitted.data, resolveItineraryLocationState(before.data));
  if (!transportHasEndpoint(locations)) return unavailable;
  const creator = typeof base?.createdByMemberId === "string" ? base.createdByMemberId : source.requested_by_member_id;
  const audience = patch.visibility === "private" ? [...new Set([creator, ...(patch.viewerMemberIds ?? [])].filter((id): id is string => typeof id === "string"))] : [];
  const linkedExpense = isRecord(source.proposed_patch.linkedExpense)
    ? expenseDisplay(source.proposed_patch.linkedExpense, null, "create", members) : null;
  if (source.proposed_patch.linkedExpense && !linkedExpense) return unavailable;
  const flight = resolveFlightPresentation({ ...locations, title: patch.title, flight: patch.flight }, "UTC");
  return { kind: "itinerary", event: {
    title: patch.title, ...locations,
    isFlight: flight.isFlight,
    ...(flight.isFlight ? { flightPresentation: { isFlight: true,
      departureTimeZone: flight.departureZoneKnown ? flight.departureTimeZone : null,
      arrivalTimeZone: flight.arrivalZoneKnown ? flight.arrivalTimeZone : null } } : {}),
    mapUrl: safeMapUrl(locations.mapUrl), departureMapUrl: safeMapUrl(locations.departureMapUrl), destinationMapUrl: safeMapUrl(locations.destinationMapUrl),
    dayDate: z.iso.date().safeParse(source.day_date).success ? source.day_date! : null,
    startsAt: patch.startsAt ?? null, endsAt: patch.endsAt ?? null, notes: patch.notes ?? null,
    visibility: patch.visibility ?? "trip", audienceNames: audience.map((id) => members.get(id) ?? null),
    isLocked: patch.isLocked ?? false,
    status: source.operation === "cancel" ? "cancelled" : source.operation === "restore" ? "planned" : patch.status ?? "planned",
    linkedExpense,
  } };
}
