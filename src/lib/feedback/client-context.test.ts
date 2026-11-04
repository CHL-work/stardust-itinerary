import { describe, expect, it } from "vitest";
import { coarseFeedbackEnvironment, FeedbackTrail, feedbackPageForPath, announceFeedbackContext, clearFeedbackContext, verifyFeedbackContext, getFeedbackContext } from "./client-context";
import { feedbackCopy, feedbackActionLabel } from "./i18n";
import { FEEDBACK_ACTIVITY_WINDOW_MS, feedbackActions, feedbackPages } from "./contracts";
import { locales } from "@/lib/i18n";

describe("private feedback diagnostic trail", () => {
  const scope = { tripId: "trip-a", memberId: "member-a" };
  it("records nothing before a scope is established", () => {
    const trail = new FeedbackTrail(); trail.record("navigate"); expect(trail.snapshot()).toEqual([]);
  });
  it("bounds the trail to 50 actions and 10 minutes without retaining arbitrary data", () => {
    const trail = new FeedbackTrail(); trail.setScope(scope);
    for (let index = 0; index < 70; index++) trail.record("event_edit", index * 1000);
    const snapshot = trail.snapshot(70_000);
    expect(snapshot).toHaveLength(50);
    expect(Object.keys(snapshot[0]).sort()).toEqual(["action", "at", "page"]);
    trail.record("private event title or token", 70_000);
    trail.record("navigate", 70_000, "/trip/private-id?token=secret");
    expect(trail.snapshot(70_000)).toHaveLength(50);
    expect(trail.snapshot(700_000)).toEqual([]);
  });
  it("includes the exact ten-minute boundary but excludes older actions", () => {
    expect(FEEDBACK_ACTIVITY_WINDOW_MS).toBe(10 * 60_000);
    const trail = new FeedbackTrail(); trail.setScope(scope);
    const now = Date.parse("2030-04-01T12:00:00.000Z");
    trail.record("event_open", now - FEEDBACK_ACTIVITY_WINDOW_MS - 1);
    trail.record("event_edit", now - FEEDBACK_ACTIVITY_WINDOW_MS);
    trail.record("event_save", now - FEEDBACK_ACTIVITY_WINDOW_MS + 1);
    expect(trail.snapshot(now).map(item => item.action)).toEqual(["event_edit", "event_save"]);
    expect(trail.snapshot(now + 1).map(item => item.action)).toEqual(["event_save"]);
  });
  it("preserves the existing one-minute future-clock tolerance", () => {
    const trail = new FeedbackTrail(); trail.setScope(scope);
    const now = Date.parse("2030-04-01T12:00:00.000Z");
    trail.record("event_open", now + 60_000);
    trail.record("event_save", now + 60_001);
    expect(trail.snapshot(now).map(item => item.action)).toEqual(["event_open"]);
  });
  it("clears on trip, identity and logout boundaries, but not a normal rerender", () => {
    const trail = new FeedbackTrail(); trail.setScope(scope); trail.record("event_edit", 1000);
    trail.setScope({ ...scope }); expect(trail.snapshot(1000)).toHaveLength(1);
    trail.setScope({ ...scope, tripId: "trip-b" }); expect(trail.snapshot(1000)).toHaveLength(0);
    trail.record("event_save", 2000); trail.setScope({ ...scope, memberId: "member-b" }); expect(trail.snapshot(2000)).toHaveLength(0);
    trail.record("event_save", 2000); trail.setScope(null); expect(trail.snapshot(2000)).toHaveLength(0);
  });
  it("returns copies, not mutable references to the stored history", () => {
    const trail = new FeedbackTrail(); trail.setScope(scope); trail.record("navigate", 1000);
    trail.snapshot(1000)[0].page = "ai"; expect(trail.snapshot(1000)[0].page).toBe("other");
  });
  it("cannot resurrect cleared auth from a stale AppShell announcement", () => {
    const value = { ...scope, locale: "en" as const, page: "today" as const };
    verifyFeedbackContext(value); clearFeedbackContext(); announceFeedbackContext(value);
    expect(getFeedbackContext()).toBeNull(); verifyFeedbackContext(value); expect(getFeedbackContext()?.tripId).toBe(scope.tripId);
    clearFeedbackContext();
  });
  it("reduces paths and user agents to strict coarse categories", () => {
    expect(feedbackPageForPath("/zh-HK-lihkg/auth/login?token=private#secret")).toBe("login");
    expect(feedbackPageForPath("/join/private-invitation-token")).toBe("join");
    expect(feedbackPageForPath("/private-title/user@gmail.com")).toBe("other");
    expect(coarseFeedbackEnvironment("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0) AppleWebKit Safari/605", 390, true)).toEqual({ osFamily: "ios", browserFamily: "safari", formFactor: "phone", online: true });
    expect(coarseFeedbackEnvironment("Windows Chrome/148 Edg/148 private-text", 1440, false)).toEqual({ osFamily: "windows", browserFamily: "edge", formFactor: "desktop", online: false });
  });
  it("localizes every page and action without rendering user content", () => {
    for (const locale of locales) {
      for (const page of feedbackPages) expect(feedbackCopy[locale].pages[page].length).toBeGreaterThan(0);
      for (const action of feedbackActions) expect(feedbackActionLabel(action, locale).length).toBeGreaterThan(0);
    }
  });
});
