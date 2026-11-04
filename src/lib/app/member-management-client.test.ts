import { describe, expect, it } from "vitest";
import { buildMemberRemovalInput, canChooseMemberRole, type PaymentRemovalChoices } from "@/lib/app/member-management-client";
import type { MemberRemovalPreview } from "@/lib/app/member-removal";

export const removalFixture: MemberRemovalPreview = {
  member: { id: "target", displayName: "Synthetic traveler", role: "editor", status: "active", revision: 4 },
  previewDigest: "a".repeat(64), canRemove: false, canRemoveWithReassignment: true, blockedReason: "financial_links",
  counts: { createdEvents: 2, viewerLinks: 1, expenses: 1, actionableProposals: 3, aiRequests: 7, aiConversations: 2, reusableInvites: 0 },
  expenses: [{ id: "expense", revision: 8, currency: "JPY", amountMinor: 101, paidByTarget: true, shareMinor: 51, description: "Synthetic lunch",
    requiresPayerReplacement: true, requiresShareRecipient: true, eligibleMembers: [{ id: "recipient", displayName: "Synthetic recipient" }, { id: "payer", displayName: "Synthetic payer" }] }],
  hiddenPrivateExpenseCount: 0,
};

describe("explicit member removal choices", () => {
  const complete = { expense: { replacementPayerMemberId: "payer", shareRecipientMemberId: "recipient" } };
  it("never infers a payer or recipient even when only one candidate exists", () => {
    expect(buildMemberRemovalInput(removalFixture, {}, true)).toBeNull();
    expect(buildMemberRemovalInput(removalFixture, { expense: { replacementPayerMemberId: "payer" } }, true)).toBeNull();
    expect(buildMemberRemovalInput(removalFixture, { expense: { shareRecipientMemberId: "recipient" } }, true)).toBeNull();
  });
  it("requires explicit confirmation after all financial choices", () => {
    expect(buildMemberRemovalInput(removalFixture, complete, false)).toBeNull();
  });
  it("binds the exact preview/member/expense revisions without amounts or re-splitting", () => {
    expect(buildMemberRemovalInput(removalFixture, complete, true)).toEqual({ confirmation: true, expectedRevision: 4, previewDigest: "a".repeat(64),
      expenseReassignments: [{ expenseId: "expense", expectedRevision: 8, replacementPayerMemberId: "payer", shareRecipientMemberId: "recipient" }] });
  });
  it("rejects members outside the server's authorized candidate list", () => {
    expect(buildMemberRemovalInput(removalFixture, { expense: { replacementPayerMemberId: "outsider", shareRecipientMemberId: "recipient" } }, true)).toBeNull();
    expect(buildMemberRemovalInput(removalFixture, { expense: { replacementPayerMemberId: "payer", shareRecipientMemberId: "target" } }, true)).toBeNull();
  });
  it("rejects stale extra expense choices", () => {
    expect(buildMemberRemovalInput(removalFixture, { ...complete, oldExpense: {} }, true)).toBeNull();
  });
  it("requires hidden financial links to be resolved without exposing private details", () => {
    expect(buildMemberRemovalInput({ ...removalFixture, hiddenPrivateExpenseCount: 1 }, complete, true)).toBeNull();
  });
  it("does not permit removing the last owner even with contradictory positive flags", () => {
    expect(buildMemberRemovalInput({ ...removalFixture, canRemove: true, blockedReason: "last_bound_owner" }, complete, true)).toBeNull();
  });
  it("fails closed when the backend declines removal", () => {
    expect(buildMemberRemovalInput({ ...removalFixture, canRemoveWithReassignment: false }, complete, true)).toBeNull();
  });
  it("can remove a record with no active expenses but still requires confirmation", () => {
    const preview = { ...removalFixture, canRemove: true, blockedReason: null, expenses: [] };
    expect(buildMemberRemovalInput(preview, {}, true)).toEqual({ confirmation: true, expectedRevision: 4, previewDigest: "a".repeat(64) });
    expect(buildMemberRemovalInput(preview, {}, false)).toBeNull();
  });
  it("includes zero-share non-payer rows but no irrelevant reassignment", () => {
    const preview = { ...removalFixture, expenses: [{ ...removalFixture.expenses[0], paidByTarget: false, shareMinor: 0, requiresPayerReplacement: false, requiresShareRecipient: false, eligibleMembers: [] }] };
    expect(buildMemberRemovalInput(preview, {}, true)?.expenseReassignments).toEqual([{ expenseId: "expense", expectedRevision: 8 }]);
    expect(buildMemberRemovalInput(preview, complete, true)?.expenseReassignments).toEqual([{ expenseId: "expense", expectedRevision: 8 }]);
  });
  it("allows an explicitly chosen newly eligible public viewer, without choosing them automatically", () => {
    const preview = { ...removalFixture, expenses: [{ ...removalFixture.expenses[0], eligibleMembers: [{ id: "public-viewer", displayName: "Authorized public viewer" }] }] };
    expect(buildMemberRemovalInput(preview, {}, true)).toBeNull();
    expect(buildMemberRemovalInput(preview, { expense: { replacementPayerMemberId: "public-viewer", shareRecipientMemberId: "public-viewer" } }, true)).not.toBeNull();
  });
});

