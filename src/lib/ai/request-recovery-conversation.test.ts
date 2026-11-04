import { describe, expect, it, vi } from "vitest";
import { createAiRequestRecoveryClient, type AiSubmission } from "@/lib/ai/request-recovery-client";
import type { AiPlannerResult, AiRequestRecoveryResponse } from "@/lib/ai/request-recovery-types";

function recovered(status: "running" | "succeeded" | "failed", activeConversationId: string | null): AiRequestRecoveryResponse {
  return {
    activeConversationId, busyElsewhere: false,
    request: { requestId: "request-a", clientRequestId: "client-a", conversationId: "chat-a", status,
      createdAt: "2030-04-01T00:00:00Z", completedAt: status === "running" ? null : "2030-04-01T00:01:00Z",
      errorCode: null, message: status === "succeeded" ? "Old saved answer" : null, result: null },
  };
}
function harness() {
  const load = vi.fn<(key?: string) => Promise<AiRequestRecoveryResponse>>().mockResolvedValue({ request: null, busyElsewhere: false, activeConversationId: "chat-a" });
  const submit = vi.fn<(input: AiSubmission & { clientRequestId: string }) => Promise<AiPlannerResult | AiRequestRecoveryResponse>>().mockRejectedValue(new Error("Submission not delivered"));
  const uuid = vi.fn().mockReturnValueOnce("client-a").mockReturnValue("client-b");
  const client = createAiRequestRecoveryClient({ load, submit, uuid, changed: vi.fn(), completed: vi.fn() });
  return { client, load, submit, uuid };
}

describe("AI recovery selected-conversation identity", () => {
  it.each([
    { request: null, busyElsewhere: false, activeConversationId: "chat-a" },
    { request: null, busyElsewhere: false, activeConversationId: null },
    { request: null, busyElsewhere: true, activeConversationId: "chat-a" },
    recovered("running", "chat-a"),
    recovered("succeeded", "chat-a"),
    recovered("failed", "chat-a"),
  ])("propagates the server's active conversation through each response state (%#)", async (response) => {
    const h = harness();
    h.load.mockResolvedValue(response);
    await h.client.check();
    expect(h.client.getState().activeConversationId).toBe(response.activeConversationId);
  });

  it("does not trust the submitted conversation ID before the server accepts it", async () => {
    const h = harness();
    await h.client.check();
    const submission = h.client.submit({ prompt: "Another question", locale: "en", conversationId: "stale-chat" });
    expect(h.client.getState().activeConversationId).toBe("chat-a");
    await submission;
    expect(h.client.getState().activeConversationId).toBe("chat-a");
    expect(h.submit.mock.calls[0]?.[0].conversationId).toBe("stale-chat");
  });

  it("updates active identity on unknown-key recovery without claiming an older answer", async () => {
    const h = harness();
    await h.client.check();
    h.load.mockResolvedValueOnce({ request: null, busyElsewhere: false, activeConversationId: "chat-b" })
      .mockResolvedValueOnce({ ...recovered("succeeded", "chat-b"), request: { ...recovered("succeeded", "chat-b").request!, requestId: "unrelated-older-answer" } });
    await h.client.submit({ prompt: "Follow up", locale: "en", conversationId: "chat-a" });
    expect(h.client.getState()).toMatchObject({ phase: "idle", activeConversationId: "chat-b", request: null, result: null });
    expect(h.client.getState().error).toBeInstanceOf(Error);
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it("honors an authoritative null active ID after the old conversation disappears", async () => {
    const h = harness();
    await h.client.check();
    h.load.mockResolvedValue({ request: null, busyElsewhere: false, activeConversationId: null });
    await h.client.submit({ prompt: "Follow up", locale: "en", conversationId: "chat-a" });
    expect(h.client.getState().activeConversationId).toBeNull();
  });

  it("keeps same-key retry scoped to the exact explicit conversation payload", async () => {
    const h = harness();
    await h.client.check();
    const input = { prompt: "Follow up", locale: "en", conversationId: "chat-a" };
    await h.client.submit(input);
    await h.client.submit(input);
    expect(h.submit.mock.calls.map(([payload]) => payload.clientRequestId)).toEqual(["client-a", "client-a"]);
    await h.client.submit({ ...input, conversationId: "chat-b" });
    expect(h.submit.mock.calls[2]?.[0].clientRequestId).toBe("client-b");
  });

  it("clears the active identity on auth denial and explicit reset", async () => {
    const h = harness();
    await h.client.check();
    h.load.mockRejectedValueOnce({ status: 403 });
    await h.client.check();
    expect(h.client.getState().activeConversationId).toBeUndefined();
    h.client.reset();
    expect(h.client.getState().activeConversationId).toBeUndefined();
  });
});
