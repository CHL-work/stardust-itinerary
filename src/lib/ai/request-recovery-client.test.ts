import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAiRequestRecoveryClient,
  watchAiRequestRecovery,
  type AiSubmission,
} from "@/lib/ai/request-recovery-client";
import type {
  AiPlannerResult,
  AiRecoveredRequest,
  AiRequestRecoveryResponse,
} from "@/lib/ai/request-recovery-types";

const firstKey = "10000000-0000-4000-8000-000000000001";
const secondKey = "10000000-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
const prompt: AiSubmission = { prompt: "Plan a museum visit.", locale: "en", model: "gpt-6.1-sol" };
const empty: AiRequestRecoveryResponse = { request: null, busyElsewhere: false };

function result(id = requestId): AiPlannerResult {
  return {
    requestId: id,
    message: "A museum visit is ready for owner review.",
    proposalIds: ["30000000-0000-4000-8000-000000000001"],
    proposalCount: 1,
    proposalId: "30000000-0000-4000-8000-000000000001",
    changeStatus: "pending",
    entityId: null,
    model: "gpt-6.1-sol",
    usedToday: 1,
    remainingToday: 19,
    webSearch: { performed: true, queryCount: 1, sources: ["https://example.org/museum"] },
    memory: {
      previousTurnsUsed: 1,
      tokenEstimate: 500,
      tokenBudget: 6_000,
      checkpointVersion: null,
      truncated: false,
    },
  };
}

