import { timingSafeEqual } from "node:crypto";
import { issueMarker, issuePayloadHash, sanitizeFeedbackText, unsafeFeedbackInstructions } from "./review-contract";

export type IssuePayload = { id: string; title: string; body: string; payloadHash: Buffer };
export type IssueReceipt = { number: number; url: string };
export type DeliveryOutcome = { state: "published"; receipt: IssueReceipt } | { state: "uncertain" | "blocked"; errorCode: string };
/** Where issues go: `owner/name` of a repository GitHub reported as private, and the publisher's token. */
export type FeedbackTarget = { repository: string; token: string };
type Fetch = typeof fetch;

const REPOSITORY_FORMAT = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u;

/** `STARDUST_FEEDBACK_REPOSITORY` as `owner/name`, or null when unset or malformed. */
export function feedbackRepository(value: string | undefined): string | null {
  const repository = value?.trim();
  return repository && REPOSITORY_FORMAT.test(repository) && !repository.split("/")[1]!.startsWith(".") ? repository : null;
}

export function validateIssuePayload(payload: IssuePayload): void {
  const marker = issueMarker(payload.id);
  if (payload.title.length < 1 || payload.title.length > 160 || payload.body.length > 12_000
    || !payload.body.endsWith(marker) || payload.body.indexOf(marker) !== payload.body.lastIndexOf(marker)
    || payload.payloadHash.length !== 32 || !timingSafeEqual(issuePayloadHash(payload.title, payload.body), payload.payloadHash)) throw new Error("payload_invalid");
  const unmarked = payload.body.slice(0, -marker.length);
  // Markdown headings/newlines are application-owned; all free text remains inert.
  const plain = unmarked.replace(/\n/gu, " ").replace(/\s+/gu, " ").trim();
  if (sanitizeFeedbackText(payload.title) !== payload.title || sanitizeFeedbackText(plain, [], 16_000) !== plain
    || unsafeFeedbackInstructions(payload.title) || unsafeFeedbackInstructions(unmarked)) throw new Error("payload_invalid");
}
function credential(token: string): string {
  if (!token.trim() || token.length > 500 || /\s/u.test(token)) throw new Error("token_missing");
  return token;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > 1_000_000 || !response.body) throw new Error("response_invalid");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new Error("response_invalid");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); }
}
function receipt(value: unknown, payload: IssuePayload, repository: string): IssueReceipt | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.pull_request || !Number.isSafeInteger(row.number) || Number(row.number) < 1 || row.title !== payload.title || row.body !== payload.body) return null;
  const url = `https://github.com/${repository}/issues/${row.number}`;
  return row.html_url === url ? { number: Number(row.number), url } : null;
}
function headers(token: string): Record<string, string> {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${credential(token)}`,
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "stardust-feedback-publisher" };
}

export type RepositoryCheck = { state: "private"; repository: string } | { state: "refused"; errorCode: string };

/**
 * Feedback can quote what users wrote, so issues go only to a private repository. Before any
 * delivery, ask GitHub with the publisher's own token whether the configured repository is private,
 * not archived, and takes issues. Its canonical `owner/name` is used for every later request and
 * receipt. Anything else refuses publishing for this run, and queued issues stay queued.
 */
export async function verifyPrivateFeedbackRepository(target: FeedbackTarget, request: Fetch = fetch): Promise<RepositoryCheck> {
  const repository = feedbackRepository(target.repository);
  if (!repository) return { state: "refused", errorCode: "repository_invalid" };
  const authorization = headers(target.token);
  try {
    const response = await request(`https://api.github.com/repos/${repository}`,
      { method: "GET", headers: authorization, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { state: "refused", errorCode: response.status === 401 ? "credential_rejected"
        : response.status === 403 || response.status === 404 ? "repository_unavailable" : "delivery_uncertain" };
    }
    const row = await boundedJson(response);
    if (!row || typeof row !== "object" || Array.isArray(row)) return { state: "refused", errorCode: "response_invalid" };
    const value = row as Record<string, unknown>;
    if (typeof value.full_name !== "string" || value.full_name.toLowerCase() !== repository.toLowerCase()
      || !feedbackRepository(value.full_name)) return { state: "refused", errorCode: "response_invalid" };
    // "internal" repositories are visible to a whole enterprise, so only "private" counts.
    if (value.private !== true || value.visibility !== "private") return { state: "refused", errorCode: "repository_public" };
    if (value.has_issues !== true || value.archived === true || value.disabled === true) return { state: "refused", errorCode: "issues_unavailable" };
    return { state: "private", repository: value.full_name };
  } catch { return { state: "refused", errorCode: "delivery_uncertain" }; }
}

/**
 * Caller must durably mark the only automatic POST attempt BEFORE calling this, and pass a target
 * from `verifyPrivateFeedbackRepository`.
 */
export async function postFeedbackIssue(payload: IssuePayload, target: FeedbackTarget, request: Fetch = fetch): Promise<DeliveryOutcome> {
  validateIssuePayload(payload);
  const authorization = headers(target.token);
  try {
    const response = await request(`https://api.github.com/repos/${target.repository}/issues`, { method: "POST", headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ title: payload.title, body: payload.body }), redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (response.status === 201) {
      const found = receipt(await boundedJson(response), payload, target.repository);
      return found ? { state: "published", receipt: found } : { state: "uncertain", errorCode: "response_invalid" };
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 500 || response.status < 400) return { state: "uncertain", errorCode: "delivery_uncertain" };
    return { state: "blocked", errorCode: response.status === 401 ? "credential_rejected"
      : response.status === 403 ? "permission_denied" : response.status === 429 ? "rate_limited" : "response_invalid" };
  } catch { return { state: "uncertain", errorCode: "delivery_uncertain" }; }
}

/** No search API, redirects, comments, edits or arbitrary URLs. At most three pages of the verified repository. */
export async function reconcileFeedbackIssue(payload: IssuePayload, target: FeedbackTarget, request: Fetch = fetch): Promise<DeliveryOutcome> {
  validateIssuePayload(payload);
  const authorization = headers(target.token);
  try {
    for (let page = 1; page <= 3; page += 1) {
      const response = await request(`https://api.github.com/repos/${target.repository}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
        { method: "GET", headers: authorization, redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { state: "uncertain", errorCode: "delivery_uncertain" }; }
      const rows = await boundedJson(response);
      if (!Array.isArray(rows) || rows.length > 100) return { state: "uncertain", errorCode: "response_invalid" };
      const matches = rows.map((row) => receipt(row, payload, target.repository)).filter((row): row is IssueReceipt => row !== null);
      if (matches.length === 1) return { state: "published", receipt: matches[0]! };
      if (matches.length > 1) return { state: "blocked", errorCode: "response_invalid" };
      if (rows.length < 100) break;
    }
    return { state: "uncertain", errorCode: "delivery_uncertain" };
  } catch { return { state: "uncertain", errorCode: "delivery_uncertain" }; }
}
