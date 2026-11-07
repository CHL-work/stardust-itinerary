import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExpenseDisplayCard, type DisplayExpense } from "@/components/expense-display-card";
import { mobileCardsMessages } from "@/lib/app/mobile-cards-i18n";
import { baseLocales, documentLanguage, formatMessage, locales, messages, type Locale } from "@/lib/i18n";
/** A number as this locale groups it ("2,000", "2.000", "2 000" or "2000"). */
const grouped = (locale: Locale, value: number) => new Intl.NumberFormat(documentLanguage(locale)).format(value);


const expense: DisplayExpense = {
  description: "Synthetic restaurant dinner", amountMinor: 6000, currency: "JPY", status: "posted",
  payerMemberId: "synthetic-member-a", payerName: "Synthetic payer", itineraryItemTitle: "Synthetic restaurant",
  occurredAt: "2030-04-01T09:30:00.000Z", splits: [
    { memberId: "synthetic-member-a", memberName: "Synthetic payer", shareMinor: 2000 },
    { memberId: "synthetic-member-b", memberName: "Synthetic other", shareMinor: 4000 },
  ],
};
const render = (value = expense, memberId = "synthetic-member-a", locale: Locale = "en") => renderToStaticMarkup(createElement(ExpenseDisplayCard, {
  expense: value, memberId, locale, timeZone: "Asia/Tokyo",
}));
const primaryAmount = (markup: string) => markup.match(/<strong data-personal-share="true"[^>]*>([^<]+)<\/strong>/u)?.[1];