function recovery(
  status: AiRecoveredRequest["status"],
  overrides: Partial<AiRecoveredRequest> = {},
): AiRequestRecoveryResponse {
  return {
    busyElsewhere: false,
    request: {
      requestId,
      clientRequestId: firstKey,
      conversationId: "40000000-0000-4000-8000-000000000001",
      status,
      createdAt: "2026-09-05T12:00:00.000Z",
      completedAt: status === "running" ? null : "2026-09-05T12:01:00.000Z",
      errorCode: null,
      message: null,
      result: status === "succeeded" ? result() : null,
      ...overrides,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function harness() {
  const load = vi.fn<(key?: string) => Promise<AiRequestRecoveryResponse>>().mockResolvedValue(empty);
  const submit = vi.fn<(input: AiSubmission & { clientRequestId: string }) => Promise<AiPlannerResult | AiRequestRecoveryResponse>>()
    .mockResolvedValue(result());
  const changed = vi.fn();
  const completed = vi.fn();
  const uuid = vi.fn().mockReturnValueOnce(firstKey).mockReturnValue(secondKey);
  const client = createAiRequestRecoveryClient({ load, submit, changed, completed, uuid });
  return { client, load, submit, changed, completed, uuid };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("private AI request recovery controller", () => {
  it("checks for an existing request before accepting a new submission", async () => {
    const h = harness();
    expect(h.client.getState().phase).toBe("checking");
    await h.client.submit(prompt);
    expect(h.submit).not.toHaveBeenCalled();
    await h.client.check();
    expect(h.load).toHaveBeenCalledWith(undefined);
    expect(h.client.getState()).toEqual({ phase: "idle", request: null, result: null, error: null });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("reattaches to running work and retrieves the complete saved result without posting", async () => {
    const h = harness();
    h.load.mockResolvedValueOnce(recovery("running")).mockResolvedValue(recovery("succeeded"));
    await h.client.check();
    expect(h.client.getState()).toMatchObject({ phase: "running", request: { requestId }, result: null });
    await h.client.submit(prompt);
    expect(h.submit).not.toHaveBeenCalled();
    await h.client.check();
    expect(h.load).toHaveBeenLastCalledWith(firstKey);
    expect(h.client.getState().result).toEqual(result());
    expect(h.client.getState().phase).toBe("idle");
    expect(h.completed).toHaveBeenCalledOnce();
    await h.client.check();
    expect(h.completed).toHaveBeenCalledOnce();
    expect(h.uuid).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("recovers a finished response on a new page without any browser-held request key", async () => {
    const h = harness();
    h.load.mockResolvedValue(recovery("succeeded"));
    await h.client.check();
    expect(h.load).toHaveBeenCalledWith(undefined);
    expect(h.client.getState().result).toEqual(result());
    expect(h.completed).toHaveBeenCalledOnce();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("coalesces overlapping status reads into one in-flight read", async () => {
    const h = harness();
    const waiting = deferred<AiRequestRecoveryResponse>();
    h.load.mockReturnValueOnce(waiting.promise).mockResolvedValue(recovery("running"));
    const first = h.client.check();
    const second = h.client.check();
    const third = h.client.check();
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(h.load).toHaveBeenCalledOnce();
    waiting.resolve(recovery("running"));
    await first;
    expect(h.client.getState().phase).toBe("running");
    await h.client.check();
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("reattaches after a phone loses the POST response, retaining its exact submission key", async () => {
    const h = harness();
    await h.client.check();
    const dropped = new TypeError("Network connection lost");
    h.submit.mockRejectedValueOnce(dropped);
    h.load.mockResolvedValue(recovery("running"));
    await h.client.submit(prompt);
    expect(h.submit).toHaveBeenCalledExactlyOnceWith({ ...prompt, clientRequestId: firstKey });
    expect(h.changed.mock.calls.some(([state]) => state.phase === "reconnecting" && state.error === dropped)).toBe(true);
    expect(h.load).toHaveBeenLastCalledWith(firstKey);
    expect(h.client.getState()).toMatchObject({ phase: "running", error: null });
    h.load.mockResolvedValue(recovery("succeeded"));
    await h.client.check();
    expect(h.client.getState().result).toEqual(result());
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it("recovers an already-completed request immediately after a lost POST response", async () => {
    const h = harness();
    await h.client.check();
    h.submit.mockRejectedValueOnce(new TypeError("Response lost"));
    h.load.mockResolvedValue(recovery("succeeded"));
    await h.client.submit(prompt);
    expect(h.client.getState()).toMatchObject({ phase: "idle", result: result(), error: null });
    expect(h.completed).toHaveBeenCalledOnce();
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it("resolves a same-user 409 by finding the other active request instead of reposting", async () => {
    const h = harness();
    await h.client.check();
    h.submit.mockRejectedValueOnce({ status: 409, code: "AI_CONVERSATION_BUSY" });
    h.load.mockResolvedValueOnce(empty).mockResolvedValue(recovery("running", { clientRequestId: secondKey }));
    await h.client.submit(prompt);
    expect(h.load.mock.calls.slice(-2)).toEqual([[firstKey], []]);
    expect(h.client.getState()).toMatchObject({ phase: "running", request: { clientRequestId: secondKey } });
    await h.client.check();
    expect(h.load).toHaveBeenLastCalledWith(secondKey);
    await h.client.submit(prompt);
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it("blocks another submission while this user's other trip is busy without disclosing its request", async () => {
    const h = harness();
    h.load.mockResolvedValueOnce({ request: null, busyElsewhere: true });
    await h.client.check();
    expect(h.client.getState()).toEqual({ phase: "busy_elsewhere", request: null, result: null, error: null });
    await h.client.submit(prompt);
    expect(h.submit).not.toHaveBeenCalled();
    await h.client.check();
    expect(h.client.getState().phase).toBe("idle");
  });

  it.each(["initial", "after-rejection"] as const)("honors another-trip busy state even alongside an older saved answer (%s)", async (phase) => {
    const h = harness();
    const oldAnswerAndBusy = { ...recovery("succeeded"), busyElsewhere: true };
    if (phase === "initial") {
      h.load.mockResolvedValueOnce(oldAnswerAndBusy);
      await h.client.check();
    } else {
      await h.client.check();
      h.submit.mockRejectedValueOnce({ status: 409, code: "AI_CONVERSATION_BUSY" });
      h.load.mockResolvedValueOnce(empty).mockResolvedValueOnce(oldAnswerAndBusy);
      await h.client.submit(prompt);
    }
    expect(h.client.getState()).toEqual({ phase: "busy_elsewhere", request: null, result: null, error: null });
    expect(h.completed).not.toHaveBeenCalled();
    const attempted = h.submit.mock.calls.length;
    await h.client.submit(prompt);
    expect(h.submit).toHaveBeenCalledTimes(attempted);
  });

  it("keeps an uncertain key for an explicit same-payload retry without replaying automatically", async () => {
    const h = harness();
    await h.client.check();
    h.submit.mockRejectedValueOnce(new TypeError("Delivery uncertain"));
    await h.client.submit(prompt);
    expect(h.client.getState().phase).toBe("idle");
    await h.client.check();
    await h.client.check();
    expect(h.submit).toHaveBeenCalledOnce();
    await h.client.submit(prompt);
    expect(h.submit.mock.calls.map(([input]) => input.clientRequestId)).toEqual([firstKey, firstKey]);
    expect(h.uuid).toHaveBeenCalledOnce();
    expect(h.client.getState().result).toEqual(result());
  });

  it("does not present an older saved response as the answer to an uncertain new submission", async () => {
    const h = harness();
    await h.client.check();
    h.submit.mockRejectedValueOnce(new TypeError("Delivery uncertain"));
    h.load.mockResolvedValueOnce(empty).mockResolvedValueOnce(recovery("succeeded", {
      requestId: "older-request",
      clientRequestId: "older-key",
      result: result("older-request"),
    }));
    await h.client.submit(prompt);
    expect(h.client.getState()).toMatchObject({ phase: "idle", request: null, result: null });
    expect(h.completed).not.toHaveBeenCalled();
    await h.client.submit(prompt);
    expect(h.submit.mock.calls.map(([input]) => input.clientRequestId)).toEqual([firstKey, firstKey]);
  });

  it("retains exact picture bytes and the key for an explicit uncertain-delivery retry", async () => {
    const h = harness();
    await h.client.check();
    const withImage: AiSubmission = { ...prompt, images: [{ mediaType: "image/jpeg", data: "synthetic-first-picture" }] };
    h.submit.mockRejectedValueOnce(new TypeError("Delivery uncertain"));
    await h.client.submit(withImage);
    await h.client.check();
    expect(h.submit).toHaveBeenCalledOnce();
    await h.client.submit(withImage);
    expect(h.submit.mock.calls.map(([input]) => input)).toEqual([
      { ...withImage, clientRequestId: firstKey }, { ...withImage, clientRequestId: firstKey },
    ]);
  });

  it("uses a new submission key when the selected picture changes after uncertain delivery", async () => {
    const h = harness();
    await h.client.check();
    h.submit.mockRejectedValueOnce(new TypeError("Delivery uncertain"));
    await h.client.submit({ ...prompt, images: [{ mediaType: "image/jpeg", data: "synthetic-first-picture" }] });
    await h.client.submit({ ...prompt, images: [{ mediaType: "image/jpeg", data: "synthetic-other-picture" }] });
    expect(h.submit.mock.calls.map(([input]) => input.clientRequestId)).toEqual([firstKey, secondKey]);
  });

  it.each([
    { ...prompt, prompt: "Plan a garden visit." },
    { ...prompt, locale: "ja-JP" },
    { ...prompt, model: "gpt-6-astra" },
  ])("gives an explicitly changed payload a new key after uncertain delivery (%#)", async (changedPrompt) => {
    const h = harness();
    await h.client.check();
    h.submit.mockRejectedValueOnce(new TypeError("Delivery uncertain"));
    await h.client.submit(prompt);
    await h.client.submit(changedPrompt);
    expect(h.submit.mock.calls.map(([input]) => input.clientRequestId)).toEqual([firstKey, secondKey]);
  });

  it("does not accept a second POST while the first POST is in flight", async () => {
    const h = harness();
    await h.client.check();
    const waiting = deferred<AiPlannerResult>();
    h.submit.mockReturnValueOnce(waiting.promise);
    const first = h.client.submit(prompt);
    await h.client.submit({ ...prompt, prompt: "Another question" });
    expect(h.submit).toHaveBeenCalledOnce();
    waiting.resolve(result());
    await first;
    expect(h.client.getState().result).toEqual(result());
    expect(h.completed).toHaveBeenCalledOnce();
  });

  it("uses an accepted running recovery envelope and continues with GET-only observation", async () => {
    const h = harness();
    await h.client.check();
    h.submit.mockResolvedValueOnce(recovery("running"));
    h.load.mockResolvedValue(recovery("running"));
    await h.client.submit(prompt);
    expect(h.client.getState().phase).toBe("running");
    h.load.mockResolvedValue(recovery("succeeded"));
    await h.client.check();
    expect(h.client.getState().result).toEqual(result());
    expect(h.submit).toHaveBeenCalledOnce();
    expect(h.completed).toHaveBeenCalledOnce();
  });

  it.each(["failed", "interrupted"] as const)("surfaces saved %s state without automatic retry", async (status) => {
    const h = harness();
    const saved = recovery(status, { errorCode: "AI_REQUEST_INTERRUPTED", message: "The request was interrupted. Please try again." });
    h.load.mockResolvedValue(saved);
    await h.client.check();
    expect(h.client.getState()).toMatchObject({ phase: "idle", request: saved.request, result: null });
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it.each([401, 403])("clears recovered private data when status reads return %i", async (status) => {
    const h = harness();
    h.load.mockResolvedValueOnce(recovery("succeeded"));
    await h.client.check();
    const error = { status };
    h.load.mockRejectedValueOnce(error);
    await h.client.check();
    expect(h.client.getState()).toEqual({ phase: "idle", request: null, result: null, error });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it.each([401, 403])("cannot restore private data from a late POST after a %i recovery denial", async (status) => {
    const h = harness();
    await h.client.check();
    const waiting = deferred<AiPlannerResult>();
    h.submit.mockReturnValueOnce(waiting.promise);
    const posting = h.client.submit(prompt);
    const error = { status };
    h.load.mockRejectedValueOnce(error);
    await h.client.check();
    expect(h.client.getState()).toEqual({ phase: "idle", request: null, result: null, error });
    waiting.resolve(result());
    await posting;
    expect(h.client.getState()).toEqual({ phase: "idle", request: null, result: null, error });
    expect(h.completed).not.toHaveBeenCalled();
  });

  it("keeps transient recovery failures read-only until a later successful read", async () => {
    const h = harness();
    const error = new TypeError("Offline");
    h.load.mockRejectedValueOnce(error);
    await h.client.check();
    expect(h.client.getState()).toMatchObject({ phase: "reconnecting", error });
    await h.client.submit(prompt);
    expect(h.submit).not.toHaveBeenCalled();
    h.load.mockResolvedValueOnce(recovery("succeeded"));
    await h.client.check();
    expect(h.client.getState()).toMatchObject({ phase: "idle", result: result(), error: null });
  });

  it("clears an older result when the server authoritatively reports no current request", async () => {
    const h = harness();
    h.load.mockResolvedValueOnce(recovery("succeeded"));
    await h.client.check();
    expect(h.client.getState().result).toEqual(result());
    await h.client.check();
    expect(h.client.getState()).toEqual({ phase: "idle", request: null, result: null, error: null });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("prevents a late pre-reset GET response from restoring an old conversation", async () => {
    const h = harness();
    const waiting = deferred<AiRequestRecoveryResponse>();
    h.load.mockReturnValueOnce(waiting.promise);
    const checking = h.client.check();
    h.client.reset();
    waiting.resolve(recovery("succeeded"));
    await checking;
    expect(h.client.getState()).toEqual({ phase: "idle", request: null, result: null, error: null });
    expect(h.completed).not.toHaveBeenCalled();
  });

  it("prevents a late pre-reset POST from delivering or starting recovery for the old conversation", async () => {
    const h = harness();
    await h.client.check();
    const waiting = deferred<AiPlannerResult>();
    h.submit.mockReturnValueOnce(waiting.promise);
    const posting = h.client.submit(prompt);
    h.client.reset();
    waiting.resolve(result());
    await posting;
    expect(h.client.getState()).toEqual({ phase: "idle", request: null, result: null, error: null });
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.load).toHaveBeenCalledOnce();
  });

  it.each(["GET", "POST"] as const)("disposal suppresses late %s delivery and all later work", async (method) => {
    const h = harness();
    const waiting = deferred<AiRequestRecoveryResponse>();
    let work: Promise<void>;
    if (method === "GET") {
      h.load.mockReturnValueOnce(waiting.promise);
      work = h.client.check();
    } else {
      await h.client.check();
      h.submit.mockReturnValueOnce(waiting.promise);
      work = h.client.submit(prompt);
    }
    h.client.dispose();
    const count = h.changed.mock.calls.length;
    waiting.resolve(recovery("succeeded"));
    await work;
    expect(h.changed).toHaveBeenCalledTimes(count);
    expect(h.completed).not.toHaveBeenCalled();
    const reads = h.load.mock.calls.length;
    const posts = h.submit.mock.calls.length;
    await h.client.check();
    await h.client.submit(prompt);
    expect(h.load).toHaveBeenCalledTimes(reads);
    expect(h.submit).toHaveBeenCalledTimes(posts);
  });

  it("does not let a late POST error replace a result already recovered by a foreground GET", async () => {
    const h = harness();
    await h.client.check();
    const waiting = deferred<AiPlannerResult>();
    h.submit.mockReturnValueOnce(waiting.promise);
    const posting = h.client.submit(prompt);
    h.load.mockResolvedValueOnce(recovery("succeeded"));
    await h.client.check();
    expect(h.client.getState().result).toEqual(result());
    waiting.reject(new TypeError("Old response disconnected"));
    await posting;
    expect(h.client.getState()).toMatchObject({ phase: "idle", result: result(), error: null });
    expect(h.completed).toHaveBeenCalledOnce();
  });

  it("does not let a late running GET replace a direct POST success", async () => {
    const h = harness();
    await h.client.check();
    const post = deferred<AiPlannerResult>();
    const read = deferred<AiRequestRecoveryResponse>();
    h.submit.mockReturnValueOnce(post.promise);
    const posting = h.client.submit(prompt);
    h.load.mockReturnValueOnce(read.promise);
    const checking = h.client.check();
    post.resolve(result());
    await posting;
    read.resolve(recovery("running"));
    await checking;
    expect(h.client.getState()).toMatchObject({ phase: "idle", result: result(), error: null });
    expect(h.completed).toHaveBeenCalledOnce();
  });

  it("accepts a new prompt after terminal recovery even while the older POST transport is stuck", async () => {
    const h = harness();
    await h.client.check();
    const oldPost = deferred<AiPlannerResult>();
    const newPost = deferred<AiPlannerResult>();
    h.submit.mockReturnValueOnce(oldPost.promise).mockReturnValueOnce(newPost.promise);
    const oldWork = h.client.submit(prompt);
    h.load.mockResolvedValueOnce(recovery("succeeded"));
    await h.client.check();
    const newWork = h.client.submit({ ...prompt, prompt: "Plan a second museum visit." });
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.client.getState().phase).toBe("running");
    oldPost.resolve(result());
    await oldWork;
    expect(h.client.getState().phase).toBe("running");
    await h.client.submit({ ...prompt, prompt: "A third overlapping prompt." });
    expect(h.submit).toHaveBeenCalledTimes(2);
    newPost.resolve(result("20000000-0000-4000-8000-000000000002"));
    await newWork;
    expect(h.client.getState().result?.requestId).toBe("20000000-0000-4000-8000-000000000002");
    expect(h.completed).toHaveBeenCalledTimes(2);
  });

  it("isolates independent controller instances while their requests run concurrently", async () => {
    const first = harness();
    const second = harness();
    second.uuid.mockReset().mockReturnValue(secondKey);
    await Promise.all([first.client.check(), second.client.check()]);
    const firstPost = deferred<AiPlannerResult>();
    const secondPost = deferred<AiPlannerResult>();
    first.submit.mockReturnValueOnce(firstPost.promise);
    second.submit.mockReturnValueOnce(secondPost.promise);
    const firstWork = first.client.submit(prompt);
    const secondWork = second.client.submit({ ...prompt, prompt: "Plan a garden visit." });
    expect(first.client.getState().phase).toBe("running");
    expect(second.client.getState().phase).toBe("running");
    expect(first.submit).toHaveBeenCalledOnce();
    expect(second.submit).toHaveBeenCalledOnce();
    first.client.dispose();
    firstPost.resolve(result());
    secondPost.resolve({ ...result("other-user-request"), message: "The garden proposal is ready." });
    await Promise.all([firstWork, secondWork]);
    expect(first.completed).not.toHaveBeenCalled();
    expect(second.client.getState().result).toMatchObject({ requestId: "other-user-request", message: "The garden proposal is ready." });
    expect(second.completed).toHaveBeenCalledOnce();
  });

  it("uses only injected request functions and never persists prompts or answers in browser storage", async () => {
    const unexpected = vi.fn(() => { throw new Error("Unexpected global storage or network access"); });
    vi.stubGlobal("fetch", unexpected);
    vi.stubGlobal("localStorage", { getItem: unexpected, setItem: unexpected, removeItem: unexpected, clear: unexpected });
    vi.stubGlobal("sessionStorage", { getItem: unexpected, setItem: unexpected, removeItem: unexpected, clear: unexpected });
    vi.stubGlobal("indexedDB", { open: unexpected, deleteDatabase: unexpected });
    const h = harness();
    await h.client.check();
    await h.client.submit(prompt);
    h.load.mockResolvedValueOnce(recovery("succeeded"));
    await h.client.check();
    h.client.reset();
    h.client.dispose();
    expect(unexpected).not.toHaveBeenCalled();
    expect(h.submit).toHaveBeenCalledOnce();
  });
});

describe("mobile AI recovery lifecycle", () => {
  it.each([
    ["document", "visibilitychange"],
    ["window", "focus"],
    ["window", "online"],
    ["window", "pageshow"],
  ] as const)("recovers on %s %s after returning to the app", async (surface, eventName) => {
    vi.useFakeTimers();
    const targets = { document: new EventTarget(), window: new EventTarget() };
    let visible = true;
    const h = harness();
    h.load.mockResolvedValueOnce(recovery("running")).mockResolvedValue(recovery("succeeded"));
    const stop = watchAiRequestRecovery({ ...targets, visible: () => visible, check: h.client.check });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.client.getState().phase).toBe("running");
    visible = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.load).toHaveBeenCalledOnce();
    visible = true;
    targets[surface].dispatchEvent(new Event(eventName));
    await h.client.check();
    expect(h.client.getState().result).toEqual(result());
    expect(h.load).toHaveBeenLastCalledWith(firstKey);
    expect(h.submit).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips the initial read, polling, and wake events while the page is hidden", async () => {
    vi.useFakeTimers();
    const targets = { document: new EventTarget(), window: new EventTarget() };
    const check = vi.fn().mockResolvedValue(undefined);
    const stop = watchAiRequestRecovery({ ...targets, check, visible: () => false });
    await vi.advanceTimersByTimeAsync(30_000);
    targets.document.dispatchEvent(new Event("visibilitychange"));
    for (const name of ["focus", "online", "pageshow"]) targets.window.dispatchEvent(new Event(name));
    expect(check).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls at five-second intervals only while visible", async () => {
    vi.useFakeTimers();
    const targets = { document: new EventTarget(), window: new EventTarget() };
    let visible = true;
    const check = vi.fn().mockResolvedValue(undefined);
    const stop = watchAiRequestRecovery({ ...targets, check, visible: () => visible });
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    visible = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(check).toHaveBeenCalledTimes(2);
    visible = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
  });

  it("coalesces simultaneous visibility, focus, online, pageshow and timer wakes", async () => {
    vi.useFakeTimers();
    const targets = { document: new EventTarget(), window: new EventTarget() };
    const h = harness();
    const waiting = deferred<AiRequestRecoveryResponse>();
    h.load.mockReturnValueOnce(waiting.promise);
    const stop = watchAiRequestRecovery({ ...targets, visible: () => true, check: h.client.check });
    await vi.advanceTimersByTimeAsync(0);
    targets.document.dispatchEvent(new Event("visibilitychange"));
    for (const name of ["focus", "online", "pageshow"]) targets.window.dispatchEvent(new Event(name));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.load).toHaveBeenCalledOnce();
    waiting.resolve(recovery("succeeded"));
    await h.client.check();
    expect(h.completed).toHaveBeenCalledOnce();
    expect(h.submit).not.toHaveBeenCalled();
    stop();
  });

  it("checks idle sessions every thirty seconds and active requests every five seconds", async () => {
    vi.useFakeTimers();
    const targets = { document: new EventTarget(), window: new EventTarget() };
    let active = false;
    const check = vi.fn().mockResolvedValue(undefined);
    const stop = watchAiRequestRecovery({ ...targets, check, visible: () => true, active: () => active });
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(3);
    active = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(check).toHaveBeenCalledTimes(5);
    active = false;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(check).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(6);
    stop();
  });

  it("wakes an idle session immediately on mobile return without waiting for its slow poll", async () => {
    vi.useFakeTimers();
    const targets = { document: new EventTarget(), window: new EventTarget() };
    const check = vi.fn().mockResolvedValue(undefined);
    const stop = watchAiRequestRecovery({ ...targets, check, visible: () => true, active: () => false });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(check).toHaveBeenCalledOnce();
    targets.window.dispatchEvent(new Event("pageshow"));
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
  });

  it("removes all listeners and timers when the AI view is disposed", async () => {
    vi.useFakeTimers();
    const targets = { document: new EventTarget(), window: new EventTarget() };
    const documentRemoval = vi.spyOn(targets.document, "removeEventListener");
    const windowRemoval = vi.spyOn(targets.window, "removeEventListener");
    const check = vi.fn().mockResolvedValue(undefined);
    const stop = watchAiRequestRecovery({ ...targets, check, visible: () => true });
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    targets.document.dispatchEvent(new Event("visibilitychange"));
    for (const name of ["focus", "online", "pageshow"]) targets.window.dispatchEvent(new Event(name));
    expect(check).not.toHaveBeenCalled();
    expect(documentRemoval.mock.calls.map(([name]) => name)).toEqual(["visibilitychange"]);
    expect(windowRemoval.mock.calls.map(([name]) => name)).toEqual(["focus", "online", "pageshow"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
