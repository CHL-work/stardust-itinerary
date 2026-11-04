import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), origin: vi.fn(), submit: vi.fn(), list: vi.fn(), context: vi.fn(), operator: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => ({ authSecret: "synthetic-secret".repeat(4) }) }));
vi.mock("@/lib/auth/web", () => ({ requireAuthenticatedSession: mocks.session, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/db/pool", () => ({ getPool: () => ({ synthetic: true }) }));
vi.mock("@/lib/feedback/repository", async (original) => ({ ...await original<typeof import("@/lib/feedback/repository")>(),
  submitFeedback: mocks.submit, listSelfFeedback: mocks.list, getFeedbackContext: mocks.context,
  listOperatorFeedback: mocks.operator, getFeedbackOperatorStatus: mocks.status }));
import { POST, GET } from "@/app/api/feedback/route";
import { GET as contextGET } from "@/app/api/feedback/context/route";
import { GET as operatorGET } from "@/app/api/feedback/operator/route";
import { FeedbackPolicyChangedError, FeedbackRateLimitError, FeedbackScopeChangedError } from "@/lib/feedback/repository";
import { AppForbiddenError } from "@/lib/app/repository";
import { SessionUnavailableError } from "@/lib/auth/errors";
const input = { scope: { tripId: "10000000-0000-4000-8000-000000000001", memberId: "20000000-0000-4000-8000-000000000001", scopeKey: "a".repeat(64) },
  clientRequestId: "40000000-0000-4000-8000-000000000001", title: "Synthetic bug", description: "Synthetic action failed", kind: "bug", allowIssuePublication: true };
const report = { id: "50000000-0000-4000-8000-000000000001", status: "queued", createdAt: "2030-04-01T00:00:00Z", title: input.title, kind: input.kind, allowIssuePublication: true };
const request = (body: unknown = input) => new NextRequest("http://localhost:3100/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ synthetic: "session" }); mocks.origin.mockReturnValue(undefined);
  mocks.submit.mockResolvedValue({ report, replayed: false }); mocks.list.mockResolvedValue([report]); mocks.context.mockResolvedValue({ scope: input.scope, isOperator: false, buildVersion: null }); });
describe("feedback HTTP privacy and admission", () => {
  it("returns durable receipt and private cache headers; exact retry returns200", async () => {
    const result = await POST(request());
    expect(result.status).toBe(201); expect(await result.json()).toEqual({ report, replayed: false });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.origin).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledWith({ synthetic: true }, { synthetic: "session" }, input, "synthetic-secret".repeat(4));
    mocks.submit.mockResolvedValueOnce({ report, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it("requires login and same-origin before reading or saving a body", async () => {
    mocks.session.mockRejectedValueOnce(new SessionUnavailableError("Sign in first."));
    expect((await POST(request())).status).toBe(401); expect(mocks.submit).not.toHaveBeenCalled();
    mocks.origin.mockImplementationOnce(() => { throw new AppForbiddenError("Origin rejected"); });
    expect((await POST(request())).status).toBe(403); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["invalid json", "x".repeat(65537), { ...input, arbitraryPrivateField: "private content" }])("rejects bad or oversized body without echoing raw diagnostics %#", async (body) => {
    const result = await POST(request(body)); expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "The feedback values are invalid.", code: "FEEDBACK_INVALID" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("returns localized-client-safe scope and rate errors", async () => {
    mocks.submit.mockRejectedValueOnce(new FeedbackScopeChangedError());
    const scope = await POST(request()); expect(scope.status).toBe(409); expect((await scope.json()).code).toBe("FEEDBACK_SCOPE_CHANGED");
    mocks.submit.mockRejectedValueOnce(new FeedbackRateLimitError(60));
    const rate = await POST(request()); expect(rate.status).toBe(429); expect(rate.headers.get("retry-after")).toBe("60");
  });
  it("returns a distinct no-store refresh precondition for stale declined submissions", async () => {
    const staleInput = { ...input, allowIssuePublication: false };
    mocks.submit.mockRejectedValueOnce(new FeedbackPolicyChangedError());
    const result = await POST(request(staleInput));
    // Old clients clear drafts on 409; this must remain a different status.
    expect(result.status).toBe(428);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ code: "FEEDBACK_POLICY_CHANGED",
      error: "Refresh the page to review the updated feedback policy before sending a new report." });
    expect(mocks.submit).toHaveBeenCalledWith({ synthetic: true }, { synthetic: "session" }, staleInput, "synthetic-secret".repeat(4));
  });
  it("returns historical declined receipts unchanged for exact retries", async () => {
    const historicalReport = { ...report, allowIssuePublication: false };
    mocks.submit.mockResolvedValueOnce({ report: historicalReport, replayed: true });
    const result = await POST(request({ ...input, allowIssuePublication: false }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ report: historicalReport, replayed: true });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns self receipts and context without actor email or raw identity", async () => {
    expect(await (await GET(new NextRequest("http://localhost:3100/api/feedback"))).json()).toEqual({ reports: [report] });
    expect(await (await contextGET(new NextRequest("http://localhost:3100/api/feedback/context"))).json()).toEqual({ scope: input.scope, isOperator: false, buildVersion: null });
  });
  it("does not turn an ordinary owner into a private report operator", async () => {
    mocks.operator.mockRejectedValueOnce(new AppForbiddenError("Operator only"));
    expect((await operatorGET(new NextRequest("http://localhost:3100/api/feedback/operator"))).status).toBe(403);
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
