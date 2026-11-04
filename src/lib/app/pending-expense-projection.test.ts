import { describe, expect, it } from "vitest";

import { projectPendingExpense } from "@/lib/app/repository";

const requesterId = "10000000-0000-4000-8000-000000000001";
const payerId = "10000000-0000-4000-8000-000000000002";
const participantId = "10000000-0000-4000-8000-000000000003";

describe("pending expense projection", () => {
  it("shows custom shares including zero without exposing a raw map or private metadata", () => {
    const projection = projectPendingExpense({ id: "20000000-0000-4000-8000-000000000001", proposal_revision: 1,
      requested_by_member_id: requesterId, requested_by_name: "Requester", created_at: new Date("2030-04-01T10:00:00Z"),
      proposed_patch: { description: "Custom bill", amountMinor: 101, currency: "JPY", payerMemberId: payerId,
        occurredAt: "2030-04-01T10:00:00Z", splitMemberIds: [payerId, participantId],
        splitAmounts: [{ memberId: participantId, amountMinor: 101 }, { memberId: payerId, amountMinor: 0 }] },
    }, new Map([[payerId, "Payer"], [participantId, "Participant"]]), new Map());
    expect(projection?.splits).toEqual([{ memberId: payerId, memberName: "Payer", shareMinor: 0 },
      { memberId: participantId, memberName: "Participant", shareMinor: 101 }]);
    expect(projection).not.toHaveProperty("splitAmounts");
  });

  it.each([
    [{ memberId: payerId, amountMinor: 101 }],
    [{ memberId: payerId, amountMinor: 50 }, { memberId: participantId, amountMinor: 50 }],
    [{ memberId: payerId, amountMinor: 0 }, { memberId: requesterId, amountMinor: 101 }],
    [{ memberId: payerId, amountMinor: 50 }, { memberId: payerId, amountMinor: 51 }],
  ].map((splitAmounts) => ({ splitAmounts })))("fails closed instead of substituting equal shares for invalid custom amounts", ({ splitAmounts }) => {
    expect(projectPendingExpense({ id: "20000000-0000-4000-8000-000000000001", proposal_revision: 1,
      requested_by_member_id: requesterId, requested_by_name: "Requester", created_at: new Date("2030-04-01T10:00:00Z"),
      proposed_patch: { description: "Invalid custom bill", amountMinor: 101, currency: "JPY", payerMemberId: payerId,
        occurredAt: "2030-04-01T10:00:00Z", splitMemberIds: [payerId, participantId], splitAmounts },
    }, new Map([[payerId, "Payer"], [participantId, "Participant"], [requesterId, "Requester"]]), new Map())).toBeNull();
  });

  it("returns a display-safe deterministic split without internal audience metadata", () => {
    const projection = projectPendingExpense({
      id: "20000000-0000-4000-8000-000000000001",
      proposal_revision: 7,
      requested_by_member_id: requesterId,
      requested_by_name: "Requester",
      created_at: new Date("2026-09-04T10:00:00.000Z"),
      proposed_patch: {
        description: "Shared dinner",
        amountMinor: 1001,
        currency: "JPY",
        payerMemberId: payerId,
        occurredAt: "2026-09-06T11:00:00.000Z",
        splitMemberIds: [payerId, participantId],
        itineraryAudienceSnapshot: { secret: "must not escape" },
      },
    }, new Map([
      [requesterId, "Requester"],
      [payerId, "Payer"],
      [participantId, "Participant"],
    ]), new Map());

    expect(projection).toMatchObject({
      status: "pending",
      proposalRevision: 7,
      amountMinor: 1001,
      payerName: "Payer",
      splits: [
        { memberId: payerId, memberName: "Payer", shareMinor: 501 },
        { memberId: participantId, memberName: "Participant", shareMinor: 500 },
      ],
    });
    expect(JSON.stringify(projection)).not.toContain("itineraryAudienceSnapshot");
    expect(JSON.stringify(projection)).not.toContain("must not escape");
  });

  it("fails closed for incomplete or unavailable participants", () => {
    const base = {
      id: "20000000-0000-4000-8000-000000000001",
      proposal_revision: 1,
      requested_by_member_id: requesterId,
      requested_by_name: "Requester",
      created_at: new Date("2026-09-04T10:00:00.000Z"),
    };
    expect(projectPendingExpense({ ...base, proposed_patch: { description: "Missing fields" } }, new Map(), new Map())).toBeNull();
    expect(projectPendingExpense({
      ...base,
      proposed_patch: {
        description: "Unknown split member",
        amountMinor: 1000,
        currency: "JPY",
        payerMemberId: payerId,
        occurredAt: "2026-09-06T11:00:00.000Z",
        splitMemberIds: [participantId],
      },
    }, new Map([[payerId, "Payer"]]), new Map())).toBeNull();
  });
});
