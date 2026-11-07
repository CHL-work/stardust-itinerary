import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DisruptionDetailBody } from "@/components/app-shell";
import type { EventDisruption } from "@/lib/app/types";
import { disruptionDetailLocale } from "@/lib/disruptions/localization";
import { locales, messages, type Locale } from "@/lib/i18n";

const disruption: EventDisruption = {
  observationId: "observation-synthetic",
  evidenceFingerprint: "unchanged-synthetic-fingerprint",
  state: "possible", reasonCode: "hours_change", severity: "warning",
  detail: "Original source warning text.",
  localizedDetails: {
    en: "Opening may be delayed; verify the official notice.",
    "zh-HK": "開門時間可能延遲，請核對官方公告。",
    "ja-JP": "開場が遅れる可能性があります。公式発表をご確認ください。",
  },
  sourceUrls: ["https://example.org/official-notice"],
  firstSeenAt: "2030-04-01T01:00:00Z",
  lastSeenAt: "2030-04-01T01:05:00Z",
  checkedAt: "2030-04-01T01:05:00Z",
  staleAfter: "2030-04-01T02:05:00Z",
};

function render(locale: Locale, warning: EventDisruption = disruption): string {
  return renderToStaticMarkup(createElement(DisruptionDetailBody, {
    disruption: warning, locale, messages: messages[locale], timeZone: "Asia/Tokyo",
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("selected-language disruption body", () => {
  it.each(locales)("renders %s detail with the original reason, source and checked time", (locale) => {
    const html = render(locale);
    const detailLocale = disruptionDetailLocale(locale);
    expect(html).toContain(`<p lang="${detailLocale}">${disruption.localizedDetails![detailLocale]}</p>`);
    expect(html).not.toContain(disruption.detail);
    expect(html).not.toContain(messages[locale].disruptionTranslationUnavailable);
    expect(html).toContain(messages[locale].disruptionHours);
    expect(html).toContain(messages[locale].disruptionSources);
    expect(html).toContain('href="https://example.org/official-notice"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toMatch(/10[:.]05/u);
    expect(html).toContain(messages[locale].disruptionPossibleNotice);
  });

  it.each(["zh-HK", "zh-HK-lihkg", "ja-JP"] as const)("labels missing %s translation and collapses the source original", (locale) => {
    const html = render(locale, { ...disruption, localizedDetails: null });
    expect(html).toContain(messages[locale].disruptionTranslationUnavailable);
    expect(html).toContain(`<details><summary>${messages[locale].disruptionOriginalText}</summary><p>${disruption.detail}</p></details>`);
    expect(html).not.toContain("<details open");
    expect(html.split("<details>")[0]).not.toContain(disruption.detail);
    expect(html).not.toContain(`<p lang="${locale}">${disruption.detail}</p>`);
    expect(html).toContain('href="https://example.org/official-notice"');
  });

  it("keeps legacy English readable but explicitly labels it as original rather than translated", () => {
    const html = render("en", { ...disruption, localizedDetails: undefined });
    expect(html).toContain(messages.en.disruptionOriginalText);
    expect(html).toContain(`<p>${disruption.detail}</p>`);
    expect(html).not.toContain(`<p lang="en">${disruption.detail}</p>`);
  });

  it("uses the same neutral warning wording for both Cantonese modes", () => {
    expect(render("zh-HK-lihkg")).toBe(render("zh-HK"));
    expect(render("zh-HK-lihkg", { ...disruption, localizedDetails: null }))
      .toBe(render("zh-HK", { ...disruption, localizedDetails: null }));
  });

  it("does not perform provider work or modify notification identity on render/locale changes", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = JSON.stringify(disruption);
    for (const locale of locales) render(locale);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(disruption)).toBe(before);
  });

  it("renders translated detail as text rather than HTML", () => {
    const html = render("en", {
      ...disruption,
      localizedDetails: { ...disruption.localizedDetails!, en: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
