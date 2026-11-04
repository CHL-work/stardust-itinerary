import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ActivityPanel, ActivitySettingsEntry } from "./activity-panel";
import { activityMessages } from "@/lib/app/activity-i18n";
import { activityActions, activityCategories, activityFields, type ActivityEntry } from "@/lib/app/activity-types";
import { formatPaymentMoney } from "@/lib/app/member-payment-format";
import { locales, messages } from "@/lib/i18n";
import { revealGroupedExpense } from "./current-day-groups";
import { ApprovalRequestCards } from "./approval-request-cards";
import type { ApprovalRequest } from "@/lib/app/types";

const entry: ActivityEntry = { id: "audit", category: "expense", action: "updated", actorName: "Synthetic payer", createdAt: "2030-04-01T00:00:00Z", title: "Synthetic lunch <private>", startsAt: "2030-04-02T10:00:00Z", endsAt: null, amount: { amountMinor: 1051, currency: "HKD" }, status: "posted", changedFields: ["amount", "shares"], target: { kind: "expense", id: "bill" }, targetState: "available" };
const props = { entries: [entry], locale: "en" as const, timeZone: "Asia/Tokyo", isOwner: true, openingId: null, busy: false, open: vi.fn(), back: vi.fn(), refresh: vi.fn() };
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;");
function buttons(node: ReactNode): Array<{ onClick?: () => void; disabled?: boolean }> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return [];
  return node.type === "button" ? [node.props] : buttons(node.props.children);
}
describe("localized owner Settings Activity", () => {
  it.each(locales)("provides readable truthful details and a read-only destination in %s", (locale) => {
    const copy = activityMessages(locale);
    const html = renderToStaticMarkup(createElement(ActivityPanel, { ...props, locale }));
    for (const text of [copy.title, copy.latest, copy.current, copy.amount, copy.openExpense, copy.back, copy.changed, copy.fields.shares]) expect(html).toContain(escape(text));
    expect(html).toContain("Synthetic lunch &lt;private&gt;");
    expect(html).toContain(formatPaymentMoney(1051, "HKD", locale));
    expect(html).toContain('dateTime="2030-04-01T00:00:00Z"');
    expect(html).not.toContain("<pre");
    for (const code of activityActions) expect(copy.actions[code]).toBeTruthy();
    for (const code of activityCategories) expect(copy.categories[code]).toBeTruthy();
    for (const code of activityFields) expect(copy.fields[code]).toBeTruthy();
    expect(renderToStaticMarkup(createElement(ActivitySettingsEntry, { locale, isOwner: true, open: vi.fn() }))).toContain(copy.open);
  });
  it("suppresses Settings entry and detail content for nonowners", () => {
    expect(renderToStaticMarkup(createElement(ActivityPanel, { ...props, isOwner: false }))).toBe("");
    expect(renderToStaticMarkup(createElement(ActivitySettingsEntry, { locale: "en", isOwner: false, open: vi.fn() }))).toBe("");
  });
  it("uses trip time zone, not device time, and exposes loading while only navigation is pending", () => {
    const html = renderToStaticMarkup(createElement(ActivityPanel, { ...props, openingId: entry.id }));
    expect(html).toContain("09:00 AM"); expect(html).toContain('aria-busy="true"');
    expect(html).toContain(activityMessages("en").loading);
    const open = vi.fn(); buttons(ActivityPanel({ ...props, open })).at(-1)?.onClick?.();
    expect(open).toHaveBeenCalledExactlyOnceWith(entry);
  });
  it.each(["removed", "unavailable"] as const)("does not offer an action for %s records", (targetState) => {
    const html = renderToStaticMarkup(createElement(ActivityPanel, { ...props, entries: [{ ...entry, title: null, target: null, targetState }] }));
    expect(html).toContain(activityMessages("en")[targetState]);
    expect(html).not.toContain(activityMessages("en").openExpense);
  });
  it("removes Activity from shared desktop/mobile nav and resolves its Settings subpage heading", () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const nav = source.slice(source.indexOf("const navItems ="), source.indexOf("const openEvent ="));
    expect(nav).not.toContain('id: "activity"');
    expect(source).toContain('<ActivitySettingsEntry locale={locale} isOwner={overview.session.isOwner} open={() => setSection("activity")} />');
    expect(source).toContain('section === "activity" ? activityMessages(locale).title');
  });
  it("has mobile-sized targets, in-flow wrapping and focus outlines", () => {
    const css = readFileSync("src/components/activity-panel.module.css", "utf8");
    expect(css).toContain("min-height: 44px"); expect(css).toContain("font-size: 16px");
    expect(css).toContain("line-height: 1.65"); expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain(":focus-visible"); expect(css).toContain("grid-template-columns: 1fr");
    expect(css).not.toContain("position: absolute");
  });
  it("reveals the exact expense's collapsed day before scrolling and ignores absent targets", () => {
    const order: string[] = []; const day = { set open(value: boolean) { order.push(`open:${value}`); } };
    const article = { id: "expense-bill", closest: () => day, scrollIntoView: () => order.push("scroll") };
    const root = { querySelectorAll: () => [article] } as unknown as HTMLElement;
    expect(revealGroupedExpense(root, "missing")).toBe(false); expect(order).toEqual([]);
    expect(revealGroupedExpense(root, "bill")).toBe(true); expect(order).toEqual(["open:true", "scroll"]);
  });
  it.each(["pending", "rejected", "approved", "superseded"] as const)("renders %s request detail without any review controls", (status) => {
    const request = { id: "request", entityType: "expense", operation: "create", status, source: "ai", requestedByName: "Synthetic editor", createdAt: "2030-04-01T00:00:00Z", proposalRevision: 1, baseRevision: null, patch: {}, display: { kind: "expense", expense: { description: "Synthetic proposed bill", amountMinor: 100, currency: "JPY", payerName: "Synthetic payer", occurredAt: "2030-04-01T00:00:00Z", status: "posted", hasLinkedEvent: false, splits: [{ memberName: "Synthetic payer", shareMinor: 100 }] } } } as ApprovalRequest;
    const review = vi.fn(); const node = ApprovalRequestCards({ requests: [request], locale: "en", messages: messages.en, busy: false, readOnly: true, review });
    expect(buttons(node)).toHaveLength(0); expect(review).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(node)).toContain("Synthetic editor");
    if (status === "pending") expect(buttons(ApprovalRequestCards({ requests: [request], locale: "en", messages: messages.en, busy: false, review }))).toHaveLength(2);
  });
});

