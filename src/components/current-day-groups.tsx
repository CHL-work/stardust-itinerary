"use client";

import { useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";

export type DayGroupsHandle = { revealItem: (itemId: string) => void; revealExpense: (expenseId: string) => void };

export function nearestDayDate(dates: readonly string[], today: string): string | null {
  const instant = Date.parse(`${today}T00:00:00Z`);
  return [...dates].sort((a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - instant)
    - Math.abs(Date.parse(`${b}T00:00:00Z`) - instant) || a.localeCompare(b))[0] ?? null;
}

/** View-local disclosure state survives data refreshes, but resets when this page remounts. */
export function DayAccordion({ date, today, className = "", children }: {
  date: string; today: string; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(date === today);
  return <details data-day-date={date} className={`expense-day ${className}${date === today ? " is-current-day" : ""}`.trim()}
    open={open} onToggle={(event) => { const next = event.currentTarget.open; setOpen((current) => current === next ? current : next); }}>
    {children}
  </details>;
}

/** Explicit Calendar links may reveal another day; no event or review mutation is performed. */
export function revealGroupedItem(root: HTMLElement, itemId: string): boolean {
  const articles = [...root.querySelectorAll<HTMLElement>("article")];
  const item = articles.find((article) => article.dataset.pendingTargetItemId === itemId && article.dataset.ownsActions === "true")
    ?? articles.find((article) => article.dataset.pendingTargetItemId === itemId)
    ?? articles.find((article) => article.id === `item-${itemId}`);
  if (!item) return false;
  const day = item.closest<HTMLDetailsElement>("details[data-day-date]");
  if (day) day.open = true;
  item.scrollIntoView({ behavior: "instant", block: "start" });
  return true;
}

export function revealGroupedExpense(root: HTMLElement, expenseId: string): boolean {
  const item = [...root.querySelectorAll<HTMLElement>("article")].find((article) => article.id === `expense-${expenseId}`);
  if (!item) return false;
  const day = item.closest<HTMLDetailsElement>("details[data-day-date]");
  if (day) day.open = true;
  item.scrollIntoView({ behavior: "instant", block: "start" });
  return true;
}

export function CurrentDayGroups({ today, className, children, ref }: {
  today: string; className: string; children: ReactNode; ref?: Ref<DayGroupsHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ revealItem(itemId) {
    if (root.current) revealGroupedItem(root.current, itemId);
  }, revealExpense(expenseId) {
    if (root.current) revealGroupedExpense(root.current, expenseId);
  } }), []);
  useLayoutEffect(() => {
    const groups = [...(root.current?.querySelectorAll<HTMLDetailsElement>("details[data-day-date]") ?? [])];
    const targetDate = nearestDayDate(groups.map((day) => day.dataset.dayDate!), today);
    const target = groups.find((day) => day.dataset.dayDate === targetDate);
    // Instant, once per page entry/date change: no animated motion or refresh-driven scroll stealing.
    target?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [today]);
  return <div className={className} ref={root}>{children}</div>;
}
