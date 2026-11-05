import type { AiRecoveryState } from "@/lib/ai/request-recovery-client";

/** The quick AI composer forgets its last answer after ten idle minutes (D-082). */
export const AI_QUICK_REPLY_TTL_MS = 10 * 60 * 1000;

/** When the shown answer was produced: its saved completion time, else when this page received it. */
export function aiQuickReplyAt(state: Pick<AiRecoveryState, "request" | "result">, receivedAt: number | null): number | null {
  for (const value of [state.request?.completedAt, state.request?.createdAt]) {
    const at = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(at)) return at;
  }
  return state.result && receivedAt !== null ? receivedAt : null;
}

/**
 * An idle answer at least ten minutes old is hidden from the quick composer, and
 * the next quick question starts a new conversation. Running work never expires.
 */
export function aiQuickReplyExpired(state: Pick<AiRecoveryState, "phase" | "request" | "result">, receivedAt: number | null, now: number): boolean {
  if (state.phase !== "idle") return false;
  const at = aiQuickReplyAt(state, receivedAt);
  return at !== null && now - at >= AI_QUICK_REPLY_TTL_MS;
}
