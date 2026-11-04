import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eligiblePaymentMember, type PaymentDecision, type PaymentDraft } from "./member-payment-controls";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { paymentAmountInput } from "@/lib/app/member-payment-format";
import { parseExpenseAmount } from "@/lib/app/expense-entry";
import type { MemberPayment } from "@/lib/app/member-payments";

// Execute the real screen closures with inert HTTP and synthetic people/money.
const source = readFileSync("src/components/app-shell.tsx", "utf8");
const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback<T>(name: string, bindings: Record<string, unknown>): T {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) initializer = node.initializer;
    else ts.forEachChild(node, visit);
  }; visit(tree);
  expect(initializer, `The actual ${name} callback must exist`).toBeDefined();
  const code = ts.transpileModule(`const invoke = ${initializer!.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return invoke;`)(...Object.values(bindings)) as T;
}
const helpers = tree.statements.filter((node) => (ts.isFunctionDeclaration(node) && ["dateTimeParts", "inputDateTime", "zonedInputToIso"].includes(node.name?.text ?? ""))
  || (ts.isClassDeclaration(node) && node.name?.text === "JsonRequestError")).map((node) => node.getText(tree).replace(/^export /, "")).join("\n");
const helperCode = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const time = new Function(`${helperCode}; return { inputDateTime, zonedInputToIso, JsonRequestError };`)() as {
  inputDateTime: (value: string, zone: string) => string; zonedInputToIso: (value: string, zone: string) => string;
  JsonRequestError: new (message: string, status: number) => Error & { status: number };
};
const copy = memberPaymentMessages("en");
const id = (number: number) => `a9280000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const payment: MemberPayment = { id: id(10), fromMemberId: id(1), toMemberId: id(2), fromMemberName: "Synthetic sender", toMemberName: "Synthetic recipient",
  accountingFromMemberId: id(1), accountingToMemberId: id(2), accountingFromMemberName: "Synthetic sender", accountingToMemberName: "Synthetic recipient",
  amountMinor: 1025, currency: "HKD", occurredAt: "2035-04-01T00:00:00Z", note: null, status: "pending", revision: 2,
  createdByMemberId: id(1), createdAt: "2035-04-01T00:00:00Z", canReview: true, canVoid: true };
const context = () => ({ trip: { id: id(9), timeZone: "Asia/Tokyo", defaultCurrency: "JPY", startDate: "2030-04-01", endDate: "2030-04-02" },
  session: { memberId: id(1), isOwner: false }, permissions: { canEditExpenses: true },
  members: ["active", "invited", "active", "revoked", "removed"].map((status, index) => ({ id: id(index + 1), displayName: `Synthetic ${index}`, status })),
  memberPayments: [{ ...payment }],
});
type Dialog = { scope: string } & ({ kind: "create"; draft: PaymentDraft } | { kind: "action"; decision: PaymentDecision });
type Attempt = { scope: string; url: string; method: string; body: string };
function harness() {
  const overview = context(); const scope = `${overview.trip.id}:${overview.session.memberId}`;
  const state = { overview, busy: false, dialog: null as Dialog | null, open: false, locked: false, error: null as string | null };
  const paymentAttempt = { current: null as Attempt | null }; const paymentInFlight = { current: false }; const paymentScopeRef = { current: scope as string | null };
  const jsonRequest = vi.fn<(url: string, init: RequestInit) => Promise<MemberPayment>>(async () => ({ ...payment }));
  const refresh = vi.fn(async () => {}); const setNotice = vi.fn(); const randomUUID = vi.fn(() => id(90));
  const bindings = () => ({ ...time, eligiblePaymentMember, paymentAmountInput, parseExpenseAmount, overview: state.overview, busy: state.busy,
    paymentDialog: state.dialog, paymentAttempt, paymentInFlight, paymentScopeRef, paymentCopy: copy, jsonRequest, refresh, setNotice,
    crypto: { randomUUID },
    setBusy: (value: boolean) => { state.busy = value; }, setPaymentDialog: (value: Dialog | null) => { state.dialog = value; },
    setPaymentDialogOpen: (value: boolean) => { state.open = value; }, setPaymentLocked: (value: boolean) => { state.locked = value; },
    setPaymentError: (value: string | null) => { state.error = value; },
  });
  const open = (suggestion?: { fromMemberId: string; toMemberId: string; currency: string; amountMinor: number }) => callback<(value?: typeof suggestion) => void>("openMemberPayment", bindings())(suggestion);
  const action = (row: MemberPayment, value: PaymentDecision["action"]) => callback<(row: MemberPayment, value: PaymentDecision["action"]) => void>("openPaymentAction", bindings())(row, value);
  const close = () => callback<() => void>("closeMemberPayment", bindings())();
  const save = () => callback<(event: { preventDefault: () => void }) => Promise<void>>("submitMemberPayment", bindings())({ preventDefault: vi.fn() });
  const fill = (patch: Partial<PaymentDraft> = {}) => {
    state.dialog = { scope, kind: "create", draft: { fromMemberId: id(1), toMemberId: id(2), amount: "10.25", currency: "HKD", occurredAt: "2035-04-01T09:00", note: " synthetic note ", confirmation: true, ...patch } };
    state.open = true;
  };
  return { state, scope, paymentAttempt, paymentInFlight, paymentScopeRef, jsonRequest, refresh, setNotice, randomUUID, open, action, close, save, fill };
}
afterEach(() => vi.useRealTimers());

describe("repayment screen defaults and scoped actions", () => {
  it("defaults sender to self, leaves recipient/amount unassumed and uses current trip-zone time", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2035-03-31T23:59:00Z"));
    const h = harness(); h.open();
    expect(h.state.dialog).toMatchObject({ kind: "create", scope: h.scope, draft: { fromMemberId: id(1), toMemberId: "", amount: "", currency: "JPY", occurredAt: "2035-04-01T08:59", confirmation: false } });
  });
  it("prefills only an eligible outgoing suggestion with exact minor units", () => {
    const h = harness(); h.open({ fromMemberId: id(1), toMemberId: id(2), amountMinor: Number.MAX_SAFE_INTEGER, currency: "HKD" });
    expect(h.state.dialog).toMatchObject({ draft: { toMemberId: id(2), amount: "90071992547409.91", currency: "HKD", confirmation: false } });
    h.close(); h.open({ fromMemberId: id(3), toMemberId: id(1), amountMinor: 100, currency: "HKD" });
    expect(h.state.dialog).toMatchObject({ draft: { toMemberId: "", amount: "" } });
  });
  it.each(["busy", "inflight", "permission"])("does not open during %s guard", (guard) => {
    const h = harness(); h.state.busy = guard === "busy"; h.paymentInFlight.current = guard === "inflight";
    h.state.overview.permissions.canEditExpenses = guard !== "permission"; h.open(); expect(h.state.dialog).toBeNull();
  });
  it("requires current owner capability/status/revision for review, but honors member void capability", () => {
    const h = harness(); h.action(payment, "approve"); expect(h.state.dialog).toBeNull();
    h.state.overview.session.isOwner = true; h.action({ ...payment, revision: 1 }, "approve"); expect(h.state.dialog).toBeNull();
    h.action(payment, "approve"); expect(h.state.dialog).toMatchObject({ kind: "action", decision: { action: "approve", confirmation: false } });
    h.close(); h.state.overview.memberPayments[0].status = "rejected"; h.action({ ...payment, status: "rejected" }, "reject"); expect(h.state.dialog).toBeNull();
    h.state.overview.session.isOwner = false; h.action(h.state.overview.memberPayments[0], "void"); expect(h.state.dialog).toMatchObject({ decision: { action: "void" } });
  });
});

describe("repayment submit validation and explicit ledger operations", () => {
  it("records exact partial amounts after the trip without creating an expense or moving money", async () => {
    const h = harness(); h.fill(); await h.save();
    expect(h.jsonRequest).toHaveBeenCalledTimes(1);
    const [url, init] = h.jsonRequest.mock.calls[0];
    expect(url).toBe(`/api/trips/${id(9)}/payments`); expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ fromMemberId: id(1), toMemberId: id(2), amountMinor: 1025, currency: "HKD", occurredAt: "2035-04-01T00:00:00.000Z", note: "synthetic note", confirmation: true, clientRequestId: id(90) });
    expect(h.setNotice).toHaveBeenCalledWith(copy.pendingSaved); expect(h.refresh).toHaveBeenCalledWith({ syncDrafts: false });
    expect(h.state.dialog).toBeNull(); expect(h.paymentAttempt.current).toBeNull(); expect(h.state.busy).toBe(false);
  });
  it.each([
    [{ fromMemberId: id(3) }, "forbidden"], [{ toMemberId: id(1) }, "self"], [{ toMemberId: id(4) }, "self"], [{ toMemberId: id(5) }, "self"],
    [{ amount: "0" }, "precision"], [{ amount: "-1" }, "precision"], [{ amount: "1.001" }, "precision"], [{ amount: "90071992547409.92" }, "precision"],
    [{ confirmation: false }, "invalid"], [{ occurredAt: "2035-02-30T09:00" }, "invalid"], [{ note: "x".repeat(1001) }, "invalid"],
  ] as const)("retains invalid draft %# without any request", async (patch, error) => {
    const h = harness(); h.fill(patch); const before = h.state.dialog; await h.save();
    expect(h.jsonRequest).not.toHaveBeenCalled(); expect(h.state.dialog).toBe(before); expect(h.state.error).toBe(copy[error]);
  });
  it("allows explicit owner on-behalf payment while rejecting revoked permission", async () => {
    const h = harness(); h.state.overview.session.isOwner = true; h.fill({ fromMemberId: id(3) }); await h.save();
    expect(JSON.parse(h.jsonRequest.mock.calls[0][1].body as string).fromMemberId).toBe(id(3));
    h.fill(); h.state.overview.permissions.canEditExpenses = false; await h.save(); expect(h.jsonRequest).toHaveBeenCalledTimes(1);
  });
  it.each(["approve", "reject", "void"] as const)("submits %s as an explicit versioned action with a new key", async (action) => {
    const h = harness(); h.state.overview.session.isOwner = true; h.action(payment, action);
    const dialog = h.state.dialog as Dialog & { kind: "action" }; dialog.decision.confirmation = true; dialog.decision.reason = " checked externally ";
    await h.save();
    expect(h.jsonRequest.mock.calls[0][0]).toBe(`/api/trips/${id(9)}/payments/${payment.id}`);
    expect(h.jsonRequest.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(h.jsonRequest.mock.calls[0][1].body as string)).toEqual({ action, expectedRevision: 2, confirmation: true, reason: "checked externally", clientRequestId: id(90) });
  });
  it("rechecks revision, owner approval and confirmation at save time", async () => {
    const h = harness(); h.state.overview.session.isOwner = true; h.action(payment, "approve");
    await h.save(); expect(h.state.error).toBe(copy.invalid);
    (h.state.dialog as Dialog & { kind: "action" }).decision.confirmation = true;
    h.state.overview.memberPayments[0] = { ...payment, revision: 3 }; await h.save(); expect(h.state.error).toBe(copy.stale); expect(h.jsonRequest).not.toHaveBeenCalled();
  });
});

describe("repayment in-flight and uncertain response recovery", () => {
  it("blocks simultaneous submits and closing before the first result settles", async () => {
    const h = harness(); h.fill(); let resolve!: (value: MemberPayment) => void;
    h.jsonRequest.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const running = h.save(); const original = h.state.dialog; await h.save(); h.close(); h.open();
    expect(h.jsonRequest).toHaveBeenCalledTimes(1); expect(h.state.dialog).toBe(original); expect(h.state.open).toBe(true);
    resolve(payment); await running; expect(h.paymentInFlight.current).toBe(false);
  });
  it("keeps one frozen key/payload across uncertain failure, modal close, refresh and retry", async () => {
    const h = harness(); h.fill(); h.jsonRequest.mockRejectedValueOnce(new TypeError("Synthetic connection lost"));
    await h.save(); const attempt = h.paymentAttempt.current; const original = h.state.dialog;
    expect(h.state.locked).toBe(true); expect(h.state.error).toBe(copy.uncertain); expect(h.randomUUID).toHaveBeenCalledTimes(1);
    h.close(); expect(h.state.open).toBe(false); expect(h.state.dialog).toBe(original); expect(h.paymentAttempt.current).toBe(attempt);
    h.open({ fromMemberId: id(1), toMemberId: id(3), amountMinor: 9999, currency: "JPY" });
    expect(h.state.open).toBe(true); expect(h.state.dialog).toBe(original);
    h.state.overview.memberPayments[0].revision = 99;
    await h.save(); expect(h.jsonRequest).toHaveBeenCalledTimes(2); expect(h.randomUUID).toHaveBeenCalledTimes(1);
    expect(h.jsonRequest.mock.calls[1][0]).toBe(h.jsonRequest.mock.calls[0][0]);
    expect(h.jsonRequest.mock.calls[1][1].body).toBe(h.jsonRequest.mock.calls[0][1].body);
  });
  it.each([408, 500, 503])("retains unconfirmed state for status %s", async (status) => {
    const h = harness(); h.fill(); h.jsonRequest.mockRejectedValue(new time.JsonRequestError("Synthetic failure", status)); await h.save();
    expect(h.state.locked).toBe(true); expect(h.paymentAttempt.current).not.toBeNull(); expect(h.state.error).toBe(copy.uncertain);
  });
  it.each([[400, "invalid"], [401, "signedOut"], [403, "forbidden"], [409, "stale"]] as const)("keeps editable input after definitive status %s", async (status, error) => {
    const h = harness(); h.fill(); const original = h.state.dialog;
    h.jsonRequest.mockRejectedValue(new time.JsonRequestError("Synthetic failure", status)); await h.save();
    expect(h.state.dialog).toBe(original); expect(h.state.locked).toBe(false); expect(h.paymentAttempt.current).toBeNull(); expect(h.state.error).toBe(copy[error]);
  });
  it("does not replay a committed payment when only overview refresh failed", async () => {
    const h = harness(); h.fill(); h.refresh.mockRejectedValue(new Error("Synthetic refresh failure")); await h.save();
    expect(h.state.dialog).toBeNull(); expect(h.paymentAttempt.current).toBeNull(); expect(h.setNotice).toHaveBeenLastCalledWith(copy.refreshedLater);
  });
  it("does not complete or replay the old trip/member request into a changed scope", async () => {
    const h = harness(); h.fill(); let resolve!: (value: MemberPayment) => void;
    h.jsonRequest.mockImplementation(() => new Promise((done) => { resolve = done; })); const running = h.save();
    h.paymentScopeRef.current = `${id(99)}:${id(1)}`; h.state.overview.trip.id = id(99); resolve(payment); await running;
    expect(h.setNotice).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
    h.state.busy = false; h.open(); expect(h.state.dialog?.scope).toBe(`${id(99)}:${id(1)}`); expect(h.paymentAttempt.current).toBeNull();
    await h.save(); expect(h.jsonRequest).toHaveBeenCalledTimes(1);
  });
});