describe("explicit repayment bookkeeping choices", () => {
  const payment = { id: "payment", revision: 3, currency: "JPY", amountMinor: 101, fromMemberName: "Departing sender", toMemberName: "Recipient",
    accountingFromMemberId: "target", accountingToMemberId: "recipient", accountingFromMemberName: "Departing sender", accountingToMemberName: "Recipient",
    requiresFromReplacement: true, requiresToReplacement: false, eligibleMembers: [{ id: "recipient", displayName: "Recipient" }] };
  const preview = { ...removalFixture, expenses: [], payments: [payment] };
  it("never infers accounting reassignment even for a single eligible remaining member", () => {
    expect(buildMemberRemovalInput(preview, {}, true)).toBeNull();
    expect(buildMemberRemovalInput(preview, {}, false, { payment: { replacementAccountingFromMemberId: "recipient" } })).toBeNull();
  });
  it("sends explicit accounting choices/revision only, preserving original participants and cash amount server-side", () => {
    expect(buildMemberRemovalInput(preview, {}, true, { payment: { replacementAccountingFromMemberId: "recipient" } })).toEqual({
      confirmation: true, expectedRevision: 4, previewDigest: "a".repeat(64),
      paymentReassignments: [{ paymentId: "payment", expectedRevision: 3, replacementAccountingFromMemberId: "recipient" }] });
  });
  it("requires both choices if both accounting legs name the departing member", () => {
    const neutral = { ...preview, payments: [{ ...payment, requiresToReplacement: true, accountingToMemberId: "target" }] };
    expect(buildMemberRemovalInput(neutral, {}, true, { payment: { replacementAccountingFromMemberId: "recipient" } })).toBeNull();
    expect(buildMemberRemovalInput(neutral, {}, true, { payment: { replacementAccountingFromMemberId: "recipient", replacementAccountingToMemberId: "recipient" } })).not.toBeNull();
  });
  it("rejects irrelevant legs, foreign members and stale extra payment rows", () => {
    const invalidChoices: PaymentRemovalChoices[] = [
      { payment: { replacementAccountingFromMemberId: "outsider" } },
      { payment: { replacementAccountingFromMemberId: "recipient", replacementAccountingToMemberId: "recipient" } },
      { payment: { replacementAccountingFromMemberId: "recipient" }, stalePayment: {} },
    ];
    for (const choices of invalidChoices) expect(buildMemberRemovalInput(preview, {}, true, choices)).toBeNull();
  });
  it("keeps old no-payment payloads backward compatible", () => {
    expect(buildMemberRemovalInput({ ...preview, payments: [], canRemove: true, blockedReason: null }, {}, true)).toEqual({
      confirmation: true, expectedRevision: 4, previewDigest: "a".repeat(64) });
  });
});

describe("role eligibility", () => {
  it.each([{ status: "invited", identityBound: false }, { status: "revoked", identityBound: true }, { status: "active", identityBound: false }, { status: "removed", identityBound: true }])("does not grant ownership to $status / $identityBound", (member) => {
    expect(canChooseMemberRole(member, "owner")).toBe(false);
  });
  it("allows bound active owner promotion without changing AI authorization", () => {
    expect(canChooseMemberRole({ status: "active", identityBound: true }, "owner")).toBe(true);
  });
  it.each(["editor", "viewer"] as const)("allows invited member's %s role and rejects removed members", (role) => {
    expect(canChooseMemberRole({ status: "invited", identityBound: false }, role)).toBe(true);
    expect(canChooseMemberRole({ status: "removed", identityBound: true }, role)).toBe(false);
  });
});
