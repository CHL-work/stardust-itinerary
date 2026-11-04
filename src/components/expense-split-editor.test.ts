import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExpenseSplitEditor } from "./expense-split-editor";
import { expenseSplitMessages } from "@/lib/app/expense-split-i18n";
import { locales } from "@/lib/i18n";

vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), useId: () => "synthetic-split" }));
const members = [{ id: "a", displayName: "Synthetic A" }, { id: "b", displayName: "Synthetic B" }];
const draft = { amount: "100.01", currency: "HKD", splitMemberIds: ["a", "b"], splitMode: "custom" as const,
  splitAmountInputs: { a: "100.01", b: "0.00" } };
function nodes(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [{ type: node.type, props: node.props }, ...nodes(node.props.children as ReactNode)];
}
describe("localized mobile split editor", () => {
  it.each(locales)("renders exact individual amounts and neutral status in %s", (locale) => {
    const copy = expenseSplitMessages(locale);
    const html = renderToStaticMarkup(createElement(ExpenseSplitEditor, { draft, members, locale, disabled: false, change: vi.fn() }));
    for (const label of [copy.equal, copy.custom, copy.assigned, copy.remaining, copy.balanced]) expect(html).toContain(label);
    expect(html).toContain('value="100.01"'); expect(html).toContain('value="0.00"');
    expect(html).toContain('inputMode="decimal"'); expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-balanced="true"'); expect(html).toContain("Synthetic A");
  });
  it.each(locales)("defaults to equal and never displays custom-only errors in %s", (locale) => {
    const copy = expenseSplitMessages(locale);
    const html = renderToStaticMarkup(createElement(ExpenseSplitEditor, { draft: { ...draft, splitMode: undefined }, members, locale, disabled: false, change: vi.fn() }));
    expect(html).toContain(copy.equalHint); expect(html).not.toContain('inputMode="decimal"');
    expect(html).not.toContain(copy.error);
  });
  it.each(locales)("shows overallocated, incomplete and unknown-total states in %s", (locale) => {
    const render = (patch: Partial<typeof draft>) => renderToStaticMarkup(createElement(ExpenseSplitEditor, { draft: { ...draft, ...patch }, members, locale, disabled: false, change: vi.fn() }));
    const copy = expenseSplitMessages(locale);
    expect(render({ amount: "99.00" })).toContain(copy.over);
    expect(render({ splitAmountInputs: { a: "100.01", b: "" } })).toContain(copy.incomplete);
    expect(render({ amount: "" })).toContain(copy.totalFirst);
  });
  it("uses non-submitting mode buttons, retains the draft and marks explicit edits", () => {
    const change = vi.fn(); const tree = nodes(ExpenseSplitEditor({ draft, members, locale: "en", disabled: false, change }));
    const buttons = tree.filter((node) => node.type === "button");
    expect(buttons.every((node) => node.props.type === "button")).toBe(true);
    (buttons[0].props.onClick as () => void)();
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ amount: "100.01", splitMode: "equal", splitTouched: true }));
    const inputs = tree.filter((node) => node.type === "input");
    (inputs[1].props.onChange as (event: unknown) => void)({ target: { value: "0.01" } });
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ splitAmountInputs: { a: "100.01", b: "0.01" }, splitTouched: true }));
    expect(draft.splitAmountInputs.b).toBe("0.00");
  });
  it("disables every descendant while busy and preserves readable phone targets", () => {
    const html = renderToStaticMarkup(createElement(ExpenseSplitEditor, { draft, members, locale: "en", disabled: true, change: vi.fn() }));
    expect(html).toMatch(/<fieldset[^>]+disabled/);
    const css = readFileSync("src/components/expense-split-editor.module.css", "utf8");
    expect(css).toContain("min-height: 44px"); expect(css).toContain("font-size: 16px");
    expect(css).toContain("minmax(0, 1fr)"); expect(css).toContain("overflow-wrap: anywhere");
  });
});
