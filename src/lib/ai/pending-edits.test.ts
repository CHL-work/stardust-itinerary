import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import type { OwnerModel } from "@/lib/app/types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), getAiPolicy: vi.fn(), getPending: vi.fn(), editPending: vi.fn(),
  create: vi.fn(), createBatch: vi.fn(), approve: vi.fn(), lockActor: vi.fn(),
  conversation: vi.fn(), selectConversation: vi.fn(), replay: vi.fn(), writable: vi.fn(),
  checkpoint: vi.fn(), draft: vi.fn(), recordDraft: vi.fn(), assertDraft: vi.fn(),
  instructions: vi.fn(),
  codex: vi.fn(), claude: vi.fn(),
  activeTransactions: 0,
  transactions: [] as Array<{ client: unknown; outcome: string }>,
  transactionQueries: [] as Array<{ client: unknown; sql: string; values: unknown[] | undefined }>,
}));

vi.mock("@/lib/app/repository", () => ({
  AppConflictError: class AppConflictError extends Error {},
  AppInvalidInputError: class AppInvalidInputError extends Error {},
  AiPolicyDeniedError: class AiPolicyDeniedError extends Error {},
  getAiPolicy: mocks.getAiPolicy, getAiPendingItineraryContext: mocks.getPending,
  updatePendingItineraryRequestWithClient: mocks.editPending,
  createChangeRequestWithClient: mocks.create, createChangeRequest: mocks.create,
  createAiCreateRequestsWithClient: mocks.createBatch, createAiItineraryCreateRequestsWithClient: mocks.createBatch,
  createChangeRequestsAtomically: mocks.createBatch,
  reviewChangeRequestWithClient: mocks.approve, applyPermittedChangeRequest: mocks.approve,
  inTransaction: async (_pool: Pool, work: (client: unknown) => unknown) => {
    const client = { query: (sql: string, values?: unknown[]) => {
      mocks.transactionQueries.push({ client, sql, values });
      return mocks.query(sql, values);
    } };
    const transaction = { client, outcome: "started" };
    mocks.transactions.push(transaction);
    mocks.activeTransactions += 1;
    try { const result = await work(client); transaction.outcome = "committed"; return result; }
    catch (error) { transaction.outcome = "rolled_back"; throw error; }
    finally { mocks.activeTransactions -= 1; }
  },
}));
vi.mock("@/lib/app/trip-authorization", () => ({ lockCurrentTripActor: mocks.lockActor }));
vi.mock("@/lib/ai/conversation", () => ({
  AiConversationBusyError: class AiConversationBusyError extends Error {}, RECENT_CONVERSATION_TOKEN_BUDGET: 6000,
  prepareAiConversation: mocks.conversation, selectAiConversationForSubmission: mocks.selectConversation,
  readAiConversationPurpose: vi.fn(async () => "trip"),
  createConversationCheckpoint: mocks.checkpoint, lockBoundUserAi: vi.fn(), assertBoundUserAiIdle: vi.fn(),
}));
vi.mock("@/lib/ai/request-recovery", async (original) => ({
  ...await original<typeof import("@/lib/ai/request-recovery")>(), findAiRequestReplay: mocks.replay,
  assertAiRequestWritable: mocks.writable,
}));
vi.mock("@/lib/ai/custom-instructions", () => ({ readAiInstructions: mocks.instructions }));
vi.mock("@/lib/ai/credentials", () => ({ readAiCredentialSecret: async () => null }));
vi.mock("@/lib/ai/planning-draft", async (original) => ({
  ...await original<typeof import("@/lib/ai/planning-draft")>(), loadPlanningDraft: mocks.draft,
  assertPlanningDraftCurrent: mocks.assertDraft, recordPlanningDraft: mocks.recordDraft,
}));
vi.mock("@openai/codex-sdk", () => ({ Codex: class { startThread() { return { run: mocks.codex }; } } }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: mocks.claude }));

import { AppConflictError } from "@/lib/app/repository";
import { runAiPlanner } from "@/lib/ai/planner";

