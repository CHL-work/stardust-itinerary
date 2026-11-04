import { describe, expect, it } from "vitest";
import type { PlanningDraft } from "@/lib/ai/planning-draft";
import {
  anchorPlanningDraft, planningDraftEvidence, previousDraftRelativeDate,
} from "@/lib/ai/planning-draft-context";

function draft(content: string): PlanningDraft {
  return {
    rootRequestId: "root", sourceRequestIds: ["root"], expiresAt: "2026-09-03T02:00:00Z",
    version: 6, legacy: false,
    userRequests: [{ requestId: "root", content, createdAt: "2026-09-02T02:00:00Z",
      referenceTime: { tripLocalDate: "2026-09-02", tomorrowLocalDate: "2026-09-03" } }],
  };
}

describe("planning draft context", () => {
  it.each(["tomorrow", "聽日", "明日", "明天"])("anchors %s to its source turn, not the follow-up date", (word) => {
    const source = draft(`Create dinner ${word}`);
    expect(anchorPlanningDraft(source).userRequests[0]?.content).toBe("Create dinner 2026-09-03");
    expect(previousDraftRelativeDate(source, "DDB 找數")).toBe("2026-09-03");
    expect(source.userRequests[0]?.content).toContain(word);
  });

  it.each(["today", "tonight", "今日", "今晚", "今晩"])("anchors %s without modifying the stored source", (word) => {
    const source = draft(`Create dinner ${word}`);
    expect(anchorPlanningDraft(source).userRequests[0]?.content).toBe("Create dinner 2026-09-02");
    expect(previousDraftRelativeDate(source, "DDB 找數")).toBe("2026-09-02");
  });

  it.each(["tomorrow", "9/4", "9月4日", "Check-in 2026-09-04"])("lets current date clarification supersede the saved relative date: %s", (answer) => {
    expect(previousDraftRelativeDate(draft("Create hotel tomorrow"), answer)).toBeNull();
  });

  it("does not force a multi-day batch onto one relative day", () => {
    expect(previousDraftRelativeDate(draft("Create dinner today and lunch tomorrow"), "DDB 找數")).toBeNull();
  });

  it("uses only selected user sources and current answer as financial evidence", () => {
    expect(planningDraftEvidence(draft("Create hotel with expense shared with Guest"), "DDB 找數"))
      .toBe("Create hotel with expense shared with Guest\n<user-clarification-boundary>\nDDB 找數");
    expect(planningDraftEvidence(null, "DDB 找數")).toBe("DDB 找數");
  });
});
