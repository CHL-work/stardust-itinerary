import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { CurrentDayGroups, DayAccordion, nearestDayDate, revealGroupedItem, type DayGroupsHandle } from "./current-day-groups";

const today = "2026-09-08";
const yesterday = "2026-09-07";
const tomorrow = "2026-09-09";

// Run the actual component bodies with a small hook adapter. This repository's
// node test environment has no browser DOM; SSR checks below still use React.
const source = readFileSync("src/components/current-day-groups.tsx", "utf8");
const tree = ts.createSourceFile("current-day-groups.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualComponent<T>(name: string, bindings: Record<string, unknown>): T {
  const declaration = tree.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  expect(declaration, `The actual ${name} component must exist`).toBeDefined();
  const code = ts.transpileModule(declaration!.getText(tree).replace(/^export\s+/u, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "createElement" },
  }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return ${name};`)(...Object.values(bindings)) as T;
}

function mockDay(date: string, trace: string[] = []) {
  let open = false;
  const element = {
    dataset: { dayDate: date },
    get open() { return open; },
    set open(value: boolean) { open = value; trace.push(`open:${date}:${value}`); },
    scrollIntoView: vi.fn((options: ScrollIntoViewOptions) => {
      void options;
      trace.push(`day-scroll:${date}`);
    }),
  };
  return element;
}
function mockArticle(input: {
  id?: string; pendingTargetItemId?: string; ownsActions?: string;
  day?: ReturnType<typeof mockDay> | null; trace?: string[];
} = {}) {
  return {
    id: input.id ?? "",
    dataset: {
      ...(input.pendingTargetItemId === undefined ? {} : { pendingTargetItemId: input.pendingTargetItemId }),
      ...(input.ownsActions === undefined ? {} : { ownsActions: input.ownsActions }),
    },
    closest: vi.fn((selector: string) => {
      expect(selector).toBe("details[data-day-date]");
      return input.day ?? null;
    }),
    scrollIntoView: vi.fn((options: ScrollIntoViewOptions) => {
      void options;
      input.trace?.push(`item-scroll:${input.id ?? "pending"}`);
    }),
  };
}
function mockRoot(input: { days?: ReturnType<typeof mockDay>[]; articles?: ReturnType<typeof mockArticle>[] } = {}) {
  return {
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === "article") return input.articles ?? [];
      if (selector === "details[data-day-date]") return input.days ?? [];
      throw new Error(`Unexpected synthetic selector: ${selector}`);
    }),
  } as unknown as HTMLElement;
}

describe("current-day disclosure SSR markup", () => {
  it.each([yesterday, today, tomorrow])("opens only the actual supplied current date: %s", (date) => {
    const props = { date, today, className: "itinerary-day", children: createElement("summary", null, "Day summary") };
    const html = renderToStaticMarkup(createElement(DayAccordion, props));
    expect(html).toContain(`data-day-date="${date}"`);
    expect(html).toContain("expense-day itinerary-day");
    expect(html.includes('open=""')).toBe(date === today);
    expect(html.includes("is-current-day")).toBe(date === today);
    expect(html).toContain("<summary>Day summary</summary>");
  });
  it("keeps all days closed when today is outside the trip", () => {
    const props = { today: "2026-10-01", className: "expense-days",
      children: [yesterday, today, tomorrow].map((date) => {
        const dayProps = { key: date, date, today: "2026-10-01", children: createElement("summary", null, date) };
        return createElement(DayAccordion, dayProps);
      }),
    };
    const html = renderToStaticMarkup(createElement(CurrentDayGroups, props));
    expect(html).not.toContain('open=""');
    expect(html).not.toContain("is-current-day");
    expect(html).toContain('class="expense-days"');
  });
  it("renders an empty current day open and escapes arbitrary child labels", () => {
    const props = { date: today, today, children: [createElement("summary", { key: "summary" }, "<unsafe> & today"),
      createElement("p", { key: "empty" }, "No expenses")] };
    const html = renderToStaticMarkup(createElement(DayAccordion, props));
    expect(html).toContain('open=""');
    expect(html).toContain("&lt;unsafe&gt; &amp; today");
    expect(html).toContain("No expenses");
  });
});

describe("nearest rendered day selection", () => {
  it("prefers exact today without changing input order", () => {
    const dates = [tomorrow, yesterday, today];
    expect(nearestDayDate(dates, today)).toBe(today);
    expect(dates).toEqual([tomorrow, yesterday, today]);
  });
  it("returns no target for an empty page", () => {
    expect(nearestDayDate([], today)).toBeNull();
  });
  it.each([
    [["2026-09-10", "2026-09-09"], today, "2026-09-09"],
    [["2026-09-07", "2026-09-01"], today, "2026-09-07"],
    [[tomorrow, yesterday], today, yesterday],
    [["2027-01-01", "2026-12-29"], "2026-12-31", "2027-01-01"],
    [["2028-02-29", "2028-03-02"], "2028-03-01", "2028-02-29"],
  ] as const)("selects closest date with deterministic earlier-date ties: %j", (dates, current, expected) => {
    expect(nearestDayDate(dates, current)).toBe(expected);
  });
});

type AccordionProps = { date: string; today: string; className?: string; children: ReactNode };
type AccordionElement = ReactElement<{ open: boolean; onToggle: (event: { currentTarget: { open: boolean } }) => void }>;
function accordionInstance() {
  let value: boolean | undefined;
  let changed = 0;
  const render = actualComponent<(props: AccordionProps) => AccordionElement>("DayAccordion", {
    createElement,
    useState(initial: boolean) {
      if (value === undefined) value = initial;
      return [value, (update: (current: boolean) => boolean) => {
        const next = update(value!);
        if (next !== value) changed += 1;
        value = next;
      }];
    },
  });
  return { render, changes: () => changed };
}

describe("view-local disclosure state", () => {
  it("preserves manually opened past days through same-instance data revalidation", () => {
    const instance = accordionInstance();
    const props = { date: yesterday, today, children: "Original expenses" };
    const initial = instance.render(props);
    expect(initial.props.open).toBe(false);
    initial.props.onToggle({ currentTarget: { open: true } });
    const refreshed = instance.render({ ...props, children: "Fresh expenses and pending proposal" });
    expect(refreshed.props.open).toBe(true);
    expect(instance.changes()).toBe(1);
  });
  it("preserves a manually closed today through same-instance revalidation", () => {
    const instance = accordionInstance();
    const props = { date: today, today, children: "Original itinerary" };
    const initial = instance.render(props);
    expect(initial.props.open).toBe(true);
    initial.props.onToggle({ currentTarget: { open: false } });
    expect(instance.render({ ...props, children: "Updated itinerary" }).props.open).toBe(false);
  });
  it("resets manual changes on a new page instance", () => {
    const old = accordionInstance();
    const props = { date: yesterday, today, children: "Items" };
    old.render(props).props.onToggle({ currentTarget: { open: true } });
    expect(old.render(props).props.open).toBe(true);
    expect(accordionInstance().render(props).props.open).toBe(false);
    expect(accordionInstance().render({ ...props, date: today }).props.open).toBe(true);
  });
  it("ignores duplicate mount/programmatic toggle values without state churn", () => {
    const instance = accordionInstance();
    const props = { date: today, today, children: "Items" };
    const initial = instance.render(props);
    initial.props.onToggle({ currentTarget: { open: true } });
    initial.props.onToggle({ currentTarget: { open: true } });
    expect(instance.changes()).toBe(0);
    expect(instance.render(props).props.open).toBe(true);
  });
  it("retains a programmatically revealed day after its native toggle event", () => {
    const instance = accordionInstance();
    const props = { date: tomorrow, today, children: "Calendar target" };
    instance.render(props).props.onToggle({ currentTarget: { open: true } });
    expect(instance.render(props).props.open).toBe(true);
  });
});

describe("explicit Calendar item reveal", () => {
  it("opens the canonical event's containing day before instant scrolling", () => {
    const trace: string[] = [];
    const day = mockDay(tomorrow, trace);
    const article = mockArticle({ id: "item-canonical", day, trace });
    expect(revealGroupedItem(mockRoot({ articles: [article] }), "canonical")).toBe(true);
    expect(day.open).toBe(true);
    expect(trace).toEqual([`open:${tomorrow}:true`, "item-scroll:item-canonical"]);
    expect(article.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
  });
  it("prefers a pending replacement owning-action point over canonical and non-owning points", () => {
    const canonicalDay = mockDay(yesterday);
    const otherEndpointDay = mockDay(today);
    const actionDay = mockDay(tomorrow);
    const canonical = mockArticle({ id: "item-transport", day: canonicalDay });
    const otherEndpoint = mockArticle({ pendingTargetItemId: "transport", ownsActions: "false", day: otherEndpointDay });
    const pendingAction = mockArticle({ pendingTargetItemId: "transport", ownsActions: "true", day: actionDay });
    expect(revealGroupedItem(mockRoot({ articles: [canonical, otherEndpoint, pendingAction] }), "transport")).toBe(true);
    expect(actionDay.open).toBe(true);
    expect(canonicalDay.open).toBe(false);
    expect(otherEndpointDay.open).toBe(false);
    expect(pendingAction.scrollIntoView).toHaveBeenCalledOnce();
    expect(otherEndpoint.scrollIntoView).not.toHaveBeenCalled();
    expect(canonical.scrollIntoView).not.toHaveBeenCalled();
  });
  it("falls back to an available pending point when its owning endpoint is absent", () => {
    const day = mockDay(tomorrow);
    const pending = mockArticle({ pendingTargetItemId: "transport", ownsActions: "false", day });
    const canonical = mockArticle({ id: "item-transport" });
    expect(revealGroupedItem(mockRoot({ articles: [canonical, pending] }), "transport")).toBe(true);
    expect(day.open).toBe(true);
    expect(pending.scrollIntoView).toHaveBeenCalledOnce();
    expect(canonical.scrollIntoView).not.toHaveBeenCalled();
  });
  it("finds the canonical owning-action anchor instead of a separate arrival anchor", () => {
    const departureDay = mockDay(yesterday);
    const arrivalDay = mockDay(today);
    const arrival = mockArticle({ id: "item-flight-arrival", day: arrivalDay });
    const departure = mockArticle({ id: "item-flight", day: departureDay });
    expect(revealGroupedItem(mockRoot({ articles: [arrival, departure] }), "flight")).toBe(true);
    expect(departureDay.open).toBe(true);
    expect(arrivalDay.open).toBe(false);
  });
  it("returns false without opening or scrolling another event when target is missing", () => {
    const day = mockDay(today);
    const article = mockArticle({ id: "item-another", day });
    expect(revealGroupedItem(mockRoot({ articles: [article] }), "removed-or-missing")).toBe(false);
    expect(day.open).toBe(false);
    expect(article.closest).not.toHaveBeenCalled();
    expect(article.scrollIntoView).not.toHaveBeenCalled();
  });
  it("handles a matching article without a containing disclosure", () => {
    const article = mockArticle({ id: "item-standalone" });
    expect(revealGroupedItem(mockRoot({ articles: [article] }), "standalone")).toBe(true);
    expect(article.scrollIntoView).toHaveBeenCalledOnce();
  });
  it("compares opaque IDs directly rather than interpolating them into selectors", () => {
    const id = 'synthetic"] article, details[';
    const article = mockArticle({ id: `item-${id}` });
    const root = mockRoot({ articles: [article] });
    expect(revealGroupedItem(root, id)).toBe(true);
    expect(root.querySelectorAll).toHaveBeenCalledWith("article");
  });
});

type GroupsProps = { today: string; className: string; children: ReactNode; ref?: { current: DayGroupsHandle | null } };
function groupsInstance() {
  const elementRef: { current: HTMLElement | null } = { current: null };
  const previous = new Map<string, readonly unknown[]>();
  let pending: Array<() => void> = [];
  const schedule = (key: string, dependencies: readonly unknown[], effect: () => void) => {
    const prior = previous.get(key);
    if (!prior || prior.length !== dependencies.length || dependencies.some((entry, i) => !Object.is(entry, prior[i]))) {
      previous.set(key, [...dependencies]);
      pending.push(effect);
    }
  };
  const component = actualComponent<(props: GroupsProps) => ReactElement>("CurrentDayGroups", {
    createElement, nearestDayDate, revealGroupedItem,
    useRef: () => elementRef,
    useLayoutEffect: (effect: () => void, dependencies: readonly unknown[]) => schedule("layout", dependencies, effect),
    useImperativeHandle: (ref: GroupsProps["ref"], create: () => DayGroupsHandle, dependencies: readonly unknown[]) => {
      schedule("handle", dependencies, () => { if (ref) ref.current = create(); });
    },
  });
  return {
    render(props: GroupsProps, root: HTMLElement | null) {
      const element = component(props);
      elementRef.current = root;
      const effects = pending;
      pending = [];
      for (const effect of effects) effect();
      return element;
    },
    detach() { elementRef.current = null; },
  };
}

describe("current-day entry-scroll lifecycle", () => {
  it("scrolls once at mount and never steals scroll on same-date data refresh", () => {
    const instance = groupsInstance();
    const day = mockDay(today);
    const props = { today, className: "itinerary-days", children: "Initial data" };
    instance.render(props, mockRoot({ days: [day] }));
    expect(day.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    instance.render({ ...props, children: "Refreshed items" }, mockRoot({ days: [day] }));
    instance.render({ ...props, children: "AI result and weather update" }, mockRoot({ days: [day] }));
    expect(day.scrollIntoView).toHaveBeenCalledOnce();
  });
  it("scrolls again on page remount or actual trip-local date change", () => {
    const first = mockDay(today);
    const second = mockDay(tomorrow);
    const root = mockRoot({ days: [first, second] });
    const props = { today, className: "expense-days", children: "Bills" };
    const instance = groupsInstance();
    instance.render(props, root);
    instance.render({ ...props, today: tomorrow }, root);
    expect(first.scrollIntoView).toHaveBeenCalledOnce();
    expect(second.scrollIntoView).toHaveBeenCalledOnce();
    groupsInstance().render({ ...props, today: tomorrow }, root);
    expect(second.scrollIntoView).toHaveBeenCalledTimes(2);
  });
  it("uses nearest day for orientation without opening a noncurrent group", () => {
    const day = mockDay("2026-09-15");
    groupsInstance().render({ today, className: "itinerary-days", children: "Future trip" }, mockRoot({ days: [day] }));
    expect(day.scrollIntoView).toHaveBeenCalledOnce();
    expect(day.open).toBe(false);
  });
  it("handles empty group sets and a detached root without throwing", () => {
    const ref: { current: DayGroupsHandle | null } = { current: null };
    const instance = groupsInstance();
    expect(() => instance.render({ today, className: "expense-days", children: null, ref }, mockRoot())).not.toThrow();
    instance.detach();
    expect(() => ref.current?.revealItem("missing")).not.toThrow();
    expect(() => groupsInstance().render({ today, className: "expense-days", children: null }, null)).not.toThrow();
  });
  it("lets an explicit reveal win after entry scroll and uses the latest root through refresh", () => {
    const trace: string[] = [];
    const currentDay = mockDay(today, trace);
    const otherDay = mockDay(tomorrow, trace);
    const article = mockArticle({ id: "item-restaurant", day: otherDay, trace });
    const ref: { current: DayGroupsHandle | null } = { current: null };
    const instance = groupsInstance();
    const props = { today, className: "itinerary-days", children: "Items", ref };
    instance.render(props, mockRoot({ days: [currentDay, otherDay], articles: [article] }));
    ref.current?.revealItem("restaurant");
    expect(trace).toEqual([`day-scroll:${today}`, `open:${tomorrow}:true`, "item-scroll:item-restaurant"]);
    const replacement = mockArticle({ id: "item-new-item", day: otherDay });
    instance.render({ ...props, children: "Refreshed items" }, mockRoot({ days: [currentDay, otherDay], articles: [replacement] }));
    ref.current?.revealItem("new-item");
    expect(replacement.scrollIntoView).toHaveBeenCalledOnce();
    expect(currentDay.scrollIntoView).toHaveBeenCalledOnce();
  });
});
