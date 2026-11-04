import { describe, expect, it } from "vitest";

import {
  timestampRepairFeedback,
  timestampRepairPreservesProposalIntent,
  type RepairableProposal,
} from "@/lib/ai/proposal-repair";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const DAY_ID = "22222222-2222-4222-8222-222222222222";
const PAYER_ID = "33333333-3333-4333-8333-333333333333";
const VIEWER_ID = "44444444-4444-4444-8444-444444444444";

function createProposal(overrides: Partial<RepairableProposal> = {}): RepairableProposal {
  return {
    entityType: "itinerary_item",
    action: "create",
    entityId: null,
    baseRevision: null,
    patchJson: JSON.stringify({
      tripDayId: DAY_ID,
      title: "Hotel stay",
      itemType: "lodging",
      startsAt: "2026-09-06T15:00:00+09:00",
      endsAt: "2026-09-10T01:00:00+09:00",
      visibility: "private",
      viewerMemberIds: [VIEWER_ID],
      linkedExpense: {
        description: "Hotel stay",
        amountMinor: 50_000,
        currency: "JPY",
        payerMemberId: PAYER_ID,
        occurredAt: "2026-09-06T15:00:00+09:00",
        splitMemberIds: [PAYER_ID, VIEWER_ID],
      },
    }),
    ...overrides,
  };
}

function expenseProposal(): RepairableProposal {
  return {
    entityType: "expense",
    action: "create",
    entityId: null,
    baseRevision: null,
    patchJson: JSON.stringify({
      description: "Dinner",
      amountMinor: 8_000,
      currency: "JPY",
      payerMemberId: PAYER_ID,
      occurredAt: "2026-09-07T20:00:00+09:00",
      splitMemberIds: [PAYER_ID, VIEWER_ID],
    }),
  };
}

function replacePatch(
  proposal: RepairableProposal,
  update: (patch: Record<string, unknown>) => void,
): RepairableProposal {
  const patch = JSON.parse(proposal.patchJson) as Record<string, unknown>;
  update(patch);
  return { ...proposal, patchJson: JSON.stringify(patch) };
}

describe("timestamp proposal repair eligibility", () => {
  it.each([
    ["invalid_format", ["startsAt"]],
    ["invalid_type", ["endsAt"]],
    ["invalid_format", ["occurredAt"]],
    ["invalid_type", ["linkedExpense", "occurredAt"]],
  ])("accepts only a structural timestamp issue: %s at %j", (code, path) => {
    const proposals = [createProposal()];

    expect(timestampRepairFeedback(0, [{ code, path }], proposals)).toEqual({
      proposalIndex: 0,
      paths: [path],
      previousProposals: proposals,
    });
  });

  it.each([
    ["malformed money", "invalid_type", ["linkedExpense", "amountMinor"]],
    ["malformed payer UUID", "invalid_format", ["linkedExpense", "payerMemberId"]],
    ["invalid privacy", "invalid_value", ["visibility"]],
    ["unrecognized field", "unrecognized_keys", []],
    ["non-structural timestamp failure", "custom", ["startsAt"]],
    ["unknown timestamp path", "invalid_format", ["paidAt"]],
  ])("does not repair %s", (_label, code, path) => {
    expect(timestampRepairFeedback(0, [{ code, path }], [createProposal()])).toBeNull();
  });

  it("rejects a mixed validation failure instead of repairing only the timestamp", () => {
    expect(timestampRepairFeedback(0, [
      { code: "invalid_format", path: ["startsAt"] },
      { code: "invalid_type", path: ["linkedExpense", "amountMinor"] },
    ], [createProposal()])).toBeNull();
  });

  it.each(["update", "cancel", "restore"])("does not repair a %s proposal", (action) => {
    expect(timestampRepairFeedback(0, [
      { code: "invalid_format", path: ["startsAt"] },
    ], [createProposal({ action })])).toBeNull();
  });

  it("does not repair a create batch that also contains a non-create proposal", () => {
    expect(timestampRepairFeedback(0, [
      { code: "invalid_format", path: ["startsAt"] },
    ], [createProposal(), createProposal({ action: "update", entityId: EVENT_ID, baseRevision: 1 })])).toBeNull();
  });

  it("rejects empty issue and proposal lists", () => {
    expect(timestampRepairFeedback(0, [], [createProposal()])).toBeNull();
    expect(timestampRepairFeedback(0, [{ code: "invalid_format", path: ["startsAt"] }], [])).toBeNull();
  });

  it("caps untrusted repair feedback at 30,000 serialized characters", () => {
    const small = createProposal({ patchJson: JSON.stringify({ notes: "x".repeat(100) }) });
    const oversized = createProposal({ patchJson: JSON.stringify({ notes: "x".repeat(30_001) }) });
    const issues = [{ code: "invalid_format", path: ["startsAt"] }];

    expect(timestampRepairFeedback(0, issues, [small])).not.toBeNull();
    expect(timestampRepairFeedback(0, issues, [oversized])).toBeNull();
  });
});

