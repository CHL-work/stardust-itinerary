import { RateLimitError } from "@/lib/auth/errors";

/**
 * At most `STARDUST_AI_MAX_CONCURRENT` (default 4) AI requests run at once in one server process.
 * Each starts provider CLI processes inside the web pod, so the cap bounds its memory; a request
 * beyond it is refused at once with a short retry delay instead of queuing. Background workers run
 * one request at a time and do not use it.
 */
const DEFAULT_MAX_CONCURRENT = 4;
const RETRY_AFTER_SECONDS = 15;
let active = 0;

function maxConcurrent(env: Record<string, string | undefined>): number {
  const value = Number(env.STARDUST_AI_MAX_CONCURRENT);
  return Number.isSafeInteger(value) && value >= 1 && value <= 64 ? value : DEFAULT_MAX_CONCURRENT;
}

export async function withAiRequestSlot<T>(work: () => Promise<T>, env: Record<string, string | undefined> = process.env): Promise<T> {
  if (active >= maxConcurrent(env)) throw new RateLimitError(RETRY_AFTER_SECONDS);
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
  }
}

/** For tests: requests holding a slot right now. */
export function activeAiRequests(): number {
  return active;
}
