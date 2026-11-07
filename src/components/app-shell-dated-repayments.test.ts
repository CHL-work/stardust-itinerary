import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Check, ChevronRight, PencilLine, Plus, X } from "lucide-react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { CurrentDayGroups, DayAccordion } from "./current-day-groups";
import { MemberPaymentCard } from "./member-payment-controls";
import { groupExpenseDays, compareExpenseDayEntries } from "@/lib/app/expense-day-groups";
import { expensePageMessages } from "@/lib/app/expense-page-i18n";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { formatPaymentMoney } from "@/lib/app/member-payment-format";
import type { MemberPayment } from "@/lib/app/member-payments";
import { countLabel, formatMessage, locales, messages, type Locale } from "@/lib/i18n";

const source = readFileSync("src/components/app-shell.tsx", "utf8");
const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let panel: ts.JsxElement | undefined;
let grouping: ts.Expression | undefined;
function visit(node: ts.Node): void {
  if (ts.isJsxElement(node) && ts.isBinaryExpression(node.parent)
    && node.parent.left.getText(tree) === 'section === "expenses"') panel = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "expenseDayGroups") grouping = node.initializer;
  ts.forEachChild(node, visit);
}
visit(tree);

const payment: MemberPayment = {
  id: "same-id", fromMemberId: "sender", toMemberId: "recipient", fromMemberName: "Synthetic sender", toMemberName: "Synthetic recipient",
  accountingFromMemberId: "sender", accountingToMemberId: "recipient", accountingFromMemberName: "Synthetic sender", accountingToMemberName: "Synthetic recipient",
  amountMinor: 900, currency: "JPY", occurredAt: "2030-04-01T16:00:00Z", createdAt: "2030-04-06T00:00:00Z",
  status: "pending", note: null, revision: 7, createdByMemberId: "sender", canReview: true, canVoid: false,
};
const fixture = () => ({
  trip: { id: "trip", timeZone: "Asia/Tokyo", defaultCurrency: "JPY" }, session: { memberId: "sender", isOwner: true },
  permissions: { canEditExpenses: true }, days: [{ date: "2030-04-01", label: "Synthetic trip day" }],
  expenses: [{ id: "same-id", occurredAt: "2030-04-01T15:30:00Z", status: "posted", currency: "JPY", currentMemberShareMinor: 120, description: "Synthetic earlier expense" }],
  pendingExpenses: [{ requestId: "same-id", occurredAt: "2030-04-02T03:00:00+09:00", description: "Synthetic later proposal" }],
  memberPayments: [{ ...payment }],
});
type Data = ReturnType<typeof fixture>;
function renderPage(locale: Locale, overview = fixture(), options: { today?: string; busy?: boolean; recovery?: boolean } = {}) {
  expect(panel).toBeDefined(); expect(grouping).toBeDefined();
  const openPaymentAction = vi.fn(); const setPaymentDialogOpen = vi.fn();
  const expenseGroupsRef = { current: null };
  const bindings = {
    createElement, groupExpenseDays, compareExpenseDayEntries, useMemo: (read: () => unknown) => read(), overview,
    locale, busy: options.busy ?? false, paymentCopy: memberPaymentMessages(locale), expensePageCopy: expensePageMessages(locale), messages: messages[locale],
    countLabel, formatMessage, formatMoney: formatPaymentMoney, CurrentDayGroups, DayAccordion, MemberPaymentCard, expenseGroupsRef,
    todayDate: options.today ?? "2030-04-02", dayGroupsScope: "synthetic-visit", Check, ChevronRight, PencilLine, Plus, X,
    TripExpenseSummary: () => createElement("div", { "data-summary": true }, "Synthetic summary"),
    ExpenseDisplayCard: ({ expense }: { expense: Data["expenses"][number] }) => createElement("article", { "data-kind": "expense" }, expense.description),
    PendingExpenseList: ({ expenses }: { expenses: Data["pendingExpenses"] }) => createElement("article", { "data-kind": "pending" }, expenses[0].description),
    openPaymentAction, openExpense: vi.fn(), openMemberPayment: vi.fn(), review: vi.fn(), reviewExpenseDraft: vi.fn(),
    paymentLocked: options.recovery ?? false, paymentDialog: { scope: "synthetic-scope" }, paymentScope: "synthetic-scope",
    paymentDialogOpen: false, setPaymentDialogOpen,
  };
  const code = ts.transpileModule(`const expenseDayGroups = ${grouping!.getText(tree)}; const render = () => (${panel!.getText(tree)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "createElement" },
  }).outputText;
  const node = new Function(...Object.keys(bindings), `${code}; return render();`)(...Object.values(bindings)) as ReactElement;
  return { node, markup: renderToStaticMarkup(node), openPaymentAction, setPaymentDialogOpen, expenseGroupsRef };
}
function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}

describe("Expense page repayment date integration", () => {
  it.each(locales)("uses the actual payment date and one chronological day list in %s", (locale) => {
    const { node, markup, expenseGroupsRef } = renderPage(locale);
    expect(descendants(node).find((entry) => entry.type === CurrentDayGroups)?.props.ref).toBe(expenseGroupsRef);
    const days = descendants(node).filter((entry) => entry.type === DayAccordion);
    expect(days.map((entry) => entry.props.date)).toEqual(["2030-04-01", "2030-04-02"]);
    expect(markup).not.toContain(memberPaymentMessages(locale).history);
    expect(markup).toContain(formatMessage(memberPaymentMessages(locale).dayCountOne, { count: 1 }));
    expect(markup.match(/Synthetic sender/g)).toHaveLength(1);
    const current = renderToStaticMarkup(days[1]);
    expect(current).toContain('open=""'); expect(current).not.toContain(expensePageMessages(locale).noExpenses);
    expect(current.indexOf("Synthetic earlier expense")).toBeLessThan(current.indexOf("Synthetic sender"));
    expect(current.indexOf("Synthetic sender")).toBeLessThan(current.indexOf("Synthetic later proposal"));
    expect(current).toContain(formatPaymentMoney(120, "JPY", locale)); // payment does not enter day spending
    expect(current).not.toContain(formatPaymentMoney(1020, "JPY", locale));
    const body = descendants(days[1]).find((entry) => entry.props.className === "data-list expense-list")!;
    const entries = (body.props.children as ReactNode[])[0] as ReactElement[];
    expect(entries.map((entry) => entry.key)).toEqual(["expense:same-id", "payment:same-id", "pending:same-id"]);
  });
  it("retains repayment-only pre/post-trip dates and keeps unrelated empty days honest", () => {
    const data = fixture(); data.expenses = []; data.pendingExpenses = [];
    data.memberPayments.push({ ...payment, id: "before", occurredAt: "2030-03-29T00:00:00Z" });
    const { node } = renderPage("en", data);
    const days = descendants(node).filter((entry) => entry.type === DayAccordion);
    expect(days.map((entry) => entry.props.date)).toEqual(["2030-03-29", "2030-04-01", "2030-04-02"]);
    for (const index of [0, 2]) {
      const html = renderToStaticMarkup(days[index]);
      expect(html).toContain("Synthetic sender"); expect(html).toContain("¥0");
      expect(html).not.toContain(expensePageMessages("en").noExpenses);
      expect(html.includes('open=""')).toBe(index === 2);
    }
    expect(renderToStaticMarkup(days[1])).toContain(expensePageMessages("en").noExpenses);
  });
  it("passes original record, revision, review authority and busy state to the shared card", () => {
    const data = fixture(); const result = renderPage("en", data, { busy: true });
    const card = descendants(result.node).find((entry) => entry.type === MemberPaymentCard)!;
    expect(card.props).toMatchObject({ payment: data.memberPayments[0], busy: true, isOwner: true, act: result.openPaymentAction });
    expect(card.props.payment).toBe(data.memberPayments[0]);
    const member = renderPage("en", { ...data, session: { ...data.session, isOwner: false } });
    expect(member.markup).not.toContain(">Approve</button>"); expect(member.markup).not.toContain(">Reject</button>");
    expect(member.markup).toContain("Synthetic sender");
  });
  it("keeps the existing unconfirmed-record recovery action outside date disclosures", () => {
    const result = renderPage("en", fixture(), { recovery: true });
    const resume = descendants(result.node).find((entry) => entry.type === "button" && entry.props.children === memberPaymentMessages("en").resume)!;
    (resume.props.onClick as () => void)(); expect(result.setPaymentDialogOpen).toHaveBeenCalledWith(true);
  });
  it("does not synthesize hidden repayment rows from totals or another member", () => {
    const data = fixture(); data.memberPayments = [];
    const { markup } = renderPage("en", data);
    expect(markup).not.toContain("Synthetic sender"); expect(markup).not.toContain("1 repayments");
    expect(markup).not.toContain("Repayment history");
  });
});
