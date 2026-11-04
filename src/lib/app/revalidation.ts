export type RevalidationMode = "passive" | "fresh";

export type RevalidationResult<T> =
  | { ok: true; value: T; isLatest: boolean }
  | { ok: false; error: unknown; isLatest: boolean };

export type RevalidationCoordinator<T> = {
  run: (mode: RevalidationMode) => Promise<RevalidationResult<T>>;
};

export function createRevalidationCoordinator<T>(load: () => Promise<T>): RevalidationCoordinator<T> {
  let queue: Promise<void> = Promise.resolve();
  let latestScheduledRequest: Promise<T> | null = null;
  let latestSequence = 0;

  const enqueue = () => {
    const request = queue.then(load);
    queue = request.then(() => undefined, () => undefined);
    latestScheduledRequest = request;
    void request.then(
      () => {
        if (latestScheduledRequest === request) latestScheduledRequest = null;
      },
      () => {
        if (latestScheduledRequest === request) latestScheduledRequest = null;
      },
    );
    return request;
  };

  return {
    async run(mode) {
      if (mode === "passive" && latestScheduledRequest) {
        try {
          return { ok: true, value: await latestScheduledRequest, isLatest: false };
        } catch (error) {
          return { ok: false, error, isLatest: false };
        }
      }

      const sequence = ++latestSequence;
      const request = enqueue();
      try {
        const value = await request;
        return { ok: true, value, isLatest: sequence === latestSequence };
      } catch (error) {
        return { ok: false, error, isLatest: sequence === latestSequence };
      }
    },
  };
}
