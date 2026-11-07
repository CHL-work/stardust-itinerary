import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventTimeFields } from "@/components/event-time-fields";
import { eventEditorFailureMessage, eventEditorMessages } from "@/lib/app/event-editor-i18n";
import * as expenseHelpers from "@/lib/app/event-expense-editor";
import { isFlightNumber, normalizeFlightNumber } from "@/lib/app/flight";
import { flightMessages } from "@/lib/app/flight-i18n";
import * as splitHelpers from "@/lib/app/expense-split-editor";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import { parseExpenseAmount } from "@/lib/app/expense-entry";
import { addMinutesToWallTime, minutesBetweenWallTimes } from "@/lib/app/wall-time";
import { locales, messages } from "@/lib/i18n";

// Run the actual editor closures with synthetic state and inert network callbacks.
const source = readFileSync("src/components/app-shell.tsx", "utf8");
const ast = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string): string {
  let result = "";
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      result = `const ${node.getText(ast)};`;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(result, `actual declaration ${name}`).not.toBe("");
  return result;
}
function evaluate<T>(code: string, result: string, bindings: Record<string, unknown> = {}): T {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return ${result};`)(...Object.values(bindings)) as T;
}
function closure<T>(name: string, bindings: Record<string, unknown>): T {
  return evaluate(declaration(name), name, bindings);
}
const timing = evaluate<{
  inputDateTime: (value: string | null, zone: string) => string;
  zonedInputToIso: (value: string, zone: string) => string;
}>(["dateTimeParts", "inputDateTime", "zonedInputToIso"].map(declaration).join("\n"), "({inputDateTime, zonedInputToIso})");
const id = (number: number) => `a9260000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const overview = {
  members: [{ id: id(1), displayName: "Synthetic traveler", status: "active" }],
  session: { memberId: id(1), isOwner: true },
  days: [1, 2].map((day) => ({ id: id(10 + day), date: `2030-04-0${day}` })),
  trip: { id: id(2), timeZone: "Asia/Tokyo", startsOn: "2030-04-01", endsOn: "2030-04-02", defaultCurrency: "JPY" },
  permissions: { canEditExpenses: true, itineraryRequiresApproval: true, expenseRequiresApproval: true },
};
const item = {
  id: id(3), tripDayId: id(11), title: "Synthetic event", itemType: "meal", currentRevision: 4,
  startsAt: "2030-04-01T01:00:37.123Z", endsAt: null as string | null,
  createdByMemberId: id(1), visibility: "trip", viewerMemberIds: [], isLocked: false,
};
type Draft = {
  title: string; tripDayId: string; itemType: string; startsAt: string; endsAt: string; durationMinutes: string;
  linkedExpense: expenseHelpers.EventExpenseDraft;
} & Record<string, unknown>;
const flightHelpers = evaluate<Record<string, unknown>>(["flightDraft", "flightFromDraft"].map(declaration).join("\n"),
  "({flightDraft, flightFromDraft})", { normalizeFlightNumber });
const baseBindings = { ...expenseHelpers, ...splitHelpers, expenseAmountInput, parseExpenseAmount, ...timing, overview, messages: messages.en,
  eventEditorCopy: eventEditorMessages("en"), eventEditorFailureMessage, addMinutesToWallTime, minutesBetweenWallTimes,
  ...flightHelpers, normalizeFlightNumber, isFlightNumber, flightMessages, locale: "en" };
function editor(initial: Draft | null = null) {
  let draft = initial;
  const eventSaveInFlight = { current: false };
  const setEventDraft = vi.fn((next: Draft | null) => { draft = next; });
  const setEventSaveError = vi.fn();
  const bindings = () => ({ ...baseBindings, eventDraft: draft, eventSaveInFlight, setEventDraft, setEventSaveError,
    setEditingItem: vi.fn(), setBusy: vi.fn(), setNotice: vi.fn(), setPendingEventLoadingId: vi.fn(),
    pickCurrentTripDay: () => overview.days[0],
    tripLocalDateKey: (date: Date, zone: string) => timing.inputDateTime(date.toISOString(), zone).slice(0, 10) });
  const update = (name: string, value: string) => closure<(value: string) => void>(name, bindings())(value);
  return {
    get draft() { return draft!; }, eventSaveInFlight, setEventDraft, setEventSaveError,
    open(target: unknown = "new") { closure<(target: unknown) => void>("openEvent", bindings())(target); },
    async openPending(detail: unknown) {
      await closure<(request: unknown) => Promise<void>>("openPendingEvent", { ...bindings(),
        canEditPendingEvent: () => true, jsonRequest: vi.fn(async () => detail) })({ requestId: id(4) });
    },
    update,
    now(field: "startsAt" | "endsAt") {
      closure<(field: string) => void>("fillEventTimeNow", { ...bindings(),
        updateEventStart: (value: string) => update("updateEventStart", value),
        updateEventEnd: (value: string) => update("updateEventEnd", value) })(field);
    },
    async save(target: unknown = "new", context = overview) {
      const request = vi.fn(async () => ({ status: "approved" }));
      await closure<(event: { preventDefault: () => void }) => Promise<void>>("saveEvent", {
        ...bindings(), overview: context, editingItem: target, jsonRequest: request, refresh: vi.fn(async () => {}),
        isPendingEventEditorTarget: (value: unknown) => Boolean(value && typeof value === "object" && "kind" in value),
      })({ preventDefault: vi.fn() });
      return request;
    },
  };
}
function initialized(target: unknown = item) { const result = editor(); result.open(target); return result; }
function patchFrom(request: Awaited<ReturnType<ReturnType<typeof editor>["save"]>>) {
  return JSON.parse(String((request.mock.calls[0] as unknown as [string, RequestInit])[1].body));
}
afterEach(() => { vi.useRealTimers(); });

describe("optional ends in actual manual event editors", () => {
  it.each(["new", "canonical"])("opens and saves %s without inventing an end or duration", async (kind) => {
    const target = kind === "new" ? "new" : item;
    const run = initialized(target);
    expect(run.draft).toMatchObject({ endsAt: "", durationMinutes: "" });
    const request = await run.save(target);
    expect(run.setEventSaveError).not.toHaveBeenCalledWith(expect.any(String));
    expect(request).toHaveBeenCalledOnce();
    expect(patchFrom(request)).toMatchObject({ operation: kind === "new" ? "create" : "update", patch: { endsAt: null } });
  });
  it.each(["create", "update"])("retains missing ends and revision on pending %s edits", async (operation) => {
    const detail = { requestId: id(4), proposalRevision: 7, createdByMemberId: id(1), operation, patch: { ...item, linkedExpense: null } };
    const run = editor(); await run.openPending(detail);
    expect(run.draft).toMatchObject({ endsAt: "", durationMinutes: "" });
    run.draft.title = "Corrected synthetic title";
    const request = await run.save({ kind: "pending", detail });
    expect(request).toHaveBeenCalledOnce();
    expect(patchFrom(request)).toMatchObject({ proposalRevision: 7, patch: { title: "Corrected synthetic title", endsAt: null } });
    expect((request.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("PUT");
  });
  it.each(["updateEventEnd", "updateEventDuration"])("%s clears both fields and explicitly clears an existing stored end", async (handler) => {
    const timed = { ...item, endsAt: "2030-04-01T02:00:37.123Z" };
    const run = initialized(timed); run.update(handler, "");
    expect(run.draft).toMatchObject({ endsAt: "", durationMinutes: "" });
    expect(patchFrom(await run.save(timed)).patch.endsAt).toBeNull();
  });
  it("retains original timestamp precision on unrelated edits", async () => {
    const timed = { ...item, endsAt: "2030-04-01T02:03:54.321Z" };
    const run = initialized(timed); run.draft.title = "Corrected title";
    expect(patchFrom(await run.save(timed)).patch).toMatchObject({ startsAt: item.startsAt, endsAt: timed.endsAt });
  });
  it("calculates an explicitly edited duration from the retained precise start", async () => {
    const timed = { ...item, endsAt: "2030-04-01T02:00:37.123Z" };
    const run = initialized(timed); run.update("updateEventDuration", "90");
    expect(patchFrom(await run.save(timed)).patch).toMatchObject({
      startsAt: item.startsAt, endsAt: "2030-04-01T02:30:37.123Z",
    });
  });
  it("respects an explicitly entered end after a duration edit", async () => {
    const run = initialized(item); run.update("updateEventDuration", "90");
    run.update("updateEventEnd", "2030-04-01T12:00");
    expect(patchFrom(await run.save(item)).patch.endsAt).toBe("2030-04-01T03:00:00.000Z");
  });
  it("rejects an overflowing duration without crashing input handling", async () => {
    const run = initialized(item);
    expect(() => run.update("updateEventDuration", "1000000000000000")).not.toThrow();
    expect(await run.save(item)).not.toHaveBeenCalled();
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").endDateOutsideTrip);
  });
  it("allows a transport departure without inventing an arrival and retains endpoint validation", async () => {
    const run = initialized({ ...item, itemType: "transport", departureLocationName: "Synthetic station" });
    expect(patchFrom(await run.save(item)).patch).toMatchObject({ endsAt: null, departureLocationName: "Synthetic station", destinationLocationName: null });
    const empty = initialized({ ...item, itemType: "transport" });
    expect(await empty.save(item)).not.toHaveBeenCalled();
    expect(empty.setEventSaveError).toHaveBeenLastCalledWith(messages.en.transportEndpointRequired);
  });
  it.each(["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"])("rejects supplied nonpositive/noninteger/unsafe duration %s", async (duration) => {
    const run = initialized(); run.update("updateEventDuration", duration);
    expect(await run.save(item)).not.toHaveBeenCalled();
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").durationWholeMinutes);
  });
  it.each(["2030-04-01T09:00", "2030-04-01T10:00"])("does not silently discard an invalid nonblank end %s", async (end) => {
    const run = initialized(); run.update("updateEventEnd", end);
    expect(await run.save(item)).not.toHaveBeenCalled();
    expect(run.draft.endsAt).toBe(end);
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").endAfterStart);
  });
  it("rejects an end outside the trip even when derived from duration", async () => {
    const run = initialized(); run.update("updateEventStart", "2030-04-02T23:45"); run.update("updateEventDuration", "30");
    expect(await run.save(item)).not.toHaveBeenCalled();
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").endDateOutsideTrip);
  });
  it("keeps member approval policy when an event has no end", async () => {
    const run = initialized();
    const request = await run.save(item, { ...overview, session: { ...overview.session, isOwner: false } });
    expect(patchFrom(request)).toMatchObject({ baseRevision: 4, applyNow: false, patch: { endsAt: null } });
  });
});

describe("time calculation and current-time controls", () => {
  it("does not add an end when a start with unknown duration changes", () => {
    const run = initialized(); run.update("updateEventStart", "2030-04-02T12:00");
    expect(run.draft).toMatchObject({ tripDayId: id(12), endsAt: "", durationMinutes: "" });
  });
  it("keeps duration/end calculations across midnight when supplied", () => {
    const run = initialized(); run.update("updateEventStart", "2030-04-01T23:30"); run.update("updateEventDuration", "90");
    expect(run.draft.endsAt).toBe("2030-04-02T01:00");
    run.update("updateEventEnd", "2030-04-02T02:00"); expect(run.draft.durationMinutes).toBe("150");
    run.update("updateEventStart", "2030-04-01T22:00"); expect(run.draft.endsAt).toBe("2030-04-02T00:30");
  });
  it("uses the click-time Tokyo date, updates its day, and never changes linked-expense timing", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-04-01T14:59:50Z"));
    const run = initialized(); const expense = structuredClone(run.draft.linkedExpense);
    vi.setSystemTime(new Date("2030-04-01T15:01:45Z")); run.now("startsAt");
    expect(run.draft).toMatchObject({ startsAt: "2030-04-02T00:01", tripDayId: id(12), endsAt: "", durationMinutes: "" });
    expect(run.draft.linkedExpense).toEqual(expense);
  });
  it("Start Now preserves a supplied duration and End Now derives minutes", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-04-01T02:30:45Z"));
    const run = initialized(); run.update("updateEventDuration", "90"); run.now("startsAt");
    expect(run.draft).toMatchObject({ startsAt: "2030-04-01T11:30", endsAt: "2030-04-01T13:00", durationMinutes: "90" });
    vi.setSystemTime(new Date("2030-04-01T04:00:12Z")); run.now("endsAt");
    expect(run.draft.durationMinutes).toBe("90");
  });
  it("does not clamp Now to a trip date when today is outside the trip", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-04-03T03:00:00Z"));
    const run = initialized(); run.now("startsAt");
    expect(run.draft.startsAt).toBe("2030-04-03T12:00");
    expect(await run.save(item)).not.toHaveBeenCalled();
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(messages.en.startDateOutsideTrip);
  });
  it("blocks an End Now before start without discarding the invalid input", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-04-01T00:00:00Z"));
    const run = initialized(); run.now("endsAt");
    expect(run.draft).toMatchObject({ endsAt: "2030-04-01T09:00", durationMinutes: "" });
    expect(await run.save(item)).not.toHaveBeenCalled();
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").endAfterStart);
  });
  it.each(["startsAt", "endsAt"] as const)("ignores %s Now while saving", (field) => {
    const run = initialized(); const before = structuredClone(run.draft); run.setEventDraft.mockClear();
    run.eventSaveInFlight.current = true; run.now(field);
    expect(run.draft).toEqual(before); expect(run.setEventDraft).not.toHaveBeenCalled();
  });
});

