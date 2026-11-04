import { describe, expect, it } from "vitest";
import { AiProviderFailureError, aiProviderFailureCodes, aiProviderFailureDetails,
  createClaudeProviderFailureTracker, parseAiProviderFailureDetails } from "./provider-failure";

const now = new Date("2030-04-01T12:00:00.000Z").getTime();
const retryAt = "2030-04-01T17:00:00.000Z";
const seconds = new Date(retryAt).getTime() / 1000;
const rate = (status: string = "rejected", resetsAt: unknown = seconds) => ({ type: "rate_limit_event",
  rate_limit_info: { status, resetsAt, utilization: 99, rateLimitType: "five_hour", overageDisabledReason: "org_level_disabled" },
  session_id: "private-session", uuid: "private-uuid" });
const terminal = { type: "result", subtype: "success", is_error: true, result: "PRIVATE raw provider response" };

describe("safe provider failure projection", () => {
  it.each(aiProviderFailureCodes)("round-trips allowlisted code %s without raw upstream data", (code) => {
    const details = { code, provider: "anthropic" as const };
    const error = new AiProviderFailureError(details);
    expect(error.name).toBe(code); expect(error.message).toBe(code);
    expect(aiProviderFailureDetails(error)).toEqual(details);
    expect(Object.isFrozen(error.details)).toBe(true);
  });
  it("retains canonical past reset estimates in history without inventing new relative times", () => {
    expect(parseAiProviderFailureDetails({ code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2020-01-01T00:00:00.000Z" }))
      .toEqual({ code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2020-01-01T00:00:00.000Z" });
  });
  it.each([null, [], {}, { code: "Error", provider: "anthropic" }, { code: "AI_PROVIDER_RATE_LIMITED", provider: "other" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", message: "private" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "tomorrow" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2030-02-30T00:00:00.000Z" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "9999-01-01T00:00:00.000Z" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: seconds },
    { code: "AI_PROVIDER_AUTH_REQUIRED", provider: "anthropic", retryAt },
  ])("rejects unsafe persisted metadata %j", (value) => {
    expect(parseAiProviderFailureDetails(value)).toBeNull();
  });
  it("does not classify plain messages, spoofed names/details or raw provider exceptions", () => {
    expect(aiProviderFailureDetails(new Error("rate_limit private account"))).toBeNull();
    expect(aiProviderFailureDetails({ name: "AI_PROVIDER_RATE_LIMITED", details: { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic" } })).toBeNull();
  });
});

describe("documented Claude terminal error tracking", () => {
  it("recognizes rejected five-hour limit plus assistant error despite success subtype", () => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    expect(tracker.observe(rate())).toBeNull();
    expect(tracker.observe({ type: "assistant", error: "rate_limit", message: { content: [{ text: "private" }] } })).toBeNull();
    const error = tracker.observe(terminal);
    expect(aiProviderFailureDetails(error)).toEqual({ code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt });
    expect(JSON.stringify(error)).not.toMatch(/private|session|utilization|overage|rateLimitType/iu);
  });
  it.each(["allowed", "allowed_warning", "unknown"])("does not use a %s reset as a rejected limit", (status) => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    tracker.observe(rate(status)); tracker.observe({ type: "assistant", error: "rate_limit" });
    expect(aiProviderFailureDetails(tracker.observe(terminal))).toEqual({ code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic" });
  });
  it("clears rejected reset when subsequent allowance replaces it", () => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    tracker.observe(rate()); tracker.observe(rate("allowed_warning")); tracker.observe({ type: "assistant", error: "rate_limit" });
    expect(aiProviderFailureDetails(tracker.observe(terminal))?.retryAt).toBeUndefined();
  });
  it.each([null, undefined, [], "malformed"])("clears an older reset when new telemetry is malformed %j", (rate_limit_info) => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    tracker.observe(rate()); tracker.observe({ type: "rate_limit_event", rate_limit_info });
    tracker.observe({ type: "assistant", error: "rate_limit" });
    expect(aiProviderFailureDetails(tracker.observe(terminal))).toEqual({ code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic" });
  });
  it.each([seconds * 1000, now / 1000, now / 1000 - 1, now / 1000 + 9 * 86400, Infinity, NaN, String(seconds), 1.1, null])(
    "omits malformed, stale or implausible reset %s", (resetsAt) => {
      const tracker = createClaudeProviderFailureTracker(() => now);
      tracker.observe(rate("rejected", resetsAt)); tracker.observe({ type: "assistant", error: "rate_limit" });
      expect(aiProviderFailureDetails(tracker.observe(terminal))?.retryAt).toBeUndefined();
    });
  it.each([
    ["authentication_failed", "AI_PROVIDER_AUTH_REQUIRED"], ["oauth_org_not_allowed", "AI_PROVIDER_AUTH_REQUIRED"],
    ["billing_error", "AI_PROVIDER_BILLING"], ["account_on_hold", "AI_PROVIDER_BILLING"],
    ["model_not_found", "AI_PROVIDER_MODEL_UNAVAILABLE"], ["overloaded", "AI_PROVIDER_UNAVAILABLE"],
    ["server_error", "AI_PROVIDER_UNAVAILABLE"], ["max_output_tokens", "AI_PROVIDER_OUTPUT_INVALID"],
  ])("maps typed terminal assistant category %s without borrowing another failure's reset", (error, code) => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    tracker.observe(rate()); tracker.observe({ type: "assistant", error });
    expect(aiProviderFailureDetails(tracker.observe(terminal))).toEqual({ code, provider: "anthropic" });
  });
  it("does not infer failure from warnings or rejected-limit telemetry when a turn succeeds", () => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    tracker.observe(rate()); tracker.observe({ type: "assistant", error: "rate_limit" });
    expect(tracker.observe({ ...terminal, is_error: false })).toBeNull();
  });
  it("does not classify unknown terminal failures by searching error strings or stale telemetry", () => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    tracker.observe(rate()); tracker.observe({ type: "assistant", error: "unknown", message: "rate_limit" });
    expect(tracker.observe(terminal)).toBeNull();
    expect(tracker.observe({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["authentication_failed"] })).toBeNull();
  });
  it("uses documented structured-output terminal failure over earlier unrelated errors", () => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    tracker.observe(rate()); tracker.observe({ type: "assistant", error: "rate_limit" });
    expect(aiProviderFailureDetails(tracker.observe({ type: "result", subtype: "error_max_structured_output_retries", is_error: true })))
      .toEqual({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "anthropic" });
  });
  it("never maps a local max-budget stop to provider billing or an undocumented result to failure", () => {
    const tracker = createClaudeProviderFailureTracker(() => now);
    expect(tracker.observe({ type: "result", subtype: "error_max_budget_usd", is_error: true })).toBeNull();
    tracker.observe({ type: "assistant", error: "rate_limit" });
    expect(tracker.observe({ type: "result", subtype: "future_new_shape" })).toBeNull();
  });
  it.each(["error_max_turns", "error_max_budget_usd"])("gives explicit local stop %s precedence over earlier provider errors", (subtype) => {
    for (const error of ["rate_limit", "authentication_failed", "billing_error"]) {
      const tracker = createClaudeProviderFailureTracker(() => now);
      tracker.observe(rate()); tracker.observe({ type: "assistant", error });
      expect(tracker.observe({ type: "result", subtype, is_error: true })).toBeNull();
    }
  });
});