describe("timestamp proposal repair intent preservation", () => {
  const original = [createProposal(), expenseProposal()];
  const feedback = timestampRepairFeedback(
    0,
    [{ code: "invalid_format", path: ["startsAt"] }],
    original,
  )!;

  it("allows either the complete corrected batch or an all-zero clarification", () => {
    const corrected = [
      replacePatch(original[0]!, (patch) => { patch.startsAt = "2026-09-06T06:00:00Z"; }),
      original[1]!,
    ];

    expect(timestampRepairPreservesProposalIntent(feedback, corrected)).toBe(true);
    expect(timestampRepairPreservesProposalIntent(feedback, [])).toBe(true);
    expect(timestampRepairPreservesProposalIntent(feedback, corrected.slice(0, 1))).toBe(false);
    expect(timestampRepairPreservesProposalIntent(feedback, [...corrected, expenseProposal()])).toBe(false);
  });

  it("allows every listed failing timestamp field and no other date field", () => {
    const twoDateFeedback = timestampRepairFeedback(0, [
      { code: "invalid_format", path: ["startsAt"] },
      { code: "invalid_format", path: ["endsAt"] },
    ], original)!;
    const corrected = [replacePatch(original[0]!, (patch) => {
      patch.startsAt = "2026-09-06T06:00:00Z";
      patch.endsAt = "2026-09-09T16:00:00Z";
    }), original[1]!];
    const changedNonFailingDate = [replacePatch(corrected[0]!, (patch) => {
      const linkedExpense = patch.linkedExpense as Record<string, unknown>;
      linkedExpense.occurredAt = "2026-09-08T00:00:00Z";
    }), corrected[1]!];

    expect(timestampRepairPreservesProposalIntent(twoDateFeedback, corrected)).toBe(true);
    expect(timestampRepairPreservesProposalIntent(twoDateFeedback, changedNonFailingDate)).toBe(false);
  });

  it("supports a narrowly listed nested linked-expense timestamp", () => {
    const linkedFeedback = timestampRepairFeedback(0, [
      { code: "invalid_format", path: ["linkedExpense", "occurredAt"] },
    ], original)!;
    const corrected = [replacePatch(original[0]!, (patch) => {
      const linkedExpense = patch.linkedExpense as Record<string, unknown>;
      linkedExpense.occurredAt = "2026-09-06T06:00:00Z";
    }), original[1]!];

    expect(timestampRepairPreservesProposalIntent(linkedFeedback, corrected)).toBe(true);
  });

  it.each([
    ["money", (patch: Record<string, unknown>) => {
      (patch.linkedExpense as Record<string, unknown>).amountMinor = 1;
    }],
    ["payer", (patch: Record<string, unknown>) => {
      (patch.linkedExpense as Record<string, unknown>).payerMemberId = VIEWER_ID;
    }],
    ["audience", (patch: Record<string, unknown>) => { patch.viewerMemberIds = []; }],
    ["trip day id", (patch: Record<string, unknown>) => { patch.tripDayId = EVENT_ID; }],
    ["item type", (patch: Record<string, unknown>) => { patch.itemType = "activity"; }],
    ["non-failing end time", (patch: Record<string, unknown>) => {
      patch.endsAt = "2026-09-12T01:00:00+09:00";
    }],
  ])("rejects a simultaneous %s change", (_label, mutate) => {
    const changed = replacePatch(original[0]!, (patch) => {
      patch.startsAt = "2026-09-06T06:00:00Z";
      mutate(patch);
    });

    expect(timestampRepairPreservesProposalIntent(feedback, [changed, original[1]!])).toBe(false);
  });

  it("rejects proposal identity, entity type, and order changes", () => {
    const corrected = replacePatch(original[0]!, (patch) => {
      patch.startsAt = "2026-09-06T06:00:00Z";
    });

    expect(timestampRepairPreservesProposalIntent(feedback, [
      { ...corrected, entityId: EVENT_ID },
      original[1]!,
    ])).toBe(false);
    expect(timestampRepairPreservesProposalIntent(feedback, [
      { ...corrected, entityType: "expense" },
      original[1]!,
    ])).toBe(false);
    expect(timestampRepairPreservesProposalIntent(feedback, [original[1]!, corrected])).toBe(false);
  });

  it("rejects malformed patch JSON in either batch", () => {
    const malformedFeedback = {
      ...feedback,
      previousProposals: [{ ...feedback.previousProposals[0]!, patchJson: "{" }, feedback.previousProposals[1]!],
    };

    expect(timestampRepairPreservesProposalIntent(malformedFeedback, original)).toBe(false);
    expect(timestampRepairPreservesProposalIntent(feedback, [
      { ...original[0]!, patchJson: "{" },
      original[1]!,
    ])).toBe(false);
  });
});
