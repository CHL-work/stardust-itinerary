import { afterEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_ACTIVITY_WINDOW_MS, feedbackActions, feedbackPages, feedbackSubmissionSchema } from "@/lib/feedback/contracts";
import { feedbackBuildVersion, feedbackPayloadHash, feedbackScope, recentFeedbackDiagnostics } from "@/lib/feedback/repository";

const session = { tripId: "10000000-0000-4000-8000-000000000001", memberId: "20000000-0000-4000-8000-000000000001", userId: "30000000-0000-4000-8000-000000000001" };
const secret = "synthetic-feedback-secret-".repeat(3);
const now = new Date("2030-04-01T12:00:00.000Z");
const diagnostics = { page: "settings" as const, locale: "en" as const, formFactor: "phone" as const, osFamily: "ios" as const,
  browserFamily: "safari" as const, online: true, breadcrumbs: [{ page: "settings" as const, action: "settings_save" as const, at: now.toISOString() }] };
const input = { scope: feedbackScope(session, secret), clientRequestId: "40000000-0000-4000-8000-000000000001",
  title: "Synthetic settings error", description: "The save action did not finish.", kind: "bug" as const, allowIssuePublication: false, diagnostics };

afterEach(() => vi.unstubAllEnvs());
describe("private feedback input boundary", () => {
  it("accepts coarse allowlisted diagnostics without arbitrary content fields", () => {
    expect(feedbackSubmissionSchema.parse(input)).toEqual(input);
    // Historical false payloads must still parse for exact idempotent retries.
    expect(feedbackSubmissionSchema.parse({ ...input, allowIssuePublication: true }).allowIssuePublication).toBe(true);
    for (const page of feedbackPages) expect(feedbackSubmissionSchema.safeParse({ ...input, diagnostics: { ...diagnostics, page } }).success).toBe(true);
    for (const action of feedbackActions) expect(feedbackSubmissionSchema.safeParse({ ...input, diagnostics: { ...diagnostics, breadcrumbs: [{ page: "other", action, at: now.toISOString() }] } }).success).toBe(true);
  });
  it.each([
    { actorUserId: session.userId }, { tripId: session.tripId }, { description: "" }, { title: "a".repeat(161) },
    { description: "a".repeat(6001) }, { allowIssuePublication: "yes" }, { scope: undefined },
    { diagnostics: { ...diagnostics, url: "https://private.example.test" } },
    { diagnostics: { ...diagnostics, page: "/settings?secret=private" } },
    { diagnostics: { ...diagnostics, breadcrumbs: [{ page: "ai", action: "typed a private prompt", at: now.toISOString() }] } },
    { diagnostics: { ...diagnostics, breadcrumbs: [{ page: "ai", action: "ai_submit", at: now.toISOString(), value: "private prompt" }] } },
    { diagnostics: { ...diagnostics, breadcrumbs: Array(51).fill(diagnostics.breadcrumbs[0]) } },
  ])("rejects actor spoofing, unsafe diagnostics and invalid bounds %#", (override) => {
    expect(feedbackSubmissionSchema.safeParse({ ...input, ...override }).success).toBe(false);
  });
  it("filters stale/future breadcrumbs using server time while preserving the submitted fingerprint", () => {
    expect(FEEDBACK_ACTIVITY_WINDOW_MS).toBe(600_000);
    const payload = { ...diagnostics, breadcrumbs: [
      ...diagnostics.breadcrumbs,
      { ...diagnostics.breadcrumbs[0], at: "2030-04-01T11:49:59.999Z" },
      { ...diagnostics.breadcrumbs[0], at: "2030-04-01T12:01:00.001Z" },
      { ...diagnostics.breadcrumbs[0], at: "2030-04-01T20:50:00+09:00" },
      { ...diagnostics.breadcrumbs[0], at: "2030-04-01T12:01:00Z" },
      { ...diagnostics.breadcrumbs[0], at: "2030-04-01T11:30:00Z" },
    ] };
    const snapshot = structuredClone(payload);
    const submittedHash = feedbackPayloadHash(session, { ...input, diagnostics: payload });
    expect(recentFeedbackDiagnostics(payload, now)?.breadcrumbs.map((item) => item.at)).toEqual([
      now.toISOString(), "2030-04-01T11:50:00.000Z", "2030-04-01T12:01:00.000Z",
    ]);
    expect(payload).toEqual(snapshot);
    expect(feedbackPayloadHash(session, { ...input, diagnostics: payload })).toEqual(submittedHash);
    expect(feedbackPayloadHash(session, input)).toEqual(feedbackPayloadHash(session, structuredClone(input)));
    expect(feedbackPayloadHash(session, { ...input, description: "Different report" })).not.toEqual(feedbackPayloadHash(session, input));
    expect(feedbackPayloadHash(session, { ...input, allowIssuePublication: true })).not.toEqual(feedbackPayloadHash(session, input));
    expect(recentFeedbackDiagnostics(undefined, now)).toBeNull();
  });
  it("fences the immutable account behind opaque scope proof without exposing its ID", () => {
    expect(feedbackScope(session, secret)).toEqual(input.scope);
    expect(feedbackScope({ ...session, userId: "30000000-0000-4000-8000-000000000002" }, secret).scopeKey).not.toBe(input.scope.scopeKey);
    expect(feedbackScope(session, `${secret}rotated`).scopeKey).not.toBe(input.scope.scopeKey);
    expect(JSON.stringify(input.scope)).not.toContain(session.userId);
    expect(() => feedbackScope(session, "short")).toThrow();
  });
  it("exposes only an explicitly supplied commit-shaped build version", () => {
    vi.stubEnv("STARDUST_BUILD_VERSION", "ABCDEF1234567");
    expect(feedbackBuildVersion()).toBe("abcdef1234567");
    for (const value of ["private/server/path", "secret=12345678", "", "latest"]) {
      vi.stubEnv("STARDUST_BUILD_VERSION", value); expect(feedbackBuildVersion()).toBeNull();
    }
  });
});