const session = {
  sessionId: "synthetic-session", tripId: "10000000-0000-4000-8000-000000000001",
  memberId: "20000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000001",
  role: "owner", displayName: "Synthetic owner", issuer: "test", subject: "synthetic-owner", generation: 1,
  expiresAt: new Date("2030-04-10T00:00:00Z"), absoluteExpiresAt: new Date("2030-04-11T00:00:00Z"),
} as AuthenticatedSession;
const dayId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const canonicalId = "40000000-0000-4000-8000-000000000002";
const conversationId = "50000000-0000-4000-8000-000000000001";
const submissionId = "60000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000002";
const originalPatch = {
  tripDayId: dayId, title: "Dinner at a synthetic restaurant", itemType: "meal", status: "planned",
  startsAt: "2030-04-01T10:00:00Z", endsAt: "2030-04-01T11:00:00Z",
  locationName: "架空レストラン 東京", visibility: "private", viewerMemberIds: [memberId],
  notes: "Synthetic saved details", linkedExpense: { description: "Synthetic dinner", amountMinor: 101,
    currency: "JPY", payerMemberId: session.memberId, splitMemberIds: [session.memberId, memberId], occurredAt: "2030-04-01T10:00:00Z" },
};
const { linkedExpense: savedLinkedExpense, ...pendingEventPatch } = originalPatch;
const pending = { requestId, proposalRevision: 3, operation: "create", targetItemId: null,
  createdByMemberId: session.memberId, patch: pendingEventPatch, hasLinkedExpense: Boolean(savedLinkedExpense) };
const partialPatch = { title: "去架空餐廳食晚飯", locationName: "架空レストラン 東京" };
const context = {
  trip: { id: session.tripId, name: "Synthetic Tokyo trip", destinationName: "Tokyo, Japan", timeZone: "Asia/Tokyo",
    currency: "JPY", startsOn: "2030-04-01", endsOn: "2030-04-05" },
  currentTime: { tripLocalDate: "2030-04-01", tomorrowLocalDate: "2030-04-02" },
  days: [{ id: dayId, date: "2030-04-01", label: null }],
  actor: { memberId: session.memberId, role: "owner" },
  audienceDirectory: [{ id: session.memberId, displayName: session.displayName, role: "owner", status: "active" },
    { id: memberId, displayName: "Synthetic guest", role: "editor", status: "active" }],
  itinerary: [{ id: canonicalId, tripDayId: dayId, revision: 7, title: "Other approved event", itemType: "activity" }],
};
const previousTurns = [{ user: "Create a pending dinner at the supplied synthetic restaurant.",
  assistant: `Dinner created, pending owner approval. Proposal ${requestId}.`, completedAt: "2030-04-01T01:00:00Z" },
{ user: "Update it to be in Cantonese but location in Japanese", assistant: "Please confirm this pending edit.", completedAt: "2030-04-01T01:02:00Z" }];
const pool = { query: mocks.query } as unknown as Pool;

