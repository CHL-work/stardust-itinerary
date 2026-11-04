import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarImportDialog, CalendarImportForm, calendarImportFailure, calendarImportPayload, type CalendarImportDraft } from "./calendar-import-dialog";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import type { CalendarImportInput, CalendarImportPreview } from "@/lib/calendar/import-contracts";
import { calendarImportMessages } from "@/lib/calendar/import-i18n";
import { locales } from "@/lib/i18n";

const preview: CalendarImportPreview = { previewToken: "synthetic-preview", expiresAt: "2030-04-01T11:00:00Z", existing: null,
  source: { eventId: "synthetic-source", title: "Synthetic private booking", location: "Synthetic source venue", startsAt: "2030-04-01T10:00:00Z", endsAt: "2030-04-01T11:00:00Z", allDay: false, startDate: null, endDateExclusive: null } };
const draft: CalendarImportDraft = { itemType: "activity", visibility: "private", viewerMemberIds: [], locationName: "Synthetic venue", mapUrl: "" };
const members = [{ id: "self", displayName: "Synthetic Self", status: "active" }, { id: "other", displayName: "Synthetic Other", status: "active" }, { id: "invited", displayName: "Synthetic Invited", status: "invited" }, { id: "disabled", displayName: "Synthetic Disabled", status: "disabled" }];
const base = { preview, draft, members, memberId: "self", locale: "en" as const, timeZone: "Asia/Tokyo", busy: false, locked: false, error: null, change: vi.fn(), submit: vi.fn(), close: vi.fn() };
function inputs(node: ReactNode): Array<{ type?: string; value?: string; checked?: boolean; onChange?: (event: { target: { value: string; checked: boolean } }) => void }> {
  if (Array.isArray(node)) return node.flatMap(inputs);
  if (!isValidElement<{ children?: ReactNode; type?: string; value?: string; checked?: boolean; onChange?: (event: { target: { value: string; checked: boolean } }) => void }>(node)) return [];
  return node.type === "input" ? [node.props] : inputs(node.props.children);
}
const source = readFileSync("src/components/calendar-import-dialog.tsx", "utf8");
const ast = ts.createSourceFile("calendar-import-dialog.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function closure<T>(name: string, bindings: Record<string, unknown>): T {
  let found = "";
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = `const ${node.getText(ast)};`; ts.forEachChild(node, walk); };
  walk(ast); expect(found).not.toBe("");
  const code = ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code};return ${name};`)(...Object.values(bindings)) as T;
}
afterEach(() => vi.useRealTimers());
describe("private Calendar import form", () => {
  it.each(locales)("has localized read-only source and explicit sharing in %s", (locale) => {
    const html = renderToStaticMarkup(createElement(CalendarImportForm, { ...base, locale })); const copy = calendarImportMessages(locale);
    expect(html).toContain(copy.source); expect(html).toContain(copy.privateHint); expect(html).toContain(copy.save);
    expect(html).toContain("Synthetic private booking"); expect(html).toContain("Synthetic Other"); expect(html).toContain("Synthetic Invited");
    expect(html).not.toContain("Synthetic Disabled"); expect(html).not.toContain('type="datetime-local"'); expect(html).not.toContain('value="Synthetic private booking"');
    expect(inputs(CalendarImportForm({ ...base, locale })).filter((input) => input.type === "checkbox").map((input) => input.checked)).toEqual([true, false, false]);
  });
  it("retains all-day source date evidence without time-zone conversion", () => {
    const allDay = { ...preview, source: { ...preview.source, allDay: true, startDate: "2030-04-01", endDateExclusive: "2030-04-03" } };
    const html = renderToStaticMarkup(createElement(CalendarImportForm, { ...base, preview: allDay, timeZone: "America/Chicago" }));
    expect(html).toContain("All day · Apr 1, 2030 — Apr 2, 2030"); expect(html).not.toContain("09:00");
  });
  it("sends no Calendar text or source timing in the source-bound commit payload", () => {
    expect(calendarImportPayload(preview, draft)).toEqual({ previewToken: "synthetic-preview", visibility: "private", viewerMemberIds: [], itemType: "activity", locationName: "Synthetic venue", mapUrl: null });
    expect(calendarImportPayload(preview, { ...draft, visibility: "trip", viewerMemberIds: ["other"] }).viewerMemberIds).toEqual([]);
    expect(calendarImportPayload(preview, { ...draft, viewerMemberIds: ["other"] }).viewerMemberIds).toEqual(["other"]);
  });
  it("retains applied AI provenance when manually editing the place", () => {
    const change = vi.fn(); const initial = { ...draft, aiReceiptToken: "signed-source-provenance" };
    inputs(CalendarImportForm({ ...base, draft: initial, change }))[0].onChange?.({ target: { value: "Corrected branch", checked: false } });
    expect(change).toHaveBeenCalledWith({ ...initial, locationName: "Corrected branch" });
    expect(calendarImportPayload(preview, change.mock.calls[0][0]).aiReceiptToken).toBe(initial.aiReceiptToken);
  });
  it("locks uncertain input and offers same-import retry, with touch-sized controls", () => {
    const html = renderToStaticMarkup(createElement(CalendarImportForm, { ...base, locked: true, error: "Retained error" }));
    expect(html).toContain("<fieldset disabled"); expect(html).toContain("Retry same import"); expect(html).toContain('role="alert"');
    const css = readFileSync("src/components/calendar-import.module.css", "utf8");
    expect(css).toContain("min-height: 44px"); expect(css).toContain("font-size: 16px"); expect(css).toContain(":focus-visible"); expect(css).toContain("overflow-wrap: anywhere");
  });
  it("does not start a provider call merely by rendering the dialog", () => {
    const request = vi.fn(); renderToStaticMarkup(createElement(CalendarImportDialog, { tripId: "trip", eventId: "source", memberId: "self", members, locale: "en", timeZone: "Asia/Tokyo", request, complete: vi.fn(), close: vi.fn() }));
    expect(request).not.toHaveBeenCalled();
  });
});

describe("actual Calendar import/search handlers", () => {
  function save(request: ReturnType<typeof vi.fn> = vi.fn(async () => ({ status: "pending" }))) {
    return { preview, draft, error: null, isTrustedGoogleMapsUrl, calendarImportPayload, calendarImportFailure, attempt: { current: null as CalendarImportInput | null }, saveInFlight: { current: false }, searchGeneration: { current: 0 }, active: { current: true }, tripId: "synthetic-trip", request, complete: vi.fn(), setBusy: vi.fn(), onBusyChange: vi.fn(), setLocked: vi.fn(), setError: vi.fn() };
  }
  it("holds one exact source-bound payload across failed response and retry", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("Network lost")).mockResolvedValueOnce({ status: "pending" }); const bindings = save(request);
    const submit = closure<(event: { preventDefault: () => void }) => Promise<void>>("submit", bindings);
    await submit({ preventDefault: vi.fn() }); bindings.draft = { ...draft, locationName: "Other input" };
    await closure<typeof submit>("submit", bindings)({ preventDefault: vi.fn() });
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body); expect(bindings.complete).toHaveBeenCalledOnce();
    expect(bindings.setLocked).toHaveBeenCalledWith(true); expect(bindings.onBusyChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
  it("rejects double submit and ignores completion after the scoped dialog closes", async () => {
    let resolve!: (value: unknown) => void; const request = vi.fn(() => new Promise((done) => { resolve = done; })); const bindings = save(request);
    const submit = closure<(event: { preventDefault: () => void }) => Promise<void>>("submit", bindings);
    const running = submit({ preventDefault: vi.fn() }); await submit({ preventDefault: vi.fn() }); expect(request).toHaveBeenCalledOnce();
    bindings.active.current = false; resolve({ status: "approved" }); await running; expect(bindings.complete).not.toHaveBeenCalled();
  });
  it("refreshes a definitive stale preview without changing the manual draft or automatically committing", async () => {
    const bindings = { ...save(), eventId: "synthetic-source", error: "stale", setPreview: vi.fn() };
    bindings.request.mockResolvedValue({ ...preview, previewToken: "fresh-preview" }); bindings.attempt.current = calendarImportPayload(preview, draft);
    await closure<(event: { preventDefault: () => void }) => Promise<void>>("submit", bindings)({ preventDefault: vi.fn() }); expect(bindings.request).not.toHaveBeenCalled();
    await closure<() => Promise<void>>("refreshPreview", bindings)();
    expect(bindings.setPreview).toHaveBeenCalledWith({ ...preview, previewToken: "fresh-preview" }); expect(bindings.attempt.current).toBeNull();
    expect(bindings.draft).toEqual(draft); expect(bindings.complete).not.toHaveBeenCalled(); expect(bindings.setLocked).toHaveBeenCalledWith(false);
  });
  it("recognizes safe reconnect/stale codes without displaying raw errors", () => {
    expect(calendarImportFailure({ code: "CALENDAR_IMPORT_RECONNECT" }, "save")).toBe("reconnect");
    expect(calendarImportFailure(new Error("CALENDAR_IMPORT_STALE"), "save")).toBe("stale");
    expect(calendarImportFailure(Object.assign(new Error("CALENDAR_IMPORT_RECONNECT"), { code: null }), "save")).toBe("reconnect");
    expect(calendarImportFailure(new Error("Sensitive provider data"), "save")).toBe("save");
  });
  function search(request: ReturnType<typeof vi.fn> = vi.fn(async () => ({ requestId: "fixed-request", status: "unavailable" }))) {
    return { subject: "Synthetic public museum, Tokyo", consent: true, searchBusy: false, busy: false, locked: false, active: { current: true }, searchGeneration: { current: 0 }, searchAttempt: { current: { subject: "Synthetic public museum, Tokyo", requestId: "fixed-request" } }, request, tripId: "synthetic-trip", locale: "en", isTrustedGoogleMapsUrl, setSearchBusy: vi.fn(), setSearchFailed: vi.fn(), setSuggestion: vi.fn() };
  }
  it("requires consent and sends only the explicit public subject, never Calendar or trip content", async () => {
    const bindings = search(); bindings.consent = false; await closure<() => Promise<void>>("findPlace", bindings)(); expect(bindings.request).not.toHaveBeenCalled();
    bindings.consent = true; await closure<() => Promise<void>>("findPlace", bindings)();
    const call = bindings.request.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ subject: bindings.subject, consent: true, locale: "en", requestId: "fixed-request" });
    expect(JSON.stringify(call)).not.toContain(preview.source.title); expect(JSON.stringify(call)).not.toContain("destination");
  });
  it("recovers a running lookup with GET using the same ID and never auto-applies a suggestion", async () => {
    vi.useFakeTimers(); const result = { requestId: "fixed-request", status: "found", locationName: "Synthetic public museum", mapUrl: "https://www.google.com/maps/search/?api=1&query=Synthetic", aiReceiptToken: "signed-provenance", sources: [] };
    const request = vi.fn().mockResolvedValueOnce({ ...result, status: "running" }).mockResolvedValueOnce(result); const bindings = search(request);
    const run = closure<() => Promise<void>>("findPlace", bindings)(); await vi.advanceTimersByTimeAsync(2500); await run;
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[1][0]).toContain("?requestId=fixed-request"); expect(request.mock.calls[1][1].method).toBeUndefined();
    expect(bindings.setSuggestion).toHaveBeenCalledWith(result); expect(bindings.setSearchFailed).toHaveBeenLastCalledWith(false);
  });
  it("drops a stale lookup response when public text or scope changes", async () => {
    let resolve!: (value: unknown) => void; const request = vi.fn(() => new Promise((done) => { resolve = done; })); const bindings = search(request);
    const run = closure<() => Promise<void>>("findPlace", bindings)(); bindings.searchGeneration.current += 1; resolve({ requestId: "fixed-request", status: "found" }); await run;
    expect(bindings.setSuggestion.mock.calls).toEqual([[null]]); expect(bindings.setSearchFailed.mock.calls).toEqual([[false]]);
  });
});
