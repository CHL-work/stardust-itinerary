import { readFileSync } from "node:fs";
import { createElement, Fragment, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { Check, PencilLine, Plus, X } from "lucide-react";

import { JsonRequestError, PendingExpenseList, TimelineList, TripTimeline } from "@/components/app-shell";
import { ExpenseDisplayCard } from "@/components/expense-display-card";
import { expensePageMessages } from "@/lib/app/expense-page-i18n";
import { mobileCardsMessages } from "@/lib/app/mobile-cards-i18n";
import { projectTimelinePoints } from "@/lib/app/timeline";
import { projectPersonalCalendarEvents } from "@/lib/calendar/timeline";
import { calendarImportMessages } from "@/lib/calendar/import-i18n";
import type { PendingExpenseProjection, PendingItineraryProjection } from "@/lib/app/types";
import { locales, messages, type Locale } from "@/lib/i18n";

type TimelineProps = Parameters<typeof TimelineList>[0];
type Item = TimelineProps["points"][number]["item"];
const item: Item = {
  id: "synthetic-event", tripDayId: "synthetic-day", title: "Synthetic restaurant", itemType: "meal",
  startsAt: "2030-04-01T10:00:00.000Z", endsAt: "2030-04-01T11:00:00.000Z", locationName: "Synthetic venue", mapUrl: null,
  departureLocationName: null, departureMapUrl: null, destinationLocationName: null, destinationMapUrl: null,
  notes: null, createdByMemberId: "synthetic-member", creatorName: "Synthetic member", visibility: "trip", viewerMemberIds: [],
  status: "planned", isLocked: false, currentRevision: 9, weather: null, weatherForecasts: [], disruption: null, calendarLink: null,
};
const pending: PendingItineraryProjection & { id: string } = {
  ...item, id: "synthetic-pending", requestId: "synthetic-pending", status: "pending", itemType: "meal", operation: "create", targetItemId: null,
  title: "Synthetic proposed museum", requestedByMemberId: "synthetic-member", requestedByName: "Synthetic member",
  createdAt: "2030-04-01T00:00:00.000Z", updatedAt: "2030-04-01T00:00:00.000Z", proposalRevision: 4,
  startsAt: "2030-04-01T09:00:00.000Z", endsAt: "2030-04-01T10:00:00.000Z",
};
const tripDays = [{ id: "synthetic-day", date: "2030-04-01" }, { id: "synthetic-day-2", date: "2030-04-02" }];
const points = <T extends Item | (typeof pending)>(items: T[]) => projectTimelinePoints(items, { tripDays, timeZone: "Asia/Tokyo" });
function timelineProps(items = [item], isOwner = true, locale: Locale = "en"): TimelineProps {
  return {
    overview: { session: { isOwner, memberId: "synthetic-member" }, trip: { timeZone: "Asia/Tokyo" },
      permissions: { canEditItinerary: true, canSyncCalendar: true } } as TimelineProps["overview"],
    points: points(items), locale, messages: messages[locale], busy: false, calendarBusy: false,
    openEvent: vi.fn(), cancelOrRestore: vi.fn(async () => {}), removeCancelledEvent: vi.fn(async () => {}),
    syncCalendar: vi.fn(), showDisruption: vi.fn(), emptyMessage: "Synthetic empty day",
  };
}
function buttonNodes(node: ReactNode): Array<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }> {
  if (Array.isArray(node)) return node.flatMap(buttonNodes);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return [];
  return node.type === "button" ? [node.props] : buttonNodes(node.props.children);
}
const pendingExpense: PendingExpenseProjection = {
  requestId: "synthetic-expense-request", proposalRevision: 7, status: "pending", requestedByMemberId: "synthetic-member",
  requestedByName: "Synthetic member", createdAt: "2030-04-01T00:00:00.000Z", description: "Synthetic proposed bill",
  amountMinor: 3000, currency: "JPY", payerMemberId: "synthetic-member", payerName: "Synthetic member",
  itineraryItemId: item.id, itineraryItemTitle: item.title, occurredAt: "2030-04-01T09:00:00.000Z",
  splits: [{ memberId: "synthetic-member", memberName: "Synthetic member", shareMinor: 3000 }],
};

