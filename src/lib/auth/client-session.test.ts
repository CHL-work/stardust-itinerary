import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("browser session coordination", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waits for an in-tab session rotation before starting an authenticated request", async () => {
    const refreshResponse = deferred<Response>();
    const fetchMock = vi.fn(() => refreshResponse.promise);
    const lockRequest = vi.fn(async (
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ) => callback({ name, mode: options.mode ?? "exclusive" } as Lock));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { locks: { request: lockRequest } });

    const { refreshSessionForActivity, withStableSession } = await import("@/lib/auth/client-session");
    const refresh = refreshSessionForActivity();
    const request = vi.fn(async () => "ok");
    const result = withStableSession(request);

    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    refreshResponse.resolve(new Response(null, { status: 200 }));

    await expect(refresh).resolves.toBeUndefined();
    await expect(result).resolves.toBe("ok");
    expect(lockRequest.mock.calls.map((call) => call[1])).toEqual([
      { mode: "exclusive", ifAvailable: true },
      { mode: "shared" },
    ]);
  });

  it("uses a shared Web Lock for authenticated requests", async () => {
    const lockRequest = vi.fn(async (
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ) => callback({ name, mode: options.mode ?? "exclusive" } as Lock));
    vi.stubGlobal("navigator", { locks: { request: lockRequest } });

    const { withStableSession } = await import("@/lib/auth/client-session");

    await expect(withStableSession(async () => 42)).resolves.toBe(42);
    expect(lockRequest).toHaveBeenCalledWith(
      "stardust-session-refresh",
      { mode: "shared" },
      expect.any(Function),
    );
  });

  it("does not rotate during an authenticated request when Web Locks are unavailable", async () => {
    const requestResponse = deferred<string>();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {});

    const { refreshSessionForActivity, withStableSession } = await import("@/lib/auth/client-session");
    const request = withStableSession(() => requestResponse.promise);
    await Promise.resolve();

    await expect(refreshSessionForActivity()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    requestResponse.resolve("done");
    await expect(request).resolves.toBe("done");
  });

  it("lets an authenticated request try its current cookie after a refresh network failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {});

    const { refreshSessionForActivity, withStableSession } = await import("@/lib/auth/client-session");
    const refresh = refreshSessionForActivity();
    const request = vi.fn(async () => "still attempted");

    await expect(refresh).resolves.toBeUndefined();
    await expect(withStableSession(request)).resolves.toBe("still attempted");
    expect(request).toHaveBeenCalledOnce();
  });
});
