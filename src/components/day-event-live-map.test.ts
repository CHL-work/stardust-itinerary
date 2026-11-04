import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { locales } from "@/lib/i18n";
import type { DayMapResponse, LocatedDayMapStop } from "@/lib/maps/client";
import { dayMapMessages } from "@/lib/maps/i18n";
import { DayEventMapPanel } from "./day-event-map";
import { DayEventLiveMap, DayMapLiveOverlay, dayMapLiveCallouts, dayMapLiveCoordinates, dayMapLiveLegs, dayMapRasterStyle, groupLiveMapPoints, type LiveMapPoint } from "./day-event-live-map";

const stop: LocatedDayMapStop = { key: "synthetic:1", number: 1, title: "Synthetic museum", at: "2030-04-01T01:00:00Z", kind: "departure", locationName: "Synthetic museum, Tokyo", mapUrl: null, visibility: "trip", pending: false, allDay: false, resolution: "located", coordinate: { lat: 35.7, lng: 139.7 } };
const stops = [stop, { ...stop, key: "synthetic:2", number: 2, kind: "arrival" as const, title: "Synthetic park", locationName: "Synthetic park, Tokyo", pending: true, coordinate: { lat: 35.701, lng: 139.702 } }, { ...stop, key: "synthetic:3", number: 3, kind: "event" as const, title: "Synthetic cafe", locationName: "Synthetic cafe, Tokyo", coordinate: { lat: 35.702, lng: 139.703 } }];
const response: DayMapResponse = { status: "ready", renderer: "osm", tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", stops, imageDataUrl: null, viewport: null, legs: [{ fromKey: stops[0].key, toKey: stops[1].key, walking: { seconds: 481, meters: 631 }, driving: { seconds: 301, meters: 1100 } }, { fromKey: stops[1].key, toKey: stops[2].key, walking: { seconds: 241, meters: 300 } }] };
const base = { id: "synthetic-live-map", response, locale: "en" as const, timeZone: "Asia/Tokyo", selectedKey: null, selectedLegKey: null, select: vi.fn(), selectLeg: vi.fn(), failed: vi.fn() };
const points: LiveMapPoint[] = stops.map((stop, index) => ({ stop, x: 70 + 65 * index, y: 130 + 100 * index }));
type ElementProps = { children?: ReactNode; href?: string; onClick?: () => void; onFocus?: () => void; style?: Record<string, unknown>; "aria-label"?: string; "data-map-callout"?: boolean };
function elements(node: ReactNode, type: string): ElementProps[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type));
  if (!isValidElement<ElementProps>(node)) return [];
  return [...(node.type === type ? [node.props] : []), ...elements(node.props.children, type)];
}

