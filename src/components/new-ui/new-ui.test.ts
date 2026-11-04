import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Bot, CalendarDays, Check, ReceiptText, Route, Settings } from "lucide-react";

import { NewBottomNavView, QuickAddButtonView } from "@/components/new-ui/new-navigation";
import { DayStripView, revealItineraryDay, TripOverviewBarView, tripProgress } from "@/components/new-ui/trip-overview-bar";
import { UiModeSettingsCardView, UiModeToggleButton } from "@/components/new-ui/ui-mode-toggle";
import { TripAdjacentNav } from "@/components/trip-adjacent-nav";
import { classicThemeColor, newDarkThemeColor, newLightThemeColor, UiModeSync } from "@/components/new-ui/ui-mode-sync";
import { uiRefreshMessages } from "@/lib/app/ui-refresh-i18n";
import { formatMessage, locales } from "@/lib/i18n";

const navItems = (owner: boolean) => [
  { id: "today" as const, label: "Today (long)", icon: CalendarDays },
  { id: "itinerary" as const, label: "Itinerary (long)", icon: Route },
  { id: "expenses" as const, label: "Trip expenses", icon: ReceiptText },
  { id: "ai" as const, label: "AI", icon: Bot },
  ...(owner ? [{ id: "requests" as const, label: "Approvals (2)", icon: Check }] : []),
  { id: "settings" as const, label: "Settings", icon: Settings },
];

function buttons(node: ReactNode): Array<ReactElement<{ onClick?: () => void; "aria-pressed"?: boolean }>> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === "button" ? [node as ReactElement<{ onClick?: () => void }>] : [];
  return [...own, ...buttons(node.props.children)];
}

describe("layout toggle", () => {
  it.each(locales)("always offers the other layout in %s", (locale) => {
    const copy = uiRefreshMessages(locale);
    const fromNew = renderToStaticMarkup(createElement(UiModeToggleButton, { mode: "new", locale, onSwitch: vi.fn() }));
    expect(fromNew).toContain(copy.toggleToClassic);
    expect(fromNew).toContain(`aria-label="${copy.toggleToClassicLabel}"`);
    expect(fromNew).toContain('data-ui-target="classic"');
    expect(fromNew).toContain('data-feedback-action="settings_save"');
    const fromClassic = renderToStaticMarkup(createElement(UiModeToggleButton, { mode: "classic", locale, onSwitch: vi.fn() }));
    expect(fromClassic).toContain(copy.toggleToNew);
    expect(fromClassic).toContain('data-ui-target="new"');
  });

  it("reports the target layout without other side effects", () => {
    const onSwitch = vi.fn();
    UiModeToggleButton({ mode: "new", locale: "en", onSwitch }).props.onClick();
    UiModeToggleButton({ mode: "classic", locale: "en", onSwitch }).props.onClick();
    expect(onSwitch.mock.calls).toEqual([["classic"], ["new"]]);
  });

  it.each(locales)("Settings card marks the layout in use with aria-pressed in %s", (locale) => {
    const copy = uiRefreshMessages(locale);
    const choose = vi.fn();
    const markup = renderToStaticMarkup(createElement(UiModeSettingsCardView, { mode: "classic", locale, choose }));
    expect(markup).toContain(copy.settingsTitle);
    expect(markup).toMatch(/data-ui-option="new" aria-pressed="false"/u);
    expect(markup).toMatch(/data-ui-option="classic" aria-pressed="true"/u);
    expect(markup.match(new RegExp(copy.current, "gu"))).toHaveLength(1);
    const found = buttons(UiModeSettingsCardView({ mode: "classic", locale, choose }));
    expect(found).toHaveLength(2);
    found.forEach((button) => button.props.onClick?.());
    expect(choose.mock.calls).toEqual([["new"], ["classic"]]);
  });
});

