import { describe, expect, it } from "vitest";

import { AI_QUICK_REPLY_TTL_MS, aiQuickReplyAt, aiQuickReplyExpired } from "@/lib/ai/quick-reply";
import type { AiRecoveryState } from "@/lib/ai/request-recovery-client";
import type { AiPlannerResult, AiRecoveredRequest } from "@/lib/ai/request-recovery-types";

const completedAt = "2030-04-01T03:00:00.000Z";
const done = Date.parse(completedAt);
const result = { requestId: "synthetic-request", message: "Synthetic answer" } as AiPlannerResult;
const request = { requestId: "synthetic-request", status: "succeeded", createdAt: "2030-04-01T02:59:00.000Z", completedAt, result } as AiRecoveredRequest;
const idle = (overrides: Partial<AiRecoveryState> = {}): AiRecoveryState => ({ phase: "idle", request, result, error: null, ...overrides });

describe("quick AI answers expire after ten idle minutes", () => {
  it("uses the saved completion time, then the start time, then when this page received a direct answer", () => {
    expect(aiQuickReplyAt(idle(), null)).toBe(done);
    expect(aiQuickReplyAt(idle({ request: { ...request, completedAt: null } }), null)).toBe(Date.parse(request.createdAt));
    expect(aiQuickReplyAt(idle({ request: null }), 1234)).toBe(1234);
    expect(aiQuickReplyAt(idle({ request: null, result: null }), 1234)).toBeNull();
    expect(aiQuickReplyAt(idle({ request: { ...request, completedAt: "not a date", createdAt: "also not" } }), 99)).toBe(99);
  });

  it("hides an idle answer from ten minutes on, but never one still running", () => {
    expect(aiQuickReplyExpired(idle(), null, done + AI_QUICK_REPLY_TTL_MS - 1)).toBe(false);
    expect(aiQuickReplyExpired(idle(), null, done + AI_QUICK_REPLY_TTL_MS)).toBe(true);
    expect(aiQuickReplyExpired(idle({ request: { ...request, status: "failed", result: null }, result: null }), null, done + 2 * AI_QUICK_REPLY_TTL_MS)).toBe(true);
    for (const phase of ["checking", "running", "reconnecting", "busy_elsewhere"] as const) {
      expect(aiQuickReplyExpired(idle({ phase }), null, done + 6 * AI_QUICK_REPLY_TTL_MS)).toBe(false);
    }
  });

  it("has nothing to expire in a fresh conversation", () => {
    expect(aiQuickReplyExpired(idle({ request: null, result: null }), 0, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