describe("actual interactive OSM map", () => {
  it("renders an OSM host with null legacy imagery and viewport and makes no request on the server", () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const html = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, id: base.id, date: "2030-04-01", stops, includePrivate: false, busy: false, failure: null, changePrivate: vi.fn(), load: vi.fn(), cancel: vi.fn(), imageFailed: vi.fn() }));
    expect(html).toContain('data-live-map="osm"'); expect(html).not.toContain("<img"); expect(html).not.toContain(dayMapMessages("en").noLocations); expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
  });
  it.each(locales)("localizes live controls, attribution and short directions without a bottom button (%s)", locale => {
    const copy = dayMapMessages(locale);
    const html = renderToStaticMarkup(createElement(DayEventLiveMap, { ...base, locale }));
    for (const value of [copy.zoomIn, copy.zoomOut, copy.allStops, copy.fixMap, copy.cachedEstimates, "OpenStreetMap contributors", "FOSSGIS", "MapLibre"]) expect(html).toContain(value);
    expect(html).toContain("https://www.openstreetmap.org/fixthemap"); expect(html).toContain("https://routing.openstreetmap.de/"); expect(html).not.toContain("/maps/dir/");
  });
  it("uses only the supplied raster tiles, no OpenFreeMap or remote style/glyph/sprite endpoints", () => {
    const style = dayMapRasterStyle(response.tileUrlTemplate!);
    expect(style.sources).toEqual({ osm: { type: "raster", tiles: [response.tileUrlTemplate], tileSize: 256, maxzoom: 19 } });
    expect(style.glyphs).toBeUndefined(); expect(style.sprite).toBeUndefined(); expect(style.layers).toHaveLength(1);
  });
  it.each(locales)("shows a basemap with a prominent zero-pin explanation and expanded reasons (%s)", locale => {
    const unresolved = stops.map(stop => ({ ...stop, coordinate: null, resolution: "unresolved" as const }));
    const html = renderToStaticMarkup(createElement(DayEventMapPanel, { ...base, locale, response: { ...response, stops: unresolved, legs: [] }, id: base.id, date: "2030-04-01", stops: unresolved, includePrivate: false, busy: false, failure: null, changePrivate: vi.fn(), load: vi.fn(), cancel: vi.fn(), imageFailed: vi.fn() }));
    expect(html).toContain('data-live-map="osm"'); expect(html).toContain(dayMapMessages(locale).noLocatedPins);
    expect(html).toMatch(/<details[^>]*open=""[^>]*><summary>/u); expect(html).toContain(dayMapMessages(locale).unresolved);
    expect(html).not.toContain("data-map-callout"); expect(html).not.toContain('aria-label="Stop 1:');
    const allStopsButton = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu)?.find(button => button.includes(dayMapMessages(locale).allStops));
    expect(allStopsButton).toContain('disabled=""');
  });
  it("mounts MapLibre lazily and removes the renderer and resize/frame work at unmount", () => {
    const source = readFileSync("src/components/day-event-live-map.tsx", "utf8");
    expect(source).toContain('void import("maplibre-gl")'); expect(source).toContain("if (disposed) return"); expect(source).toContain("instance?.remove()"); expect(source).toContain("observer?.disconnect()"); expect(source).toContain("cancelAnimationFrame(frame)"); expect(source).toContain('instance.on("move", schedule)'); expect(source).toContain("refreshExpiredTiles: false");
    expect(source).toContain('setWorkerUrl(`/vendor/maplibre/${getVersion()}/maplibre-gl-worker.mjs`)');
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|setInterval|geolocation|openfreemap|maps\.googleapis/u);
  });
  it("uses a neutral world view without coordinates and retries rendering without another lookup", () => {
    const source = readFileSync("src/components/day-event-live-map.tsx", "utf8");
    expect(source).toContain("instance.jumpTo({ center: [0, 0]");
    expect(source).toContain("setRendererAttempt(attempt => attempt + 1)");
    expect(source).toContain("[response, copy.interactiveMap, rendererAttempt]");
    expect(source).not.toMatch(/failure\.current|props\.failed|requestDayMap|createDayMapLoader|fetch\(/u);
  });
});

