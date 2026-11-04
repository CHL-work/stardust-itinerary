import { MAX_AI_INSTRUCTION_CHARACTERS, type AiInstructions } from "@/lib/ai/custom-instructions-contract";

export const AI_INSTRUCTIONS_MAX_CHARACTERS = MAX_AI_INSTRUCTION_CHARACTERS;
export type AiInstructionsSnapshot = AiInstructions;
export type AiInstructionsState = {
  phase: "loading" | "ready" | "saving" | "failed" | "forbidden";
  saved: AiInstructionsSnapshot | null;
  draft: string;
  notice: "saved" | "cleared" | "loadFailed" | "saveFailed" | "conflict" | "unavailable" | "limit" | null;
};
export type AiInstructionsRequest = <T>(url: string, init?: RequestInit) => Promise<T>;

export function emptyAiInstructionsState(): AiInstructionsState {
  return { phase: "loading", saved: null, draft: "", notice: null };
}

function snapshot(value: AiInstructionsSnapshot): AiInstructionsSnapshot {
  if (typeof value?.instructions !== "string" || value.instructions.length > AI_INSTRUCTIONS_MAX_CHARACTERS
    || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error("Invalid instructions response.");
  return { instructions: value.instructions, revision: value.revision };
}

/** One editor lifetime owns one identity scope. Disposal discards every late response. */
export function createAiInstructionsController(tripId: string, request: AiInstructionsRequest, changed: (state: AiInstructionsState) => void) {
  let state = emptyAiInstructionsState();
  let disposed = false;
  let generation = 0;
  let pending: AbortController | null = null;
  const url = `/api/trips/${encodeURIComponent(tripId)}/ai/instructions`;
  const publish = (next: AiInstructionsState) => { if (!disposed) { state = next; changed(next); } };
  const execute = async (instructions?: string) => {
    if (disposed || state.phase === "saving" || state.phase === "forbidden") return;
    const saving = instructions !== undefined;
    if (saving && (!state.saved || state.notice === "conflict")) return;
    if (saving && instructions.length > AI_INSTRUCTIONS_MAX_CHARACTERS) {
      publish({ ...state, notice: "limit" }); return;
    }
    const expectedRevision = state.saved?.revision;
    const ticket = ++generation;
    pending?.abort();
    const abort = new AbortController();
    pending = abort;
    const timeout = setTimeout(() => abort.abort(), 15_000);
    publish({ ...state, phase: saving ? "saving" : "loading", notice: null });
    try {
      const value = snapshot(await request<AiInstructionsSnapshot>(url, {
        cache: "no-store", signal: abort.signal,
        ...(saving ? { method: "PATCH", body: JSON.stringify({ instructions, expectedRevision }) } : {}),
      }));
      if (disposed || ticket !== generation) return;
      publish({ phase: "ready", saved: value, draft: value.instructions, notice: saving ? value.instructions ? "saved" : "cleared" : null });
    } catch (error) {
      if (disposed || ticket !== generation) return;
      const status = error && typeof error === "object" && "status" in error ? error.status : null;
      if (status === 401 || status === 403) {
        publish({ phase: "forbidden", saved: null, draft: "", notice: "unavailable" });
      } else {
        publish({ ...state, phase: saving ? "ready" : "failed", notice: status === 409 && saving ? "conflict" : saving ? "saveFailed" : "loadFailed" });
      }
    } finally {
      clearTimeout(timeout);
      if (ticket === generation) pending = null;
    }
  };
  return {
    getState: () => state,
    load: () => execute(),
    edit: (draft: string) => {
      if (state.phase === "ready") publish({ ...state, draft, notice: state.notice === "conflict" ? "conflict" : null });
    },
    save: () => execute(state.draft),
    clear: () => execute(""),
    dispose: () => { disposed = true; generation += 1; pending?.abort(); pending = null; },
  };
}
