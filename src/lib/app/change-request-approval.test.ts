import { describe, expect, it } from "vitest";

import { memberCanDirectlyApplyChangeRequest } from "@/lib/app/repository";

const immediateEditorPermissions = {
  canEditItinerary: true,
  itineraryRequiresApproval: false,
  canEditExpenses: true,
  expenseRequiresApproval: false,
  canSyncCalendar: true,
};

describe("member direct-apply approval policy", () => {
  it("allows an unedited itinerary request when the requester has the explicit override", () => {
    expect(memberCanDirectlyApplyChangeRequest({
      entityType: "itinerary_item",
      hasLinkedExpense: false,
      hasNonRequesterProposalEdit: false,
      permissions: immediateEditorPermissions,
    })).toBe(true);
  });

  it("requires owner review after another editor changes the request", () => {
    expect(memberCanDirectlyApplyChangeRequest({
      entityType: "itinerary_item",
      hasLinkedExpense: false,
      hasNonRequesterProposalEdit: true,
      permissions: immediateEditorPermissions,
    })).toBe(false);
  });

  it("also requires owner review when the non-requester editor was the owner", () => {
    expect(memberCanDirectlyApplyChangeRequest({
      entityType: "itinerary_item",
      hasLinkedExpense: true,
      hasNonRequesterProposalEdit: true,
      permissions: immediateEditorPermissions,
    })).toBe(false);
  });

  it("retains the independent expense permission policy", () => {
    expect(memberCanDirectlyApplyChangeRequest({
      entityType: "expense",
      hasLinkedExpense: false,
      hasNonRequesterProposalEdit: false,
      permissions: immediateEditorPermissions,
    })).toBe(true);
  });
});
