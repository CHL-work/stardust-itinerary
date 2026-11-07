import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronRight } from "lucide-react";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { currencyFactor } from "@/lib/app/event-expense-editor";
import { DayAccordion } from "@/components/current-day-groups";
import { expensePageMessages } from "@/lib/app/expense-page-i18n";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { countLabel, formatMessage, locales, messages, type Locale } from "@/lib/i18n";

const source = readFileSync("src/components/app-shell.tsx", "utf8");
const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const summaries: ts.JsxElement[] = [];
function findSummary(node: ts.Node): void {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "summary"
    && node.openingElement.attributes.getText(tree).includes('className="expense-day-summary"')) summaries.push(node);
  ts.forEachChild(node, findSummary);
}
findSummary(tree);

type DayGroup = { date: string; label: string | null; expenses: unknown[]; pendingExpenses: unknown[]; payments: unknown[]; totals: Array<[string, number]> };
type DetailsProps = { date: string; today: string; children: ReactNode };
const sample: DayGroup = { date: "2030-04-01", label: "Synthetic restaurant day", expenses: [{}, {}, {}], pendingExpenses: [{}], payments: [{}, {}],
  totals: [["JPY", 1234], ["HKD", 6789]] };

/** Render the actual summary and its parent disclosure attributes, without loading a trip or its cards. */
function renderSummary(locale: Locale, group = sample, todayDate = sample.date) {
  expect(summaries).toHaveLength(1);
  const summary = summaries[0];
  const parent = summary.parent;
  expect(ts.isJsxElement(parent) && parent.openingElement.tagName.getText(tree) === "DayAccordion").toBe(true);
  const details = parent as ts.JsxElement;
  const money = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "formatMoney");
  expect(money).toBeDefined();
  const code = ts.transpileModule(`${money!.getText(tree)}\nconst render = () => (<DayAccordion ${details.openingElement.attributes.getText(tree)}>${summary.getText(tree)}</DayAccordion>);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "createElement" },
  }).outputText;
  const bindings = {
    createElement, DayAccordion, ChevronRight, countLabel, formatMessage, currencyFactor, group, locale,
    expensePageCopy: expensePageMessages(locale), paymentCopy: memberPaymentMessages(locale), messages: messages[locale],
    todayDate, overview: { trip: { defaultCurrency: "JPY" } },
  };
  const render = new Function(...Object.keys(bindings), `${code}; return render;`)(...Object.values(bindings)) as () => ReactElement<DetailsProps>;
  const node = render();
  return { node, markup: renderToStaticMarkup(node) };
}

describe("side-by-side expense day heading", () => {
  it.each(locales)("keeps the date/counts on the left and personal multi-currency spending on the right in %s", (locale) => {
    const { node, markup } = renderSummary(locale);
    const summary = node.props.children as ReactElement<{ className: string; children: ReactNode[] }>;
    expect(summary.props.className).toBe("expense-day-summary");
    const columns = summary.props.children.filter(isValidElement) as ReactElement<{ className: string }>[];
    expect(columns.map((column) => column.props.className)).toEqual(["expense-day-toggle", "expense-day-total"]);
    expect(markup).toContain(sample.date);
    expect(markup).toContain(expensePageMessages(locale).currentDay);
    expect(markup).toContain(formatMessage(expensePageMessages(locale).count, { count: 3 }));
    expect(markup).toContain(formatMessage(messages[locale].pendingExpenseCountOne, { count: 1 }));
    expect(markup).toContain(formatMessage(memberPaymentMessages(locale).dayCount, { count: 2 }));
    expect(markup).toContain(expensePageMessages(locale).myDayTotal);
    expect(markup).toContain("1,234");
    expect(markup).toContain("67.89");
    expect(markup).not.toContain("69.12");
    expect(markup).toContain('open=""');
  });

  it("preserves the amount on a collapsed non-current day without a misleading today label", () => {
    const result = renderSummary("en", sample, "2030-04-02");
    expect(result.markup).not.toContain('open=""');
    expect(result.markup).not.toContain(expensePageMessages("en").currentDay);
    expect(result.markup).toContain("¥1,234");
  });

  it("uses an honest zero for a day without posted personal spending and omits a zero pending count", () => {
    const { markup } = renderSummary("en", { ...sample, label: null, expenses: [], pendingExpenses: [], payments: [], totals: [] });
    expect(markup).toContain("Monday");
    expect(markup).toContain("0 expenses");
    expect(markup).toContain("¥0");
    expect(markup).not.toContain("pending expense");
  });

  it("counts one of each in the singular, and more in the plural (JOB-077)", () => {
    const one = renderSummary("en", { ...sample, expenses: [{}], pendingExpenses: [{}], payments: [{}] }).markup;
    expect(one).toContain("1 expense · 1 pending expense · 1 repayment<");
    const many = renderSummary("en", { ...sample, expenses: [{}, {}], pendingExpenses: [{}, {}], payments: [{}, {}] }).markup;
    expect(many).toContain("2 expenses · 2 pending expenses · 2 repayments<");
  });

  it("escapes and preserves a long day label rather than shortening or hiding it", () => {
    const label = `Synthetic ${"長い日付の説明".repeat(12)} <script>bad()</script>`;
    const { markup } = renderSummary("ja-JP", { ...sample, label });
    expect(markup).toContain("長い日付の説明".repeat(12));
    expect(markup).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("scopes a two-column grid to expense headings and overrides inherited phone indentation", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.expense-day > \.expense-day-summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\);[^}]*align-items:\s*center;/u);
    expect(css).toMatch(/\.expense-day-summary \.expense-day-total\s*\{[^}]*padding-left:\s*0;[^}]*text-align:\s*right;[^}]*align-items:\s*flex-end;/u);
    expect(css).toMatch(/\.expense-day-summary \.expense-day-toggle,[^{}]*\.expense-day-summary \.expense-day-toggle > span,[^{}]*\.expense-day-summary \.expense-day-total\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/u);
    expect(css).toMatch(/\.expense-day-summary \.expense-day-total strong\s*\{[^}]*font-size:\s*18px;[^}]*font-variant-numeric:\s*tabular-nums;/u);
    expect(summaries).toHaveLength(1);
  });
});
