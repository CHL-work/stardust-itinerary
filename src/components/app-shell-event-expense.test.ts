import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { EventEditorFeedback, EventExpenseParticipants } from "@/components/event-editor-feedback";
import * as expenseHelpers from "@/lib/app/event-expense-editor";
import * as splitHelpers from "@/lib/app/expense-split-editor";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import { parseExpenseAmount } from "@/lib/app/expense-entry";
import { eventEditorFailureMessage, eventEditorMessages } from "@/lib/app/event-editor-i18n";
import { isFlightNumber, normalizeFlightNumber } from "@/lib/app/flight";
import { flightMessages } from "@/lib/app/flight-i18n";
import { resolveFlightPresentation } from "@/lib/app/flight-presentation";
import { eventTimeInputsFromInstants } from "@/lib/app/flight-editor-time";
import { wallTimeToIso, ZonedEventTimeError } from "@/lib/app/zoned-event-time";
import { tripLocalDateKey } from "@/lib/app/day-view";
import { addMinutesToWallTime } from "@/lib/app/wall-time";
import { locales, messages } from "@/lib/i18n";

// Execute the actual component closures with synthetic state and inert request callbacks.
// This catches wiring regressions that tests of the audience helper alone cannot see.
const source = readFileSync("src/components/app-shell.tsx", "utf8");
// The editor's module-level flight helpers (JOB-082), shared by every closure below.
function topLevelFunction(name: string): string {
  const text = source.replace(/\r\n/gu, "\n");
  const start = text.indexOf(`\nfunction ${name}(`);
  expect(start).toBeGreaterThan(0);
  return text.slice(start, text.indexOf("\n}\n", start) + 3);
}
const flightBindings = {
  ...new Function("normalizeFlightNumber", `${ts.transpileModule(["flightDraft", "flightFromDraft", "flightTimeSource"].map(topLevelFunction).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return { flightDraft, flightFromDraft, flightTimeSource };`)(normalizeFlightNumber) as Record<string, unknown>,
  normalizeFlightNumber, isFlightNumber, flightMessages, locale: "en",
  resolveFlightPresentation, eventTimeInputsFromInstants, wallTimeToIso, ZonedEventTimeError, tripLocalDateKey,
};
function closure<T>(name: string, next: string, bindings: Record<string, unknown>): T {
  const start = source.indexOf(`  const ${name} =`);
  const end = source.indexOf(`\n  const ${next} =`, start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const all = { ...flightBindings, ...bindings };
  return new Function(...Object.keys(all), `${code}; return ${name};`)(...Object.values(all)) as T;
}
const id = (number: number) => `a9210000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const member = (number: number, status = "active") => ({ id: id(number), status, displayName: `Synthetic member ${number}` });
const overview = { members: [member(1), member(2, "invited"), member(3), member(4, "removed")],
  session: { memberId: id(1), isOwner: true }, days: [{ id: id(5), date: "2030-04-01" }],
  trip: { id: id(6), timeZone: "UTC", defaultCurrency: "JPY" },
  permissions: { canEditExpenses: true, itineraryRequiresApproval: false, expenseRequiresApproval: false } };
const item = { id: id(7), tripDayId: id(5), title: "Synthetic event", itemType: "meal", startsAt: "2030-04-01T10:00:00Z",
  endsAt: "2030-04-01T11:00:00Z", createdByMemberId: id(1), viewerMemberIds: [id(2)], visibility: "private", isLocked: false, currentRevision: 1 };
const toInput = (value: string | null) => value?.slice(0, 16) ?? "";
type Draft = Record<string, unknown> & { linkedExpense: expenseHelpers.EventExpenseDraft };
function initialize(target: unknown, context = overview): Draft {
  let draft: Draft | null = null;
  const open = closure<(item: unknown) => void>("openEvent", "openPendingEvent", { ...expenseHelpers, ...splitHelpers, expenseAmountInput, overview: context,
    eventSaveInFlight: { current: false },
    setEventSaveError: vi.fn(), pickCurrentTripDay: () => context.days[0], tripLocalDateKey: () => "2030-04-01",
    inputDateTime: toInput, addMinutesToWallTime, setEditingItem: vi.fn(), setEventDraft: (next: Draft) => { draft = next; } });
  open(target);
  return draft!;
}
async function initializePending(detail: Record<string, unknown>): Promise<Draft> {
  let draft: Draft | null = null;
  const open = closure<(request: unknown) => Promise<void>>("openPendingEvent", "openExpense", { ...expenseHelpers, ...splitHelpers, expenseAmountInput,
    overview, canEditPendingEvent: () => true, setEventSaveError: vi.fn(), setBusy: vi.fn(), setPendingEventLoadingId: vi.fn(),
    eventSaveInFlight: { current: false },
    setNotice: vi.fn(), jsonRequest: vi.fn(async () => detail), inputDateTime: toInput, setEditingItem: vi.fn(),
    setEventDraft: (next: Draft) => { draft = next; }, messages: messages.en });
  await open({ requestId: id(8) });
  expect(draft).not.toBeNull();
  return draft!;
}
function submit(draft: Draft, target: unknown = item, response: () => Promise<unknown> = async () => ({ status: "approved" })) {
  const request = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => response());
  const setEventSaveError = vi.fn(); const setEventDraft = vi.fn(); const setEditingItem = vi.fn();
  const save = closure<(event: { preventDefault: () => void }) => Promise<void>>("saveEvent", "cancelOrRestore", {
    ...expenseHelpers, ...splitHelpers, expenseAmountInput, parseExpenseAmount, overview, eventDraft: draft, editingItem: target, eventSaveInFlight: { current: false },
    setBusy: vi.fn(), setNotice: vi.fn(), setEventSaveError, setEventDraft, setEditingItem,
    isPendingEventEditorTarget: (value: unknown) => Boolean(value && typeof value === "object" && "kind" in value),
    messages: messages.en, eventEditorCopy: eventEditorMessages("en"), eventEditorFailureMessage,
    addMinutesToWallTime, zonedInputToIso: (value: string) => `${value}:00.000Z`, inputDateTime: toInput,
    jsonRequest: request, refresh: vi.fn(async () => {}),
  });
  return { save: () => save({ preventDefault: vi.fn() }), request, setEventSaveError, setEventDraft, setEditingItem };
}
function enabled(draft = initialize(item)): Draft {
  return { ...draft, linkedExpense: { ...draft.linkedExpense, enabled: true, description: "Synthetic charge", amount: "101" } };
}

describe("actual event editor initialization and submission", () => {
  it("creates an event-linked custom expense with exact shares and a zero participant", async () => {
    const draft = enabled();
    draft.linkedExpense = { ...draft.linkedExpense, splitMode: "custom", splitAmountInputs: { [id(1)]: "101", [id(2)]: "0" } };
    const run = submit(draft, "new"); await run.save();
    expect(run.request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(run.request.mock.calls[0][1]?.body)).patch.linkedExpense).toMatchObject({ amountMinor: 101,
      splitAmounts: [{ memberId: id(1), amountMinor: 101 }, { memberId: id(2), amountMinor: 0 }] });
  });
  it.each(["create", "update"])("reopens pending %s custom expense and retains it through an event-only edit", async (operation) => {
    const saved = { description: "Synthetic unequal charge", amountMinor: 101, currency: "JPY", payerMemberId: id(2),
      splitMemberIds: [id(2), id(1)], splitAmounts: [{ memberId: id(2), amountMinor: 70 }, { memberId: id(1), amountMinor: 31 }], occurredAt: "2030-04-01T10:00:37.123Z" };
    const detail = { requestId: id(8), proposalRevision: 4, operation, createdByMemberId: id(1), requestedByMemberId: id(3), patch: { ...item, linkedExpense: saved } };
    const draft = await initializePending(detail);
    expect(draft.linkedExpense).toMatchObject({ splitMode: "custom", splitAmountInputs: { [id(2)]: "70", [id(1)]: "31" } });
    const run = submit({ ...draft, title: "Corrected synthetic event" }, { kind: "pending", detail }); await run.save();
    const body = JSON.parse(String(run.request.mock.calls[0][1]?.body));
    expect(body.proposalRevision).toBe(4); expect(body.patch.linkedExpense).toEqual(saved);
    const invalid = submit({ ...draft, linkedExpense: { ...draft.linkedExpense, amount: "102" } }, { kind: "pending", detail });
    await invalid.save(); expect(invalid.request).not.toHaveBeenCalled();
    expect(invalid.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").splits);
  });
  it("switches a saved linked custom split to equal only after explicit user choice", async () => {
    const saved = { description: "Synthetic unequal charge", amountMinor: 101, currency: "JPY", payerMemberId: id(2),
      splitMemberIds: [id(2), id(1)], splitAmounts: [{ memberId: id(2), amountMinor: 70 }, { memberId: id(1), amountMinor: 31 }], occurredAt: "2030-04-01T10:00:00Z" };
    const detail = { requestId: id(8), proposalRevision: 1, createdByMemberId: id(1), patch: { ...item, linkedExpense: saved } };
    const draft = await initializePending(detail);
    const run = submit({ ...draft, linkedExpense: splitHelpers.changeExpenseSplitMode(draft.linkedExpense, "equal") }, { kind: "pending", detail });
    await run.save();
    expect(JSON.parse(String(run.request.mock.calls[0][1]?.body)).patch.linkedExpense).not.toHaveProperty("splitAmounts");
  });
  it("initializes canonical private splits without invisible outsiders", async () => {
    const draft = enabled();
    expect(draft.linkedExpense.splitMemberIds).toEqual([id(1), id(2)]);
    const run = submit(draft); await run.save();
    expect(run.request).toHaveBeenCalledOnce();
    const body = JSON.parse(String(run.request.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ entityType: "itinerary_item", operation: "update", entityId: id(7),
      patch: { linkedExpense: { payerMemberId: id(1), splitMemberIds: [id(1), id(2)], amountMinor: 101 } } });
  });
  it("retains legacy equal remainder ownership if the same selected members are reordered", async () => {
    const saved = { description: "Synthetic remainder charge", amountMinor: 101, currency: "JPY", payerMemberId: id(2),
      splitMemberIds: [id(2), id(1)], occurredAt: "2030-04-01T10:00:00Z" };
    const detail = { requestId: id(8), proposalRevision: 1, createdByMemberId: id(1), patch: { ...item, linkedExpense: saved } };
    const draft = await initializePending(detail);
    const run = submit({ ...draft, linkedExpense: { ...draft.linkedExpense, splitMemberIds: [id(1), id(2)] } }, { kind: "pending", detail });
    await run.save();
    expect(JSON.parse(String(run.request.mock.calls[0][1]?.body)).patch.linkedExpense).toEqual(saved);
  });
  it.each(["new", { ...item, visibility: "trip" }])("retains all eligible members for public/new event %j", (target) => {
    expect(initialize(target).linkedExpense.splitMemberIds).toEqual([id(1), id(2), id(3)]);
  });
  it.each(["create", "update"])("uses actual creator rather than proposal requester for pending %s", async (operation) => {
    const draft = await initializePending({ createdByMemberId: id(1), requestedByMemberId: id(3), operation,
      patch: { ...item, linkedExpense: null } });
    expect(draft.linkedExpense).toMatchObject({ payerMemberId: id(1), splitMemberIds: [id(1), id(2)] });
  });
  it("does not invent an occurrence date for an untimed canonical event", () => {
    expect(initialize({ ...item, startsAt: null, endsAt: null }).linkedExpense.occurredAt).toBe("");
  });
  it("does not open another canonical or pending draft during an in-flight save", async () => {
    const setEventDraft = vi.fn();
    for (const [name, next] of [["openEvent", "openPendingEvent"], ["openPendingEvent", "openExpense"]]) {
      const open = closure<(target: unknown) => Promise<void> | void>(name, next, {
        overview, eventSaveInFlight: { current: true }, setEventDraft,
      });
      await open(item);
    }
    expect(setEventDraft).not.toHaveBeenCalled();
    const modal = source.slice(source.indexOf('{eventDraft && editingItem ? ('), source.indexOf('{expenseDraft ? <Modal'));
    expect(modal).toContain('close={() => { if (!eventSaveInFlight.current)');
    expect(modal).toContain('disabled={busy} onClick={() => { if (!eventSaveInFlight.current)');
  });
  it("keeps a saved pending expense exactly on event-only edits, including hidden stale choices in the draft", async () => {
    const saved = { description: "Synthetic charge", amountMinor: 101, currency: "JPY", payerMemberId: id(2),
      splitMemberIds: [id(2), id(1)], occurredAt: "2030-04-01T10:00:37.123Z" };
    const detail = { requestId: id(8), proposalRevision: 2, createdByMemberId: id(1), requestedByMemberId: id(3),
      patch: { ...item, linkedExpense: saved } };
    const draft = await initializePending(detail);
    const run = submit({ ...draft, title: "Corrected synthetic title" }, { kind: "pending", detail });
    await run.save();
    expect(JSON.parse(String(run.request.mock.calls[0][1]?.body)).patch.linkedExpense).toEqual(saved);
    const editedCharge = { ...draft, linkedExpense: { ...draft.linkedExpense, description: "Corrected synthetic charge" } };
    const correction = submit(editedCharge, { kind: "pending", detail }); await correction.save();
    expect(JSON.parse(String(correction.request.mock.calls[0][1]?.body)).patch.linkedExpense)
      .toEqual({ ...saved, description: "Corrected synthetic charge", status: "posted" });
    const stale = await initializePending({ ...detail, patch: { ...item, linkedExpense: { ...saved, splitMemberIds: [id(4)] } } });
    expect(stale.linkedExpense.splitMemberIds).toEqual([id(4)]);
    const rejected = submit(stale, { kind: "pending", detail }); await rejected.save();
    expect(rejected.request).not.toHaveBeenCalled();
  });
  it.each([id(3), id(4), id(99)])("blocks hidden/removed/nonexistent split %s before any request, retaining input", async (memberId) => {
    const draft = enabled(); draft.linkedExpense.splitMemberIds.push(memberId);
    const before = JSON.stringify(draft); const run = submit(draft); await run.save();
    expect(run.request).not.toHaveBeenCalled(); expect(run.setEventDraft).not.toHaveBeenCalled();
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").participants);
    expect(JSON.stringify(draft)).toBe(before);
  });
  it("exposes invalid occurrence time and leaves an untimed expense draft intact", async () => {
    const draft = enabled(); draft.linkedExpense.occurredAt = "";
    const run = submit(draft); await run.save();
    expect(run.request).not.toHaveBeenCalled(); expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorMessages("en").date);
    expect(run.setEventDraft).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 500, null])("keeps failed %s saves in the form and never automatically resubmits", async (status) => {
    const failure = status ? { status } : new TypeError("Synthetic network failure");
    const run = submit(enabled(), item, async () => { throw failure; });
    await run.save(); await Promise.resolve();
    expect(run.request).toHaveBeenCalledOnce(); expect(run.setEditingItem).not.toHaveBeenCalled();
    expect(run.setEventDraft).not.toHaveBeenCalled();
    expect(run.setEventSaveError).toHaveBeenLastCalledWith(eventEditorFailureMessage(failure, eventEditorMessages("en")));
    await run.save(); expect(run.request).toHaveBeenCalledTimes(2);
  });
  it("prevents simultaneous double submits", async () => {
    let release!: () => void;
    const run = submit(enabled(), item, () => new Promise((resolve) => { release = () => resolve({ status: "approved" }); }));
    const first = run.save(); await run.save();
    expect(run.request).toHaveBeenCalledOnce(); release(); await first;
  });
  it("mounts feedback inside the form and reports native validation there", () => {
    const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const forms: ts.JsxElement[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "form"
        && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
          && attribute.name.getText(tree) === "onSubmit" && attribute.initializer
          && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.getText(tree) === "saveEvent")) forms.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(forms).toHaveLength(1);
    const form = forms[0].getText(tree);
    expect(form).toContain("onInvalidCapture"); expect(form).toContain("setEventSaveError(eventEditorCopy.formInvalid)");
    expect(form).toContain('<EventEditorFeedback error={eventSaveError} />');
    expect(form).toContain('data-feedback-action="event_save"');
  });
});

describe("event expense feedback and explicit stale-selection corrections", () => {
  it.each(locales)("renders accessible local form feedback in %s", (locale) => {
    const copy = eventEditorMessages(locale);
    const html = renderToStaticMarkup(createElement(EventEditorFeedback, { error: copy.saveFailed }));
    expect(html).toContain('role="alert"'); expect(html).toContain('tabindex="-1"');
    expect(html).toContain(copy.saveFailed);
  });
  it("uses identical neutral money copy for both Cantonese modes", () => {
    expect(eventEditorMessages("zh-HK-lihkg")).toEqual(eventEditorMessages("zh-HK"));
  });
  it("shows unavailable saved payer/splits and removes them only on an explicit checkbox change", () => {
    const changeSplits = vi.fn(); const copy = eventEditorMessages("en");
    const props = { members: overview.members.slice(0, 2), allMembers: overview.members,
      payerMemberId: id(99), splitMemberIds: [id(1), id(4), id(99)], disabled: false,
      payerLabel: "Paid by", splitsLabel: "Shared by", copy, changePayer: vi.fn(), changeSplits };
    const html = renderToStaticMarkup(createElement(EventExpenseParticipants, props));
    expect(html).toContain(`value="${id(99)}" disabled="" selected=""`);
    expect(html).toContain(`Synthetic member 4 — ${copy.unavailable}`);
    expect(html.match(/checked=""/g)).toHaveLength(3); expect(changeSplits).not.toHaveBeenCalled();
    const walk = (node: ReactNode): Array<{ checked?: boolean; onChange?: () => void }> => {
      if (Array.isArray(node)) return node.flatMap(walk);
      if (!isValidElement<{ children?: ReactNode; checked?: boolean; onChange?: () => void }>(node)) return [];
      return node.type === "input" ? [node.props] : walk(node.props.children);
    };
    const controls = walk(EventExpenseParticipants(props));
    controls.at(-1)?.onChange?.();
    expect(changeSplits).toHaveBeenCalledWith([id(1), id(4)]);
  });
});
