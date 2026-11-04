import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";

import { GoogleCalendarPanel } from "@/components/app-shell";
import { messages } from "@/lib/i18n";

type Props = ComponentProps<typeof GoogleCalendarPanel>;
const overview = {
  calendar: { connected: true }, permissions: { canSyncCalendar: true },
  trip: { timeZone: "Asia/Tokyo" }, days: [], itinerary: [],
} as unknown as Props["overview"];
const state: Props["state"] = {
  events: [{ id: "event-1", title: "Existing Calendar event", startsAt: "2030-04-01T10:00:00Z",
    endsAt: "2030-04-01T11:00:00Z", location: null, htmlLink: null, linkedItineraryItemId: null }],
  conflicts: [{ itineraryItemId: "item-1", itineraryTitle: "Existing trip event",
    calendarEventId: "event-1", calendarTitle: "Existing Calendar event" }],
};
function render(locale: Props["locale"], overrides: Partial<Props> = {}) {
  return renderToStaticMarkup(createElement(GoogleCalendarPanel, {
    overview, locale, messages: messages[locale], state: null, busy: false,
    refresh: vi.fn(), syncAll: vi.fn(), openItineraryItem: vi.fn(), ...overrides,
  }));
}
const locales = ["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const;

describe("silent automatic Calendar refresh", () => {
  it.each(locales)("does not announce the first automatic read in %s", (locale) => {
    const markup = render(locale);
    expect(markup).not.toContain(messages[locale].calendarSyncing);
    expect(markup).not.toContain(messages[locale].checkingCalendarConflicts);
    expect(markup).not.toContain(messages[locale].loadingCalendar);
    expect(markup).not.toContain(messages[locale].noCalendarConflicts);
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain("disabled");
  });

  it.each(locales)("keeps cached content and usable controls during passive refresh in %s", (locale) => {
    const markup = render(locale, { state });
    expect(markup).toContain("Existing Calendar event");
    expect(markup).toContain("Existing trip event");
    expect(markup).not.toContain(messages[locale].calendarSyncing);
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain("disabled");
  });

  it.each(locales)("retains explicit-action loading feedback in %s", (locale) => {
    const markup = render(locale, { busy: true });
    expect(markup).toContain(messages[locale].calendarSyncing);
    expect(markup).not.toContain(messages[locale].loadingCalendar);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("disabled");
  });

  it("shows a successful empty result without claiming an initial read already succeeded", () => {
    const markup = render("en", { state: { events: [], conflicts: [] } });
    expect(markup).toContain(messages.en.noCalendarConflicts);
    expect(markup).toContain("0 Calendar events");
    expect(markup).not.toContain("calendar-event-list");
  });

  it("wires implicit reads as silent while keeping explicit actions and their feedback", () => {
    const source = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
    const read = source.slice(source.indexOf("const loadCalendar = useCallback"), source.indexOf("const syncCalendar = useCallback"));
    expect(read).toContain("window.setTimeout(() => void loadCalendar(false), 0)");
    expect(read).toContain("if (showBusy && calendarScopeRef.current === scope && calendarReadGeneration.current === generation) setNotice(message)");
    expect(read).toContain("if (showBusy) setCalendarBusy(true)");
    expect(read).toContain("if (showBusy && calendarScopeRef.current === scope && calendarActionGeneration.current === action) setCalendarBusy(false)");
    expect(source).toContain("refresh={() => void loadCalendar()}");
    const sync = source.slice(source.indexOf("const syncCalendar = useCallback"), source.indexOf("const viewCalendarConfirmation ="));
    expect(sync).toContain("setCalendarBusy(true)");
    expect(sync).toContain("loadCalendar(false)");
    expect(sync).toContain("setNotice(message)");
    expect(sync).toContain("setCalendarConfirmation(nextConfirmation)");
  });
});

describe("Calendar scoped request generation", () => {
  const source = readFileSync("src/components/app-shell.tsx", "utf8");
  const ast = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function load(bindings: Record<string, unknown>) {
    let found = "";
    const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "loadCalendar") found = `const ${node.getText(ast)};`; ts.forEachChild(node, visit); };
    visit(ast); expect(found).not.toBe("");
    const code = ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(bindings), `${code};return loadCalendar;`)(...Object.values(bindings)) as (showBusy?: boolean) => Promise<void>;
  }
  function setup() {
    const context = { ...overview, trip: { id: "trip-a", timeZone: "Asia/Tokyo" }, session: { memberId: "member-a" } };
    return { overview: context, messages: messages.en, useCallback: (fn: unknown) => fn,
      calendarScopeRef: { current: "trip-a:member-a" as string | null }, calendarReadGeneration: { current: 0 }, calendarActionGeneration: { current: 0 },
      setCalendarRead: vi.fn(), setCalendarBusy: vi.fn(), setNotice: vi.fn(), refresh: vi.fn(async () => {}),
      calendarAuthorizationNeedsReconnect: () => false, jsonRequest: vi.fn() };
  }
  it("discards reads after trip/member change and does not publish old busy/error state", async () => {
    const run = setup(); let resolve!: (value: unknown) => void;
    run.jsonRequest.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const request = load(run)(); run.calendarScopeRef.current = "trip-b:member-b"; resolve(state); await request;
    expect(run.setCalendarRead).not.toHaveBeenCalled(); expect(run.setNotice).not.toHaveBeenCalled(); expect(run.setCalendarBusy.mock.calls).toEqual([[true]]);
  });
  it("keeps the newest read if an older same-scope request finishes later", async () => {
    const run = setup(); const resolve: Array<(value: unknown) => void> = [];
    run.jsonRequest.mockImplementation(() => new Promise((done) => resolve.push(done)));
    const read = load(run); const old = read(false); const latest = read(false);
    resolve[1]({ events: [], conflicts: [] }); await latest; resolve[0](state); await old;
    expect(run.setCalendarRead).toHaveBeenCalledExactlyOnceWith({ scope: "trip-a:member-a", state: { events: [], conflicts: [] } });
    expect(run.setCalendarBusy).not.toHaveBeenCalled(); expect(run.setNotice).not.toHaveBeenCalled();
  });
  it("does not announce a late reconnect error after revalidation changes scope", async () => {
    const run = setup(); run.jsonRequest.mockRejectedValue(new Error("Reconnect")); run.calendarAuthorizationNeedsReconnect = () => true;
    run.refresh.mockImplementation(async () => { run.calendarScopeRef.current = null; });
    await load(run)(); expect(run.setNotice).not.toHaveBeenCalled();
  });
  it("clears Calendar display/action scope before sign-out and on identity failures", () => {
    const signOut = source.slice(source.indexOf("const signOut ="), source.indexOf("const signOut =") + 1000);
    expect(signOut.indexOf("calendarScopeRef.current = null")).toBeLessThan(signOut.indexOf("await jsonRequest"));
    expect(source).toContain("calendarRead?.scope === calendarScope ? calendarRead.state : null");
    expect(source).toContain("calendarImport.scope === calendarScope");
    expect(source).toContain("calendarPoints={overviewCalendarPoints}"); expect(source).toContain("calendarPoints={group.calendarPoints}");
  });
});