function output(patch: Record<string, unknown> = partialPatch, overrides: Record<string, unknown> = {}) {
  return { message: "活動名稱已改做廣東話，地點保留日文，仍然等候批准。", proposals: [{
    entityType: "itinerary_item", action: "update_pending", entityId: requestId, baseRevision: 3,
    patchJson: JSON.stringify(patch), reason: "Requested language edit to the same pending event", ...overrides,
  }], sources: [] };
}
function modelReply(model: OwnerModel, payload = output()) {
  mocks.getAiPolicy.mockResolvedValue({ enabled: true, model, usedToday: 0, limit: null });
  mocks.codex.mockImplementation(async () => {
    expect(mocks.activeTransactions).toBe(0);
    return { finalResponse: JSON.stringify(payload), items: [], usage: null };
  });
  mocks.claude.mockImplementation(async function* () {
    expect(mocks.activeTransactions).toBe(0);
    yield { type: "result", subtype: "success", is_error: false, structured_output: payload,
      modelUsage: { [model]: {} }, usage: { input_tokens: 30, output_tokens: 10, cache_read_input_tokens: 0 } };
  });
}
function noReplacementOrApproval() {
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.createBatch).not.toHaveBeenCalled();
  expect(mocks.approve).not.toHaveBeenCalled();
}
async function submit(prompt = "Update it", model: OwnerModel = "gpt-6.1-sol") {
  const result = await runAiPlanner(pool, session, prompt, model, "zh-HK-lihkg", submissionId, conversationId);
  if ("request" in result) throw new Error("Unexpected replay in synthetic fresh submission.");
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.activeTransactions = 0; mocks.transactions.length = 0; mocks.transactionQueries.length = 0;
  mocks.query.mockImplementation(async (sql: string) => sql.includes("AS context") && sql.includes("FROM trips")
    ? { rows: [{ context: structuredClone(context) }], rowCount: 1 } : { rows: [], rowCount: 1 });
  mocks.getPending.mockResolvedValue({ pendingItinerary: [structuredClone(pending)], pendingItineraryTruncated: false });
  mocks.editPending.mockResolvedValue({ id: requestId, requestId, targetItemId: null, status: "pending", proposalRevision: 4,
    patch: { ...originalPatch, ...partialPatch } });
  mocks.conversation.mockResolvedValue({ conversationId, turns: previousTurns, tokenEstimate: 80,
    truncated: false, checkpoint: null, checkpointThrough: null });
  mocks.selectConversation.mockResolvedValue(conversationId); mocks.replay.mockResolvedValue(null);
  mocks.checkpoint.mockResolvedValue(null); mocks.draft.mockResolvedValue(null);
  mocks.instructions.mockResolvedValue({ instructions: "", revision: 0 });
  modelReply("gpt-6.1-sol");
});

