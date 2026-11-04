import { describe, expect, it, vi } from "vitest";
import { createAiConversationHistoryClient, mergeAiHistoryTurns } from "@/lib/ai/conversation-history-client";
import type { AiConversationListResponse, AiConversationMessagesResponse, AiConversationSummary } from "@/lib/ai/conversation-history-types";

function conversation(id: string, active = false): AiConversationSummary {
  return { conversationId: id, title: `Synthetic ${id}`, createdAt: "2030-04-01T00:00:00Z", lastUsedAt: "2030-04-01T01:00:00Z", closedAt: active ? null : "2030-04-01T00:30:00Z", isActive: active, canResume: !active };
}
function turn(id: string, conversationId = "current", createdAt = "2030-04-01T01:00:00Z"): AiConversationMessagesResponse["messages"][number] {
  return { requestId: id, conversationId, clientRequestId: null, prompt: `Question ${id}`, model: "gpt-6.1-sol", status: "succeeded", createdAt, completedAt: createdAt, errorCode: null, message: `Answer ${id}`, result: null };
}
function page(id = "current", messages = [turn("newest", id)], nextCursor: string | null = null): AiConversationMessagesResponse {
  return { conversation: conversation(id, id === "current"), messages, nextCursor };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const loadList = vi.fn<(cursor?: string) => Promise<AiConversationListResponse>>().mockResolvedValue({ conversations: [conversation("current", true), conversation("previous")], activeConversationId: "current", nextCursor: null });
  const loadMessages = vi.fn<(id: string, cursor?: string) => Promise<AiConversationMessagesResponse>>().mockImplementation(async (id) => page(id));
  const changed = vi.fn();
  const client = createAiConversationHistoryClient({ loadList, loadMessages, changed });
  return { client, loadList, loadMessages, changed };
}

