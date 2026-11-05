import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayEventMap, DayEventMapPanel, dayMapAttributionHeight, dayMapCalloutLayout, dayMapCompactTime, dayMapConnector, dayMapDisplayLegs, dayMapStopTime, dayMapTravelDistance, dayMapTravelModes, dayMapTravelTime, type DisplayMapLeg } from "./day-event-map";
import { dayMapMessages } from "@/lib/maps/i18n";
import { readIncludePrivatePlaces, saveIncludePrivatePlaces } from "@/lib/maps/private-places-preference";
import { dayMapResponseMatches, visibleDayMapStops, type DayMapResponse } from "@/lib/maps/client";
import { chooseMapViewport } from "@/lib/maps/geometry";
import type { DayMapStop } from "@/lib/maps/day-stops";
import { locales } from "@/lib/i18n";

const stop: DayMapStop = { key: "synthetic:event", number: 1, title: "Synthetic public museum", at: "2030-04-01T01:00:00Z", kind: "event", locationName: "Synthetic museum, Tokyo", mapUrl: null, visibility: "trip", pending: false, allDay: false };
const pending: DayMapStop = { ...stop, key: "pending:synthetic:event", number: 2, title: "Synthetic proposed return", pending: true };
const missing: DayMapStop = { ...stop, key: "missing:event", number: 3, title: "Synthetic unknown venue", locationName: null };
const privateStop: DayMapStop = { ...stop, key: "private:event", number: 4, title: "Synthetic private appointment", visibility: "private" };
const coordinate = { lat: 35.7, lng: 139.7 };
const ready: DayMapResponse = { status: "ready", stops: [{ ...stop, coordinate, resolution: "located" }, { ...pending, coordinate, resolution: "located" }, { ...missing, coordinate: null, resolution: "missing" }], viewport: chooseMapViewport([coordinate]), imageDataUrl: "data:image/png;base64,aGVsbG8=", legs: [{ fromKey: stop.key, toKey: pending.key, walking: { seconds: 481, meters: 631 }, driving: { seconds: 341, meters: 1700 }, transit: { seconds: 611, meters: 1200 } }] };
const base = { id: "synthetic-map", date: "2030-04-01", timeZone: "Asia/Tokyo", locale: "en" as const, stops: [stop, pending, missing], includePrivate: false, busy: false, response: null, failure: null, selectedKey: null, select: vi.fn(), selectLeg: vi.fn(), changePrivate: vi.fn(), load: vi.fn(), cancel: vi.fn(), imageFailed: vi.fn() };
type InteractiveProps = { type?: string; checked?: boolean; disabled?: boolean; href?: string; title?: string; onChange?: (event: { target: { checked: boolean } }) => void; onClick?: () => void; onFocus?: () => void; children?: ReactNode; "aria-label"?: string; "aria-pressed"?: boolean; "data-map-callout"?: boolean };
function elements(node: ReactNode, type: string): InteractiveProps[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type));
  if (!isValidElement<InteractiveProps>(node)) return [];
  return [...(node.type === type ? [node.props] : []), ...elements(node.props.children, type)];
}
const source = readFileSync("src/components/day-event-map.tsx", "utf8");
const ast = ts.createSourceFile("day-event-map.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function closure<T>(name: string, bindings: Record<string, unknown>): T {
  let found = "";
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = `const ${node.getText(ast)};`; ts.forEachChild(node, walk); };
  walk(ast); expect(found).not.toBe("");
  const code = ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code};return ${name};`)(...Object.values(bindings)) as T;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("map-only daily journey presentation", () => {
  it.each(locales)("starts collapsed without a provider request or private content in %s", locale => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const html = renderToStaticMarkup(createElement(DayEventMap, { tripId: "synthetic-trip", memberId: "synthetic-member", tripDayId: "synthetic-day", date: base.date, timeZone: base.timeZone, locale, stops: [stop, privateStop] }));
    expect(html).toContain(dayMapMessages(locale).show); expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain("<img"); expect(html).not.toContain(privateStop.title); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(locales)("keeps explicit private consent and localized compact controls in %s", locale => {
    const copy = dayMapMessages(locale); const tree = DayEventMapPanel({ ...base, locale }); const html = renderToStaticMarkup(tree);
    expect(html).toContain(copy.disclosure); expect(html).toContain(copy.calendarHint); expect(html).toContain(copy.privateConsent); expect(html).toContain(copy.load);
    expect(elements(tree, "input").map(input => input.checked)).toEqual([false]); expect(html).not.toContain(privateStop.title);
    const consent = vi.fn(); elements(DayEventMapPanel({ ...base, changePrivate: consent }), "input")[0].onChange?.({ target: { checked: true } }); expect(consent).toHaveBeenCalledWith(true);
  });
  it.each(locales)("shows sourced times and mode-specific distances on-map, not in a duplicate list (%s)", locale => {
    const tree = DayEventMapPanel({ ...base, locale, response: ready }); const html = renderToStaticMarkup(tree); const cards = elements(tree, "button").filter(button => button["data-map-callout"]);
    expect(cards).toHaveLength(1); expect(html).toContain(dayMapTravelTime(481, locale)); expect(html).toContain(dayMapTravelDistance(631, locale)); expect(html).toContain(dayMapTravelDistance(1700, locale));
    expect(html.indexOf("data-map-callout")).toBeLessThan(html.indexOf("</figure>")); expect(html).not.toContain("<ol"); expect(html).not.toContain("<ul"); expect(html).not.toContain("Tap a number"); expect(html).not.toContain("Stops in visiting order");
    expect(elements(tree, "a")).toHaveLength(1); const link = new URL(elements(tree, "a")[0].href!); expect(link.pathname).toBe("/maps/dir/"); expect(link.searchParams.has("travelmode")).toBe(false);
    expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('target="_blank"'); expect(html).toContain('width="640" height="400"');
  });
  it("does not render a detached directions footer before a map is loaded or after failure", () => {
    for (const status of [null, "not_configured", "unavailable", "rate_limited"] as const) {
      const tree = DayEventMapPanel({ ...base, response: status ? { ...ready, status, imageDataUrl: null, viewport: null } : null });
      expect(elements(tree, "a")).toHaveLength(0);
      const html = renderToStaticMarkup(tree); expect(html).not.toContain(stop.title); expect(html).not.toContain(pending.title); expect(html).not.toContain("<img"); expect(html).not.toContain("~9 min");
      if (status) expect(html).toContain(dayMapMessages("en")[status]);
    }
  });
  it("does not substitute a later located endpoint when a selected consecutive leg has no location", () => {
    const legs = dayMapDisplayLegs(ready); const tree = DayEventMapPanel({ ...base, response: ready, selectedLegKey: legs[1].key });
    const links = elements(tree, "a"); expect(links).toHaveLength(1); expect(new URL(links[0].href!).searchParams.get("destination")).toBe(pending.locationName); expect(renderToStaticMarkup(tree)).toContain(missing.title);
    expect(elements(tree, "button").filter(button => button["data-map-callout"])).toHaveLength(1);
    expect(elements(tree, "button").find(button => button["data-map-callout"])?.["aria-label"]).not.toContain(missing.title);
  });
  it("cycles all coincident visits through one keyboard-operable marker without a repeated event list", () => {
    const select = vi.fn(); const tree = DayEventMapPanel({ ...base, response: ready, selectedKey: stop.key, select });
    const pin = elements(tree, "button").find(button => button["aria-label"]?.startsWith("Stop 1:")); pin?.onClick?.(); expect(select).toHaveBeenCalledWith(pending.key);
    expect(pin?.["aria-label"]).toContain(dayMapMessages("en").pending); expect(renderToStaticMarkup(tree)).toContain("+1");
    const next = elements(DayEventMapPanel({ ...base, response: ready, selectedKey: pending.key, select }), "button").find(button => button["aria-label"]?.startsWith("Stop 1:")); next?.onClick?.(); expect(select).toHaveBeenLastCalledWith(stop.key);
  });
  it("offers focus selection and a compact sibling Directions link without footer navigation", () => {
    const selectLeg = vi.fn(); const tree = DayEventMapPanel({ ...base, response: ready, selectLeg }); const buttons = elements(tree, "button");
    buttons.find(button => button["data-map-callout"])?.onFocus?.(); expect(selectLeg).toHaveBeenLastCalledWith(dayMapDisplayLegs(ready)[0].key);
    expect(buttons.filter(button => ["Walk", "Drive", "Transit"].includes(button["aria-label"] ?? ""))).toHaveLength(0);
    expect(buttons.find(button => button["aria-label"] === "Previous leg")).toBeUndefined();
    expect(buttons.find(button => button["aria-label"] === "Next leg")).toBeUndefined();
    expect(elements(tree, "a")[0].children).toBe("Directions");
  });
  it("omits unknown modes and never invents a numeric time, distance or route", () => {
    const html = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, response: { ...ready, legs: undefined } }));
    expect(html).toContain(dayMapMessages("en").timesUnavailable); expect(html).not.toMatch(/~\d/u);
    expect(html).toContain(dayMapMessages("en").connectors); expect(html).not.toContain("0 min");
  });
  it.each(["offline", "timeout", "access", "changed"] as const)("has neutral %s recovery without a repeated event list", failure => {
    const html = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, failure }));
    expect(html).toContain(dayMapMessages("en")[failure].replaceAll("'", "&#x27;")); expect(html).not.toContain("<img"); expect(html).not.toContain("<ol");
  });
  it("handles single, empty and entirely unlocated days without fabricating a connector", () => {
    const single = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, stops: [stop], response: { ...ready, stops: [ready.stops[0]], legs: [] } }));
    expect(single).toContain(dayMapMessages("en").singleStop); expect(single).not.toContain("<line"); expect(single).not.toContain("/maps/dir");
    const empty = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, stops: [] })); expect(empty).toContain(dayMapMessages("en").empty); expect(empty).toContain("disabled");
    const unknown = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, stops: [missing], response: { ...ready, viewport: null, imageDataUrl: null, stops: [ready.stops[2]], legs: [] } }));
    expect(unknown).toContain(dayMapMessages("en").noLocations); expect(unknown).toContain(missing.title); expect(unknown).toContain(dayMapMessages("en").unplotted); expect(unknown).not.toContain("<img");
  });
  it("retains trip-local and all-day times and neutral Cantonese privacy text", () => {
    expect(dayMapStopTime(stop, "en", "Asia/Tokyo")).toBe("10:00 AM"); expect(dayMapStopTime({ ...stop, at: null }, "en", "Asia/Tokyo")).toBe("Time not set"); expect(dayMapStopTime({ ...stop, allDay: true }, "ja-JP", "America/Chicago")).toBe("終日"); expect(dayMapMessages("zh-HK-lihkg")).toEqual(dayMapMessages("zh-HK"));
  });
  it("preserves image aspect, attribution, keyboard styles and all-card resize measurement", () => {
    const css = readFileSync("src/components/day-event-map.module.css", "utf8"); expect(css).toContain("min-height: 44px"); expect(css).toContain(":focus-visible"); expect(css).toContain("height: auto"); expect(css).toContain("overflow-wrap: anywhere"); expect(css).not.toContain("object-fit: cover");
    expect(source).toContain('querySelectorAll<HTMLButtonElement>("[data-map-callout]")'); expect(source).toContain("setCalloutHeight(current => Math.max(current, 44"); expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|setInterval|maps\.googleapis\.com/u);
  });
  it.each(locales)("uses icon-only compact times, accessible mode names and direction arrows in %s", locale => {
    const tree = DayEventMapPanel({ ...base, locale, response: ready });
    const card = elements(tree, "button").find(button => button["data-map-callout"])!;
    const visibleCard = renderToStaticMarkup(createElement("div", null, card.children));
    expect(visibleCard).toContain(dayMapCompactTime(481, locale));
    for (const mode of ["walking", "driving", "transit"] as const) {
      expect(visibleCard).not.toContain(dayMapMessages(locale)[mode]);
      expect(card["aria-label"]).toContain(dayMapMessages(locale)[mode]);
    }
    expect(visibleCard).not.toContain("→"); expect(visibleCard).not.toContain(dayMapMessages(locale).estimated);
    expect(card.title).not.toMatch(/\d\s*→\s*\d/u);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('marker-end="url(#synthetic-map-direction)"');
    expect(html).not.toContain("marker-mid=");
    expect(html).toContain('orient="auto-start-reverse"');
    expect(html).not.toMatch(/>\s*1\s*→\s*2\s*</u);
  });
});

describe("journey projection and collision-safe cards", () => {
  it("pairs the original stop order before filtering unknown locations", () => {
    const response: DayMapResponse = { ...ready, stops: [ready.stops[0], { ...ready.stops[2], number: 2 }, { ...ready.stops[1], number: 3 }] };
    const legs = dayMapDisplayLegs(response); expect(legs.map(leg => [leg.from.number, leg.to.number])).toEqual([[1, 2], [2, 3]]); expect(legs.every(leg => !leg.fromPoint || !leg.toPoint)).toBe(true); expect(legs.every(leg => !leg.estimate)).toBe(true);
  });
  it("shows valid supplied modes, preserving distance, but hides walks above five hours", () => {
    const leg = ready.legs![0]; expect(dayMapTravelModes(leg).map(mode => mode.meters)).toEqual([631, 1700, 1200]);
    expect(dayMapTravelModes({ ...leg, walking: { seconds: 18001, meters: 2 } }).map(mode => mode.mode)).toEqual(["driving", "transit"]);
    expect(dayMapTravelModes({ ...leg, walking: { seconds: 18000, meters: 2 } })[0].mode).toBe("walking");
    expect(dayMapTravelModes({ fromKey: stop.key, toKey: pending.key, walking: { seconds: NaN, meters: 1 }, driving: { seconds: 3, meters: -1 } })).toEqual([]);
    expect(dayMapTravelTime(3601, "en")).toBe("~1 hr 1 min"); expect(dayMapTravelDistance(1200, "en")).toBe("1.2 km");
  });
  it.each([240, 264, 320, 390, 736])("keeps every dense-day chip visible, separate and clear of pins/attribution at %spx", width => {
    const stops = Array.from({ length: 12 }, (_, index) => ({ ...ready.stops[0], key: `repeat-${index}`, number: index + 1 }));
    const response = { ...ready, stops, legs: stops.slice(0, -1).map((from, index) => ({ ...ready.legs![0], fromKey: from.key, toKey: stops[index + 1].key })) };
    const legs = dayMapDisplayLegs(response);
    const layout = dayMapCalloutLayout(legs, [{ xPercent: 50, yPercent: 56 }], width);
    expect(layout.callouts).toHaveLength(11); expect(layout.imageHeight).toBe(layout.width * 0.625);
    const overlap = (a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
    const pin = { left: layout.width / 2 - 40, top: layout.imageHeight * 0.56 - 48, width: 80, height: 52 };
    const attributionHeight = dayMapAttributionHeight(layout.width);
    const attribution = { left: 0, top: layout.imageHeight - attributionHeight, width: layout.width, height: attributionHeight };
    for (const [index, card] of layout.callouts.entries()) {
      expect(card.left).toBeGreaterThanOrEqual(12); expect(card.left + card.width).toBeLessThanOrEqual(layout.width - 12);
      expect(card.height).toBeGreaterThanOrEqual(44); expect(card.top).toBeGreaterThanOrEqual(0); expect(card.top + card.height).toBeLessThanOrEqual(layout.imageHeight);
      expect(overlap(card, pin)).toBe(false); expect(overlap(card, attribution)).toBe(false);
      for (const other of layout.callouts.slice(index + 1)) expect(overlap(card, other)).toBe(false);
    }
    const tree = DayEventMapPanel({ ...base, stops, response, displayWidth: width, selectedLegKey: legs[10].key });
    expect(elements(tree, "button").filter(button => button["data-map-callout"])).toHaveLength(11);
  });
  it("keeps desktop callout DOM positions stable when keyboard focus changes the selected leg", () => {
    const baseLeg = dayMapDisplayLegs(ready)[0];
    const legs: DisplayMapLeg[] = [{ ...baseLeg, key: "a", fromPoint: { xPercent: 10, yPercent: 80 }, toPoint: { xPercent: 40, yPercent: 80 } }, { ...baseLeg, key: "b", fromPoint: { xPercent: 60, yPercent: 80 }, toPoint: { xPercent: 90, yPercent: 80 } }];
    const layout = dayMapCalloutLayout(legs, [], 736);
    expect(layout.width).toBe(736); expect(layout.callouts.map(card => card.leg.key)).toEqual(["a", "b"]);
    const stops = [ready.stops[0], { ...ready.stops[1], coordinate: { lat: 35.7001, lng: 139.7001 } }, { ...ready.stops[0], key: "third", number: 3 }];
    const response = { ...ready, stops };
    const getCards = (selectedKey: string) => elements(DayEventMapPanel({ ...base, stops, response, selectedKey, displayWidth: 736 }), "button").filter(button => button["data-map-callout"]).map(button => button.children);
    expect(getCards(stops[0].key)).toEqual(getCards(stops[2].key));
  });
  it("keeps every one of twelve repeated visits reachable through consecutive legs", () => {
    const stops = Array.from({ length: 12 }, (_, index) => ({ ...ready.stops[0], key: `repeat-${index}`, number: index + 1 }));
    const legs = dayMapDisplayLegs({ ...ready, stops, legs: [] }); expect(legs).toHaveLength(11);
    const layout = dayMapCalloutLayout(legs, [{ xPercent: 50, yPercent: 56 }], 264); expect(layout.callouts[10].leg.to.number).toBe(12); expect(layout.callouts).toHaveLength(11);
  });
  it("never anchors an estimate to invented coordinates or shortcuts past a missing endpoint", () => {
    const response = { ...ready, stops: [ready.stops[0], ready.stops[2], ready.stops[1]], legs: [ready.legs![0]] };
    const layout = dayMapCalloutLayout(dayMapDisplayLegs(response), [], 390);
    expect(layout.callouts).toEqual([]); expect(layout.width).toBe(390);
  });
  it.each(locales)("allows larger measured labels without hiding any estimates in %s", locale => {
    const legs = dayMapDisplayLegs(ready).filter(leg => leg.fromPoint && leg.toPoint);
    const repeated = Array.from({ length: 10 }, (_, index) => ({ ...legs[0], key: `large-${index}` }));
    const layout = dayMapCalloutLayout(repeated, [{ xPercent: 50, yPercent: 56 }], 240, 88, locale);
    expect(layout.callouts).toHaveLength(10); expect(layout.callouts.every(card => card.height === 88)).toBe(true);
    expect(dayMapCompactTime(60, locale)).toMatch(/^~1/u); expect(dayMapCompactTime(3601, locale)).toMatch(/^~1/u);
  });
  it("keeps 499 co-located journey estimates on a bounded real-image canvas without a quadratic grid scan", () => {
    const leg = dayMapDisplayLegs(ready)[0];
    const legs = Array.from({ length: 499 }, (_, index) => ({ ...leg, key: `dense-${index}` }));
    const started = performance.now();
    const layout = dayMapCalloutLayout(legs, [{ xPercent: 50, yPercent: 56 }], 320);
    expect(layout.callouts).toHaveLength(499); expect(layout.width).toBeLessThanOrEqual(4096); expect(layout.imageHeight).toBe(layout.width * 0.625);
    expect(performance.now() - started).toBeLessThan(2000);
    for (const card of layout.callouts) expect(card.top + card.height).toBeLessThan(layout.imageHeight - dayMapAttributionHeight(layout.width));
  });
  it("provides keyboard panning and keeps the original attribution visible outside the scroll surface", () => {
    const stops = Array.from({ length: 12 }, (_, index) => ({ ...ready.stops[0], key: `repeat-${index}`, number: index + 1 }));
    const response = { ...ready, stops };
    const html = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, stops, response, displayWidth: 320 }));
    expect(html).toContain('tabindex="0" role="region"'); expect(html).toContain(dayMapMessages("en").pan);
    expect(html.match(/data:image\/png;base64,aGVsbG8=/gu)).toHaveLength(2);
    expect(source).not.toContain("calloutDock"); expect(source).not.toContain("imageTop");
  });
  it("puts the direction arrow outside a co-located pin and its estimate chip", () => {
    const legs = dayMapDisplayLegs(ready);
    const pins = [{ xPercent: 50, yPercent: 56 }];
    const layout = dayMapCalloutLayout(legs, pins, 320);
    const card = layout.callouts[0];
    const { arrow, arrowStart, from, to } = dayMapConnector(card, layout.width, layout.imageHeight, layout.callouts, pins);
    expect(from).toEqual(to);
    expect(arrow.x < card.left || arrow.x > card.left + card.width || arrow.y < card.top || arrow.y > card.top + card.height).toBe(true);
    expect(arrow.x < to.x - 40 || arrow.x > to.x + 40 || arrow.y < to.y - 48 || arrow.y > to.y + 4).toBe(true);
    const arrowVector = { x: arrow.x - arrowStart.x, y: arrow.y - arrowStart.y };
    const destinationVector = { x: to.x - arrow.x, y: to.y - arrow.y };
    expect(arrowVector.x * destinationVector.y - arrowVector.y * destinationVector.x).toBeCloseTo(0);
    expect(arrowVector.x * destinationVector.x + arrowVector.y * destinationVector.y).toBeGreaterThan(0);
  });
  it("checks grouped-marker centroids at every attempted canvas size, not just the original endpoints", () => {
    const legs = dayMapDisplayLegs(ready).slice(0, 1);
    const renderedGroups = vi.fn((width: number) => [{ xPercent: width < 400 ? 50 : 20, yPercent: 20, stops: [{}, {}] }]);
    const layout = dayMapCalloutLayout(legs, [], 320, 44, "en", renderedGroups);
    expect(renderedGroups).toHaveBeenCalledWith(layout.width);
    const group = renderedGroups(layout.width)[0];
    const pin = { left: group.xPercent * layout.width / 100 - 40, top: group.yPercent * layout.imageHeight / 100 - 48, width: 80, height: 52 };
    for (const card of layout.callouts) expect(card.left < pin.left + pin.width && card.left + card.width > pin.left && card.top < pin.top + pin.height && card.top + card.height > pin.top).toBe(false);
  });
  it("scales the attribution exclusion and supplemental footer with the original image", () => {
    expect(dayMapAttributionHeight(320)).toBe(28); expect(dayMapAttributionHeight(640)).toBe(28); expect(dayMapAttributionHeight(1280)).toBe(56); expect(dayMapAttributionHeight(4096)).toBeCloseTo(179.2);
    expect(source).toContain("height={layout.imageHeight - dayMapAttributionHeight(layout.width)}");
    expect(source).toContain("height: dayMapAttributionHeight(displayWidth)");
  });
});

describe("actual map UI request handlers", () => {
  function handlers(overrides: Record<string, unknown> = {}) {
    const bindings = { loader: { cancel: vi.fn(), load: vi.fn() }, setResponse: vi.fn(), setFailure: vi.fn(), setBusy: vi.fn(), setSelectedKey: vi.fn(), setSelectedLegKey: vi.fn(), setIncludePrivate: vi.fn(), setOpen: vi.fn(),
      open: false, busy: false, includePrivate: true, stops: [stop, privateStop], tripId: "synthetic-trip", tripDayId: "synthetic-day", locale: "en",
      visibleDayMapStops, dayMapResponseMatches, readIncludePrivatePlaces: vi.fn(() => true), saveIncludePrivatePlaces: vi.fn(), ...overrides };
    const clearMap = closure<() => void>("clearMap", bindings);
    const request = closure<(include: boolean) => void>("request", bindings);
    const all = { ...bindings, clearMap, request };
    return { bindings, toggle: closure<() => void>("toggle", all), changePrivate: closure<(value: boolean) => void>("changePrivate", all), load: closure<() => void>("load", all) };
  }
  it("opens straight into a map request that includes private places by default", () => {
    const { bindings, toggle } = handlers(); toggle();
    expect(bindings.setOpen).toHaveBeenCalledWith(true); expect(bindings.setIncludePrivate).toHaveBeenCalledWith(true); expect(bindings.loader.load).toHaveBeenCalledOnce();
    expect(bindings.loader.load.mock.calls[0][0]).toEqual({ tripId: "synthetic-trip", tripDayId: "synthetic-day", includePrivate: true, locale: "en" });
  });
  it("keeps a remembered choice to leave private places out and requests nothing for an empty day", () => {
    const { bindings, toggle } = handlers({ readIncludePrivatePlaces: vi.fn(() => false), stops: [privateStop] }); toggle();
    expect(bindings.setIncludePrivate).toHaveBeenCalledWith(false); expect(bindings.setOpen).toHaveBeenCalledWith(true); expect(bindings.loader.load).not.toHaveBeenCalled();
  });
  it("closing cancels and discards the map without a request", () => {
    const { bindings, toggle } = handlers({ open: true }); toggle();
    expect(bindings.loader.cancel).toHaveBeenCalledOnce(); expect(bindings.setResponse).toHaveBeenCalledWith(null); expect(bindings.setOpen).toHaveBeenCalledWith(false); expect(bindings.loader.load).not.toHaveBeenCalled();
  });
  it("clears the map synchronously, remembers the private choice and reloads at once", () => {
    const { bindings, changePrivate } = handlers({ open: true }); changePrivate(false);
    expect(bindings.loader.cancel).toHaveBeenCalledOnce(); expect(bindings.setResponse).toHaveBeenCalledWith(null); expect(bindings.setSelectedKey).toHaveBeenCalledWith(null); expect(bindings.setSelectedLegKey).toHaveBeenCalledWith(null); expect(bindings.setBusy).toHaveBeenCalledWith(false);
    expect(bindings.setIncludePrivate).toHaveBeenCalledWith(false); expect(bindings.saveIncludePrivatePlaces).toHaveBeenCalledWith(false);
    expect(bindings.loader.load.mock.calls[0][0]).toEqual({ tripId: "synthetic-trip", tripDayId: "synthetic-day", includePrivate: false, locale: "en" });
  });
  it("reloads with the current choice only while open, and stale or access-denied results never paint", () => {
    const closed = handlers({ includePrivate: false }); closed.load(); expect(closed.bindings.loader.load).not.toHaveBeenCalled();
    const { bindings, load } = handlers({ open: true, includePrivate: false }); load();
    expect(bindings.loader.load.mock.calls[0][0]).toEqual({ tripId: "synthetic-trip", tripDayId: "synthetic-day", includePrivate: false, locale: "en" });
    const events = bindings.loader.load.mock.calls[0][1]; events.start(); expect(bindings.setResponse).toHaveBeenCalledWith(null); events.success(ready); expect(bindings.setFailure).toHaveBeenLastCalledWith("changed");
    events.failure("access"); expect(bindings.setResponse).toHaveBeenLastCalledWith(null); expect(bindings.setFailure).toHaveBeenLastCalledWith("access");
  });
  it("stores only the private-places choice, never map data", () => {
    const preference = readFileSync("src/lib/maps/private-places-preference.ts", "utf8");
    expect(preference.match(/\.(?:setItem|getItem|removeItem)\(/gu)).toHaveLength(3); expect(preference).not.toMatch(/sessionStorage|indexedDB|JSON\.stringify|response|stops/u);
  });
  it("reads and saves the private choice defensively", () => {
    expect(readIncludePrivatePlaces(null)).toBe(true); expect(readIncludePrivatePlaces({ getItem: () => null })).toBe(true); expect(readIncludePrivatePlaces({ getItem: () => "off" })).toBe(false);
    expect(readIncludePrivatePlaces({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    saveIncludePrivatePlaces(false, storage); expect(storage.setItem).toHaveBeenCalledWith("stardust.day-map.include-private", "off");
    saveIncludePrivatePlaces(true, storage); expect(storage.removeItem).toHaveBeenCalledWith("stardust.day-map.include-private");
    expect(() => saveIncludePrivatePlaces(false, { setItem: () => { throw new Error("full"); }, removeItem: vi.fn() })).not.toThrow();
  });
});
