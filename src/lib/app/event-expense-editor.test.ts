import { describe, expect, it } from "vitest";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import {
  constrainNewEventExpense, eventExpenseDefaults, eventExpenseMembers, preserveUnchangedLinkedExpense,
  validateEventExpense, type EventExpenseDraft,
} from "@/lib/app/event-expense-editor";

const members = [
  { id: "creator", status: "active" }, { id: "viewer", status: "invited" },
  { id: "outsider", status: "active" }, { id: "removed", status: "removed" },
  { id: "revoked", status: "revoked" }, { id: "disabled", status: "disabled" },
  { id: "unknown", status: "future-status" },
];
const audience = { createdByMemberId: "creator", visibility: "private" as const, viewerMemberIds: ["viewer", "removed", "disabled"] };
const draft: EventExpenseDraft = { enabled: true, description: "Synthetic ticket", amount: "101", currency: "JPY",
  payerMemberId: "creator", occurredAt: "2030-04-01T10:00", status: "posted", splitMemberIds: ["creator", "viewer"] };

describe("linked event expense audience", () => {
  it("selects only active or invited creator/viewers, never unrelated or unavailable members", () => {
    expect(eventExpenseMembers(members, audience).map((member) => member.id)).toEqual(["creator", "viewer"]);
    expect(eventExpenseDefaults(members, audience, "outsider")).toEqual({ payerMemberId: "creator", splitMemberIds: ["creator", "viewer"] });
  });
  it("allows all eligible public members and prefers an eligible current payer", () => {
    expect(eventExpenseDefaults(members, { ...audience, visibility: "trip" }, "outsider"))
      .toEqual({ payerMemberId: "outsider", splitMemberIds: ["creator", "viewer", "outsider"] });
  });
  it("falls back to an eligible viewer when the immutable creator is unavailable", () => {
    expect(eventExpenseDefaults(members.filter((member) => member.id !== "creator"), audience, "creator"))
      .toEqual({ payerMemberId: "viewer", splitMemberIds: ["viewer"] });
  });
  it("does not invent a payer when no audience member is eligible", () => {
    expect(eventExpenseDefaults([], audience, "creator")).toEqual({ payerMemberId: "", splitMemberIds: [] });
    expect(validateEventExpense(draft, [], audience)).toBe("noMembers");
  });
  it("constrains only an unsaved expense when its audience changes, without mutating the draft", () => {
    const next = constrainNewEventExpense(draft, members, { ...audience, viewerMemberIds: [] });
    expect(next.splitMemberIds).toEqual(["creator"]);
    expect(draft.splitMemberIds).toEqual(["creator", "viewer"]);
  });
  it("does not redistribute custom shares or select replacement people after audience changes", () => {
    const custom: EventExpenseDraft = { ...draft, splitMode: "custom", splitAmountInputs: { creator: "80", viewer: "21" } };
    const next = constrainNewEventExpense(custom, members, { ...audience, viewerMemberIds: [] });
    expect(next.splitMemberIds).toEqual(["creator"]); expect(next.splitAmountInputs).toEqual(custom.splitAmountInputs);
    expect(validateEventExpense(next, members, audience)).toBe("splits");
    const none = constrainNewEventExpense({ ...custom, splitMemberIds: ["viewer"] }, members, { ...audience, viewerMemberIds: [] });
    expect(none.splitMemberIds).toEqual([]);
  });
  it.each(["outsider", "removed", "revoked", "disabled", "missing", "unknown"])("rejects selected unavailable payer/share %s", (id) => {
    expect(validateEventExpense({ ...draft, payerMemberId: id }, members, audience)).toBe("participants");
    expect(validateEventExpense({ ...draft, splitMemberIds: ["creator", id] }, members, audience)).toBe("participants");
  });
  it("requires an explicit occurrence date and does not invent one for an untimed event", () => {
    expect(validateEventExpense({ ...draft, occurredAt: "" }, members, audience)).toBe("date");
  });
  it.each([
    [{ amount: "0" }, "amount"], [{ amount: "NaN" }, "amount"], [{ amount: "1e30" }, "amount"],
    [{ currency: "JP" }, "currency"], [{ description: " " }, "description"], [{ splitMemberIds: [] }, "participants"],
  ] as Array<[Partial<EventExpenseDraft>, string]>)("validates an enabled expense %j", (patch, issue) => {
    expect(validateEventExpense({ ...draft, ...patch }, members, audience)).toBe(issue);
  });
  it("skips unused optional expense fields", () => {
    expect(validateEventExpense({ ...draft, enabled: false, amount: "", occurredAt: "" }, [], audience)).toBeNull();
  });
});

describe("unchanged saved linked expense", () => {
  const original = { description: "Synthetic charge", amountMinor: 101, currency: "JPY", payerMemberId: "viewer",
    occurredAt: "2030-04-01T10:00:37.123Z", splitMemberIds: ["viewer", "creator"] };
  const projected = { ...original, occurredAt: "2030-04-01T10:00:00.000Z", status: "posted" as const };
  it("preserves exact timestamp precision, optional status and split ordering on an event-only save", () => {
    expect(preserveUnchangedLinkedExpense(original, projected, "2030-04-01T10:00", "2030-04-01T10:00", "101")).toBe(original);
  });
  it("keeps explicit payer/share/time corrections rather than restoring old financial choices", () => {
    for (const next of [{ ...projected, payerMemberId: "creator" }, { ...projected, splitMemberIds: ["creator"] }]) {
      expect(preserveUnchangedLinkedExpense(original, next, "2030-04-01T10:00", "2030-04-01T10:00", "101"))
        .toEqual({ ...next, occurredAt: original.occurredAt });
    }
    expect(preserveUnchangedLinkedExpense(original, projected, "2030-04-01T10:00", "2030-04-01T10:01", "101")).toEqual(projected);
  });
  it.each([9007199254740893, Number.MAX_SAFE_INTEGER])("retains unchanged large minor-unit amount %s with exact display", (amountMinor) => {
    const saved = { ...original, amountMinor, currency: "HKD" };
    const amount = expenseAmountInput(amountMinor, "HKD");
    const candidate = { ...saved, amountMinor: Math.round(Number(amount) * 100), description: "Corrected description" };
    expect(preserveUnchangedLinkedExpense(saved, candidate, "2030-04-01T10:00", "2030-04-01T10:00", amount))
      .toEqual({ ...saved, description: "Corrected description" });
    expect(validateEventExpense({ ...draft, currency: "HKD", amount }, members, audience, saved)).toBeNull();
  });
});
