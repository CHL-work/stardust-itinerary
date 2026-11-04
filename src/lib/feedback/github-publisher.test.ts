import { beforeEach, describe, expect, it, vi } from "vitest";
import { postFeedbackIssue, reconcileFeedbackIssue, type IssuePayload } from "./github-publisher";
import { issuePayloadHash, renderFeedbackIssue } from "./review-contract";

const id = "a173e4d4-ae74-40f1-b31e-0864cd8c1a30";
const content = renderFeedbackIssue(id, { key: "R1", title: "Save fails", description: "Save fails", kind: "bug", environment: "phone", actions: [], build: null },
  { key: "R1", decision: "issue", duplicateKey: null, title: "Save fails", evidence: ["Save fails"], reproductionSteps: [], expected: "", actual: "Save fails", hypotheses: [], missingInformation: [] });
const payload: IssuePayload = { id, ...content, payloadHash: issuePayloadHash(content.title, content.body) };
const issue = { number: 123, html_url: "https://github.com/CHL-work/stardust-itinerary/issues/123", ...content };
const request = vi.fn<typeof fetch>();
beforeEach(() => { request.mockReset(); });
describe("restricted GitHub publisher", () => {
  it("creates only the fixed-repository title/body and accepts exact201 receipt", async () => {
    request.mockResolvedValue(Response.json(issue, { status: 201 }));
    expect(await postFeedbackIssue(payload, "synthetic-credential", request)).toEqual({ state: "published", receipt: { number: 123, url: issue.html_url } });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/CHL-work/stardust-itinerary/issues");
    expect(options).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(String(options!.body))).toEqual(content);
    expect(String(options!.body)).not.toContain("synthetic-credential");
  });
  it.each([500, 502, 302, 200])("treats status %i as uncertain without retries", async (status) => {
    request.mockResolvedValue(new Response("private remote failure", { status }));
    expect(await postFeedbackIssue(payload, "secret", request)).toMatchObject({ state: "uncertain" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 422, 429])("blocks definitive %i without another POST", async (status) => {
    request.mockResolvedValue(new Response("private", { status }));
    expect(await postFeedbackIssue(payload, "secret", request)).toMatchObject({ state: "blocked" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("network ambiguity is safe and raw exception content never escapes", async () => {
    request.mockRejectedValue(new Error("credential and private data"));
    expect(await postFeedbackIssue(payload, "secret", request)).toEqual({ state: "uncertain", errorCode: "delivery_uncertain" });
  });
  it("reconciles exact opaque marker/title/body using GET only", async () => {
    request.mockResolvedValue(Response.json([issue]));
    expect(await reconcileFeedbackIssue(payload, "secret", request)).toMatchObject({ state: "published" });
    expect(request.mock.calls.every(([url, opts]) => String(url).startsWith("https://api.github.com/repos/CHL-work/stardust-itinerary/issues?") && opts?.method === "GET")).toBe(true);
  });
  it("rejects foreign repos, PRs and edited/copied marker payloads", async () => {
    request.mockResolvedValue(Response.json([{ ...issue, html_url: "https://github.com/evil/repo/issues/123" }, { ...issue, pull_request: {} }, { ...issue, body: `${issue.body} tampered` }]));
    expect(await reconcileFeedbackIssue(payload, "secret", request)).toMatchObject({ state: "uncertain" });
  });
  it("caps reconciliation at three pages and never follows arbitrary Link headers", async () => {
    request.mockImplementation(async () => Response.json(Array.from({ length: 100 }, () => ({ number: 1 })), { headers: { Link: '<https://evil.test>; rel="next"' } }));
    expect(await reconcileFeedbackIssue(payload, "secret", request)).toMatchObject({ state: "uncertain" });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("rejects malformed/oversized responses and missing/tampered payload before dispatch", async () => {
    request.mockResolvedValue(new Response("{}", { status: 201, headers: { "content-length": "1000001" } }));
    expect(await postFeedbackIssue(payload, "secret", request)).toMatchObject({ state: "uncertain" });
    request.mockClear();
    await expect(postFeedbackIssue({ ...payload, body: "changed" }, "secret", request)).rejects.toThrow();
    await expect(postFeedbackIssue(payload, "", request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