describe("AI editing of existing pending events", () => {
  it.each([
    ["gpt-6.1-sol", "Update it"], ["claude-opus-5-5", "Update it"],
    ["gpt-6.1-sol", "Update it to be in Cantonese but location in Japanese"],
    ["claude-opus-5-5", "Update it to be in Cantonese but location in Japanese"],
  ] as const)("%s handles '%s' without replacing or approving the pending proposal", async (model, prompt) => {
    modelReply(model);
    const result = await submit(prompt, model);
    expect(result).toMatchObject({ model, proposalId: requestId, proposalIds: [requestId], proposalCount: 1,
      changeStatus: "pending", entityId: null });
    expect(mocks.editPending).toHaveBeenCalledOnce();
    const args = mocks.editPending.mock.calls[0]!;
    expect(args.slice(1, 4)).toEqual([session, session.tripId, requestId]);
    expect(args[4]).toMatchObject({ proposalRevision: 3, patch: partialPatch });
    expect(args[4].patch).not.toHaveProperty("linkedExpense");
    expect(args[4].patch).not.toHaveProperty("startsAt");
    expect(args[5]).toEqual({ aiRequestId: result.requestId });
    expect(mocks.writable).toHaveBeenCalledWith(args[0], session, result.requestId, conversationId);
    const receipt = mocks.transactionQueries.find((entry) => entry.sql.includes("response_json"));
    expect(receipt?.client).toBe(args[0]);
    expect(mocks.transactionQueries.some((entry) => entry.client === args[0] && entry.sql.includes("status = 'succeeded'"))).toBe(true);
    expect(mocks.transactions.find((transaction) => transaction.client === args[0])?.outcome).toBe("committed");
    expect(mocks.getPending).toHaveBeenCalledWith(expect.anything(), session, session.tripId);
    expect(mocks.lockActor).toHaveBeenCalledWith(mocks.getPending.mock.calls[0]?.[0], session);
    const providerPrompt = model.startsWith("claude") ? String(mocks.claude.mock.calls[0]?.[0]?.prompt) : String(mocks.codex.mock.calls[0]?.[0]);
    expect(providerPrompt).toContain("pendingItinerary");
    expect(providerPrompt).toContain(requestId);
    expect(providerPrompt).toContain("hasLinkedExpense");
    expect(providerPrompt).not.toContain(originalPatch.linkedExpense.description);
    const providerContext = JSON.parse(providerPrompt.split("\nTRIP_CONTEXT_JSON\n")[1]!.split("\nCONVERSATION_CHECKPOINT_JSON\n")[0]!);
    expect(providerContext.pendingItinerary[0]).toMatchObject({ requestId, proposalRevision: 3, hasLinkedExpense: true });
    expect(providerContext.pendingItinerary[0].patch).not.toHaveProperty("linkedExpense");
    expect(providerContext.itinerary.some((item: { id: string }) => item.id === requestId)).toBe(false);
    expect(providerPrompt).toContain("Update it to be in Cantonese but location in Japanese");
    noReplacementOrApproval();
  });

  it("keeps a pending update to an approved target pending rather than auto-applying the canonical event", async () => {
    mocks.getPending.mockResolvedValue({ pendingItinerary: [{ ...pending, operation: "update", targetItemId: canonicalId }], pendingItineraryTruncated: false });
    mocks.editPending.mockResolvedValue({ requestId, targetItemId: canonicalId, status: "pending", proposalRevision: 4 });
    const result = await submit("Update the pending restaurant title to Cantonese.");
    expect(result).toMatchObject({ proposalId: requestId, changeStatus: "pending", entityId: canonicalId });
    expect(mocks.editPending).toHaveBeenCalledOnce();
    noReplacementOrApproval();
  });

  it("uses the saved event date for 'today's pending restaurant' without changing omitted times or linked expense", async () => {
    modelReply("gpt-6.1-sol", output({ title: "去架空餐廳食晚飯" }));
    const result = await submit("Update today's pending restaurant title to Cantonese, keeping the location in Japanese.");
    expect(result).toMatchObject({ proposalId: requestId, changeStatus: "pending" });
    expect(mocks.editPending.mock.calls[0]?.[4].patch).toEqual({ title: "去架空餐廳食晚飯" });
    noReplacementOrApproval();
  });

  it("rejects an empty no-op patch rather than sending a meaningless pending revision", async () => {
    modelReply("gpt-6.1-sol", output({}));
    await expect(submit()).rejects.toBeDefined();
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it.each(["unknown", "private", "terminal", "invalidated", "outside bounded context"])("does not recreate an unavailable %s proposal", async () => {
    mocks.getPending.mockResolvedValue({ pendingItinerary: [], pendingItineraryTruncated: true });
    await expect(submit()).rejects.toBeDefined();
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it("rejects a stale model proposal revision before any pending mutation", async () => {
    modelReply("gpt-6.1-sol", output(partialPatch, { baseRevision: 2 }));
    await expect(submit()).rejects.toBeDefined();
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it("does not treat a pending request ID as an approved canonical event ID", async () => {
    modelReply("gpt-6.1-sol", output(partialPatch, { action: "update" }));
    await expect(submit()).rejects.toBeDefined();
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it("does not bypass an existing pending edit by addressing its canonical target", async () => {
    mocks.getPending.mockResolvedValue({ pendingItinerary: [{ ...pending, operation: "update", targetItemId: canonicalId }], pendingItineraryTruncated: false });
    modelReply("gpt-6.1-sol", output(partialPatch, { action: "update", entityId: canonicalId, baseRevision: 7 }));
    await expect(submit()).rejects.toBeDefined();
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it.each([false, true])("rechecks a canonical target's pending updates in the final transaction when omitted from model context (truncated: %s)", async (truncated) => {
    mocks.getPending.mockResolvedValue({ pendingItinerary: [], pendingItineraryTruncated: truncated });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("AS has_pending_change")) return { rows: [{ has_pending_change: true }], rowCount: 1 };
      return sql.includes("AS context") && sql.includes("FROM trips")
        ? { rows: [{ context: structuredClone(context) }], rowCount: 1 } : { rows: [], rowCount: 1 };
    });
    modelReply("gpt-6.1-sol", output(partialPatch, { action: "update", entityId: canonicalId, baseRevision: 7 }));

    await expect(submit()).rejects.toThrow("This event has a pending change.");

    const guard = mocks.transactionQueries.find((entry) => entry.sql.includes("AS has_pending_change"));
    expect(guard).toBeDefined();
    expect(guard?.values).toEqual([session.tripId, canonicalId]);
    expect(mocks.writable).toHaveBeenCalledWith(guard?.client, session, expect.any(String), conversationId);
    expect(mocks.transactions.find((transaction) => transaction.client === guard?.client)?.outcome).toBe("rolled_back");
    expect(mocks.transactionQueries.some((entry) => entry.client === guard?.client && entry.sql.includes("status = 'succeeded'"))).toBe(false);
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it("cannot use an expense action or omit revision/target identity for pending event editing", async () => {
    for (const invalid of [{ entityType: "expense" }, { entityId: null }, { baseRevision: null }]) {
      modelReply("gpt-6.1-sol", output(partialPatch, invalid));
      await expect(submit()).rejects.toBeDefined();
    }
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it("rejects a mixed create/pending-edit batch before its first mutation", async () => {
    const payload = output();
    payload.proposals.push({ ...payload.proposals[0]!, action: "create", entityId: null as unknown as string,
      baseRevision: null as unknown as number, patchJson: JSON.stringify(originalPatch) });
    modelReply("gpt-6.1-sol", payload);
    await expect(submit()).rejects.toBeDefined();
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it("replays a saved pending-edit receipt without re-editing or invoking a model", async () => {
    const recovered = { request: { requestId: "70000000-0000-4000-8000-000000000001", status: "succeeded",
      result: { proposalId: requestId, proposalIds: [requestId], changeStatus: "pending" } }, busyElsewhere: false, activeConversationId: conversationId };
    mocks.replay.mockResolvedValue(recovered);
    await expect(runAiPlanner(pool, session, "Update it", "gpt-6.1-sol", "zh-HK-lihkg", submissionId, conversationId)).resolves.toEqual(recovered);
    expect(mocks.codex).not.toHaveBeenCalled(); expect(mocks.claude).not.toHaveBeenCalled();
    expect(mocks.getPending).not.toHaveBeenCalled(); expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it.each([{ linkedExpense: originalPatch.linkedExpense }, { linkedExpense: null }, { isLocked: false }])("rejects expense or owner-lock changes through the pending event-only AI operation", async (extra) => {
    modelReply("gpt-6.1-sol", output({ ...partialPatch, ...extra }));
    await expect(submit()).rejects.toBeDefined();
    expect(mocks.editPending).not.toHaveBeenCalled();
    noReplacementOrApproval();
  });

  it("propagates a concurrent stale-review failure without a successful receipt or duplicate", async () => {
    const changed = new AppConflictError("Synthetic pending proposal was reviewed or revised concurrently.");
    mocks.editPending.mockRejectedValue(changed);
    await expect(submit()).rejects.toBe(changed);
    const client = mocks.editPending.mock.calls[0]?.[0];
    expect(mocks.transactions.find((transaction) => transaction.client === client)?.outcome).toBe("rolled_back");
    expect(mocks.transactionQueries.some((entry) => entry.client === client && entry.sql.includes("status = 'succeeded'"))).toBe(false);
    noReplacementOrApproval();
  });

  it("does not edit after the final active-user/request fence rejects a late model response", async () => {
    const failure = new AppConflictError("Synthetic member removed while provider ran.");
    mocks.writable.mockRejectedValue(failure);
    await expect(submit()).rejects.toBe(failure);
    expect(mocks.editPending).not.toHaveBeenCalled();
    expect(mocks.transactionQueries.some((entry) => entry.sql.includes("status = 'succeeded'"))).toBe(false);
    noReplacementOrApproval();
  });

  it("does not commit the pending edit separately when successful receipt persistence fails", async () => {
    const failure = new Error("Synthetic receipt persistence failure");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("response_json")) throw failure;
      return sql.includes("AS context") && sql.includes("FROM trips")
        ? { rows: [{ context: structuredClone(context) }], rowCount: 1 } : { rows: [], rowCount: 1 };
    });
    await expect(submit()).rejects.toBe(failure);
    const client = mocks.editPending.mock.calls[0]?.[0];
    expect(client).toBeDefined();
    expect(mocks.transactions.find((transaction) => transaction.client === client)?.outcome).toBe("rolled_back");
    expect(mocks.transactionQueries.find((entry) => entry.sql.includes("response_json"))?.client).toBe(client);
    noReplacementOrApproval();
  });
});