describe("actual Activity navigation handler fencing", () => {
  const source = readFileSync("src/components/app-shell.tsx", "utf8");
  const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function handler(bindings: Record<string, unknown>) {
    let declaration = "";
    const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "openActivityTarget") declaration = `const ${node.getText(tree)};`; ts.forEachChild(node, visit); };
    visit(tree); expect(declaration).not.toBe("");
    const code = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(bindings), `${code};return openActivityTarget;`)(...Object.values(bindings)) as (entry: ActivityEntry) => Promise<void>;
  }
  function setup() {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => { resolve = done; });
    const state = { memberAdminScopeRef: { current: "trip:owner" as string | null }, overview: { trip: { id: "trip" }, session: { isOwner: true } },
      activityRequestGeneration: { current: 0 }, activityOpeningId: null, busy: false, locale: "en", activityMessages,
      setActivityOpeningId: vi.fn(), setActivityDetail: vi.fn(), setNotice: vi.fn(), setActivityAccessLost: vi.fn(),
      jsonRequest: vi.fn(() => pending), refresh: vi.fn(async () => ({ session: { isOwner: true }, itinerary: [], pendingItinerary: [], expenses: [{ id: "bill" }] })),
      setSection: vi.fn(), window: { setTimeout: (run: () => void, delay: number) => { if (delay === 0) run(); return 1; }, clearTimeout: vi.fn() }, itineraryGroupsRef: { current: { revealItem: vi.fn() } }, expenseGroupsRef: { current: { revealExpense: vi.fn() } },
      JsonRequestError: class extends Error { status = 404; } };
    return { state, run: handler(state), resolve };
  }
  it("refreshes visible data then reveals an actual expense, never invokes an edit/mutation", async () => {
    const { state, run, resolve } = setup(); const work = run(entry); resolve({ entry, request: null }); await work;
    expect(state.refresh).toHaveBeenCalledWith({ syncDrafts: false }); expect(state.setSection).toHaveBeenCalledWith("expenses");
    expect(state.expenseGroupsRef.current.revealExpense).toHaveBeenCalledWith("bill");
    expect(state.jsonRequest).toHaveBeenCalledWith("/api/trips/trip/activity/audit", { cache: "no-store", signal: expect.any(AbortSignal) });
  });
  it("ignores a late response after trip/member/role change", async () => {
    const { state, run, resolve } = setup(); const work = run(entry); state.memberAdminScopeRef.current = "different:member";
    resolve({ entry, request: null }); await work;
    expect(state.refresh).not.toHaveBeenCalled(); expect(state.setSection).not.toHaveBeenCalled();
  });
  it("does not jump when the refreshed record has disappeared", async () => {
    const { state, run, resolve } = setup(); state.refresh.mockResolvedValue({ session: { isOwner: true }, itinerary: [], pendingItinerary: [], expenses: [] });
    const work = run(entry); resolve({ entry, request: null }); await work;
    expect(state.setSection).not.toHaveBeenCalled(); expect(state.setNotice).toHaveBeenCalledWith(activityMessages("en").unavailable);
  });
  it("releases the opening state with neutral feedback on an aborted request", async () => {
    const { state, run } = setup(); state.jsonRequest.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await run(entry);
    expect(state.setNotice).toHaveBeenCalledWith(activityMessages("en").loadFailed);
    expect(state.setActivityOpeningId).toHaveBeenLastCalledWith(null);
    expect(state.window.clearTimeout).toHaveBeenCalledWith(1);
    expect(source).toContain("window.setTimeout(() => abort.abort(), 15_000)");
  });
});
