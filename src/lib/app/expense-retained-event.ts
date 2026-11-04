type Audience = { createdByMemberId: string; visibility: "trip" | "private"; viewerMemberIds: string[] };
type EventLink = Audience & { id: string; title: string; status: string };
type SavedExpense = { id: string; itineraryItemId: string | null; itineraryItemTitle: string | null;
  itineraryItemRemoved?: boolean; itineraryItemAudience?: Audience | null };

/** A removed event can supply the audience of an existing bill, never a new link. */
export function resolveExpenseEvent(
  overview: { itinerary: readonly EventLink[]; expenses?: readonly SavedExpense[] },
  draft: { id: string | null; itineraryItemId: string },
): EventLink | undefined {
  const active = overview.itinerary.find((item) => item.id === draft.itineraryItemId);
  if (active) return active;
  const saved = draft.id ? overview.expenses?.find((expense) => expense.id === draft.id) : undefined;
  if (!saved?.itineraryItemRemoved || !saved.itineraryItemAudience || !saved.itineraryItemId
    || saved.itineraryItemId !== draft.itineraryItemId) return undefined;
  return { ...saved.itineraryItemAudience, id: saved.itineraryItemId,
    title: saved.itineraryItemTitle ?? "", status: "cancelled" };
}