describe("localized optional event time form", () => {
  it.each(locales)("renders optional fields and distinct non-submit Now controls in %s", (locale) => {
    const copy = eventEditorMessages(locale); const fillNow = vi.fn();
    const props = { startsLabel: "Start", endsLabel: "End", durationLabel: "Duration", copy,
      startsAt: "2030-04-01T10:00", endsAt: "", durationMinutes: "", min: "2030-04-01T00:00", max: "2030-04-02T23:59", busy: false,
      changeStart: vi.fn(), changeEnd: vi.fn(), changeDuration: vi.fn(), fillNow };
    const html = renderToStaticMarkup(createElement(EventTimeFields, props));
    const inputs = html.match(/<input\b[^>]*>/g)!; const buttons = html.match(/<button\b[^>]*>[^<]*<\/button>/g)!;
    expect(inputs).toHaveLength(3); expect(inputs.filter((tag) => tag.includes('required=""'))).toHaveLength(1);
    expect(inputs[0]).toContain('required=""'); expect(inputs[1]).toContain('value=""'); expect(inputs[2]).toContain('step="1"');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) { expect(button).toContain('type="button"'); expect(button).toContain(`>${copy.now}</button>`); }
    expect(buttons[0]).toContain(`aria-label="${copy.startNow}"`); expect(buttons[1]).toContain(`aria-label="${copy.endNow}"`);
    expect(copy.startNow).not.toBe(copy.endNow); expect(html).toContain(copy.unknownEnd); expect(html).toContain(copy.optional);
    expect(fillNow).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(createElement(EventTimeFields, { ...props, busy: true }))).toMatch(/<fieldset[^>]*disabled=""/);
  });
  it("keeps phone inputs readable, touch controls at least 44px, and a single-column phone layout", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.event-time-now\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.event-time-fields input\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.event-time-fields\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.event-time-fields input\s*\{\s*font-size:\s*16px/);
  });
});
