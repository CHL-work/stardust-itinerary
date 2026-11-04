import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { reconcileTripSettingsDraft, TripSettingsCard, tripSettingsScope } from "./app-shell";
import { tripDateErrors, validTripDateRange } from "@/lib/app/trip-date-range";
import { formatMessage, locales, messages, type Locale } from "@/lib/i18n";

const draft = () => ({ scope: "synthetic-trip:synthetic-member:synthetic-user", destinationName: "Synthetic city", timeZone: "Asia/Tokyo", maxMembers: "10",
  startsOn: "2030-04-01", endsOn: "2030-04-05", expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-05" });
const source = readFileSync("src/components/app-shell.tsx", "utf8");
const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function collect(node: ts.Node): void { nodes.push(node); ts.forEachChild(node, collect); }
collect(tree);
const save = nodes.find((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && node.name.getText(tree) === "saveTripSettings")!;
function saveHarness(locale: Locale = "en", settings = draft(), owner = true) {
  const request = vi.fn().mockResolvedValue({ status: "updated" });
  const refresh = vi.fn().mockResolvedValue({ trip: { id: "synthetic-trip" } }), setNotice = vi.fn(), setBusy = vi.fn(), confirm = vi.fn().mockReturnValue(true);
  let settingsState: ReturnType<typeof draft> | null = settings;
  const setTripSettings = vi.fn((update: (current: typeof settingsState) => typeof settingsState) => { settingsState = update(settingsState); });
  const bindings = { overview: { session: { isOwner: owner, memberId: "synthetic-member", userId: "synthetic-user" }, trip: { id: "synthetic-trip", memberCount: 2, startsOn: "2030-03-01", endsOn: "2030-04-06" } },
    tripSettings: settings, setTripSettings, tripSettingsScope, tripSettingsScopeRef: { current: draft().scope as string | null },
    tripSettingsSaving: { current: false }, jsonRequest: request, refresh, setNotice, setBusy,
    messages: messages[locale], locale, formatMessage, formatTripDay: (date: string) => date,
    tripDateErrors, validTripDateRange, window: { confirm } };
  const code = ts.transpileModule(`const save = ${save.initializer!.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function(...Object.keys(bindings), `${code}; return save;`)(...Object.values(bindings)) as (event: { preventDefault: () => void }) => Promise<void>;
  return { run: () => run({ preventDefault: vi.fn() }), request, refresh, setNotice, setBusy, confirm, bindings, getSettings: () => settingsState };
}
function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}

describe("owner trip dates in everyday Settings", () => {
  it.each(locales)("renders labeled start/end controls and safe guidance in %s", (locale) => {
    const setSettings = vi.fn(), settings = draft();
    const node = TripSettingsCard({ settings, setSettings, memberCount: 2, busy: false, messages: messages[locale], submit: vi.fn() });
    const dates = descendants(node).filter((item) => item.type === "input" && item.props.type === "date");
    expect(dates).toHaveLength(2);
    expect(dates[0].props).toMatchObject({ name: "startsOn", value: settings.startsOn, "aria-label": messages[locale].startDateField });
    expect(dates[1].props).toMatchObject({ name: "endsOn", value: settings.endsOn, min: settings.startsOn, max: "2031-04-01", "aria-label": messages[locale].endDateField });
    (dates[0].props.onChange as (event: unknown) => void)({ target: { value: "2030-03-31" } });
    expect(setSettings).toHaveBeenLastCalledWith({ ...settings, startsOn: "2030-03-31" });
    (dates[1].props.onChange as (event: unknown) => void)({ target: { value: "2030-04-03" } });
    expect(setSettings).toHaveBeenLastCalledWith({ ...settings, endsOn: "2030-04-03" });
    expect(renderToStaticMarkup(node)).toContain(messages[locale].tripDatesHint);
  });

  it("locks all controls during saving and tolerates a cleared start date", () => {
    const html = renderToStaticMarkup(createElement(TripSettingsCard, { settings: { ...draft(), startsOn: "" }, setSettings: vi.fn(), memberCount: 2, busy: true, messages: messages.en, submit: vi.fn() }));
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain(messages.en.tripSettingsSaving);
    expect(html).not.toContain("Invalid Date");
  });

  it("keeps dates owner-only and outside the collapsed advanced controls", () => {
    const settings = source.slice(source.indexOf('{section === "settings"'), source.indexOf('<details className={advancedStyles.advanced}'));
    expect(settings).toContain("overview.session.isOwner && tripSettings?.scope === tripSettingsScope(overview) ? <TripSettingsCard");
    const card = nodes.find((node): node is ts.ConditionalExpression => ts.isConditionalExpression(node)
      && node.whenTrue.getText(tree).startsWith("<TripSettingsCard"))!;
    const code = ts.transpileModule(`const render = () => (${card.getText(tree)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const render = new Function("React", "overview", "tripSettings", "TripSettingsCard", "setTripSettings", "busy", "messages", "saveTripSettings", "tripSettingsScope", `${code}; return render();`);
    expect(render({ createElement }, { session: { isOwner: false } }, draft(), TripSettingsCard, vi.fn(), false, messages.en, vi.fn(), tripSettingsScope)).toBeNull();
    expect(render({ createElement }, { session: { isOwner: true, memberId: "synthetic-member", userId: "synthetic-user" }, trip: { id: "different-trip" } }, draft(), TripSettingsCard, vi.fn(), false, messages.en, vi.fn(), tripSettingsScope)).toBeNull();
  });

  it.each(locales)("sends both dates with the draft's original concurrency fence in %s", async (locale) => {
    const settings = { ...draft(), startsOn: "2030-03-31", endsOn: "2030-04-04" };
    const test = saveHarness(locale, settings);
    await test.run();
    expect(test.confirm).toHaveBeenCalledOnce();
    for (const value of [settings.startsOn, settings.endsOn, settings.expectedStartsOn, settings.expectedEndsOn]) expect(test.confirm.mock.calls[0][0]).toContain(value);
    const { scope, ...payload } = settings;
    expect(scope).toBe(draft().scope);
    expect(JSON.parse(test.request.mock.calls[0][1].body)).toEqual({ ...payload, maxMembers: 10 });
    expect(test.refresh).toHaveBeenCalledOnce();
    expect(test.setNotice).toHaveBeenCalledWith(messages[locale].tripSettingsSaved);
    expect(test.bindings.tripSettingsSaving.current).toBe(false);
  });

  it.each([{ startsOn: "2030-04-06" }, { endsOn: "2031-04-02" }, { startsOn: "2030-02-30" }])("rejects invalid bounds without requesting or confirming: %j", async (change) => {
    const test = saveHarness("en", { ...draft(), ...change }); await test.run();
    expect(test.request).not.toHaveBeenCalled(); expect(test.confirm).not.toHaveBeenCalled();
    expect(test.setNotice).toHaveBeenCalledWith(messages.en.tripSettingsInvalidDates);
  });

  it("does not send cancelled confirmations or nonowner requests", async () => {
    const test = saveHarness("en", { ...draft(), startsOn: "2030-03-31" });
    test.confirm.mockReturnValue(false); await test.run(); expect(test.request).not.toHaveBeenCalled();
    const member = saveHarness("en", draft(), false); await member.run(); expect(member.request).not.toHaveBeenCalled();
  });

  it.each(locales)("keeps edits on occupied/stale failure and never renders arbitrary private detail in %s", async (locale) => {
    for (const [error, key] of [[tripDateErrors.occupied, "tripSettingsDatesOccupied"], [tripDateErrors.stale, "tripSettingsDatesStale"], ["PRIVATE_SERVER_DETAIL", "tripSettingsSaveFailed"]] as const) {
      const settings = { ...draft(), startsOn: "2030-04-02" };
      const test = saveHarness(locale, settings); test.request.mockRejectedValue(new Error(error)); await test.run();
      expect(test.setNotice).toHaveBeenLastCalledWith(messages[locale][key]);
      expect(test.bindings.tripSettings).toEqual(settings); expect(test.refresh).not.toHaveBeenCalled();
      expect(test.setBusy).toHaveBeenLastCalledWith(false);
    }
  });

  it("blocks duplicate clicks and distinguishes saved-but-refresh-failed from a failed write", async () => {
    const test = saveHarness(); let finish!: () => void;
    test.request.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const first = test.run(); await test.run(); expect(test.request).toHaveBeenCalledOnce();
    test.refresh.mockRejectedValue(new Error("Synthetic offline")); finish(); await first;
    expect(test.setNotice).toHaveBeenLastCalledWith(messages.en.refreshAfterChangeFailed);
    expect(test.request).toHaveBeenCalledOnce(); expect(test.bindings.tripSettingsSaving.current).toBe(false);
  });

  it("rebases the accepted dates when the real refresh failure returns undefined", async () => {
    const settings = { ...draft(), startsOn: "2030-04-02", endsOn: "2030-04-04" };
    const test = saveHarness("en", settings); test.refresh.mockResolvedValue(undefined); await test.run();
    expect(test.setNotice).toHaveBeenLastCalledWith(messages.en.refreshAfterChangeFailed);
    expect(test.getSettings()).toEqual({ ...settings, expectedStartsOn: settings.startsOn, expectedEndsOn: settings.endsOn });
    const retry = saveHarness("en", test.getSettings()!); await retry.run();
    expect(retry.confirm).not.toHaveBeenCalled();
    expect(JSON.parse(retry.request.mock.calls[0][1].body)).toMatchObject({ expectedStartsOn: settings.startsOn, expectedEndsOn: settings.endsOn });
  });

  it.each(["trip", "member", "user"])("refuses an old draft after a passive %s identity change", async (kind) => {
    const test = saveHarness();
    if (kind === "trip") test.bindings.overview.trip.id = "other-trip";
    if (kind === "member") test.bindings.overview.session.memberId = "other-member";
    if (kind === "user") test.bindings.overview.session.userId = "other-user";
    test.bindings.tripSettingsScopeRef.current = tripSettingsScope(test.bindings.overview);
    await test.run(); expect(test.request).not.toHaveBeenCalled(); expect(test.confirm).not.toHaveBeenCalled();
  });

  it("does not rebase or report an old save into a new scope during delivery", async () => {
    const test = saveHarness(); let finish!: () => void;
    test.request.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const saving = test.run(); test.bindings.tripSettingsScopeRef.current = "another-scope"; finish(); await saving;
    expect(test.bindings.setTripSettings).not.toHaveBeenCalled(); expect(test.setNotice).not.toHaveBeenCalled();
    expect(test.refresh).not.toHaveBeenCalled();
  });

  it("preserves same-scope edits but rebuilds scope transitions even on passive refresh", () => {
    const current = { ...draft(), startsOn: "2030-03-31" };
    const overview = { session: { memberId: "synthetic-member", userId: "synthetic-user", isOwner: true },
      trip: { id: "synthetic-trip", destinationName: "Server city", timeZone: "UTC", maxMembers: 8, startsOn: "2030-04-01", endsOn: "2030-04-05" } };
    expect(reconcileTripSettingsDraft(current, overview, false)).toBe(current);
    for (const changed of [
      { ...overview, trip: { ...overview.trip, id: "other-trip" } },
      { ...overview, session: { ...overview.session, memberId: "other-member" } },
      { ...overview, session: { ...overview.session, userId: "other-user" } },
    ]) expect(reconcileTripSettingsDraft(current, changed, false)).toEqual({ scope: tripSettingsScope(changed),
      destinationName: "Server city", timeZone: "UTC", maxMembers: "8", startsOn: "2030-04-01", endsOn: "2030-04-05",
      expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-05" });
    expect(reconcileTripSettingsDraft(current, { ...overview, session: { ...overview.session, isOwner: false } }, false)).toBeNull();
    expect(reconcileTripSettingsDraft(current, overview, true)?.startsOn).toBe(overview.trip.startsOn);
    expect(source).toContain("setTripSettings((current) => reconcileTripSettingsDraft(current, data, syncDrafts))");
  });
});
