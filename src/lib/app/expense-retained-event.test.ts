import { describe, expect, it } from "vitest";
import { resolveExpenseEvent } from "./expense-retained-event";
import { eventExpenseMembers } from "./event-expense-editor";

const audience = { createdByMemberId: "synthetic-creator", visibility: "private" as const, viewerMemberIds: ["synthetic-viewer"] };
const saved = { id: "synthetic-bill", itineraryItemId: "synthetic-removed-event", itineraryItemTitle: "Synthetic removed event",
  itineraryItemRemoved: true, itineraryItemAudience: audience };
const draft = { id: saved.id, itineraryItemId: saved.itineraryItemId };

describe("retained expense event audience", () => {
  it("keeps the audience of an already-linked removed private event for financial corrections", () => {
    const resolved = resolveExpenseEvent({ itinerary: [], expenses: [saved] }, draft);
    expect(resolved).toEqual({ ...audience, id: saved.itineraryItemId, title: saved.itineraryItemTitle, status: "cancelled" });
    const members = ["synthetic-creator", "synthetic-viewer", "synthetic-owner", "synthetic-other"].map((id) => ({ id, status: "active" }));
    expect(eventExpenseMembers(members, resolved!).map((member) => member.id)).toEqual(["synthetic-creator", "synthetic-viewer"]);
  });

  it("prefers the current visible event audience to a saved fallback", () => {
    const current = { ...audience, viewerMemberIds: [], id: saved.itineraryItemId, title: "Current event", status: "cancelled" };
    expect(resolveExpenseEvent({ itinerary: [current], expenses: [saved] }, draft)).toBe(current);
  });

  it.each([
    { id: null, itineraryItemId: saved.itineraryItemId },
    { id: "synthetic-other-bill", itineraryItemId: saved.itineraryItemId },
    { id: saved.id, itineraryItemId: "synthetic-other-event" },
    { id: saved.id, itineraryItemId: "" },
  ])("cannot use a removed link for a new, foreign or altered draft %j", (value) => {
    expect(resolveExpenseEvent({ itinerary: [], expenses: [saved] }, value)).toBeUndefined();
  });

  it.each([
    { ...saved, itineraryItemRemoved: false },
    { ...saved, itineraryItemAudience: null },
    { ...saved, itineraryItemId: null },
  ])("does not invent removed-event authority without complete saved metadata %j", (value) => {
    expect(resolveExpenseEvent({ itinerary: [], expenses: [value] }, draft)).toBeUndefined();
  });

  it("fails safely when no saved expense projection is available", () => {
    expect(resolveExpenseEvent({ itinerary: [] }, draft)).toBeUndefined();
  });
});