describe("private conversation history client", () => {
  it("loads only a private list and active transcript on initialization", async () => {
    const h = harness();
    await h.client.refresh();
    expect(h.loadList).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(h.loadMessages).toHaveBeenCalledExactlyOnceWith("current", undefined);
    expect(h.client.getState()).toMatchObject({ activeConversationId: "current", selectedConversationId: "current", listLoading: false, messageLoading: false, messages: [turn("newest")] });
    expect(Object.keys(h.client)).not.toContain("submit");
    expect(Object.keys(h.client)).not.toContain("resume");
  });

  it("can browse an old transcript without changing active conversation", async () => {
    const h = harness();
    await h.client.refresh();
    await h.client.select("previous");
    expect(h.client.getState()).toMatchObject({ activeConversationId: "current", selectedConversationId: "previous", messages: [turn("newest", "previous")] });
    expect(h.loadList).toHaveBeenCalledOnce();
  });

  it("keeps an archive selected when live-request completion refreshes the list", async () => {
    const h = harness();
    await h.client.refresh();
    await h.client.select("previous");
    h.loadList.mockResolvedValueOnce({ conversations: [conversation("current"), conversation("other", true)], activeConversationId: "other", nextCursor: null });
    await h.client.refresh();
    expect(h.client.getState().selectedConversationId).toBe("previous");
    expect(h.client.getState().activeConversationId).toBe("other");
    expect(h.client.getState().conversations.find((row) => row.conversationId === "current")?.isActive).toBe(false);
    expect(h.loadMessages).toHaveBeenLastCalledWith("previous", undefined);
  });

  it("follows the new active conversation only after an explicit successful action", async () => {
    const h = harness();
    await h.client.refresh();
    await h.client.select("previous");
    await h.client.refresh(true);
    expect(h.client.getState().selectedConversationId).toBe("current");
    expect(h.client.getState().messages).toEqual([turn("newest")]);
  });

  it("returns a truthful empty state without inventing a conversation", async () => {
    const h = harness();
    h.loadList.mockResolvedValueOnce({ conversations: [], activeConversationId: null, nextCursor: null });
    await h.client.refresh();
    expect(h.client.getState()).toMatchObject({ activeConversationId: null, selectedConversationId: null, messages: [], listLoading: false });
    expect(h.loadMessages).not.toHaveBeenCalled();
  });

  it("loads active conversation detail even when it is not in the newest list page", async () => {
    const h = harness();
    h.loadList.mockResolvedValueOnce({ conversations: [conversation("previous")], activeConversationId: "resumed-old", nextCursor: "more" });
    await h.client.refresh();
    expect(h.loadMessages).toHaveBeenCalledExactlyOnceWith("resumed-old", undefined);
    expect(h.client.getState().selectedConversationId).toBe("resumed-old");
  });

  it("clears old messages immediately when switching, then ignores the older late response", async () => {
    const h = harness();
    await h.client.refresh();
    const waiting = deferred<AiConversationMessagesResponse>();
    h.loadMessages.mockReturnValueOnce(waiting.promise);
    const oldSelection = h.client.select("previous");
    expect(h.client.getState().messages).toEqual([]);
    await h.client.select("current");
    waiting.resolve(page("previous"));
    await oldSelection;
    expect(h.client.getState()).toMatchObject({ selectedConversationId: "current", messages: [turn("newest")] });
  });

  it("ignores a stale list response after a newer post-activation refresh", async () => {
    const h = harness();
    const old = deferred<AiConversationListResponse>();
    h.loadList.mockReturnValueOnce(old.promise);
    const first = h.client.refresh();
    h.loadList.mockResolvedValueOnce({ conversations: [conversation("new", true)], activeConversationId: "new", nextCursor: null });
    await h.client.refresh(true);
    old.resolve({ conversations: [conversation("previous", true)], activeConversationId: "previous", nextCursor: null });
    await first;
    expect(h.client.getState().selectedConversationId).toBe("new");
    expect(h.client.getState().activeConversationId).toBe("new");
  });

  it("prepends older messages chronologically and replaces overlapping versions once", async () => {
    const h = harness();
    h.loadMessages.mockResolvedValueOnce(page("current", [turn("b")], "older"));
    await h.client.refresh();
    h.loadMessages.mockResolvedValueOnce(page("current", [turn("a", "current", "2030-04-01T00:00:00Z"), { ...turn("b"), message: "Fresh answer" }], null));
    await h.client.loadOlderMessages();
    expect(h.loadMessages).toHaveBeenLastCalledWith("current", "older");
    expect(h.client.getState().messages.map((row) => row.requestId)).toEqual(["a", "b"]);
    expect(h.client.getState().messages[1]?.message).toBe("Fresh answer");
    expect(h.client.getState().messageCursor).toBeNull();
  });

  it("deduplicates overlapping load-older actions", async () => {
    const h = harness();
    h.loadMessages.mockResolvedValueOnce(page("current", [turn("b")], "older"));
    await h.client.refresh();
    const waiting = deferred<AiConversationMessagesResponse>();
    h.loadMessages.mockReturnValueOnce(waiting.promise);
    const first = h.client.loadOlderMessages();
    await h.client.loadOlderMessages();
    expect(h.loadMessages).toHaveBeenCalledTimes(2);
    waiting.resolve(page("current", [turn("a")], null));
    await first;
  });

  it("retains loaded older messages when latest-page polling updates a running answer", async () => {
    const h = harness();
    h.loadMessages.mockResolvedValueOnce(page("current", [{ ...turn("b"), status: "running", message: null }], "older"));
    await h.client.refresh();
    h.loadMessages.mockResolvedValueOnce(page("current", [turn("a", "current", "2030-04-01T00:00:00Z")], null));
    await h.client.loadOlderMessages();
    h.loadMessages.mockResolvedValueOnce(page("current", [turn("b")], "older"));
    await h.client.refresh();
    expect(h.client.getState().messages.map((row) => [row.requestId, row.status])).toEqual([["a", "succeeded"], ["b", "succeeded"]]);
    expect(h.client.getState().messageCursor).toBeNull();
  });

  it("does not lose a pagination gap when the refreshed first page has no overlap", async () => {
    const h = harness();
    h.loadMessages.mockResolvedValueOnce(page("current", [turn("old")], null));
    await h.client.refresh();
    h.loadMessages.mockResolvedValueOnce(page("current", [turn("new")], "gap-cursor"));
    await h.client.refresh();
    expect(h.client.getState().messageCursor).toBe("gap-cursor");
    expect(h.client.getState().messages.map((row) => row.requestId)).toEqual(["new", "old"]);
  });

  it("loads list pages once without changing the selected transcript", async () => {
    const h = harness();
    h.loadList.mockResolvedValueOnce({ conversations: [conversation("current", true)], activeConversationId: "current", nextCursor: "next-page" });
    await h.client.refresh();
    const waiting = deferred<AiConversationListResponse>();
    h.loadList.mockReturnValueOnce(waiting.promise);
    const more = h.client.loadMoreConversations();
    await h.client.loadMoreConversations();
    expect(h.loadList).toHaveBeenLastCalledWith("next-page");
    expect(h.loadList).toHaveBeenCalledTimes(2);
    waiting.resolve({ conversations: [conversation("previous")], activeConversationId: "current", nextCursor: null });
    await more;
    expect(h.client.getState().conversations).toHaveLength(2);
    expect(h.client.getState().selectedConversationId).toBe("current");
    expect(h.loadMessages).toHaveBeenCalledOnce();
  });

  it.each([401, 403])("clears all private history on %i and invalidates other in-flight reads", async (status) => {
    const h = harness();
    await h.client.refresh();
    const waiting = deferred<AiConversationMessagesResponse>();
    h.loadMessages.mockReturnValueOnce(waiting.promise);
    const older = h.client.select("previous");
    h.loadList.mockRejectedValueOnce({ status, message: "Private raw detail must not surface" });
    await h.client.refresh();
    waiting.resolve(page("previous"));
    await older;
    expect(h.client.getState()).toMatchObject({ accessDenied: true, conversations: [], messages: [], conversation: null, selectedConversationId: null, activeConversationId: null });
    expect(JSON.stringify(h.client.getState())).not.toContain("Private raw detail");
    const count = h.loadMessages.mock.calls.length;
    await h.client.select("current");
    await h.client.refresh();
    expect(h.loadMessages).toHaveBeenCalledTimes(count);
  });

  it("clears private data when the selected transcript itself becomes forbidden", async () => {
    const h = harness();
    await h.client.refresh();
    h.loadMessages.mockRejectedValueOnce({ status: 403 });
    await h.client.select("previous");
    expect(h.client.getState()).toMatchObject({ accessDenied: true, conversations: [], messages: [], listError: true });
  });

  it("purges history when an explicit new/resume action loses authorization", async () => {
    const h = harness();
    await h.client.refresh();
    expect(h.client.handleAuthorizationFailure({ status: 409 })).toBe(false);
    expect(h.client.getState().messages).toHaveLength(1);
    expect(h.client.handleAuthorizationFailure({ status: 403 })).toBe(true);
    expect(h.client.getState()).toMatchObject({ accessDenied: true, messages: [], conversations: [] });
  });

  it("retains displayed messages on temporary errors and can retry without replaying a prompt", async () => {
    const h = harness();
    await h.client.refresh();
    h.loadMessages.mockRejectedValueOnce(new Error("Internal error details"));
    await h.client.retryMessages();
    expect(h.client.getState()).toMatchObject({ messageError: true, messages: [turn("newest")] });
    expect(JSON.stringify(h.client.getState())).not.toContain("Internal error details");
    await h.client.retryMessages();
    expect(h.client.getState().messageError).toBe(false);
  });

  it("rejects a mismatched conversation response instead of showing another transcript", async () => {
    const h = harness();
    h.loadMessages.mockResolvedValueOnce(page("another-user-conversation"));
    await h.client.refresh();
    expect(h.client.getState()).toMatchObject({ messages: [], messageError: true });
  });

  it("disposed and independent controller scopes never publish each other's late private rows", async () => {
    const old = harness();
    const fresh = harness();
    const waiting = deferred<AiConversationListResponse>();
    old.loadList.mockReturnValueOnce(waiting.promise);
    const oldWork = old.client.refresh();
    old.client.dispose();
    const count = old.changed.mock.calls.length;
    await fresh.client.refresh();
    waiting.resolve({ conversations: [conversation("old-private")], activeConversationId: "old-private", nextCursor: null });
    await oldWork;
    expect(old.changed).toHaveBeenCalledTimes(count);
    expect(fresh.client.getState().selectedConversationId).toBe("current");
    expect(JSON.stringify(fresh.client.getState())).not.toContain("old-private");
    expect(old.loadMessages).not.toHaveBeenCalled();
  });
});

describe("history message ordering", () => {
  it("uses creation time and request identity as deterministic ordering without mutating inputs", () => {
    const a = turn("a", "current", "2030-04-01T00:00:00.000001Z");
    const b = turn("b", "current", "2030-04-01T00:00:00.000002Z");
    const c = turn("c", "current", "2030-04-01T00:00:00.000002Z");
    const before = JSON.stringify([c, a]);
    expect(mergeAiHistoryTurns([c, a], [b]).map((row) => row.requestId)).toEqual(["a", "b", "c"]);
    expect(JSON.stringify([c, a])).toBe(before);
  });
});