describe("consistent pending and cancelled event cards", () => {
  it.each(locales)("labels a cancelled event in %s and offers removal only to the owner", (locale) => {
    for (const isOwner of [true, false]) {
      const props = timelineProps([{ ...item, status: "cancelled" }], isOwner, locale);
      const markup = renderToStaticMarkup(createElement(TimelineList, props));
      expect(markup).toContain(messages[locale].eventStatusCancelled);
      expect(markup).toContain("cancelled-event-label");
      expect(markup.includes(mobileCardsMessages(locale).remove)).toBe(isOwner);
      expect(markup).not.toContain(messages[locale].addToCalendar);
      expect(props.removeCancelledEvent).not.toHaveBeenCalled();
    }
    expect(renderToStaticMarkup(createElement(TimelineList, timelineProps([item], true, locale)))).not.toContain("cancelled-event-label");
  });

  it("gives an active event horizontal edit, cancel and calendar controls but no remove action", () => {
    const props = timelineProps();
    const node = TimelineList(props);
    const markup = renderToStaticMarkup(node);
    expect(markup).toContain('class="row-actions card-actions"');
    expect(markup).toContain(messages.en.editEvent);
    expect(markup).toContain(messages.en.cancelEvent);
    expect(markup).toContain(messages.en.addToCalendar);
    expect(markup).not.toContain("danger-button");
    const buttons = buttonNodes(node);
    expect(buttons).toHaveLength(3);
    buttons[0].onClick?.(); buttons[1].onClick?.(); buttons[2].onClick?.();
    expect(props.openEvent).toHaveBeenCalledWith(item);
    expect(props.cancelOrRestore).toHaveBeenCalledWith(item);
    expect(props.syncCalendar).toHaveBeenCalledWith("item", item.id);
  });

  it("interleaves pending and posted events by time in one timeline instead of a separate pending section", () => {
    const props = timelineProps();
    const markup = renderToStaticMarkup(createElement(TripTimeline, {
      ...props, pending: { points: points([pending]), edit: vi.fn(), canEdit: () => true, approve: vi.fn(), reject: vi.fn() },
    }));
    expect(markup.indexOf(pending.title)).toBeLessThan(markup.indexOf(item.title));
    expect(markup).toContain('class="timeline-card trip-timeline"');
    expect(markup.match(/timeline-card/gu)).toHaveLength(1);
    expect(markup).not.toContain("pending-itinerary-list");
    expect(markup).toContain(mobileCardsMessages("en").editShort);
    expect(markup).toContain(mobileCardsMessages("en").approveShort);
    expect(markup).toContain(mobileCardsMessages("en").rejectShort);
  });

  it.each(locales)("interleaves personal Calendar rows with pending and approved events in %s", (locale) => {
    const raw = { id: "calendar-source", title: "Synthetic personal Calendar", startsAt: "2030-04-01T09:30:00Z", endsAt: "2030-04-01T09:45:00Z", location: "Synthetic place", htmlLink: null, linkedItineraryItemId: null };
    const calendarPoints = projectPersonalCalendarEvents([raw, { ...raw, id: "linked-source", linkedItineraryItemId: item.id }], ["2030-04-01"], "Asia/Tokyo");
    const openCalendarImport = vi.fn();
    const markup = renderToStaticMarkup(createElement(TripTimeline, {
      ...timelineProps([item], true, locale), calendarPoints, openCalendarImport,
      pending: { points: points([pending]), edit: vi.fn(), canEdit: () => true, approve: vi.fn(), reject: vi.fn() },
    }));
    expect(markup.indexOf(pending.title)).toBeLessThan(markup.indexOf(raw.title));
    expect(markup.indexOf(raw.title)).toBeLessThan(markup.indexOf(item.title));
    expect(markup.match(/data-calendar-event-id=/gu)).toHaveLength(1);
    expect(markup).toContain(calendarImportMessages(locale).add);
    expect(markup).not.toContain("linked-source"); expect(openCalendarImport).not.toHaveBeenCalled();
  });

  it("retains only one action set per canonical and pending transport while interleaving their endpoints", () => {
    const transport = { ...item, itemType: "transport" as const, title: "Synthetic train", departureLocationName: "Synthetic origin", destinationLocationName: "Synthetic destination", startsAt: "2030-04-01T08:00:00.000Z", endsAt: "2030-04-01T12:00:00.000Z" };
    const proposed = { ...pending, itemType: "transport" as const, title: "Synthetic proposed train", departureLocationName: "Synthetic pending origin", destinationLocationName: "Synthetic pending destination", startsAt: "2030-04-01T09:00:00.000Z", endsAt: "2030-04-01T11:00:00.000Z" };
    const markup = renderToStaticMarkup(createElement(TripTimeline, {
      ...timelineProps([transport]), pending: { points: points([proposed]), edit: vi.fn(), canEdit: () => true, approve: vi.fn(), reject: vi.fn() },
    }));
    expect(markup.match(/data-timeline-point=/gu)).toHaveLength(2);
    expect(markup.match(/data-pending-timeline-point=/gu)).toHaveLength(2);
    expect(markup.split(` ${messages.en.editEvent}</button>`)).toHaveLength(2);
    expect(markup.split(` ${messages.en.addToCalendar}</button>`)).toHaveLength(2);
    expect(markup.split(`>${mobileCardsMessages("en").editShort}</button>`)).toHaveLength(2);
    expect(markup.split(`>${mobileCardsMessages("en").approveShort}</button>`)).toHaveLength(2);
    expect(markup.split(`>${mobileCardsMessages("en").rejectShort}</button>`)).toHaveLength(2);
    const roles = Array.from(markup.matchAll(/data-(?:pending-)?timeline-point="(departure|arrival)"/gu), (match) => match[1]);
    expect(roles).toEqual(["departure", "departure", "arrival", "arrival"]);
  });

  it("allows the selected-day arrival fallback to carry actions once when departure is on another date", () => {
    const transport = { ...item, itemType: "transport" as const, departureLocationName: "Synthetic origin", destinationLocationName: "Synthetic destination", startsAt: "2030-04-01T14:00:00.000Z", endsAt: "2030-04-01T16:00:00.000Z" };
    const props = timelineProps([transport]);
    const markup = renderToStaticMarkup(createElement(TripTimeline, { ...props,
      points: props.points.filter((point) => point.kind === "arrival"), allowActionFallback: true, pending: { points: [] },
    }));
    expect(markup.match(/data-timeline-point="arrival"/gu)).toHaveLength(1);
    expect(markup.split(messages.en.editEvent)).toHaveLength(2);
    expect(markup.split(messages.en.addToCalendar)).toHaveLength(2);
  });

  it.each(locales)("renders pending expenses as normal cards with owner-only version-bound review in %s", (locale) => {
    for (const isOwner of [true, false]) {
      const review = vi.fn();
      const value = { ...pendingExpense };
      const node = PendingExpenseList({ expenses: [value], locale, messages: messages[locale], timeZone: "Asia/Tokyo", memberId: "synthetic-member", busy: false, isOwner, review, embedded: true });
      const markup = renderToStaticMarkup(node);
      expect(markup).toContain('data-expense-status="pending"');
      expect(markup).toContain("data-personal-share");
      expect(markup).not.toContain("<section");
      expect(markup.includes(messages[locale].approveRequest)).toBe(isOwner);
      expect(markup.includes(messages[locale].rejectRequest)).toBe(isOwner);
      const buttons = buttonNodes(node);
      expect(buttons).toHaveLength(isOwner ? 2 : 0);
      value.proposalRevision = 8;
      for (const button of buttons) button.onClick?.();
      if (isOwner) {
        expect(review).toHaveBeenNthCalledWith(1, value.requestId, "approve", 7);
        expect(review).toHaveBeenNthCalledWith(2, value.requestId, "reject", 7);
      } else expect(review).not.toHaveBeenCalled();
    }
  });

  it("keeps action buttons wrapping horizontally and large enough for touch without fixed full widths", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.card-actions, \.timeline-content > \.card-actions\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/u);
    expect(css).toMatch(/\.card-actions > button\s*\{[^}]*width:\s*auto[^}]*min-height:\s*44px/u);
    expect(css).toMatch(/\.pending-timeline-row \.status-pending\s*\{[^}]*color:\s*#ffe399/u);
  });
});

