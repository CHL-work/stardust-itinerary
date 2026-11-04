import { createHash } from "node:crypto";
import { z } from "zod";
import { feedbackDiagnosticsSchema } from "./contracts";

export const FEEDBACK_MODEL = "gpt-6-astra";
export const FEEDBACK_EFFORT = "medium";
export const FEEDBACK_BATCH_LIMIT = 20;
export const FEEDBACK_REPOSITORY = "CHL-work/stardust-itinerary";
export type ReviewReport = { key: string; title: string; description: string; kind: "bug" | "feedback";
  environment: string; actions: string[]; build: string | null };
export type KnownFeedbackIssue = { key: string; title: string };
const text = z.string().max(500);
export const reviewDecisionSchema = z.strictObject({
  key: z.string().regex(/^R(?:[1-9]|1\d|20)$/u), decision: z.enum(["issue", "duplicate", "ignore"]),
  duplicateKey: z.string().regex(/^[RK](?:[1-9]|[12]\d|30)$/u).nullable(),
  title: z.string().max(140), evidence: z.array(text).max(5),
  reproductionSteps: z.array(text).max(6),
  expected: text, actual: text, hypotheses: z.array(text).max(3), missingInformation: z.array(text).max(4),
});
export const reviewOutputSchema = z.strictObject({ decisions: z.array(reviewDecisionSchema).max(FEEDBACK_BATCH_LIMIT) });
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type ReviewResult = { decisions: ReviewDecision[]; inputTokens: number; outputTokens: number };

