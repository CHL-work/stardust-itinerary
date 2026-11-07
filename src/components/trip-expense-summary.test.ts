import { readFileSync } from "node:fs";
import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { expenseSummaryCopy } from "@/lib/expense-copy";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { documentLanguage, locales, type Locale } from "@/lib/i18n";
/** A number as this locale groups it ("2,000", "2.000", "2 000" or "2000"). */
const grouped = (locale: Locale, value: number) => new Intl.NumberFormat(documentLanguage(locale)).format(value);

import type { ExpenseSummaryOverview } from "@/lib/domain/expense-summary";
import { PersonalExpenseWidget, TripExpenseSummary } from "./trip-expense-summary";

function overview(isOwner = false): ExpenseSummaryOverview {
  return {
    session: { memberId: "a", isOwner }, trip: { defaultCurrency: "JPY" },
    expenses: [{ id: "bill-a", status: "posted", currency: "JPY", amountMinor: 4000, payerMemberId: "a", splits: [{ memberId: "a", shareMinor: 1000 }, { memberId: "b", shareMinor: 3000 }] }],
    expenseLedger: { settlements: [
      { currency: "JPY", fromMemberId: "b", fromMemberName: "Member B", toMemberId: "a", toMemberName: "Member A", amountMinor: 3000 },
      { currency: "HKD", fromMemberId: "c", fromMemberName: "Third party C", toMemberId: "d", toMemberName: "Third party D", amountMinor: 4550 },
    ] },
  };
}

function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === "function") return descendants((element.type as (props: unknown) => ReactNode)(element.props));
  return [element, ...descendants(element.props.children as ReactNode)];
}

const escapedText = (value: string) => renderToStaticMarkup(createElement("p", null, value)).slice(3, -4);
function metricValues(node: ReactNode): unknown[] {
  return descendants(node).filter((element) => element.type === "dd").map((element) => (
    Array.isArray(element.props.children) ? element.props.children[0] : element.props.children
  ));
}

