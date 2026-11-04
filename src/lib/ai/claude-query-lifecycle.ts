/** The documented SDK Query.close() synchronously terminates its resources. */
export type ClosableClaudeQuery<T> = AsyncIterable<T> & { close(): void };
export type ClaudeQueryCompletion = { cleanupFailed: boolean };

export class ClaudeQueryAbortedError extends Error {
  constructor() {
    super("The Claude query was aborted.");
    this.name = "AbortError";
  }
}

/**
 * Consume one query without letting a stalled next() delay an application abort.
 * The caller owns message validation and its existing deadline/abort controller.
 * A true callback result signals a completed turn, without awaiting SDK teardown
 * messages or another next(). No provider diagnostics or signal.reason cross here.
 */
export async function consumeClaudeQuery<T>(
  query: ClosableClaudeQuery<T>,
  signal: AbortSignal,
  onMessage: (message: T) => void | boolean | Promise<void | boolean>,
): Promise<ClaudeQueryCompletion> {
  let closed = false;
  let cleanupFailed = false;
  const closeQuery = () => {
    if (closed) return;
    closed = true;
    try { query.close(); } catch { cleanupFailed = true; }
  };
  let resolveAbort!: (value: { aborted: true }) => void;
  // Resolve, rather than reject, so an already-aborted signal cannot create an
  // unhandled rejection before the first iterator operation has been attached.
  const aborted = new Promise<{ aborted: true }>((resolve) => { resolveAbort = resolve; });
  const onAbort = () => {
    resolveAbort({ aborted: true });
    closeQuery();
  };
  const throwIfAborted = () => {
    if (signal.aborted) throw new ClaudeQueryAbortedError();
  };
  const waitFor = async <Value>(operation: Value | PromiseLike<Value>): Promise<Value> => {
    const outcome = await Promise.race([
      Promise.resolve(operation).then((value) => ({ aborted: false as const, value })),
      aborted,
    ]);
    if (outcome.aborted) throw new ClaudeQueryAbortedError();
    throwIfAborted();
    return outcome.value;
  };

  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    throwIfAborted();
    const iterator = query[Symbol.asyncIterator]();
    while (true) {
      throwIfAborted();
      const next = await waitFor(iterator.next());
      if (next.done) break;
      // Invoke synchronously so a message-validation/provider error remains the
      // primary exception even if its callback also aborts the query.
      if (await waitFor(onMessage(next.value)) === true) break;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Do not await iterator.return(): it can queue behind the same stalled
    // next(). The SDK's documented close() owns process/transport cleanup.
    closeQuery();
  }
  return { cleanupFailed };
}