describe("personal-first mobile expense cards", () => {
  it.each(locales)("puts the member's portion before the smaller full bill and payer in %s", (locale) => {
    const copy = mobileCardsMessages(locale);
    const markup = render(expense, "synthetic-member-a", locale);
    const personal = markup.indexOf("data-personal-share");
    expect(personal).toBeGreaterThan(-1);
    expect(primaryAmount(markup)).toContain(grouped(locale, 2000));
    expect(markup).toContain(copy.paidMyShare);
    expect(markup.indexOf(copy.total)).toBeGreaterThan(personal);
    expect(markup.indexOf(formatMessage(copy.payer, { name: expense.payerName }))).toBeGreaterThan(markup.indexOf(copy.total));
    expect(markup).not.toContain(copy.draft);
    expect(markup).not.toContain(copy.excluded);
    expect(markup).not.toMatch(/Recorded|status-tag/u);
    expect(markup).not.toContain("<svg");
  });

  it("does not mistake the full amount someone advanced for their own portion", () => {
    expect(primaryAmount(render())).toBe("¥2,000");
    const other = render(expense, "synthetic-member-b");
    expect(primaryAmount(other)).toBe("¥4,000");
    expect(other).toContain(mobileCardsMessages("en").myShare);
    expect(other).not.toContain(mobileCardsMessages("en").paidMyShare);
    expect(other).toContain("Paid by Synthetic payer");
  });

  it("shows zero personal participation rather than the whole bill to an uninvolved owner", () => {
    expect(primaryAmount(render(expense, "synthetic-owner"))).toBe("¥0");
    expect(render(expense, "synthetic-owner")).toContain("¥6,000");
    expect(render(expense, "synthetic-owner")).toContain('data-personal-share="true" data-zero="true"');
    expect(render()).toContain('data-personal-share="true" data-zero="false"');
  });

  it("preserves two-decimal currency amounts without converting or combining them", () => {
    const hkd = { ...expense, amountMinor: 10001, currency: "HKD", splits: [
      { memberId: "synthetic-member-a", memberName: "Synthetic payer", shareMinor: 5001 },
      { memberId: "synthetic-member-b", memberName: "Synthetic other", shareMinor: 5000 },
    ] };
    const markup = render(hkd);
    expect(primaryAmount(markup)).toBe("HK$50.01");
    expect(markup).toContain("HK$100.01");
    expect(markup).not.toContain("¥");
  });

  it.each(["draft", "pending"])("uses the same card with an icon and proposed wording for %s", (status) => {
    const copy = mobileCardsMessages("en");
    const markup = render({ ...expense, status });
    expect(markup).toContain(`data-expense-status="${status}"`);
    expect(markup).toContain(status === "pending" ? copy.pending : copy.draft);
    expect(markup).toContain("<svg");
    expect(markup).toContain(copy.proposedShare);
    expect(markup).toContain(copy.excluded);
    expect(markup).toContain(formatMessage(copy.proposedPayer, { name: expense.payerName }));
    expect(markup).not.toContain(copy.paidMyShare);
    expect(primaryAmount(markup)).toBe("¥2,000");
  });

  it("clearly identifies void records without describing them as paid or pending", () => {
    const copy = mobileCardsMessages("en");
    const markup = render({ ...expense, status: "void" });
    expect(markup).toContain(copy.void);
    expect(markup).not.toContain(copy.paidMyShare);
    expect(markup).not.toContain(copy.proposedShare);
    expect(markup).not.toContain(copy.excluded);
  });

  it("keeps detailed allocations collapsed while preserving exact saved shares", () => {
    const markup = render();
    expect(markup).toMatch(/<details class="[^"]+"><summary>/u);
    expect(markup).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/u);
    expect(markup).toContain("Synthetic other");
    expect(markup).toContain("¥4,000");
    expect(markup).toContain("6:30 PM");
  });

  it("escapes expense, payer and event text instead of treating it as HTML", () => {
    const markup = render({ ...expense, description: "<script>expense()</script>", payerName: "<img onerror=bad()>", itineraryItemTitle: "<b>Venue</b>" });
    expect(markup).toContain("&lt;script&gt;expense()");
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("&lt;b&gt;Venue&lt;/b&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
  });

  it("uses a yellow top-right draft marker and larger right-hand personal amount with phone wrapping", () => {
    const css = readFileSync(new URL("./expense-display-card.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.status\s*\{[^}]*justify-content:\s*flex-end/u);
    expect(css).toMatch(/\.draft\s*\{[^}]*color:\s*#ffe399[^}]*background:\s*#594314/u);
    expect(css).toMatch(/\.amount\s*\{[^}]*align-items:\s*flex-end[^}]*text-align:\s*right/u);
    expect(css).toMatch(/\.amount > strong\s*\{[^}]*font-size:\s*26px/u);
    expect(css).toMatch(/\.amount > small\s*\{[^}]*font-size:\s*12px/u);
    expect(css).toContain("font-variant-numeric: tabular-nums;");
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).not.toContain("text-overflow: ellipsis");
  });

  it("uses neutral money and destructive copy in both Cantonese tone modes", () => {
    expect(mobileCardsMessages("zh-HK-lihkg")).toEqual(mobileCardsMessages("zh-HK"));
    expect(mobileCardsMessages("en").removeConfirm).toBe("Remove this cancelled event? This cannot be undone.");
  });

  it("accentuates nonzero personal shares without treating zero or void bills as active spending", () => {
    const css = readFileSync(new URL("./expense-display-card.module.css", import.meta.url), "utf8");
    expect(css).toContain('.card:not([data-expense-status="void"]) .amount > strong[data-zero="false"] { color: var(--gold); }');
    expect(css).toContain('.card[data-expense-status="void"] .amount > strong { color: var(--muted); }');
    expect(css).toMatch(/\.amount > strong\s*\{\s*color:\s*var\(--ink\)/u);
    expect(render({ ...expense, status: "void" })).toContain(mobileCardsMessages("en").void);
    expect(render()).toContain(mobileCardsMessages("en").paidMyShare);
  });

  it("uses short Add event labels and side-by-side title/action headings on phones", () => {
    expect(baseLocales.map((locale) => messages[locale].addPlanItem)).toEqual(baseLocales.map((locale) => locale === "en" ? "Add event" : locale === "ja-JP" ? "予定を追加" : "新增活動"));
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.section-heading\.day-section-heading\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/u);
    expect(css).toMatch(/\.day-section-heading > \.primary-button\s*\{[^}]*justify-self:\s*end;[^}]*width:\s*auto;[^}]*min-height:\s*44px;[^}]*background:\s*var\(--gold\);/u);
    expect(css).toMatch(/\.day-section-heading > :first-child\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/u);
    expect(css).toMatch(/\.expense-day\.is-current-day\s*\{[^}]*border-color:/u);
    expect(css).toContain('.expense-day-summary .expense-day-total strong[data-zero="false"]');
  });
});
