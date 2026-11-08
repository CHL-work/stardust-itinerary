import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiUsageView, formatTokens, formatUsd } from "@/components/ai-usage-section";
import { aiTabMessages } from "@/lib/ai/ai-tab-i18n";
import type { AiUsageSummary } from "@/lib/ai/usage-types";

const days = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 9, 10 + index)).toISOString().slice(0, 10),
  tokens: { chat: index * 100, routine: index % 3 === 0 ? 400 : 0, tripSetup: index === 29 ? 50 : 0, other: 0 },
}));
const summary: AiUsageSummary = {
  since: days[0].date, days,
  services: [
    { service: "chat", requests: 20, tokens: 43_500, costUsd: 0.4321 },
    { service: "routine", requests: 10, tokens: 4_000, costUsd: 0.0021 },
    { service: "tripSetup", requests: 1, tokens: 50, costUsd: 0 },
    { service: "other", requests: 0, tokens: 0, costUsd: 0 },
  ],
  models: [
    { model: "claude-haiku-5-5", provider: "anthropic", payer: "mine", requests: 25, tokens: 40_000, costUsd: 0.4342 },
    { model: "guest-free", provider: "kilo", payer: "free", requests: 6, tokens: 7_550, costUsd: null },
  ],
  total: { requests: 31, tokens: 47_550, costUsd: 0.4342, webSearches: 3 },
};
const render = (value: AiUsageSummary, locale: "en" | "ja-JP" = "en") =>
  renderToStaticMarkup(createElement(AiUsageView, { summary: value, locale, copy: aiTabMessages(locale) }));

describe("AI tab usage (JOB-093)", () => {
  it("shows the 30-day total, the chart, a legend and both tables", () => {
    const html = render(summary);
    expect(html).toContain("47.6K tokens in 30 days · est. $0.43 on your keys");
    expect(html).toContain('role="img"');
    expect(html).toContain("Tokens per day, last 30 days");
    expect(html.match(/class="ai-usage-bar /gu)?.length).toBeGreaterThan(30);
    for (const label of ["Chat", "Routine checks", "Trip setup", "Other", "By service", "By model", "Your key", "Free"]) expect(html).toContain(label);
    // Free and other people's requests are never priced for you.
    expect(html).toContain("<td>—</td>");
  });

  it("explains the estimate behind one info button", () => {
    const html = render(summary);
    expect(html.match(/popovertarget|popoverTarget/giu)?.length).toBe(1);
    expect(html).toContain("your provider&#x27;s bill is final");
  });

  it("says so when there was no AI use", () => {
    const html = render({ ...summary, services: summary.services.map((service) => ({ ...service, requests: 0, tokens: 0, costUsd: 0 })),
      models: [], days: days.map((day) => ({ ...day, tokens: { chat: 0, routine: 0, tripSetup: 0, other: 0 } })),
      total: { requests: 0, tokens: 0, costUsd: 0, webSearches: 0 } });
    expect(html).toContain("No AI use in the last 30 days.");
    expect(html).not.toContain('role="img"');
  });

  it("formats tokens compactly and tiny costs honestly", () => {
    expect(formatTokens(999, "en")).toBe("999");
    expect(formatTokens(1_234_567, "en")).toBe("1.2M");
    expect(formatUsd(0, "en")).toBe("$0.00");
    expect(formatUsd(0.004, "en")).toBe("< $0.01");
    expect(formatUsd(1.234, "en")).toBe("$1.23");
    expect(render(summary, "ja-JP")).toContain("推定");
  });

  it("colors series from validated slots in both themes", () => {
    const css = readFileSync("src/app/new-ui/ai-settings.css", "utf8");
    for (const color of ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#3987e5", "#d95926", "#199e70", "#c98500"]) expect(css).toContain(color);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-ui="new"\] \.ai-tab \{/u);
  });
});
