import type { ActivityAction, ActivityCategory, ActivityEntry, ActivityField } from "./activity-types";

/** This source contains current authorized display facts, never historical audit values. */
export type ActivityRow = {
  id: string; entity_type: string; action: string; actor_name: string | null; created_at: Date;
  target_id: string | null; target_kind: string | null; target_removed: boolean;
  target_title: unknown; target_starts_at: unknown; target_ends_at: unknown;
  target_amount_minor: unknown; target_currency: unknown; target_status: unknown; changed_keys: string[] | null;
};
const categoryByEntity: Record<string, ActivityCategory> = {
  itinerary_item: "event", expense: "expense", change_request: "request", trip_member: "member",
  member_permissions: "permissions", calendar_event_link: "calendar", calendar_connection: "calendar",
  trip: "trip", ai_settings: "ai", ai_personal_memory: "ai", ai_request: "ai", ai_conversation: "ai", member_payment: "payment",
};
const actionByCode: Record<string, ActivityAction> = {
  created: "created", create: "created", updated: "updated", update: "updated", proposal_updated: "updated",
  requested: "requested", approved: "approved", rejected: "rejected", cancel: "cancelled", cancelled: "cancelled",
  restore: "restored", restored: "restored", removed: "removed", void: "voided", calendar_created: "synced", calendar_updated: "synced",
  calendar_recreated: "synced", calendar_sync_failed: "failed", connected: "connected", disconnected: "disconnected",
  calendar_disconnected: "disconnected", joined: "joined", disabled: "disabled", enabled: "enabled",
  payment_create: "created", payment_approve: "approved", payment_reject: "rejected", payment_void: "voided",
  edited: "updated", confirmed: "updated", forgotten: "removed", reset: "updated", resumed: "updated",
};
const fieldByKey: Record<string, ActivityField> = {
  title: "title", description: "title", startsAt: "time", endsAt: "time", tripDayId: "time", occurredAt: "time",
  locationName: "location", mapUrl: "location", departureLocationName: "location", departureMapUrl: "location",
  destinationLocationName: "location", destinationMapUrl: "location", itemType: "type", status: "status",
  visibility: "visibility", viewerMemberIds: "audience", amountMinor: "amount", currency: "currency",
  payerMemberId: "payer", splitMemberIds: "shares", splits: "shares", splitAmounts: "shares",
  linkedExpense: "linkedExpense", itineraryItemId: "linkedEvent", notes: "notes", isLocked: "lock",
};
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}
function timestamp(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === "string" && value.length <= 40 ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const statuses = new Set(["pending", "approved", "rejected", "superseded", "draft", "planned", "cancelled", "completed", "posted", "void"]);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

export function projectActivityEntry(row: ActivityRow): ActivityEntry {
  const kind = row.target_kind === "itinerary" || row.target_kind === "expense" || row.target_kind === "request" ? row.target_kind : null;
  const removed = row.target_removed === true;
  const target: ActivityEntry["target"] = !removed && kind && row.target_id && uuid.test(row.target_id) ? { kind, id: row.target_id } : null;
  const hasEntityTarget = ["itinerary_item", "expense", "change_request", "calendar_event_link"].includes(row.entity_type);
  const display = Boolean(target);
  const amount = typeof row.target_amount_minor === "string" && /^\d+$/u.test(row.target_amount_minor)
    ? Number(row.target_amount_minor) : row.target_amount_minor;
  const currency = text(row.target_currency, 3);
  let validCurrency = false;
  if (currency && /^[A-Z]{3}$/u.test(currency)) {
    try { validCurrency = Intl.supportedValuesOf("currency").includes(currency); } catch { validCurrency = false; }
  }
  return {
    id: row.id, category: categoryByEntity[row.entity_type] ?? "system", action: actionByCode[row.action] ?? "changed",
    actorName: text(row.actor_name, 120), createdAt: row.created_at.toISOString(),
    title: display ? text(row.target_title, 500) : null,
    startsAt: display ? timestamp(row.target_starts_at) : null, endsAt: display ? timestamp(row.target_ends_at) : null,
    amount: display && Number.isSafeInteger(amount) && Number(amount) >= 0 && validCurrency
      ? { amountMinor: Number(amount), currency: currency! } : null,
    status: display && typeof row.target_status === "string" && statuses.has(row.target_status)
      ? row.target_status as ActivityEntry["status"] : null,
    changedFields: display ? [...new Set((row.changed_keys ?? []).map((key) => fieldByKey[key]).filter(Boolean))] : [],
    target, targetState: removed ? "removed" : target ? "available" : hasEntityTarget ? "unavailable" : "none",
  };
}
