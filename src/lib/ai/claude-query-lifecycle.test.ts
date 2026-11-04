import { describe, expect, it, vi } from "vitest";
import { AiProviderFailureError } from "@/lib/ai/provider-failure";
import { ClaudeQueryAbortedError, consumeClaudeQuery, type ClosableClaudeQuery } from "@/lib/ai/claude-query-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function queryFixture<T>(next: () => Promise<IteratorResult<T>>) {
  const close = vi.fn();
  const iterator = { next: vi.fn(next), return: vi.fn(() => new Promise<IteratorResult<T>>(() => {})) };
  const iterable = vi.fn(() => iterator);
  const query: ClosableClaudeQuery<T> = { [Symbol.asyncIterator]: iterable, close };
  return { query, close, iterator, iterable };
}
function finishedQuery() {
  const results: IteratorResult<number>[] = [{ done: false, value: 1 }, { done: false, value: 2 }, { done: true, value: undefined }];
  return queryFixture(async () => results.shift()!);
}

describe("bounded Claude query lifecycle", () => {
  it.each([false, true])("closes on the explicit terminal result without awaiting a stalled next() (cleanup failure=%s)", async (cleanupFails) => {
    const fixture = queryFixture<number>(() => new Promise(() => {}));
    fixture.iterator.next.mockResolvedValueOnce({ done: false, value: 1 });
    if (cleanupFails) fixture.close.mockImplementation(() => { throw new Error("private cleanup detail"); });
    const message = vi.fn(() => true);
    const result = await consumeClaudeQuery(fixture.query, new AbortController().signal, message);
    expect(result).toEqual({ cleanupFailed: cleanupFails });
    expect(message).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.iterator.next).toHaveBeenCalledOnce();
    expect(fixture.iterator.return).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
  }, 1_000);
  it("continues after false/nonterminal callbacks until explicit completion", async () => {
    const fixture = finishedQuery();
    const message = vi.fn((value: number) => value === 2);
    expect(await consumeClaudeQuery(fixture.query, new AbortController().signal, message)).toEqual({ cleanupFailed: false });
    expect(message.mock.calls).toEqual([[1], [2]]);
    expect(fixture.iterator.next).toHaveBeenCalledTimes(2);
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("processes ordered messages, closes once and removes the exact abort listener", async () => {
    const fixture = finishedQuery();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
    const message = vi.fn();
    expect(await consumeClaudeQuery(fixture.query, controller.signal, message)).toEqual({ cleanupFailed: false });
    expect(message.mock.calls).toEqual([[1], [2]]);
    expect(fixture.iterator.next).toHaveBeenCalledTimes(3);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.iterator.return).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
    controller.abort();
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("returns only cleanup metadata when a completed query fails to close", async () => {
    const fixture = finishedQuery();
    fixture.close.mockImplementation(() => { throw new Error("private SDK detail"); });
    const result = await consumeClaudeQuery(fixture.query, new AbortController().signal, vi.fn());
    expect(result).toEqual({ cleanupFailed: true });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])("preserves a primary provider error through cleanup failure=%s", async (cleanupFails) => {
    const fixture = finishedQuery();
    if (cleanupFails) fixture.close.mockImplementation(() => { throw new Error("private cleanup"); });
    const failure = new AiProviderFailureError({ code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic" });
    await expect(consumeClaudeQuery(fixture.query, new AbortController().signal, () => { throw failure; })).rejects.toBe(failure);
    expect(fixture.iterator.next).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.iterator.return).not.toHaveBeenCalled();
  });
  it("preserves a synchronous validation failure even if that callback also aborts", async () => {
    const fixture = finishedQuery();
    const controller = new AbortController();
    const failure = new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "anthropic" });
    fixture.close.mockImplementation(() => { throw new Error("private cleanup"); });
    await expect(consumeClaudeQuery(fixture.query, controller.signal, () => { controller.abort(); throw failure; })).rejects.toBe(failure);
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("preserves a rejected iterator exception and still removes its listener", async () => {
    const failure = new Error("synthetic primary failure");
    const fixture = queryFixture<number>(async () => { throw failure; });
    fixture.close.mockImplementation(() => { throw new Error("secondary cleanup"); });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(consumeClaudeQuery(fixture.query, controller.signal, vi.fn())).rejects.toBe(failure);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
  it("closes even if obtaining the iterator throws", async () => {
    const failure = new Error("synthetic iterator failure");
    const fixture = finishedQuery();
    fixture.iterable.mockImplementation(() => { throw failure; });
    await expect(consumeClaudeQuery(fixture.query, new AbortController().signal, vi.fn())).rejects.toBe(failure);
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])("never starts an already-aborted iterator even with cleanup failure=%s", async (cleanupFails) => {
    const fixture = finishedQuery();
    if (cleanupFails) fixture.close.mockImplementation(() => { throw new Error("private cleanup"); });
    const controller = new AbortController();
    controller.abort(new Error("private cancellation reason"));
    const message = vi.fn();
    const error = await consumeClaudeQuery(fixture.query, controller.signal, message).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ClaudeQueryAbortedError);
    expect(error).toMatchObject({ name: "AbortError", message: "The Claude query was aborted." });
    expect(error).not.toHaveProperty("cause");
    expect(fixture.iterable).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])("releases a stalled next() promptly on abort with cleanup failure=%s", async (cleanupFails) => {
    const pendingNext = deferred<IteratorResult<number>>();
    const fixture = queryFixture(() => pendingNext.promise);
    if (cleanupFails) fixture.close.mockImplementation(() => { throw new Error("private cleanup"); });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const message = vi.fn();
    const pending = consumeClaudeQuery(fixture.query, controller.signal, message);
    expect(fixture.iterator.next).toHaveBeenCalledOnce();
    controller.abort(new Error("private reason"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    // A late message must not be processed or start another iterator operation.
    pendingNext.resolve({ done: false, value: 99 });
    await Promise.resolve(); await Promise.resolve();
    expect(message).not.toHaveBeenCalled();
    expect(fixture.iterator.next).toHaveBeenCalledOnce();
  }, 1_000);
  it("handles late rejected next() promises after abort without another consumer or close", async () => {
    const pendingNext = deferred<IteratorResult<number>>();
    const fixture = queryFixture(() => pendingNext.promise);
    const controller = new AbortController();
    const pending = consumeClaudeQuery(fixture.query, controller.signal, vi.fn());
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ClaudeQueryAbortedError);
    pendingNext.reject(new Error("late synthetic provider failure"));
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("drops a value returned by next() while that operation aborts", async () => {
    const controller = new AbortController();
    const fixture = queryFixture<number>(async () => { controller.abort(); return { done: false, value: 1 }; });
    const message = vi.fn();
    await expect(consumeClaudeQuery(fixture.query, controller.signal, message)).rejects.toBeInstanceOf(ClaudeQueryAbortedError);
    expect(message).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("stops after a callback aborts without dispatching the next message", async () => {
    const controller = new AbortController();
    const fixture = finishedQuery();
    const message = vi.fn(() => { controller.abort(); });
    await expect(consumeClaudeQuery(fixture.query, controller.signal, message)).rejects.toBeInstanceOf(ClaudeQueryAbortedError);
    expect(message).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.iterator.next).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("bounds an asynchronous message callback without processing further messages after abort", async () => {
    const blocked = deferred<void>();
    const callbackStarted = deferred<void>();
    const fixture = finishedQuery();
    const controller = new AbortController();
    const message = vi.fn(() => { callbackStarted.resolve(); return blocked.promise; });
    const pending = consumeClaudeQuery(fixture.query, controller.signal, message);
    await callbackStarted.promise;
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ClaudeQueryAbortedError);
    blocked.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(message).toHaveBeenCalledOnce();
    expect(fixture.iterator.next).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
  }, 1_000);
  it("preserves an asynchronous callback rejection before abort", async () => {
    const failure = new Error("synthetic callback failure");
    const fixture = finishedQuery();
    await expect(consumeClaudeQuery(fixture.query, new AbortController().signal, async () => { throw failure; })).rejects.toBe(failure);
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("does not treat the cleanup itself aborting its controller as a failed completed response", async () => {
    const fixture = finishedQuery();
    const controller = new AbortController();
    fixture.close.mockImplementation(() => { controller.abort(); });
    expect(await consumeClaudeQuery(fixture.query, controller.signal, vi.fn())).toEqual({ cleanupFailed: false });
    expect(fixture.close).toHaveBeenCalledOnce();
  });
});
