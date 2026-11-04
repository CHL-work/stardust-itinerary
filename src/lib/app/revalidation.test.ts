import { describe, expect, it, vi } from "vitest";

import { createRevalidationCoordinator } from "@/lib/app/revalidation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("createRevalidationCoordinator", () => {
  it("coalesces overlapping passive refreshes", async () => {
    const response = deferred<string>();
    const load = vi.fn(() => response.promise);
    const coordinator = createRevalidationCoordinator(load);

    const first = coordinator.run("passive");
    const overlap = coordinator.run("passive");
    expect(load).toHaveBeenCalledTimes(0);

    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    response.resolve("shared");

    await expect(first).resolves.toEqual({ ok: true, value: "shared", isLatest: true });
    await expect(overlap).resolves.toEqual({ ok: true, value: "shared", isLatest: false });
  });

  it("queues a forced fresh request behind an older passive request and marks only fresh data latest", async () => {
    const passiveResponse = deferred<string>();
    const freshResponse = deferred<string>();
    const load = vi.fn()
      .mockReturnValueOnce(passiveResponse.promise)
      .mockReturnValueOnce(freshResponse.promise);
    const coordinator = createRevalidationCoordinator(load);

    const passive = coordinator.run("passive");
    await Promise.resolve();
    const fresh = coordinator.run("fresh");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    passiveResponse.resolve("stale");
    await expect(passive).resolves.toEqual({ ok: true, value: "stale", isLatest: false });
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);

    freshResponse.resolve("fresh");
    await expect(fresh).resolves.toEqual({ ok: true, value: "fresh", isLatest: true });
  });

  it("does not let a passive tick supersede or duplicate a forced refresh", async () => {
    const response = deferred<string>();
    const load = vi.fn(() => response.promise);
    const coordinator = createRevalidationCoordinator(load);

    const fresh = coordinator.run("fresh");
    const passiveTick = coordinator.run("passive");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    response.resolve("current");
    await expect(fresh).resolves.toEqual({ ok: true, value: "current", isLatest: true });
    await expect(passiveTick).resolves.toEqual({ ok: true, value: "current", isLatest: false });
  });

  it("recovers after a failed request", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("recovered");
    const coordinator = createRevalidationCoordinator(load);

    const failed = await coordinator.run("passive");
    expect(failed.ok).toBe(false);
    expect(failed.isLatest).toBe(true);
    await expect(coordinator.run("fresh")).resolves.toEqual({ ok: true, value: "recovered", isLatest: true });
  });
});