describe("coordinate overlays and compact per-leg directions", () => {
  it.each(locales)("keeps each estimate and its own mode-neutral Directions link adjacent (%s)", locale => {
    const tree = DayMapLiveOverlay({ ...base, locale, snapshot: { width: 320, height: 460, points } });
    const cards = elements(tree, "button").filter(button => button["data-map-callout"]), links = elements(tree, "a");
    expect(cards).toHaveLength(2); expect(links).toHaveLength(2);
    links.forEach((link, index) => { const url = new URL(link.href!); expect(url.searchParams.get("origin")).toBe(stops[index].locationName); expect(url.searchParams.get("destination")).toBe(stops[index + 1].locationName); expect(url.searchParams.has("travelmode")).toBe(false); expect(renderToStaticMarkup(createElement("div", null, link.children))).toContain(dayMapMessages(locale).directions); });
    const pairs = elements(tree, "div").filter(div => elements(div.children, "a").length === 1 && elements(div.children, "button").filter(button => button["data-map-callout"]).length === 1);
    expect(pairs).toHaveLength(2); expect(pairs.every(pair => typeof pair.style?.left === "number")).toBe(true);
    const html = renderToStaticMarkup(tree); expect(html).not.toContain("<ul"); expect(html).not.toContain("<ol"); expect(html).not.toContain("<footer"); expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('target="_blank"');
    expect(cards[0]["aria-label"]).toContain(dayMapMessages(locale).walking); expect(cards[0]["aria-label"]).toContain("631"); expect(renderToStaticMarkup(createElement("div", null, cards[0].children))).not.toContain(dayMapMessages(locale).walking);
  });
  it("does not remove other estimates or directions when a leg is selected", () => {
    const first = DayMapLiveOverlay({ ...base, snapshot: { width: 320, height: 460, points } });
    const next = DayMapLiveOverlay({ ...base, selectedLegKey: dayMapLiveLegs(response, points)[1].key, snapshot: { width: 320, height: 460, points } });
    expect(elements(first, "a").map(link => link.href)).toEqual(elements(next, "a").map(link => link.href));
    const selectLeg = vi.fn(); const tree = DayMapLiveOverlay({ ...base, selectLeg, snapshot: { width: 320, height: 460, points } });
    elements(tree, "button").find(button => button["data-map-callout"])?.onFocus?.(); expect(selectLeg).toHaveBeenCalledWith(dayMapLiveLegs(response, points)[0].key);
  });
  it("keeps unknown times unknown while leaving explicit directions available", () => {
    const tree = DayMapLiveOverlay({ ...base, response: { ...response, legs: [] }, snapshot: { width: 320, height: 460, points } });
    const html = renderToStaticMarkup(tree); expect(html).not.toMatch(/~\d/u); expect(html).toContain(dayMapMessages("en").timesUnavailable); expect(elements(tree, "a")).toHaveLength(2);
  });
  it("does not bridge unresolved intervening stops", () => {
    const sparse = points.filter(point => point.stop.key !== stops[1].key);
    expect(dayMapLiveLegs(response, sparse)).toEqual([]); expect(elements(DayMapLiveOverlay({ ...base, snapshot: { width: 320, height: 460, points: sparse } }), "a")).toHaveLength(0);
  });
  it("retains separate pending transport endpoints and cycles repeated visits", () => {
    const repeated = points.map(point => ({ ...point, x: 100, y: 150 }));
    expect(groupLiveMapPoints(repeated)[0].stops.map(stop => stop.number)).toEqual([1, 2, 3]);
    const select = vi.fn(); const tree = DayMapLiveOverlay({ ...base, select, selectedKey: stops[0].key, snapshot: { width: 320, height: 460, points: repeated } });
    const pin = elements(tree, "button").find(button => button["aria-label"]?.startsWith("Stop 1:"));
    expect(pin?.["aria-label"]).toContain("Departure"); expect(pin?.["aria-label"]).toContain("Arrival"); expect(pin?.["aria-label"]).toContain(dayMapMessages("en").pending); pin?.onClick?.(); expect(select).toHaveBeenCalledWith(stops[1].key);
  });
  it.each(locales)("offers only the selected visit's explicit Google place handoff in its on-map label (%s)", locale => {
    const projected = points.map(point => ({ ...point, x: 150, y: 200 }));
    const tree = DayMapLiveOverlay({ ...base, locale, selectedKey: stops[1].key, snapshot: { width: 320, height: 520, points: projected } });
    const links = elements(tree, "a"), place = links.find(link => link["aria-label"]?.startsWith(dayMapMessages(locale).openPlace));
    expect(place?.href).toBe("https://www.google.com/maps/search/?api=1&query=Synthetic%20park%2C%20Tokyo");
    expect(place?.["aria-label"]).toContain(stops[1].title);
    expect(links.filter(link => link["aria-label"]?.startsWith(dayMapMessages(locale).openPlace))).toHaveLength(1);
    expect(elements(DayMapLiveOverlay({ ...base, locale, snapshot: { width: 320, height: 520, points: projected } }), "a").some(link => link["aria-label"]?.startsWith(dayMapMessages(locale).openPlace))).toBe(false);
  });
  it.each(["javascript:alert('SYNTHETIC_SECRET')", "https://user:SYNTHETIC_SECRET@www.google.com/maps", "https://evil.example/SYNTHETIC_SECRET"])("rejects unsafe place handoff URLs, escapes titles and performs no provider call (%s)", mapUrl => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const safeStop = { ...stop, title: '<img src=x onerror="alert(1)">', mapUrl, notes: "SYNTHETIC_PRIVATE_NOTE" };
    const tree = DayMapLiveOverlay({ ...base, response: { ...response, stops: [safeStop], legs: [] }, selectedKey: safeStop.key, snapshot: { width: 320, height: 520, points: [{ stop: safeStop, x: 150, y: 200 }] } });
    const html = renderToStaticMarkup(tree), links = elements(tree, "a");
    expect(links).toHaveLength(1); expect(links[0].href).toBe("https://www.google.com/maps/search/?api=1&query=Synthetic%20museum%2C%20Tokyo");
    expect(html).toContain("&lt;img"); expect(html).not.toContain("<img"); expect(html).not.toContain("SYNTHETIC_SECRET"); expect(html).not.toContain("SYNTHETIC_PRIVATE_NOTE");
    expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noopener noreferrer"'); expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
  });
  it.each([240, 264, 320, 390, 736])("keeps typical labels within the live viewport at %spx", width => {
    const projected = points.map((point, index) => ({ ...point, x: 45 + (width - 90) * index / 2 }));
    const cards = dayMapLiveCallouts(dayMapLiveLegs(response, projected), groupLiveMapPoints(projected), width, 460, "en");
    expect(cards).toHaveLength(2); for (const card of cards) { expect(card.left).toBeGreaterThanOrEqual(8); expect(card.left + card.width).toBeLessThanOrEqual(width - 8); expect(card.top).toBeGreaterThanOrEqual(58); expect(card.top + card.height).toBeLessThanOrEqual(448); }
  });
  it("unwraps date-line points to a local span and rejects invalid/unresolved coordinates", () => {
    const coordinates = dayMapLiveCoordinates([{ ...stop, coordinate: { lat: 10, lng: 179 } }, { ...stops[1], coordinate: { lat: 11, lng: -179 } }, { ...stops[2], coordinate: { lat: 100, lng: 139 } }, { ...stop, resolution: "unresolved" }]);
    expect(coordinates).toHaveLength(2); expect(Math.abs(coordinates[0].lng - coordinates[1].lng)).toBe(2); expect(dayMapLiveCoordinates([])).toEqual([]);
  });
  it.each([
    { phone: 390, width: 334, positions: [[97.98, 237.10], [157.56, 110], [237.01, 330]] },
    { phone: 320, width: 250, positions: [[62.5, 244.38], [116.06, 130.10], [187.5, 327.9]] },
  ])("keeps all three-mode labels separate from each other, pins and titles on a $phone px phone", ({ width, positions }) => {
    const projected = positions.map(([x, y], index) => ({ stop: stops[index], x, y }));
    const allModes = { ...response, legs: [{ ...response.legs![0], transit: { seconds: 600, meters: 1800 } }, { ...response.legs![1], driving: { seconds: 180, meters: 800 } }] };
    const legs = dayMapLiveLegs(allModes, projected), groups = groupLiveMapPoints(projected);
    const intersects = (a: { left: number; top: number; width: number; height: number }, b: typeof a) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
    for (const locale of locales) {
      const cards = dayMapLiveCallouts(legs, groups, width, 520, locale, Object.fromEntries(legs.map(leg => [leg.key, width < 300 ? 64 : 44])));
      expect(cards).toHaveLength(2);
      expect(intersects(cards[0], cards[1])).toBe(false);
      for (const card of cards) {
        expect(card.left).toBeGreaterThanOrEqual(8); expect(card.left + card.width).toBeLessThanOrEqual(width - 8);
        expect(card.top).toBeGreaterThanOrEqual(58); expect(card.top + card.height).toBeLessThanOrEqual(508);
        for (const group of groups) {
          expect(intersects(card, { left: group.x - 22, top: group.y - 44, width: 44, height: 44 })).toBe(false);
          expect(intersects(card, { left: group.x - 75, top: group.y + 3, width: 150, height: 26 })).toBe(false);
        }
      }
    }
  });
  it("keeps all bounded dense-day estimates in the overlay, with no selected-only fallback", () => {
    const dense = Array.from({ length: 100 }, (_, index) => ({ ...stop, key: `synthetic:${index}`, number: index + 1 }));
    const projected = dense.map(stop => ({ stop, x: 150, y: 220 }));
    const legs = dayMapLiveLegs({ ...response, stops: dense, legs: [] }, projected);
    expect(dayMapLiveCallouts(legs, groupLiveMapPoints(projected), 320, 460, "en")).toHaveLength(99);
  });
});
