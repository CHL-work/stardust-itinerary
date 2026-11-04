import { FEEDBACK_ACTIVITY_WINDOW_MS, feedbackActions, feedbackPages, type FeedbackAction, type FeedbackBreadcrumb, type FeedbackDiagnostics, type FeedbackPage } from "./contracts";

export type FeedbackClientContext = { tripId: string; memberId: string; page: FeedbackPage; locale: FeedbackDiagnostics["locale"] };
export const FEEDBACK_CONTEXT_EVENT = "stardust-feedback-context";

/** Content-free diagnostics only. Never persisted to browser storage or uploaded until submission. */
export class FeedbackTrail {
  private identity: string | null = null;
  private items: FeedbackBreadcrumb[] = [];
  page: FeedbackPage = "other";
  setScope(scope: Pick<FeedbackClientContext, "tripId" | "memberId"> | null) {
    const next = scope ? `${scope.tripId}:${scope.memberId}` : null;
    const changed = next !== this.identity;
    if (changed || !next) this.items = [];
    this.identity = next;
    return changed;
  }
  record(action: string, now = Date.now(), page: string = this.page) {
    if (!this.identity || !feedbackActions.includes(action as FeedbackAction) || !feedbackPages.includes(page as FeedbackPage)) return;
    this.items = this.snapshot(now);
    this.items.push({ action: action as FeedbackAction, page: page as FeedbackPage, at: new Date(now).toISOString() });
    this.items = this.items.slice(-50);
  }
  snapshot(now = Date.now()): FeedbackBreadcrumb[] {
    return this.items.filter(item => Date.parse(item.at) >= now - FEEDBACK_ACTIVITY_WINDOW_MS && Date.parse(item.at) <= now + 60_000).map(item => ({ ...item }));
  }
}

export const feedbackTrail = new FeedbackTrail();
let context: FeedbackClientContext | null = null;
let needsVerification = false;
export function getFeedbackContext() { return context; }
export function announceFeedbackContext(next: FeedbackClientContext) {
  if (needsVerification) return;
  feedbackTrail.setScope(next);
  const pageChanged = context?.page !== next.page;
  context = { ...next };
  feedbackTrail.page = next.page;
  if (pageChanged) feedbackTrail.record("navigate");
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FEEDBACK_CONTEXT_EVENT));
}
export function clearFeedbackContext() {
  needsVerification = true;
  context = null;
  feedbackTrail.setScope(null);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FEEDBACK_CONTEXT_EVENT));
}
export function verifyFeedbackContext(next: FeedbackClientContext) {
  needsVerification = false;
  announceFeedbackContext(next);
}

/** Do not retain full routes, query strings, identifiers or fragments. */
export function feedbackPageForPath(path: string): FeedbackPage {
  const parts = path.split(/[?#]/, 1)[0].split("/").filter(Boolean);
  if (["en", "zh-HK", "zh-HK-lihkg", "ja-JP"].includes(parts[0])) parts.shift();
  const page = parts[0];
  if (page === "auth") return "login";
  return ["login", "join", "onboarding", "privacy", "terms"].includes(page) ? page as FeedbackPage : "other";
}

export function coarseFeedbackEnvironment(userAgent: string, width: number, online: boolean): Pick<FeedbackDiagnostics, "formFactor" | "osFamily" | "browserFamily" | "online"> {
  const ua = userAgent.toLowerCase();
  const osFamily = /iphone|ipad|ipod/.test(ua) ? "ios" : /android/.test(ua) ? "android" : /windows/.test(ua) ? "windows" : /macintosh|mac os/.test(ua) ? "macos" : /linux/.test(ua) ? "linux" : "other";
  const browserFamily = /edg[ea]?\//.test(ua) ? "edge" : /firefox|fxios/.test(ua) ? "firefox" : /chrome|crios/.test(ua) ? "chrome" : /safari/.test(ua) ? "safari" : "other";
  return { osFamily, browserFamily, formFactor: width <= 0 ? "unknown" : width < 768 ? "phone" : width < 1024 ? "tablet" : "desktop", online };
}