describe("new bottom navigation", () => {
  it.each(locales)("uses short labels without scrolling counts in %s", (locale) => {
    const copy = uiRefreshMessages(locale);
    const markup = renderToStaticMarkup(createElement(NewBottomNavView<string>, { items: navItems(true), section: "today", navigate: vi.fn(), pendingCount: 2, locale }));
    for (const label of [copy.navToday, copy.navItinerary, copy.navExpenses, copy.navAi, copy.navRequests, copy.navSettings]) expect(markup).toContain(`>${label}</span>`);
    expect(markup).not.toContain("Approvals (2)");
    expect(markup).toContain('data-count="6"');
    expect(markup).toContain(`aria-label="${formatMessage(copy.navRequestsWaiting, { count: 2 })}"`);
    expect(markup).toContain('<span class="new-bottom-badge" aria-hidden="true">2</span>');
    expect(markup.match(/aria-current="page"/gu)).toHaveLength(1);
  });

  it("omits the approvals badge at zero, caps large counts and keeps Settings active for Activity", () => {
    const zero = renderToStaticMarkup(createElement(NewBottomNavView<string>, { items: navItems(true), section: "activity", navigate: vi.fn(), pendingCount: 0, locale: "en" }));
    expect(zero).not.toContain("new-bottom-badge");
    expect(zero).toMatch(/class="new-bottom-item is-active" aria-current="page"><span class="new-bottom-icon">.*?<\/span><span class="new-bottom-label">Settings/u);
    const many = renderToStaticMarkup(createElement(NewBottomNavView<string>, { items: navItems(true), section: "today", navigate: vi.fn(), pendingCount: 140, locale: "en" }));
    expect(many).toContain(">99+</span>");
    const member = renderToStaticMarkup(createElement(NewBottomNavView<string>, { items: navItems(false), section: "today", navigate: vi.fn(), pendingCount: 3, locale: "en" }));
    expect(member).toContain('data-count="5"');
    expect(member).not.toContain("new-bottom-badge");
  });

  it("navigates with the existing section ids", () => {
    const navigate = vi.fn();
    buttons(NewBottomNavView<string>({ items: navItems(true), section: "today", navigate, pendingCount: 0, locale: "en" })).forEach((button) => button.props.onClick?.());
    expect(navigate.mock.calls.flat()).toEqual(["today", "itinerary", "expenses", "ai", "requests", "settings"]);
  });

  it("maps quick add kinds to allowlisted feedback actions", () => {
    const add = vi.fn();
    expect(renderToStaticMarkup(createElement(QuickAddButtonView, { kind: "event", label: "Add event", add }))).toContain('data-feedback-action="event_open"');
    const expense = renderToStaticMarkup(createElement(QuickAddButtonView, { kind: "expense", label: "Add expense", add, disabled: true }));
    expect(expense).toContain('data-feedback-action="expense_open"');
    expect(expense).toContain('disabled=""');
    QuickAddButtonView({ kind: "event", label: "Add event", add }).props.onClick();
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe("trip summary and day chips", () => {
  it("computes trip progress from calendar dates", () => {
    expect(tripProgress("2030-04-01", "2030-04-06", "2030-03-29")).toEqual({ state: "upcoming", total: 6, daysUntil: 3 });
    expect(tripProgress("2030-04-01", "2030-04-06", "2030-03-31")).toEqual({ state: "upcoming", total: 6, daysUntil: 1 });
    expect(tripProgress("2030-04-01", "2030-04-06", "2030-04-01")).toEqual({ state: "active", total: 6, day: 1 });
    expect(tripProgress("2030-04-01", "2030-04-06", "2030-04-06")).toEqual({ state: "active", total: 6, day: 6 });
    expect(tripProgress("2030-04-01", "2030-04-06", "2030-04-07")).toEqual({ state: "past", total: 6 });
    expect(tripProgress("2030-04-01", "2030-04-01", "2030-04-01")).toEqual({ state: "active", total: 1, day: 1 });
    expect(tripProgress("2030-03-30", "2030-04-02", "2030-04-01")).toEqual({ state: "active", total: 4, day: 3 });
    // Spring-forward/fall-back days stay whole calendar days because only UTC date keys are compared.
    expect(tripProgress("2030-03-09", "2030-03-11", "2030-03-11")).toEqual({ state: "active", total: 3, day: 3 });
  });

  it("shows no progress for invalid or reversed dates", () => {
    for (const [startsOn, endsOn, today] of [
      ["2030-04-01", "2030-04-06", ""], ["2030-04-01", "2030-04-06", "not-a-date"], ["", "2030-04-06", "2030-04-02"],
      ["2030-04-06", "2030-04-01", "2030-04-03"], ["2030-02-30x", "2030-04-01", "2030-03-01"],
    ]) expect(tripProgress(startsOn, endsOn, today)).toBeNull();
    const markup = renderToStaticMarkup(createElement(TripOverviewBarView, {
      trip: { name: "Synthetic trip", destinationName: "", startsOn: "2030-04-06", endsOn: "2030-04-01" }, members: [], today: "2030-04-03", locale: "en",
    }));
    expect(markup).toContain('data-trip-state="unknown"');
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("new-trip-bar-progress");
  });

  const trip = { name: "Synthetic spring trip", destinationName: "Tokyo", startsOn: "2030-04-01", endsOn: "2030-04-06" };
  const members = [
    ...["Aki", "Ben", "Chika", "Dev", "Eri", "Fumi"].map((name, index) => ({ id: `m${index}`, displayName: name, status: "active" })),
    { id: "gone", displayName: "Removed", status: "removed" }, { id: "off", displayName: "Revoked", status: "revoked" },
  ];

  it.each(locales)("summarises the trip with localized progress in %s", (locale) => {
    const copy = uiRefreshMessages(locale);
    const markup = renderToStaticMarkup(createElement(TripOverviewBarView, { trip, members, today: "2030-04-03", locale }));
    expect(markup).toContain(trip.name);
    expect(markup).toContain(formatMessage(copy.dayOf, { day: 3, total: 6 }));
    expect(markup).toContain(`aria-label="${formatMessage(copy.membersMany, { count: 6 })}"`);
    expect(markup).toContain(">+1</i>");
    expect(markup).not.toContain("Removed");
    expect(markup).toContain('style="width:50%"');
    expect(renderToStaticMarkup(createElement(TripOverviewBarView, { trip, members, today: "2030-05-01", locale }))).toContain(copy.tripEnded);
  });

  it.each(locales)("links the chronologically previous and next trips in %s", (locale) => {
    const copy = uiRefreshMessages(locale);
    const trips = [
      { id: "later", name: "Synthetic later trip", startsOn: "2031-01-01", endsOn: "2031-01-05" },
      { id: "current", name: "Synthetic current trip", startsOn: "2030-04-01", endsOn: "2030-04-06" },
      { id: "earlier", name: "Synthetic earlier trip", startsOn: "2029-01-01", endsOn: "2029-01-05" },
    ];
    const render = (currentTripId: string, list = trips) => renderToStaticMarkup(createElement(TripAdjacentNav, { trips: list, currentTripId, locale, disabled: false, select: () => undefined }));
    const middle = render("current");
    expect(middle).toContain(copy.previousTrip);
    expect(middle).toContain("Synthetic earlier trip");
    expect(middle).toContain(copy.nextTrip);
    expect(middle).toContain("Synthetic later trip");
    expect(middle.indexOf("Synthetic earlier trip")).toBeLessThan(middle.indexOf("Synthetic later trip"));
    expect(middle.match(/data-feedback-action="trip_switch"/g)).toHaveLength(2);
    expect(render("earlier")).not.toContain(copy.previousTrip);
    expect(render("later")).not.toContain(copy.nextTrip);
    expect(render("current", [trips[1]])).toBe("");
  });

  it("switches through the shared handler and blocks while busy", () => {
    const select = vi.fn();
    const trips = [
      { id: "current", name: "Synthetic current trip", startsOn: "2030-04-01", endsOn: "2030-04-06" },
      { id: "next", name: "Synthetic next trip", startsOn: "2030-05-01", endsOn: "2030-05-06" },
    ];
    const nav = TripAdjacentNav({ trips, currentTripId: "current", locale: "en", disabled: false, select }) as ReactElement<{ children: (ReactElement<{ onClick: () => void }> | null)[] }>;
    nav.props.children[1]!.props.onClick();
    expect(select).toHaveBeenCalledWith("next");
    expect(renderToStaticMarkup(createElement(TripAdjacentNav, { trips, currentTripId: "current", locale: "en", disabled: true, select }))).toContain("disabled");
  });

  it.each(locales)("marks today and the selected chip in %s", (locale) => {
    const copy = uiRefreshMessages(locale);
    const days = ["2030-04-01", "2030-04-02", "2030-04-03"].map((date) => ({ date }));
    const markup = renderToStaticMarkup(createElement(DayStripView, { days, selectedDate: "2030-04-02", todayDate: "2030-04-03", locale, select: vi.fn() }));
    expect(markup.match(/data-day-chip=/gu)).toHaveLength(3);
    expect(markup.match(/aria-pressed="true"/gu)).toHaveLength(1);
    expect(markup).toMatch(/data-day-chip="2030-04-02" class="new-day-chip is-selected" aria-pressed="true"/u);
    expect(markup).toContain(`class="new-day-chip is-today" aria-pressed="false"`);
    expect(markup).toContain(`>${copy.todayChip}</span>`);
    expect(markup).toContain(`aria-label="${copy.daysLabel}"`);
    // The accessible name starts with the visible words and adds the full date; no aria-label override.
    expect(markup).not.toMatch(/<button[^>]*aria-label=/u);
    expect(markup.match(/<span class="sr-only">/gu)).toHaveLength(3);
  });

  it("renders Itinerary jump chips as buttons with today marked as the current date", () => {
    const days = ["2030-04-01", "2030-04-02", "2030-04-03"].map((date) => ({ date }));
    const markup = renderToStaticMarkup(createElement(DayStripView, { days, selectedDate: "2030-04-03", todayDate: "2030-04-03", locale: "en", select: vi.fn(), variant: "jump" }));
    expect(markup).not.toContain("aria-pressed");
    expect(markup.match(/aria-current="date"/gu)).toHaveLength(1);
    expect(markup).toContain('data-variant="jump"');
  });

  it("opens, scrolls to and focuses the chosen Itinerary day without touching other days", () => {
    const makeDay = (date: string) => {
      const summary = { focus: vi.fn() };
      return { dataset: { dayDate: date }, open: false, scrollIntoView: vi.fn(), querySelector: vi.fn(() => summary), summary };
    };
    const days = [makeDay("2030-04-01"), makeDay("2030-04-02")];
    const root = { querySelectorAll: vi.fn(() => days) } as unknown as ParentNode;
    expect(revealItineraryDay(root, "2030-04-02")).toBe(true);
    expect(root.querySelectorAll).toHaveBeenCalledWith(".itinerary-days details[data-day-date]");
    expect(days[1].open).toBe(true);
    expect(days[1].scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    expect(days[1].summary.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(days[0].open).toBe(false);
    expect(revealItineraryDay(root, "2030-05-01")).toBe(false);
  });
});

describe("browser chrome color", () => {
  it("renders light and dark theme colors for the new layout on the server", () => {
    const markup = renderToStaticMarkup(createElement(UiModeSync));
    expect(markup).toContain(`media="(prefers-color-scheme: light)" content="${newLightThemeColor}"`);
    expect(markup).toContain(`media="(prefers-color-scheme: dark)" content="${newDarkThemeColor}"`);
    expect(markup).not.toContain(classicThemeColor);
    expect(readFileSync("src/app/layout.tsx", "utf8")).not.toContain("themeColor");
  });
});

describe("new layout copy", () => {
  it("has identical non-empty keys in every locale and keeps both Cantonese modes neutral", () => {
    const keys = Object.keys(uiRefreshMessages("en"));
    for (const locale of locales) {
      const copy = uiRefreshMessages(locale);
      expect(Object.keys(copy)).toEqual(keys);
      for (const value of Object.values(copy)) expect(value.trim()).not.toBe("");
    }
    expect(uiRefreshMessages("zh-HK-lihkg")).toEqual(uiRefreshMessages("zh-HK"));
    expect(uiRefreshMessages("zh-HK").toggleToClassic).not.toBe(uiRefreshMessages("en").toggleToClassic);
    expect(uiRefreshMessages("ja-JP").toggleToClassic).not.toBe(uiRefreshMessages("en").toggleToClassic);
  });
});

// postcss ships with Next; parsing (not regex) keeps strings, comments and nested parentheses honest.
type CssParent = { type: string; parent?: CssParent };
type PostcssRoot = {
  walkAtRules(callback: (rule: { name: string }) => void): void;
  walkRules(callback: (rule: { selector: string; selectors: string[]; parent?: CssParent }) => void): void;
};
const nextRequire = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
const postcss = nextRequire("postcss") as { parse(css: string, options?: { from?: string }): PostcssRoot };
const allowedAtRules = new Set(["media", "container", "supports"]);

function cssRules(file: string) {
  const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
  const problems: string[] = [];
  const selectorsSeen: string[] = [];
  root.walkAtRules((rule) => { if (!allowedAtRules.has(rule.name)) problems.push(`@${rule.name} is not allowed`); });
  root.walkRules((rule) => {
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type !== "atrule") problems.push(`nested rule ${rule.selector}`);
    }
    selectorsSeen.push(...rule.selectors.map((selector) => selector.trim()));
  });
  return { problems, selectors: selectorsSeen };
}

describe("new layout stylesheets cannot leak into the classic layout", () => {
  const directory = "src/app/new-ui";
  const scoped = readdirSync(directory).filter((file) => file.endsWith(".css") && file !== "layout-toggle.css");

  it.each(scoped)("%s scopes every rule to :root[data-ui=\"new\"]", (file) => {
    const { problems, selectors } = cssRules(`${directory}/${file}`);
    expect(problems).toEqual([]);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector.startsWith(':root[data-ui="new"]'), `${file}: ${selector}`).toBe(true);
  });

  it("limits the shared toggle stylesheet to the toggle, its card and classic-only accommodations", () => {
    const { problems, selectors } = cssRules(`${directory}/layout-toggle.css`);
    expect(problems).toEqual([]);
    for (const selector of selectors) {
      expect(/^(\.ui-mode-|\.offline-topbar-actions\b|:root:not\(\[data-ui="new"\]\) )/u.test(selector), selector).toBe(true);
    }
  });

  it("keeps classic stylesheets free of layout-mode selectors and loads new-layout files after globals", () => {
    expect(readFileSync("src/app/globals.css", "utf8")).not.toContain("data-ui");
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout.indexOf('import "./globals.css"')).toBeLessThan(layout.indexOf('import "./new-ui/base.css"'));
    for (const file of scoped) expect(layout).toContain(`import "./new-ui/${file}"`);
    expect(layout).toContain("<html lang=\"zh-HK\" suppressHydrationWarning>");
    expect(layout).toContain("dangerouslySetInnerHTML={{ __html: uiModeBootstrapScript }}");
  });

  it("offers the toggle in the live and offline headers and in Settings", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(shell.match(/<UiModeToggle locale=\{locale\} \/>/gu)).toHaveLength(2);
    expect(shell).toContain('<div className="topbar-actions"><UiModeToggle locale={locale} /><LocaleSwitcher locale={locale} />');
    expect(shell).toContain('<div className="offline-topbar-actions"><UiModeToggle locale={locale} /><LocaleSwitcher locale={locale} /></div>');
    expect(shell.match(/<UiModeSettingsCard locale=\{locale\} \/>/gu)).toHaveLength(1);
    expect(shell.indexOf('<nav className="bottom-nav"')).toBeLessThan(shell.indexOf("<NewBottomNav "));
  });
});
