import { describe, expect, it } from "vitest";

import {
  disruptionDetailLocale,
  parseLocalizedDisruptionDetails,
  selectLocalizedDisruptionDetail,
} from "@/lib/disruptions/localization";
import { locales } from "@/lib/i18n";

const details = {
  en: "The venue may open later. Check the official notice.",
  "zh-HK": "場地可能延遲開門，請查看官方公告。",
  "ja-JP": "開場が遅れる可能性があります。公式のお知らせをご確認ください。",
};

describe("disruption detail localization", () => {
  it.each(locales)("selects the stored %s detail without translating or mutating evidence", (locale) => {
    const snapshot = JSON.stringify(details);
    expect(selectLocalizedDisruptionDetail(details, locale)).toBe(details[disruptionDetailLocale(locale)]);
    expect(JSON.stringify(details)).toBe(snapshot);
  });

  it("uses the same neutral Cantonese safety body for both Cantonese modes", () => {
    expect(disruptionDetailLocale("zh-HK-lihkg")).toBe("zh-HK");
    expect(selectLocalizedDisruptionDetail(details, "zh-HK-lihkg"))
      .toBe(selectLocalizedDisruptionDetail(details, "zh-HK"));
  });

  it.each([
    undefined, null, "legacy English detail", [], {},
    { en: "Only English" },
    { ...details, "zh-HK": " " },
    { ...details, "ja-JP": null },
    { ...details, en: "x".repeat(801) },
    { ...details, extra: "unapproved field" },
    Object.assign(Object.create(details), { a: "one", b: "two", c: "three" }),
  ])("returns no translation for incomplete or malformed stored details (%#)", (value) => {
    expect(parseLocalizedDisruptionDetails(value)).toBeNull();
    expect(selectLocalizedDisruptionDetail(value, "zh-HK")).toBeNull();
  });

  it("trims display whitespace and accepts the exact supported bound", () => {
    expect(parseLocalizedDisruptionDetails({ ...details, en: " Original translation " })?.en)
      .toBe("Original translation");
    expect(parseLocalizedDisruptionDetails({ ...details, en: "x".repeat(800) })?.en).toHaveLength(800);
  });
});
