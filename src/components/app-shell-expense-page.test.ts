import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as expenseHelpers from "@/lib/app/event-expense-editor";
import { eventEditorFailureMessage, eventEditorMessages } from "@/lib/app/event-editor-i18n";
import { parseExpenseAmount } from "@/lib/app/expense-entry";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import * as splitHelpers from "@/lib/app/expense-split-editor";
import { resolveExpenseEvent } from "@/lib/app/expense-retained-event";
import { expensePageMessages } from "@/lib/app/expense-page-i18n";
import { locales, messages } from "@/lib/i18n";

// Exercise the actual screen callbacks with synthetic trip data and inert HTTP calls.
// Extract one initializer so unrelated adjacent callbacks never become test dependencies.
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
  const code = ts.transpileModule(`const invoke = ${initializer!.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return invoke;`)(...Object.values(bindings)) as T;
}

const id = (number: number) => `a9240000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const member = (number: number, status = "active") => ({ id: id(number), status, displayName: `Synthetic member ${number}` });
const publicEvent = { id: id(10), title: "Synthetic restaurant", visibility: "trip", viewerMemberIds: [],
  createdByMemberId: id(1), status: "planned", startsAt: "2030-04-01T18:00:00Z" };
const privateEvent = { ...publicEvent, id: id(11), visibility: "private", viewerMemberIds: [id(2)] };
const overview = {
  members: [member(1), member(2, "invited"), member(3), member(4, "revoked"), member(5, "removed")],
  session: { memberId: id(1), isOwner: true },
  trip: { id: id(6), timeZone: "UTC", defaultCurrency: "JPY" },
  permissions: { canEditExpenses: true, expenseRequiresApproval: false },
  itinerary: [publicEvent, privateEvent],
};
type Context = typeof overview;
type Draft = splitHelpers.ExpenseSplitDraft & { id: string | null; currentRevision: number | null; description: string; amount: string;
  currency: string; payerMemberId: string; itineraryItemId: string; occurredAt: string; splitMemberIds: string[] };
const savedExpense = { id: id(20), currentRevision: 7, description: "Synthetic saved bill", amountMinor: 101,
  currency: "JPY", status: "posted", payerMemberId: id(2), itineraryItemId: publicEvent.id,
  occurredAt: "2030-04-01T18:23:45.678Z", splits: [{ memberId: id(1), shareMinor: 60 }, { memberId: id(2), shareMinor: 41 }] };
const inputDateTime = (value: string | null) => value?.slice(0, 16) ?? "";
const bindings = {
  ...expenseHelpers, ...splitHelpers, expenseAmountInput, eligibleEventExpenseMembers: expenseHelpers.eventExpenseMembers,
  eventEditorCopy: eventEditorMessages("en"), eventEditorFailureMessage,
  expensePageCopy: expensePageMessages("en"), parseExpenseAmount,
  messages: messages.en, inputDateTime, resolveExpenseEvent,
};
const requestErrorClass = tree.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === "JsonRequestError");
const requestErrorCode = ts.transpileModule(requestErrorClass!.getText(tree).replace(/^export /, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const JsonRequestError = new Function(`${requestErrorCode}; return JsonRequestError;`)() as new (message: string, status: number) => Error & { status: number };
function initialize(expense?: typeof savedExpense, options?: { itineraryItemId?: string; individual?: boolean }, context = overview) {
  let draft: Draft | null = null;
  const expenseOriginal = { current: null as typeof savedExpense | null };
  const setExpenseFormError = vi.fn();
  const open = callback<(expense?: typeof savedExpense, options?: { itineraryItemId?: string; individual?: boolean }) => void>("openExpense", {
    ...bindings, overview: context, expenseSavePending: { current: false }, expenseOriginal,
    setExpenseFormError, setExpenseDraft: (next: Draft) => { draft = next; },
  });
  open(expense, options);
  return { draft: draft!, expenseOriginal, setExpenseFormError };
}

describe("expense page initialization and independent event bills", () => {
  it("defaults a new bill to the signed-in payer and sole participant", () => {
    const { draft } = initialize();
    expect(draft).toMatchObject({ id: null, currentRevision: null, payerMemberId: id(1),
      splitMemberIds: [id(1)], itineraryItemId: "", amount: "", currency: "JPY" });
    expect(draft.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  it("allows independent people to initialize their own bill for the same restaurant", () => {
    for (const memberId of [id(1), id(3)]) {
      const context = { ...overview, session: { memberId, isOwner: memberId === id(1) } };
      const { draft } = initialize(undefined, { itineraryItemId: publicEvent.id, individual: true }, context);
      expect(draft).toMatchObject({ id: null, itineraryItemId: publicEvent.id, payerMemberId: memberId, splitMemberIds: [memberId] });
    }
  });
  it("initializes a private bill without unrelated or disabled members", () => {
    const { draft } = initialize(undefined, { itineraryItemId: privateEvent.id, individual: true });
    expect(draft).toMatchObject({ itineraryItemId: privateEvent.id, payerMemberId: id(1), splitMemberIds: [id(1)] });
  });
  it("keeps an existing bill's selections and original precise record when editing", () => {
    const { draft, expenseOriginal } = initialize(savedExpense);
    expect(draft).toMatchObject({ id: savedExpense.id, currentRevision: 7, description: savedExpense.description,
      amount: "101", currency: "JPY", payerMemberId: id(2), itineraryItemId: publicEvent.id,
      splitMemberIds: [id(1), id(2)], occurredAt: "2030-04-01T18:23" });
    expect(expenseOriginal.current).toEqual(savedExpense);
    expect(savedExpense.splits.map((split) => split.shareMinor)).toEqual([60, 41]);
  });
  it("does not open or replace a draft while another expense save is in flight", () => {
    const setExpenseDraft = vi.fn();
    const open = callback<(expense?: typeof savedExpense) => void>("openExpense", {
      overview, expenseSavePending: { current: true }, setExpenseDraft,
    });
    open(); open(savedExpense);
    expect(setExpenseDraft).not.toHaveBeenCalled();
  });
  it("does not open a write form for a member without expense editing permission", () => {
    const context = { ...overview, session: { memberId: id(3), isOwner: false },
      permissions: { canEditExpenses: false, expenseRequiresApproval: true } };
    expect(initialize(undefined, undefined, context).draft).toBeNull();
  });
  it("ignores a missing or cancelled target instead of creating an unrelated bill", () => {
    expect(initialize(undefined, { itineraryItemId: id(99) }).draft).toBeNull();
    const context = { ...overview, itinerary: [{ ...publicEvent, status: "cancelled" }] };
    expect(initialize(undefined, { itineraryItemId: publicEvent.id }, context).draft).toBeNull();
  });
});

function preset(draft: Draft, individual: boolean, context: Context = overview, inFlight = false): Draft | null {
  let changed: Draft | null = null;
  const choose = callback<(individual: boolean) => void>("chooseExpenseParticipants", {
    ...bindings, overview: context, expenseDraft: draft, expenseSavePending: { current: inFlight },
    setExpenseDraft: (next: Draft) => { changed = next; }, setExpenseFormError: vi.fn(),
  });
  choose(individual);
  return changed;
}

describe("explicit individual/shared bill presets", () => {
  it("sets both payer and sole split to the actor, retaining the amount and event", () => {
    const draft = initialize(savedExpense).draft;
    expect(preset(draft, true)).toEqual({ ...draft, payerMemberId: id(1), splitMemberIds: [id(1)] });
    expect(draft.payerMemberId).toBe(id(2));
    expect(draft.splitMemberIds).toEqual([id(1), id(2)]);
  });
  it("allows a shared public bill to include eligible members but not disabled or removed members", () => {
    const draft = initialize(savedExpense).draft;
    expect(preset(draft, false)).toEqual({ ...draft, payerMemberId: id(2), splitMemberIds: [id(1), id(2), id(3)] });
  });
  it("limits a shared private bill to its canonical creator/viewer audience", () => {
    const draft = { ...initialize(savedExpense).draft, itineraryItemId: privateEvent.id };
    expect(preset(draft, false)?.splitMemberIds).toEqual([id(1), id(2)]);
  });
  it("does not turn an unrelated actor into a payer or participant of a private bill", () => {
    const draft = { ...initialize(savedExpense).draft, itineraryItemId: privateEvent.id };
    const context = { ...overview, session: { memberId: id(3), isOwner: false } };
    expect(preset(draft, true, context)).toBeNull();
  });
  it.each([true, false])("does not change participant preset %s during an in-flight save", (individual) => {
    expect(preset(initialize(savedExpense).draft, individual, overview, true)).toBeNull();
  });
  it("only closes and clears original input when a save is not pending", () => {
    for (const inFlight of [true, false]) {
      const setExpenseDraft = vi.fn(); const setExpenseFormError = vi.fn();
      const expenseOriginal = { current: savedExpense as typeof savedExpense | null };
      const close = callback<() => void>("closeExpense", {
        expenseSavePending: { current: inFlight }, expenseOriginal, setExpenseDraft, setExpenseFormError,
      });
      close();
      if (inFlight) {
        expect(setExpenseDraft).not.toHaveBeenCalled();
        expect(setExpenseFormError).not.toHaveBeenCalled();
        expect(expenseOriginal.current).toBe(savedExpense);
      } else {
        expect(setExpenseDraft).toHaveBeenCalledWith(null);
        expect(setExpenseFormError).toHaveBeenCalledWith(null);
        expect(expenseOriginal.current).toBeNull();
      }
    }
  });
});

function submit(draft: Draft, options: { original?: typeof savedExpense | null; context?: Context; response?: () => Promise<unknown> } = {}) {
  const request = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => options.response ? options.response() : ({ status: "approved" }));
  const setExpenseFormError = vi.fn(); const setExpenseDraft = vi.fn(); const setNotice = vi.fn();
  const refresh = vi.fn(async () => {}); const setBusy = vi.fn();
  const expenseSavePending = { current: false };
  const expenseOriginal = { current: options.original === undefined ? draft.id ? savedExpense : null : options.original };
  const save = callback<(event: { preventDefault: () => void }) => Promise<void>>("saveExpense", {
    ...bindings, overview: options.context ?? overview, expenseDraft: draft, expenseOriginal, expenseSavePending,
    setExpenseFormError, setExpenseDraft, setBusy, setNotice, JsonRequestError,
    zonedInputToIso: (value: string) => `${value}:00.000Z`, jsonRequest: request, refresh,
  });
  return { save: () => save({ preventDefault: vi.fn() }), request, setExpenseFormError, setExpenseDraft,
    setNotice, refresh, setBusy, expenseSavePending, expenseOriginal };
}
function validDraft(context = overview, itineraryItemId = publicEvent.id): Draft {
  return { ...initialize(undefined, { itineraryItemId, individual: true }, context).draft,
    description: "Synthetic individual dinner bill", amount: "1600", occurredAt: "2030-04-01T18:30" };
}
function submittedBody(run: ReturnType<typeof submit>) {
  return JSON.parse(String(run.request.mock.calls[0][1]?.body)) as {
    operation: string; entityType: string; entityId: string | null; baseRevision: number | null; applyNow: boolean;
    patch: Record<string, unknown>;
  };
}

describe("actual expense form submission and audit/review payloads", () => {
  it.each([["JPY", "101", "101", "0", 101, 0], ["HKD", "1.01", "0.80", "0.21", 80, 21]])(
    "creates exact custom %s shares including zero without changing owner-review policy", async (currency, amount, first, second, a, b) => {
      const context = { ...overview, session: { memberId: id(1), isOwner: false }, permissions: { canEditExpenses: true, expenseRequiresApproval: true } };
      const next = { ...validDraft(context), currency: String(currency), amount: String(amount), splitMemberIds: [id(1), id(2)],
        splitMode: "custom" as const, splitAmountInputs: { [id(1)]: String(first), [id(2)]: String(second) } };
      const run = submit(next, { context }); await run.save();
      expect(submittedBody(run)).toMatchObject({ applyNow: false, patch: { splitMemberIds: [id(1), id(2)],
        splitAmounts: [{ memberId: id(1), amountMinor: a }, { memberId: id(2), amountMinor: b }] } });
    });
  it("sends reconciled custom total edits with the original optimistic revision", async () => {
    const next = { ...initialize(savedExpense).draft, amount: "103", splitTouched: true,
      splitAmountInputs: { [id(1)]: "62", [id(2)]: "41" } };
    const run = submit(next); await run.save();
    expect(submittedBody(run)).toMatchObject({ baseRevision: 7, patch: { amountMinor: 103,
      splitAmounts: [{ memberId: id(1), amountMinor: 62 }, { memberId: id(2), amountMinor: 41 }] } });
  });
  it("keeps custom inputs after participant changes and blocks an unreconciled preset", async () => {
    const original = initialize(savedExpense).draft;
    const next = preset(original, true)!;
    expect(next.splitAmountInputs).toEqual(original.splitAmountInputs);
    const run = submit(next); await run.save();
    expect(run.request).not.toHaveBeenCalled(); expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").splits);
  });
  it("preserves a legacy equal remainder assignment on a payer/date edit", async () => {
    const original = { ...savedExpense, splits: [{ memberId: id(1), shareMinor: 50 }, { memberId: id(2), shareMinor: 51 }] };
    const next = { ...initialize(original).draft, payerMemberId: id(1), occurredAt: "2030-04-02T19:30" };
    expect(next.splitMode).toBe("equal");
    const run = submit(next, { original }); await run.save();
    expect(submittedBody(run).patch).not.toHaveProperty("splitMemberIds"); expect(submittedBody(run).patch).not.toHaveProperty("splitAmounts");
  });
  it("submits independent individual amounts linked to the same event without editing another bill", async () => {
    for (const [memberId, amount] of [[id(1), "1600"], [id(3), "2300"]]) {
      const context = { ...overview, session: { memberId, isOwner: memberId === id(1) } };
      const run = submit({ ...validDraft(context), amount }, { context }); await run.save();
      expect(run.request).toHaveBeenCalledOnce();
      expect(run.request.mock.calls[0][0]).toBe(`/api/trips/${overview.trip.id}/change-requests`);
      expect(run.request.mock.calls[0][1]?.method).toBe("POST");
      expect(submittedBody(run)).toMatchObject({ operation: "create", entityType: "expense", entityId: null, baseRevision: null,
        patch: { amountMinor: Number(amount), currency: "JPY", payerMemberId: memberId,
          itineraryItemId: publicEvent.id, splitMemberIds: [memberId], occurredAt: "2030-04-01T18:30:00.000Z", status: "posted" } });
    }
  });
  it.each([[true, true, true], [false, true, false], [false, false, true]])(
    "respects owner=%s and require-approval=%s when setting applyNow=%s", async (isOwner, expenseRequiresApproval, applyNow) => {
      const context = { ...overview, session: { memberId: id(1), isOwner }, permissions: { canEditExpenses: true, expenseRequiresApproval } };
      const run = submit(validDraft(context), { context, response: async () => ({ status: applyNow ? "approved" : "pending" }) });
      await run.save();
      expect(submittedBody(run).applyNow).toBe(applyNow);
      expect(run.setNotice).toHaveBeenLastCalledWith(applyNow ? expensePageMessages("en").saved : expensePageMessages("en").pending);
      expect(run.setExpenseDraft).toHaveBeenLastCalledWith(null);
      expect(run.expenseOriginal.current).toBeNull(); expect(run.refresh).toHaveBeenCalledOnce();
    },
  );
  it("preserves exact timestamp and unequal allocations on a description-only edit", async () => {
    const draft = { ...initialize(savedExpense).draft, description: "Corrected synthetic description" };
    const run = submit(draft); await run.save();
    const body = submittedBody(run);
    expect(body).toMatchObject({ operation: "update", entityId: savedExpense.id, baseRevision: 7,
      patch: { description: draft.description, occurredAt: savedExpense.occurredAt, status: "posted", payerMemberId: id(2) } });
    expect(body.patch).not.toHaveProperty("amountMinor");
    expect(body.patch).not.toHaveProperty("splitMemberIds");
    expect(savedExpense.splits.map((split) => split.shareMinor)).toEqual([60, 41]);
  });
  it.each(["draft", "void"])("does not silently post an existing %s expense", async (status) => {
    const original = { ...savedExpense, status };
    const run = submit(initialize(original).draft, { original }); await run.save();
    expect(submittedBody(run).patch.status).toBe(status);
  });
  it("preserves the last supported minor unit with an exact large HKD input", async () => {
    const original = { ...savedExpense, currency: "HKD", amountMinor: Number.MAX_SAFE_INTEGER,
      splits: [{ memberId: id(1), shareMinor: Number.MAX_SAFE_INTEGER - 41 }, { memberId: id(2), shareMinor: 41 }] };
    const run = submit(initialize(original).draft, { original }); await run.save();
    expect(run.request).toHaveBeenCalledOnce();
    expect(submittedBody(run).patch).not.toHaveProperty("amountMinor");
    expect(submittedBody(run).patch).not.toHaveProperty("splitMemberIds");
  });
  it("requires reconciliation instead of silently redistributing an existing custom total change", async () => {
    const run = submit({ ...initialize(savedExpense).draft, amount: "103" }); await run.save();
    expect(run.request).not.toHaveBeenCalled();
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").splits);
  });
  it("sends an explicit equal individual preset after the user chooses equal splitting", async () => {
    const draft = splitHelpers.changeExpenseSplitMode(preset(initialize(savedExpense).draft, true)!, "equal");
    const run = submit(draft); await run.save();
    expect(submittedBody(run).patch).toMatchObject({ payerMemberId: id(1), splitMemberIds: [id(1)] });
    expect(submittedBody(run).patch).not.toHaveProperty("splits");
    expect(submittedBody(run).patch).not.toHaveProperty("amountMinor");
  });
  it("does not recalculate shares merely because selected participant order changed", async () => {
    const run = submit({ ...initialize(savedExpense).draft, splitMemberIds: [id(2), id(1)] }); await run.save();
    expect(submittedBody(run).patch).not.toHaveProperty("splitMemberIds");
  });
  it("converts an explicitly changed wall time but preserves the event link", async () => {
    const run = submit({ ...initialize(savedExpense).draft, occurredAt: "2030-04-02T19:10" }); await run.save();
    expect(submittedBody(run).patch).toMatchObject({ occurredAt: "2030-04-02T19:10:00.000Z", itineraryItemId: publicEvent.id });
  });
  it("represents an explicitly unlinked extra bill as a null event reference", async () => {
    const run = submit({ ...validDraft(), itineraryItemId: "" }); await run.save();
    expect(submittedBody(run).patch.itineraryItemId).toBeNull();
  });
});

describe("expense validation, access, and safe failure handling", () => {
  it.each([id(3), id(4), id(5), id(99)])("rejects private-event split member %s before HTTP without discarding input", async (memberId) => {
    const draft = { ...validDraft(overview, privateEvent.id), splitMemberIds: [id(1), memberId] };
    const before = JSON.stringify(draft); const run = submit(draft); await run.save();
    expect(run.request).not.toHaveBeenCalled(); expect(run.setExpenseDraft).not.toHaveBeenCalled();
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").participants);
    expect(JSON.stringify(draft)).toBe(before); expect(run.expenseSavePending.current).toBe(false);
  });
  it("rejects a private-event payer outside its creator/viewer audience", async () => {
    const run = submit({ ...validDraft(overview, privateEvent.id), payerMemberId: id(3) }); await run.save();
    expect(run.request).not.toHaveBeenCalled();
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").participants);
  });
  it("does not silently discard unavailable saved participants on editing", async () => {
    const original = { ...savedExpense, splits: [{ memberId: id(1), shareMinor: 60 }, { memberId: id(5), shareMinor: 41 }] };
    const draft = initialize(original).draft;
    expect(draft.splitMemberIds).toEqual([id(1), id(5)]);
    const run = submit(draft, { original }); await run.save();
    expect(run.request).not.toHaveBeenCalled(); expect(run.setExpenseDraft).not.toHaveBeenCalled();
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").participants);
  });
  it.each([
    [{ splitMemberIds: [] }, "participants"], [{ description: " " }, "description"],
    [{ amount: "0" }, "amount"], [{ currency: "YEN!" }, "currency"],
    [{ occurredAt: "" }, "date"], [{ occurredAt: "2030-02-31T19:30" }, "date"],
  ] as Array<[Partial<Draft>, keyof ReturnType<typeof eventEditorMessages>]>)("keeps invalid %j in the form with localized feedback", async (invalid, issue) => {
    const run = submit({ ...validDraft(), ...invalid });
    await run.save();
    expect(run.request).not.toHaveBeenCalled(); expect(run.setExpenseDraft).not.toHaveBeenCalled();
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en")[issue]);
  });
  it.each([["JPY", "12.5"], ["HKD", "12.345"], ["HKD", "1e3"]])("rejects unsupported %s precision %s instead of rounding money", async (currency, amount) => {
    const run = submit({ ...validDraft(), currency, amount }); await run.save();
    expect(run.request).not.toHaveBeenCalled();
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").amount);
  });
  it("blocks a stale edit snapshot and a missing target rather than guessing another bill/event", async () => {
    const stale = submit(initialize(savedExpense).draft, { original: null }); await stale.save();
    expect(stale.request).not.toHaveBeenCalled();
    expect(stale.setExpenseFormError).toHaveBeenLastCalledWith(expensePageMessages("en").stale);
    const missing = submit({ ...validDraft(), itineraryItemId: id(99) }); await missing.save();
    expect(missing.request).not.toHaveBeenCalled();
    expect(missing.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").forbidden);
  });
  it("does not submit when a member's expense editing permission is absent", async () => {
    const context = { ...overview, session: { memberId: id(3), isOwner: false }, permissions: { canEditExpenses: false, expenseRequiresApproval: true } };
    const run = submit(validDraft(), { context }); await run.save();
    expect(run.request).not.toHaveBeenCalled(); expect(run.setBusy).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 500, null])("keeps a failed %s submission for explicit retry and never automatically resends", async (status) => {
    const error = status ? new JsonRequestError("Synthetic failure", status) : new TypeError("Synthetic offline failure");
    const run = submit(validDraft(), { response: async () => { throw error; } });
    await run.save(); await Promise.resolve();
    expect(run.request).toHaveBeenCalledOnce(); expect(run.setExpenseDraft).not.toHaveBeenCalled();
    expect(run.refresh).not.toHaveBeenCalled(); expect(run.expenseSavePending.current).toBe(false);
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(status === 409 ? expensePageMessages("en").stale
      : eventEditorFailureMessage(error, eventEditorMessages("en")));
    await run.save(); expect(run.request).toHaveBeenCalledTimes(2);
  });
  it("prevents simultaneous double submissions until the first response completes", async () => {
    let release!: () => void;
    const run = submit(validDraft(), { response: () => new Promise((resolve) => { release = () => resolve({ status: "approved" }); }) });
    const first = run.save(); await run.save();
    expect(run.request).toHaveBeenCalledOnce(); expect(run.expenseSavePending.current).toBe(true);
    release(); await first;
    expect(run.expenseSavePending.current).toBe(false); expect(run.refresh).toHaveBeenCalledOnce();
  });
});

describe("event relinking keeps financial selections explicit", () => {
  function relink(draft: Draft, itineraryItemId: string, inFlight = false) {
    let next: Draft | null = null;
    const change = callback<(itineraryItemId: string) => void>("updateExpenseEvent", {
      ...bindings, overview, expenseDraft: draft, expenseSavePending: { current: inFlight },
      setExpenseDraft: (value: Draft) => { next = value; },
    });
    change(itineraryItemId);
    return next;
  }
  it("constrains a new bill to its private event without inventing additional split participants", () => {
    const draft = { ...validDraft(), splitMemberIds: [id(1), id(3), id(5)] };
    expect(relink(draft, privateEvent.id)).toMatchObject({ itineraryItemId: privateEvent.id, payerMemberId: id(1), splitMemberIds: [id(1)] });
    expect(draft.splitMemberIds).toEqual([id(1), id(3), id(5)]);
  });
  it("keeps saved allocations visible after a link change until a user explicitly corrects them", async () => {
    const original = { ...savedExpense, payerMemberId: id(3), splits: [{ memberId: id(3), shareMinor: 101 }] };
    const draft = initialize(original).draft;
    const changed = relink(draft, privateEvent.id)!;
    expect(changed).toEqual({ ...draft, itineraryItemId: privateEvent.id });
    const run = submit(changed, { original }); await run.save();
    expect(run.request).not.toHaveBeenCalled();
    expect(run.setExpenseFormError).toHaveBeenLastCalledWith(eventEditorMessages("en").participants);
  });
  it("does not reset a bill when selecting an unavailable event or while a save is pending", () => {
    expect(relink(validDraft(), id(99))).toBeNull();
    expect(relink(validDraft(), privateEvent.id, true)).toBeNull();
  });
  it("allows a new extra bill to detach its event without changing its payer or shares", () => {
    const draft = validDraft();
    expect(relink(draft, "")).toEqual({ ...draft, itineraryItemId: "" });
  });
});

describe("localized expense form wiring", () => {
  const modal = source.slice(source.indexOf("{expenseDraft ? <Modal"), source.indexOf("{inviteToast ? <aside"));
  it("shows errors inside the modal, retains input after native validation, and guards close actions", () => {
    expect(modal).toContain("close={closeExpense}");
    expect(modal).toContain("onClick={closeExpense}");
    expect(modal).toContain("<EventEditorFeedback error={expenseFormError} />");
    expect(modal).toContain("onInvalid={() => setExpenseFormError(eventEditorCopy.formInvalid)}");
    expect(modal).toContain('className="form-grid full-field expense-editor-fields" disabled={busy}');
  });
  it("wires self/shared presets, selectable existing links, and explicit stale participant correction", () => {
    expect(modal).toContain("onClick={() => chooseExpenseParticipants(true)}");
    expect(modal).toContain("onClick={() => chooseExpenseParticipants(false)}");
    expect(modal).toContain("<EventExpenseParticipants members={expenseAudienceMembers} allMembers={overview.members}");
    expect(modal).toContain('disabled={Boolean(expenseDraft.id && expenseLinkedItem?.visibility === "private")}');
    expect(modal).toContain("updateExpenseEvent(event.target.value)");
    expect(modal).toContain("expensePageCopy.linkedHelp");
  });
  it.each(locales)("provides complete money-neutral expense copy for %s", (locale) => {
    const copy = expensePageMessages(locale);
    expect(Object.keys(copy)).toEqual(Object.keys(expensePageMessages("en")));
    for (const value of Object.values(copy)) expect(value.trim().length).toBeGreaterThan(0);
  });
  it("keeps financial wording identical across Cantonese tones", () => {
    expect(expensePageMessages("zh-HK-lihkg")).toEqual(expensePageMessages("zh-HK"));
  });
});
