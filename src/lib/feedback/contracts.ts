import { z } from "zod";
import { locales } from "@/lib/i18n";

export const FEEDBACK_ACTIVITY_WINDOW_MS = 10 * 60_000;

export const feedbackPages = ["today", "itinerary", "expenses", "ai", "requests", "settings", "permissions", "usage", "activity", "login", "join", "onboarding", "privacy", "terms", "other"] as const;
export const feedbackActions = ["navigate", "dialog_open", "dialog_close", "event_open", "event_edit", "event_save", "event_cancel", "event_remove", "event_approve", "event_reject", "expense_open", "expense_edit", "expense_save", "expense_review", "expense_approve", "expense_reject", "repayment_submit", "calendar_connect", "calendar_sync", "calendar_refresh", "ai_submit", "ai_complete", "ai_error", "ai_new", "ai_resume", "trip_switch", "request_error", "feedback_open", "feedback_submit", "login", "logout", "page_view", "form_submit", "client_error", "locale_change", "settings_save", "member_invite", "member_change", "feedback_retry", "button"] as const;
export const feedbackStatuses = ["queued", "triaged", "ignored", "published"] as const;
export type FeedbackPage = typeof feedbackPages[number];
export type FeedbackAction = typeof feedbackActions[number];
export type FeedbackStatus = typeof feedbackStatuses[number];

export const feedbackBreadcrumbSchema = z.strictObject({
  page: z.enum(feedbackPages), action: z.enum(feedbackActions), at: z.iso.datetime({ offset: true }),
});
export const feedbackDiagnosticsSchema = z.strictObject({
  page: z.enum(feedbackPages), locale: z.enum(locales),
  formFactor: z.enum(["phone", "tablet", "desktop", "unknown"]),
  osFamily: z.enum(["windows", "macos", "ios", "android", "linux", "other"]),
  browserFamily: z.enum(["chrome", "edge", "firefox", "safari", "other"]), online: z.boolean(),
  breadcrumbs: z.array(feedbackBreadcrumbSchema).max(50),
});
export const feedbackScopeSchema = z.strictObject({ tripId: z.uuid(), memberId: z.uuid(), scopeKey: z.string().regex(/^[a-f0-9]{64}$/u) });
export type FeedbackScope = z.infer<typeof feedbackScopeSchema>;
export const feedbackSubmissionSchema = z.strictObject({
  scope: feedbackScopeSchema,
  clientRequestId: z.uuid(), title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(6000), kind: z.enum(["bug", "feedback"]),
  allowIssuePublication: z.boolean(), diagnostics: feedbackDiagnosticsSchema.optional(),
});
export type FeedbackBreadcrumb = z.infer<typeof feedbackBreadcrumbSchema>;
export type FeedbackDiagnostics = z.infer<typeof feedbackDiagnosticsSchema>;
export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;
export type FeedbackReceipt = {
  id: string; status: FeedbackStatus; createdAt: string; title: string; kind: "bug" | "feedback";
  allowIssuePublication: boolean;
};
export type FeedbackSubmissionResult = { report: FeedbackReceipt; replayed: boolean };
export type FeedbackContext = { scope: FeedbackScope; isOperator: boolean; buildVersion: string | null };
export type PrivateFeedbackReport = FeedbackReceipt & { description: string; diagnostics: FeedbackDiagnostics | null;
  buildVersion: string | null; tripId: string; actorMemberId: string; actorUserId: string };
export type FeedbackOperatorStatus = {
  configuration: { triageConfigured: boolean; publishingConfigured: boolean };
  queue: { reports: number; queuedIssues: number; uncertainIssues: number; blockedIssues: number; publishedIssues: number };
  lastRun: { runDate: string; state: "queued" | "running" | "succeeded" | "failed"; attemptCount: number; startedAt: string | null;
    completedAt: string | null; model: "gpt-6-astra"; effort: "medium"; errorCode: string | null } | null;
};