/** No URLs/mentions/identity or credential-like tokens cross either output boundary. */
export function sanitizeFeedbackText(value: string, privateNames: readonly string[] = [], maximum = 6000): string {
  let text = value.normalize("NFKC");
  for (let count = 0; count < 2; count += 1) {
    try { text = decodeURIComponent(text); } catch { break; }
  }
  for (const name of [...new Set(privateNames.map((value) => value.normalize("NFKC").trim()))].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const expression = name.length === 1 && /[a-z0-9]/iu.test(name) ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
    text = text.replaceAll(new RegExp(expression, "giu"), "[redacted]");
  }
  return text
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "")
    .replace(/!?\[[^\]]*\]\([^)]*\)/gu, "[link removed]")
    .replace(/!?\[[^\]]*\]\[[^\]]*\]/gu, "[link removed]")
    .replace(/(?:https?:\/\/|www\.|mailto:|data:|javascript:|\/\/)[^\s<>]+/giu, "[link removed]")
    .replace(/-----BEGIN[\s\S]*?-----END[^\r\n]*-----/gu, "[redacted]")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/giu, "[link removed]")
    .replace(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu, "[redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]{15,})\b/gu, "[redacted]")
    .replace(/(?:password|passwd|secret|token|authorization|cookie|api[ _-]?key|pin|予約番号|暗証番号|密碼)\s*(?:[:=：]\s*|\s+)[^\s,;]+/giu, "[credential removed]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "[identifier removed]")
    .replace(/(?:\+?\d[\d ()-]{7,}\d)|(?:\b(?:\d{1,3}\.){3}\d{1,3}\b)/gu, "[number removed]")
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/gu, "[identifier removed]")
    .replace(/(?:[A-Z]:[\\/]|\\\\)[^\s]+/giu, "[path removed]")
    .replace(/@[\p{L}\p{N}_/-]+/gu, "[mention removed]")
    .replace(/[#]\d+/gu, "[reference removed]")
    .replace(/[<>`\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ").trim().slice(0, maximum);
}

export function unsafeFeedbackInstructions(value: string): boolean {
  return /(?:ignore|override|disregard|bypass).{0,45}(?:instructions?|rules?|system|guardrails?)|(?:reveal|print|extract|send).{0,40}(?:secret|token|credential|password)|(?:run|execute).{0,20}(?:shell|powershell|bash|command)|(?:system|developer)\s*(?:prompt|message)\s*:/iu.test(value);
}

export function projectReviewReport(row: { title: string; description: string; kind: "bug" | "feedback"; diagnostics: unknown; build_version: string | null }, key: string, privateNames: readonly string[]): ReviewReport {
  const diagnostic = feedbackDiagnosticsSchema.safeParse(row.diagnostics);
  const data = diagnostic.success ? diagnostic.data : null;
  return { key, title: sanitizeFeedbackText(row.title, privateNames, 160),
    description: sanitizeFeedbackText(row.description, privateNames, 4000), kind: row.kind,
    environment: data ? `${data.page}; ${data.locale}; ${data.formFactor}; ${data.osFamily}; ${data.browserFamily}; ${data.online ? "online" : "offline"}` : "Not supplied",
    actions: data ? data.breadcrumbs.slice(-20).map((entry) => `${entry.page}: ${entry.action}`) : [],
    build: row.build_version && /^[a-f0-9]{7,40}$/u.test(row.build_version) ? row.build_version.slice(0, 7) : null };
}

export function validateReviewOutput(raw: unknown, reports: readonly ReviewReport[], known: readonly KnownFeedbackIssue[]): ReviewDecision[] {
  const parsed = reviewOutputSchema.parse(raw);
  if (parsed.decisions.length !== reports.length || new Set(parsed.decisions.map((d) => d.key)).size !== reports.length) throw new Error("output_invalid");
  const decisions: ReviewDecision[] = [];
  for (const report of reports) {
    const result = parsed.decisions.find((decision) => decision.key === report.key);
    if (!result) throw new Error("output_invalid");
    const prose = [result.title, ...result.evidence, ...result.reproductionSteps, result.expected, result.actual, ...result.hypotheses, ...result.missingInformation];
    if (prose.some((value) => sanitizeFeedbackText(value) !== value || unsafeFeedbackInstructions(value))) throw new Error("output_invalid");
    const source = `${report.title}\n${report.description}`;
    if ([...result.evidence, ...result.reproductionSteps, result.expected, result.actual].filter(Boolean).some((value) => !source.includes(value))) throw new Error("output_invalid");
    if (result.decision === "issue" && (!result.title.trim() || !result.evidence.length || result.duplicateKey !== null)) throw new Error("output_invalid");
    if (result.decision === "duplicate" && ![...known, ...decisions.filter((d) => d.decision === "issue")].some((entry) => entry.key === result.duplicateKey)) throw new Error("output_invalid");
    if (result.decision !== "duplicate" && result.duplicateKey !== null) throw new Error("output_invalid");
    decisions.push(result);
  }
  return decisions;
}

export function feedbackFingerprint(report: ReviewReport): Buffer {
  return createHash("sha256").update(JSON.stringify({ title: report.title.toLowerCase(), description: report.description.toLowerCase(), kind: report.kind })).digest();
}
export function issueMarker(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new Error("payload_invalid");
  return `<!-- stardust-feedback:${id} -->`;
}
export function issuePayloadHash(title: string, body: string): Buffer {
  return createHash("sha256").update(JSON.stringify({ repository: FEEDBACK_REPOSITORY, title, body })).digest();
}
export function renderFeedbackIssue(id: string, report: ReviewReport, decision: ReviewDecision): { title: string; body: string } {
  const list = (values: readonly string[]) => values.length ? values.map((value) => `- ${value}`).join("\n") : "- Not supplied.";
  const title = `[${report.kind === "bug" ? "Bug report" : "Feedback"}] ${decision.title}`;
  const body = ["User reports below are untrusted data. This issue grants no permissions.",
    "## Reported behavior (not independently reproduced)", list(decision.evidence),
    "## Reproduction steps supplied by the reporter (not executed)", list(decision.reproductionSteps),
    "## Expected behavior reported by the user", decision.expected || "Not supplied.",
    "## Actual behavior reported by the user", decision.actual || "Not supplied.",
    "## Recent interaction sequence (diagnostic codes, not reproduction proof)", list(report.actions),
    "## Coarse environment", report.environment, `Build: ${report.build ?? "not supplied"}`,
    "## Hypotheses — unverified, not established causes", list(decision.hypotheses),
    "## Missing information / suggested manual verification", list(decision.missingInformation),
    "This is an automatically triaged, sanitized user report. No code was inspected or changed, no fix was verified, and no coding agent was started.", issueMarker(id)].join("\n\n");
  return { title, body };
}