const source = readFileSync("src/components/app-shell.tsx", "utf8");
const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback<T>(name: string, bindings: Record<string, unknown>): T {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) initializer = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(initializer, `The actual ${name} callback must exist`).toBeDefined();
  const code = ts.transpileModule(`const invoke = ${initializer!.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return invoke;`)(...Object.values(bindings)) as T;
}

describe("expense card action cleanup", () => {
  it.each(locales)("keeps only edit and allowed draft review on linked expense cards in %s", (locale) => {
    let card: ts.JsxElement | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "ExpenseDisplayCard"
        && node.openingElement.attributes.getText(tree).includes('key={`expense:${expense.id}`}')) card = node;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(card).toBeDefined();
    const code = ts.transpileModule(`const render = () => (${card!.getText(tree)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "createElement", jsxFragmentFactory: "Fragment" },
    }).outputText;
    for (const status of ["posted", "draft"]) {
      for (const isOwner of [false, true]) {
        const expense = { ...pendingExpense, id: "synthetic-linked-bill", currentRevision: 6, status };
        const openExpense = vi.fn(); const reviewExpenseDraft = vi.fn();
        const copy = expensePageMessages(locale);
        const bindings = { createElement, Fragment, ExpenseDisplayCard, PencilLine, Check, X, Plus, expense, locale,
          overview: { session: { memberId: "synthetic-member", isOwner }, trip: { timeZone: "Asia/Tokyo" },
            permissions: { canEditExpenses: true }, itinerary: [item] },
          busy: false, expensePageCopy: copy, messages: messages[locale], openExpense, reviewExpenseDraft };
        const render = new Function(...Object.keys(bindings), `${code}; return render;`)(...Object.values(bindings)) as () => ReactNode;
        const node = render();
        const markup = renderToStaticMarkup(node);
        const controls = buttonNodes(node);
        const labels = controls.map((control) => renderToStaticMarkup(createElement("button", control)).replace(/<[^>]*>/gu, "").trim());
        expect(labels).toEqual(status === "draft" && isOwner
          ? [copy.edit, messages[locale].approveRequest, messages[locale].rejectRequest] : [copy.edit]);
        expect(markup).not.toContain("expense-another-bill");
        expect(markup).not.toContain("Add my bill to this event");
        controls[0].onClick?.();
        expect(openExpense).toHaveBeenCalledExactlyOnceWith(expense);
        if (status === "draft" && isOwner) {
          controls[1].onClick?.(); controls[2].onClick?.();
          expect(reviewExpenseDraft).toHaveBeenNthCalledWith(1, expense, "approve");
          expect(reviewExpenseDraft).toHaveBeenNthCalledWith(2, expense, "reject");
        } else expect(reviewExpenseDraft).not.toHaveBeenCalled();
      }
    }
  });

  it("retains ordinary expense creation and event-editor linked expenses", () => {
    expect(source).toContain('onClick={() => openExpense()}');
    expect(source).toContain('<details className="event-expense-details full-field">');
    expect(source).toContain("{messages.addLinkedExpense}");
    expect(source).toContain("eventDraft.linkedExpense.enabled");
    expect(source).toContain("updateExpenseEvent(event.target.value)");
    expect(source).not.toContain("expense-another-bill");
    expect(source).not.toContain("expensePageCopy.anotherBill");
    for (const locale of locales) expect(expensePageMessages(locale)).not.toHaveProperty("anotherBill");
    expect(readFileSync("src/app/globals.css", "utf8")).not.toContain(".expense-another-bill");
  });
});

function mutationBindings(options: { isOwner?: boolean; busy?: boolean; inFlight?: boolean; confirm?: boolean; request?: () => Promise<unknown> } = {}) {
  const request = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => options.request ? options.request() : ({ status: "approved" }));
  const confirm = vi.fn(() => options.confirm ?? true);
  return {
    overview: { session: { isOwner: options.isOwner ?? true }, trip: { id: "synthetic-trip" } },
    busy: options.busy ?? false, cardMutationPending: { current: options.inFlight ?? false },
    cardCopy: mobileCardsMessages("en"), messages: messages.en, JsonRequestError,
    jsonRequest: request, window: { confirm }, setBusy: vi.fn(), setNotice: vi.fn(),
    refresh: vi.fn(async () => {}), loadApprovalHistory: vi.fn(async () => {}),
  };
}
const cancelled = { ...item, status: "cancelled" };
const draft = { id: "synthetic-expense", status: "draft", currentRevision: 6 };

describe("actual card mutation safety callbacks", () => {
  it("requires explicit confirmation and submits the cancelled event's displayed revision", async () => {
    const bindings = mutationBindings();
    const remove = callback<(value: typeof cancelled) => Promise<void>>("removeCancelledEvent", bindings);
    await remove(cancelled);
    expect(bindings.window.confirm).toHaveBeenCalledWith(bindings.cardCopy.removeConfirm);
    expect(bindings.jsonRequest).toHaveBeenCalledWith(`/api/trips/synthetic-trip/itinerary/${item.id}/remove`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 9, confirm: true }),
    });
    expect(bindings.setNotice).toHaveBeenCalledWith(bindings.cardCopy.removed);
    expect(bindings.refresh).toHaveBeenCalledOnce();
    expect(bindings.cardMutationPending.current).toBe(false);
  });

  it.each([{ isOwner: false }, { busy: true }, { inFlight: true }, { confirm: false }])("does not remove with failed local guard %j", async (options) => {
    const bindings = mutationBindings(options);
    await callback<(value: typeof cancelled) => Promise<void>>("removeCancelledEvent", bindings)(cancelled);
    expect(bindings.jsonRequest).not.toHaveBeenCalled();
    expect(bindings.refresh).not.toHaveBeenCalled();
  });

  it("does not remove a planned event even for the owner", async () => {
    const bindings = mutationBindings();
    await callback<(value: Item) => Promise<void>>("removeCancelledEvent", bindings)(item);
    expect(bindings.window.confirm).not.toHaveBeenCalled();
    expect(bindings.jsonRequest).not.toHaveBeenCalled();
  });

  it.each(["approve", "reject"] as const)("reviews canonical draft %s through audited revision-checked changes without altering amounts", async (decision) => {
    const bindings = mutationBindings();
    await callback<(value: typeof draft, decision: "approve" | "reject") => Promise<void>>("reviewExpenseDraft", bindings)(draft, decision);
    const init = bindings.jsonRequest.mock.calls[0]?.[1] as { body: string } | undefined;
    expect(JSON.parse(init!.body)).toEqual({ entityType: "expense", entityId: draft.id, baseRevision: 6,
      operation: decision === "approve" ? "update" : "void", patch: decision === "approve" ? { status: "posted" } : {},
      applyNow: true, reason: `Owner ${decision} of expense draft` });
    expect(bindings.setNotice).toHaveBeenCalledWith(decision === "approve" ? bindings.cardCopy.draftApproved : bindings.cardCopy.draftRejected);
    expect(bindings.cardMutationPending.current).toBe(false);
  });

  it.each(["posted", "pending", "void"])("cannot use canonical-draft actions on %s status", async (status) => {
    const bindings = mutationBindings();
    await callback<(value: typeof draft, decision: "approve") => Promise<void>>("reviewExpenseDraft", bindings)({ ...draft, status }, "approve");
    expect(bindings.jsonRequest).not.toHaveBeenCalled();
  });

  it.each([{ isOwner: false }, { busy: true }, { inFlight: true }])("does not approve a canonical draft with failed guard %j", async (options) => {
    const bindings = mutationBindings(options);
    await callback<(value: typeof draft, decision: "approve") => Promise<void>>("reviewExpenseDraft", bindings)(draft, "approve");
    expect(bindings.jsonRequest).not.toHaveBeenCalled();
  });

  it.each(["removeCancelledEvent", "reviewExpenseDraft", "review"])("prevents same-tick duplicate submissions from %s", async (name) => {
    let finish!: (value: unknown) => void;
    const bindings = mutationBindings({ request: () => new Promise((resolve) => { finish = resolve; }) });
    const invoke = callback<(...args: unknown[]) => Promise<void>>(name, bindings);
    const args = name === "removeCancelledEvent" ? [cancelled] : name === "reviewExpenseDraft" ? [draft, "approve"] : ["synthetic-request", "approve", 7];
    const first = invoke(...args);
    void invoke(...args);
    expect(bindings.jsonRequest).toHaveBeenCalledOnce();
    finish({ status: "approved" });
    await first;
    expect(bindings.cardMutationPending.current).toBe(false);
  });

  it.each(["removeCancelledEvent", "reviewExpenseDraft"])("reports stale %s and does not automatically repeat it", async (name) => {
    const bindings = mutationBindings({ request: async () => { throw new JsonRequestError("Synthetic stale revision", 409); } });
    const invoke = callback<(...args: unknown[]) => Promise<void>>(name, bindings);
    await invoke(...(name === "removeCancelledEvent" ? [cancelled] : [draft, "reject"]));
    expect(bindings.jsonRequest).toHaveBeenCalledOnce();
    expect(bindings.setNotice).toHaveBeenCalledWith(bindings.cardCopy.stale);
    expect(bindings.cardMutationPending.current).toBe(false);
    expect(bindings.setBusy).toHaveBeenLastCalledWith(false);
  });

  it.each(["removeCancelledEvent", "reviewExpenseDraft"])("releases the local guard after %s network failure without retrying", async (name) => {
    const bindings = mutationBindings({ request: async () => { throw new Error("Synthetic offline"); } });
    await callback<(...args: unknown[]) => Promise<void>>(name, bindings)(...(name === "removeCancelledEvent" ? [cancelled] : [draft, "approve"]));
    expect(bindings.jsonRequest).toHaveBeenCalledOnce();
    expect(bindings.refresh).not.toHaveBeenCalled();
    expect(bindings.cardMutationPending.current).toBe(false);
    expect(bindings.setBusy).toHaveBeenLastCalledWith(false);
  });
});