describe("expense summary rendering", () => {
  it.each(locales)("clarifies reassigned repayment totals without claiming the assignee made the original payment in %s", (locale) => {
    const data = overview();
    data.memberPayments = [{ fromMemberId: "removed", toMemberId: "b", accountingFromMemberId: "a", accountingToMemberId: "b", amountMinor: 1000, currency: "JPY", status: "posted" }];
    expect(renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale }))).toContain(memberPaymentMessages(locale).reassignedTotals);
    data.memberPayments = [{ fromMemberId: "b", toMemberId: "removed", accountingFromMemberId: "b", accountingToMemberId: "a", amountMinor: 1000, currency: "JPY", status: "posted" }];
    expect(renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale }))).toContain(memberPaymentMessages(locale).reassignedTotals);
  });

  it("omits the reassignment note for unchanged, non-posted, unrelated or legacy payment inputs", () => {
    const rows = [
      { fromMemberId: "a", toMemberId: "b", accountingFromMemberId: "a", accountingToMemberId: "b", status: "posted" },
      { fromMemberId: "removed", toMemberId: "b", accountingFromMemberId: "a", accountingToMemberId: "b", status: "pending" },
      { fromMemberId: "removed", toMemberId: "b", accountingFromMemberId: "a", accountingToMemberId: "b", status: "rejected" },
      { fromMemberId: "removed", toMemberId: "b", accountingFromMemberId: "a", accountingToMemberId: "b", status: "void" },
      { fromMemberId: "removed", toMemberId: "a", accountingFromMemberId: "b", accountingToMemberId: "a", status: "posted" },
      { accountingFromMemberId: "a", accountingToMemberId: "b", status: "posted" },
    ];
    for (const row of rows) {
      const data = overview(); data.memberPayments = [{ ...row, amountMinor: 1000, currency: "JPY" }];
      expect(renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale: "en" }))).not.toContain(memberPaymentMessages("en").reassignedTotals);
    }
  });

  it("offers one generic repayment action and an exact outgoing suggestion shortcut, not incoming or owner-wide actions", () => {
    const data = overview(true); data.session.memberId = "b";
    const recordRepayment = vi.fn();
    const rendered = TripExpenseSummary({ overview: data, locale: "en", recordRepayment });
    const buttons = descendants(rendered).filter((element) => element.type === "button");
    expect(buttons).toHaveLength(2);
    (buttons[0].props.onClick as () => void)(); (buttons[1].props.onClick as () => void)();
    expect(recordRepayment.mock.calls).toEqual([[], [data.expenseLedger.settlements[0]]]);
    const incoming = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: overview(true), locale: "en", recordRepayment }));
    expect(incoming.match(/<button /gu)).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale: "en" }))).not.toContain("Record repayment");
  });

  it("shows repayments as secondary adjustments without increasing spending or vendor-paid figures", () => {
    const data = overview();
    data.memberPayments = [{ accountingFromMemberId: "b", accountingToMemberId: "a", amountMinor: 1000, currency: "JPY", status: "posted" }];
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale: "en" }));
    expect(markup).toContain("Repayments received: ¥1,000"); expect(markup).toContain("¥2,000");
    expect(markup).toContain('data-zero="false">¥4,000');
    expect(markup.indexOf(expenseSummaryCopy("en").title)).toBeLessThan(markup.indexOf("Repayments received"));
  });

  it("keeps payment-only currencies and their last cent visible", () => {
    const data = overview(); data.expenses = []; data.expenseLedger.settlements = [];
    data.memberPayments = [{ accountingFromMemberId: "a", accountingToMemberId: "b", amountMinor: Number.MAX_SAFE_INTEGER, currency: "HKD", status: "posted" }];
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale: "en" }));
    expect(markup).toContain("HK$90,071,992,547,409.91"); expect(markup).toContain("Repayments sent");
    expect(markup).toContain('data-zero="true">HK$0.00');
  });

  it.each(locales)("leads with localized personal spending in %s", (locale) => {
    const copy = expenseSummaryCopy(locale);
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: overview(true), locale }));
    expect(markup).toContain(`<h2>${copy.title}</h2>`);
    expect(markup.indexOf(copy.myShare)).toBeLessThan(markup.indexOf(copy.paid));
    expect(markup.indexOf(copy.paid)).toBeLessThan(markup.indexOf(copy.ownerDetails));
    expect(markup).toContain(escapedText(copy.scope));
    expect(markup).toContain(copy.settlementHint);
    expect(markup).toContain(copy.ownerScope);
    expect(markup).not.toContain("<details open");
    expect(markup).toContain(grouped(locale, 1000));
    expect(markup).toContain(grouped(locale, 4000));
  });

  it.each(locales)("omits owner totals and unrelated settlement identities for members in %s", (locale) => {
    const copy = expenseSummaryCopy(locale);
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: overview(), locale }));
    expect(markup).not.toContain(copy.ownerDetails);
    expect(markup).not.toContain(copy.visibleTotal);
    expect(markup).not.toContain("Third party");
    expect(markup).toContain("Member B");
  });

  it("keeps empty personal balances neutral instead of claiming a receipt or debt", () => {
    const data = overview();
    data.expenses = [];
    data.expenseLedger.settlements = [];
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale: "en" }));
    const copy = expenseSummaryCopy("en");
    expect(markup).toContain(`>${copy.balanced}</span>`);
    expect(markup).not.toContain(`>${copy.receive}</span>`);
    expect(markup).not.toContain(`>${copy.owe}</span>`);
    expect(markup).toContain("No suggested transfers for you.");
    expect(markup.match(/data-zero="true"/gu)).toHaveLength(2);
  });

  it("formats two-decimal currencies without dropping minor units", () => {
    const data = overview();
    data.expenses = [{ id: "bill", status: "posted", amountMinor: 4551, currency: "HKD", payerMemberId: "a", splits: [{ memberId: "a", shareMinor: 4551 }] }];
    data.expenseLedger.settlements = [];
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale: "en" }));
    expect(markup).toContain("45.51");
    expect(markup).toContain("HKD");
    expect(markup).not.toContain("JPY");
  });

  it("escapes long user labels in settlement text without losing attribution", () => {
    const data = overview();
    data.expenseLedger.settlements = [{ currency: "JPY", fromMemberId: "b", fromMemberName: `${"Long display name ".repeat(12)}<script>`, toMemberId: "a", toMemberName: "Member & A", amountMinor: 3000 }];
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: data, locale: "en" }));
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("Member &amp; A");
    expect(markup).not.toContain("<script>");
  });

  it("uses identical neutral financial copy for both Cantonese modes", () => {
    expect(expenseSummaryCopy("zh-HK-lihkg")).toEqual(expenseSummaryCopy("zh-HK"));
  });

  it.each(locales)("renders a compact personal-first overview widget in %s", (locale) => {
    const copy = expenseSummaryCopy(locale);
    const markup = renderToStaticMarkup(createElement(PersonalExpenseWidget, { overview: overview(true), locale, openExpenses: () => undefined, addExpense: () => undefined }));
    expect(markup).toContain(`<h3>${copy.title}</h3>`);
    expect(markup.indexOf(copy.myShare)).toBeLessThan(markup.indexOf(grouped(locale, 1000)));
    expect(markup.indexOf(grouped(locale, 1000))).toBeLessThan(markup.indexOf(grouped(locale, 4000)));
    expect(markup).toContain(copy.viewExpenses);
    expect(markup).toContain(copy.addExpense);
    expect(markup).not.toContain(copy.visibleTotal);
    expect(markup).not.toContain("Third party");
  });

  it("omits widget creation when no add permission handler is supplied", () => {
    const markup = renderToStaticMarkup(createElement(PersonalExpenseWidget, { overview: overview(), locale: "en", openExpenses: () => undefined }));
    expect(markup).toContain("View all expenses");
    expect(markup).not.toContain("Add expense");
  });

  it("colors share, paid and net figures distinctly while keeping neutral zero values and explanatory labels", () => {
    const markup = renderToStaticMarkup(createElement(TripExpenseSummary, { overview: overview(), locale: "en" }));
    expect(markup.match(/data-zero="false"/gu)).toHaveLength(2);
    expect(markup).toContain(expenseSummaryCopy("en").myShare);
    expect(markup).toContain(expenseSummaryCopy("en").paid);
    expect(markup).toContain(expenseSummaryCopy("en").receive);
    const css = readFileSync(new URL("./trip-expense-summary.module.css", import.meta.url), "utf8");
    expect(css).toContain('.primary dd[data-zero="false"] { color: var(--gold); }');
    expect(css).toContain('.secondary > dl:first-child dd[data-zero="false"] { color: var(--violet); }');
    expect(css).toContain('.widgetAmount[data-zero="false"] { color: var(--gold); }');
    expect(css).toContain(".positive { color: var(--mint); }");
    expect(css).toContain(".negative { color: var(--rose); }");
    expect(css).toContain(".neutral { color: var(--ink); }");
    const data = overview(); data.expenses = []; data.expenseLedger.settlements = [];
    const emptyWidget = renderToStaticMarkup(createElement(PersonalExpenseWidget, { overview: data, locale: "en", openExpenses: () => undefined }));
    expect(emptyWidget).toContain('data-zero="true"');
    expect(emptyWidget).toContain(expenseSummaryCopy("en").balanced);
  });

  it.each(locales)("provides three native, initially collapsed metric explanations and no notes under the figures on both surfaces in %s", (locale) => {
    const copy = expenseSummaryCopy(locale);
    const data = overview();
    const surfaces = [TripExpenseSummary({ overview: data, locale }), PersonalExpenseWidget({ overview: data, locale, openExpenses: vi.fn() })];
    for (const surface of surfaces) {
      const all = descendants(surface);
      const helps = all.filter((element) => element.type === "details");
      expect(helps).toHaveLength(3);
      for (const [index, help] of helps.entries()) {
        expect(help.props.open).toBeUndefined();
        expect(help.props.onToggle).toBeUndefined();
        const children = help.props.children as ReactElement<Record<string, unknown>>[];
        expect(children[0].type).toBe("summary");
        expect(children[0].props["aria-label"]).toBe(`${[copy.myShare, copy.paid, copy.receive][index]}: ${copy.helpLabel}`);
        expect(children[0].props.onClick).toBeUndefined();
        expect(children[0].props.onKeyDown).toBeUndefined();
        expect(children[0].props["aria-expanded"]).toBeUndefined(); // Native details owns expanded state.
        expect(children[1].type).toBe("p");
        expect(children[1].props.children).toBe([copy.myShareHelp, copy.paidHelp, copy.balanceHelp][index]);
        const question = descendants(children[0]).find((element) => element.props.children === "?");
        expect(question?.props["aria-hidden"]).toBe("true");
        const expanded = renderToStaticMarkup(cloneElement(help, { open: true }));
        expect(expanded).toMatch(/^<details[^>]* open=""/);
        expect(expanded).toContain(escapedText([copy.myShareHelp, copy.paidHelp, copy.balanceHelp][index]));
      }
      expect(all.filter((element) => element.type === "dt")).toHaveLength(3);
      expect(metricValues(surface)).toEqual([1000, 4000, 3000].map((value) => locale === "en" ? `¥${grouped(locale, value)}` : expect.stringContaining(grouped(locale, value))));
      const markup = renderToStaticMarkup(surface);
      expect(markup).toContain(escapedText(copy.scope));
      // JOB-075: each figure shows only its amount; what a note used to say is in the figure's help.
      for (const description of all.filter((element) => element.type === "dd")) {
        expect(descendants(description).some((element) => element.type === "p")).toBe(false);
      }
    }
  });

  it("keeps owner-only totals independently collapsed alongside the new informational disclosures", () => {
    const data = overview(true);
    const details = descendants(TripExpenseSummary({ overview: data, locale: "en" })).filter((element) => element.type === "details");
    expect(details).toHaveLength(4);
    const owner = details.find((element) => descendants(element).some((child) => child.type === "summary" && child.props.children === expenseSummaryCopy("en").ownerDetails));
    expect(owner).toBeDefined(); expect(owner?.props.open).toBeUndefined();
    expect(renderToStaticMarkup(owner!)).toContain("Visible trip total");
  });

  it("groups each full-summary metric into a valid definition list with its term and value", () => {
    const lists = descendants(TripExpenseSummary({ overview: overview(), locale: "en" })).filter((element) => element.type === "dl");
    expect(lists).toHaveLength(3);
    for (const list of lists) {
      const children = list.props.children as ReactElement[];
      expect(children.map((child) => child.type)).toEqual(["dt", "dd"]);
    }
  });

  it.each(locales)("keeps payer and someone else's portion distinct after a repayment in %s", (locale) => {
    const copy = expenseSummaryCopy(locale);
    for (const [memberId, figures, label] of [["a", [1000, 4000, 1800], copy.receive], ["b", [3000, 0, 1800], copy.owe]] as const) {
      const data = overview(); data.session.memberId = memberId;
      data.memberPayments = [{ accountingFromMemberId: "b", accountingToMemberId: "a", amountMinor: 1200, currency: "JPY", status: "posted" }];
      for (const surface of [TripExpenseSummary({ overview: data, locale }), PersonalExpenseWidget({ overview: data, locale, openExpenses: vi.fn() })]) {
        const values = metricValues(surface);
        expect(values).toHaveLength(3);
        for (const [index, value] of values.entries()) expect(value).toContain(grouped(locale, figures[index]!));
        const metricLabels = descendants(surface).filter((element) => element.type === "summary").map((element) => element.props["aria-label"]);
        expect(metricLabels).toEqual([copy.myShare, copy.paid, label].map((name) => `${name}: ${copy.helpLabel}`));
      }
    }
  });

  it("preserves exact overview navigation callbacks without turning help into financial actions", () => {
    const openExpenses = vi.fn(); const addExpense = vi.fn();
    const all = descendants(PersonalExpenseWidget({ overview: overview(), locale: "en", openExpenses, addExpense }));
    const buttons = all.filter((element) => element.type === "button");
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.props.children)).toEqual([expenseSummaryCopy("en").viewExpenses, expenseSummaryCopy("en").addExpense]);
    expect(openExpenses).not.toHaveBeenCalled(); expect(addExpense).not.toHaveBeenCalled();
    (buttons[0].props.onClick as () => void)(); (buttons[1].props.onClick as () => void)();
    expect(openExpenses).toHaveBeenCalledOnce(); expect(addExpense).toHaveBeenCalledOnce();
  });

  it("makes question-mark help tap-sized, focus-visible and readable in normal document flow", () => {
    const css = readFileSync(new URL("./trip-expense-summary.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.metricHelp > summary\s*\{[^}]*min-height: 44px;[^}]*min-width: 44px;/);
    expect(css).toMatch(/\.metricHelp > summary:focus-visible\s*\{[^}]*outline: 3px solid/);
    expect(css).toMatch(/\.metricExplanation\s*\{[^}]*font-size: 15px;[^}]*line-height: 1\.65;[^}]*overflow-wrap: anywhere/);
    const phoneStyles = css.slice(css.indexOf("@media (max-width: 440px)"));
    expect(phoneStyles).toContain(".secondary > dl:has(details[open]) { grid-column: 1 / -1; }");
    expect(phoneStyles).toContain(".metricExplanation { font-size: 16px; }");
    expect(css).toMatch(/\.secondary\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).not.toContain("position: absolute"); expect(css).not.toContain("position: fixed"); expect(css).not.toContain(":hover");
  });
});
