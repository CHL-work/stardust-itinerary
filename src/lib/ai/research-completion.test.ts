import { describe, expect, it } from "vitest";
import { locales } from "@/lib/i18n";
import { researchCompletionNotice, type ResearchCompletionFailure } from "@/lib/ai/research-completion";

describe("truthful research completion feedback", () => {
  it.each(locales)("gives distinct neutral %s completion reasons without blaming evidence", (locale) => {
    const options = { locale, timeZone: "Asia/Tokyo", isOwner: true };
    const reasons: ResearchCompletionFailure[] = ["budget_exhausted", "timeout", "additional_research", "failed"];
    const notes = reasons.map(reason => researchCompletionNotice(reason, options));
    expect(new Set(notes).size).toBe(4);
    for (const note of notes) {
      expect(note).not.toMatch(/⚠|required public-fact check|未能完成所需公開資料|必要な公開情報の確認/u);
      expect(note.length).toBeGreaterThan(20);
      expect(note).not.toContain("undefined");
    }
  });
  it.each(locales)("retains safe typed provider feedback in %s", (locale) => {
    const note = researchCompletionNotice("provider_failed", { locale, timeZone: "Asia/Tokyo", isOwner: true,
      providerFailure: { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2030-04-01T03:00:00.000Z" } });
    expect(note).toContain("Anthropic (Claude)");
    expect(note).toContain("Asia/Tokyo");
    expect(note).not.toContain("required public-fact check");
  });
  it("keeps both Cantonese tone modes neutral", () => {
    const options = { timeZone: "Asia/Tokyo", isOwner: false };
    expect(researchCompletionNotice("timeout", { ...options, locale: "zh-HK-lihkg" }))
      .toBe(researchCompletionNotice("timeout", { ...options, locale: "zh-HK" }));
  });
});
