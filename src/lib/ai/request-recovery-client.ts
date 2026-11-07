import type { AiPlannerResult, AiRequestRecoveryResponse } from "@/lib/ai/request-recovery-types";

type RecoveredRequest = NonNullable<AiRequestRecoveryResponse["request"]>;
export type AiSubmission = { prompt: string; locale: string; model?: string; freeModel?: string; conversationId?: string | null; images?: import("@/lib/ai/image-types").AiImageInput[] };
export type AiRecoveryState = {
  phase: "checking" | "idle" | "running" | "reconnecting" | "busy_elsewhere";
  request: RecoveredRequest | null;
  result: AiPlannerResult | null;
  error: unknown | null;
  activeConversationId?: string | null;
};

const emptyState: AiRecoveryState = { phase: "checking", request: null, result: null, error: null };

/** A page-independent database request is observed, never automatically resubmitted. */
export function createAiRequestRecoveryClient(options: {
  load: (clientRequestId?: string) => Promise<AiRequestRecoveryResponse>;
  submit: (input: AiSubmission & { clientRequestId: string }) => Promise<AiPlannerResult | AiRequestRecoveryResponse>;
  changed: (state: AiRecoveryState) => void;
  completed: () => void;
  uuid: () => string;
}) {
  let state = emptyState;
  let disposed = false;
  let generation = 0;
  let checking: Promise<void> | null = null;
  let postingGeneration: number | null = null;
  let pending: { id: string; payload: string } | null = null;
  let deliveredId: string | null = null;

  const publish = (next: AiRecoveryState) => {
    if (disposed) return;
    state = next;
    options.changed(next);
  };
  const completed = (requestId: string) => {
    if (deliveredId === requestId) return;
    deliveredId = requestId;
    options.completed();
  };
  const receive = (response: AiRequestRecoveryResponse, allowEmpty: boolean) => {
    const request = response.request;
    const conversation = { activeConversationId: response.activeConversationId };
    if (response.busyElsewhere && request?.status !== "running") {
      publish({ phase: "busy_elsewhere", request: null, result: null, error: null, ...conversation });
      return;
    }
    if (!request) {
      if (response.busyElsewhere) {
        publish({ phase: "busy_elsewhere", request: null, result: null, error: null, ...conversation });
      } else if (allowEmpty) {
        publish({ ...emptyState, phase: "idle", ...conversation });
      }
      return;
    }
    if (request.status === "running") {
      if (request.clientRequestId && !pending) pending = { id: request.clientRequestId, payload: "" };
      publish({ phase: "running", request, result: null, error: null, ...conversation });
      return;
    }
    pending = null;
    postingGeneration = null;
    generation += 1;
    publish({ phase: "idle", request, result: request.result, error: null, ...conversation });
    if (request.status === "succeeded") completed(request.requestId);
  };

  const check = (latest = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (checking) return checking;
    const version = generation;
    checking = (async () => {
      try {
        const response = await options.load(latest ? undefined : pending?.id);
        if (disposed || version !== generation) return;
        // A busy rejection may refer to another same-user request, not this key.
        if (!response.request && !response.busyElsewhere && pending && postingGeneration === null) {
          const current = await options.load();
          if (disposed || version !== generation) return;
          if (current.request?.status === "running" || current.busyElsewhere) {
            pending = null;
            receive(current, true);
          } else {
            // Preserve a failed transport's uncertain submission key for an
            // explicit retry; never claim an older response belongs to it.
            publish({ ...state, phase: "idle", activeConversationId: current.activeConversationId === undefined ? state.activeConversationId : current.activeConversationId });
          }
          return;
        }
        receive(response, postingGeneration === null);
      } catch (error) {
        if (disposed || version !== generation) return;
        const status = error && typeof error === "object" && "status" in error ? error.status : null;
        if (status === 401 || status === 403) {
          pending = null;
          postingGeneration = null;
          generation += 1;
          publish({ phase: "idle", request: null, result: null, error });
        } else {
          publish({ ...state, phase: "reconnecting", error });
        }
      }
    })().finally(() => { checking = null; });
    return checking;
  };

  return {
    check,
    getState: () => state,
    async submit(input: AiSubmission) {
      if (disposed || postingGeneration !== null || state.phase !== "idle") return;
      const payload = JSON.stringify(input);
      const clientRequestId = pending?.payload === payload ? pending.id : options.uuid();
      pending = { id: clientRequestId, payload };
      const version = ++generation;
      postingGeneration = version;
      publish({ phase: "running", request: null, result: null, error: null, activeConversationId: state.activeConversationId });
      try {
        const result = await options.submit({ ...input, clientRequestId });
        if (disposed || version !== generation) return;
        if ("request" in result) {
          receive(result, true);
        } else {
          pending = null;
          postingGeneration = null;
          generation += 1;
          publish({ phase: "idle", request: null, result, error: null, activeConversationId: state.activeConversationId });
          completed(result.requestId);
        }
      } catch (error) {
        if (disposed || version !== generation) return;
        // The server can still be working after a phone/network/proxy drops
        // the HTTP response. Reattach before presenting an ordinary error.
        publish({ ...state, phase: "reconnecting", error });
      } finally {
        if (postingGeneration === version) postingGeneration = null;
        if (!disposed && version === generation && !state.result) {
          if (checking) await checking;
          await check();
        }
      }
    },
    reset() {
      generation += 1;
      postingGeneration = null;
      pending = null;
      deliveredId = null;
      publish({ ...emptyState, phase: "idle" });
    },
    dispose() { disposed = true; generation += 1; },
  };
}

export type AiRequestRecoveryClient = ReturnType<typeof createAiRequestRecoveryClient>;

export function watchAiRequestRecovery(options: {
  check: () => Promise<void>;
  visible: () => boolean;
  active?: () => boolean;
  document: Pick<Document, "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}) {
  let alive = true;
  let idleTicks = 0;
  const refresh = () => {
    if (alive && options.visible()) {
      idleTicks = 0;
      void options.check();
    }
  };
  const initial = setTimeout(refresh, 0);
  const interval = setInterval(() => {
    if (!options.active || options.active() || ++idleTicks >= 6) refresh();
  }, 5_000);
  options.document.addEventListener("visibilitychange", refresh);
  options.window.addEventListener("focus", refresh);
  options.window.addEventListener("online", refresh);
  options.window.addEventListener("pageshow", refresh);
  return () => {
    alive = false;
    clearTimeout(initial);
    clearInterval(interval);
    options.document.removeEventListener("visibilitychange", refresh);
    options.window.removeEventListener("focus", refresh);
    options.window.removeEventListener("online", refresh);
    options.window.removeEventListener("pageshow", refresh);
  };
}
