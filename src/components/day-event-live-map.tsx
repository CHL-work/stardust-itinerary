"use client";

import { useEffect, useRef, useState } from "react";
import { Car, Footprints, LocateFixed, Minus, Plus, Train } from "lucide-react";
import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import type { Locale } from "@/lib/i18n";
import { dayMapDirectionsLink, dayMapLink, type DayMapLeg, type DayMapResponse, type LocatedDayMapStop } from "@/lib/maps/client";
import { dayMapMessages } from "@/lib/maps/i18n";
import { dayMapCompactTime, dayMapStopTime, dayMapTravelDistance, dayMapTravelModes, dayMapTravelTime } from "./day-event-map-presentation";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./day-event-map.module.css";

type Point = { x: number; y: number };
export type LiveMapPoint = Point & { stop: LocatedDayMapStop };
type LiveMapGroup = Point & { key: string; stops: LocatedDayMapStop[] };
type LiveMapLeg = { key: string; from: LiveMapPoint; to: LiveMapPoint; estimate?: DayMapLeg };
type LiveCallout = { leg: LiveMapLeg; left: number; top: number; width: number; height: number };
type LiveSnapshot = { width: number; height: number; points: LiveMapPoint[]; calloutHeights?: Record<string, number> };
type LiveMapProps = {
  id: string; response: DayMapResponse; locale: Locale; timeZone: string;
  selectedKey: string | null; selectedLegKey: string | null;
  select: (key: string) => void; selectLeg: (key: string) => void;
};

/** Unwrap the shortest longitude span, so a date-line day does not fit the whole world. */
export function dayMapLiveCoordinates(stops: LocatedDayMapStop[]) {
  const located = stops.filter(stop => stop.resolution === "located" && stop.coordinate
    && Number.isFinite(stop.coordinate.lat) && Math.abs(stop.coordinate.lat) <= 85.05112878
    && Number.isFinite(stop.coordinate.lng) && Math.abs(stop.coordinate.lng) <= 180);
  const longitudes = located.map(stop => (stop.coordinate!.lng + 360) % 360).sort((a, b) => a - b);
  let start = longitudes[0] ?? 0, largestGap = -1;
  longitudes.forEach((longitude, index) => {
    const next = longitudes[(index + 1) % longitudes.length] + (index === longitudes.length - 1 ? 360 : 0);
    if (next - longitude > largestGap) { largestGap = next - longitude; start = next % 360; }
  });
  const result = located.map(stop => { let lng = (stop.coordinate!.lng + 360) % 360; if (lng < start) lng += 360; return { stop, lng, lat: stop.coordinate!.lat }; });
  const center = result.length ? result.reduce((sum, point) => sum + point.lng, 0) / result.length : 0;
  const offset = center > 180 ? 360 : 0;
  return result.map(point => ({ ...point, lng: point.lng - offset }));
}

/** Raster only: there is no remote style, glyph, sprite or hidden geocoder request. */
export function dayMapRasterStyle(tileUrlTemplate: string): StyleSpecification {
  return { version: 8, sources: { osm: { type: "raster", tiles: [tileUrlTemplate], tileSize: 256, maxzoom: 19 } }, layers: [{ id: "osm", type: "raster", source: "osm" }] };
}

export function groupLiveMapPoints(points: LiveMapPoint[]): LiveMapGroup[] {
  const groups: LiveMapPoint[][] = [];
  for (const point of points) {
    const neighbors = groups.filter(group => group.some(other => Math.abs(point.x - other.x) < 48 && Math.abs(point.y - other.y) < 48));
    for (const group of neighbors) groups.splice(groups.indexOf(group), 1);
    groups.push([...neighbors.flat(), point]);
  }
  return groups.map(points => ({ key: points.map(point => point.stop.key).join("|"), x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length, stops: points.map(point => point.stop).sort((a, b) => a.number - b.number) }));
}

export function dayMapLiveLegs(response: DayMapResponse, points: LiveMapPoint[]): LiveMapLeg[] {
  const positions = new Map(points.map(point => [point.stop.key, point]));
  // Pair first, then require both coordinates: never jump across an unresolved stop.
  return response.stops.slice(0, -1).flatMap((stop, index) => {
    const from = positions.get(stop.key), to = positions.get(response.stops[index + 1].key);
    return from && to ? [{ key: JSON.stringify([from.stop.key, to.stop.key]), from, to, estimate: response.legs?.find(leg => leg.fromKey === from.stop.key && leg.toKey === to.stop.key) }] : [];
  });
}

/** Bounded near-leg candidates keep labels attached to their geography while panning. */
export function dayMapLiveCallouts(legs: LiveMapLeg[], groups: LiveMapGroup[], width: number, height: number, locale: Locale, measuredHeights: Record<string, number> = {}): LiveCallout[] {
  const pins = groups.flatMap(group => [{ left: group.x - 40, top: group.y - 52, width: 80, height: 56 }, { left: group.x - 75, top: group.y + 3, width: 150, height: 26 }]);
  const occupied: Array<{ left: number; top: number; width: number; height: number }> = [];
  const overlap = (a: { left: number; top: number; width: number; height: number }, b: typeof a) => Math.max(0, Math.min(a.left + a.width + 6, b.left + b.width + 6) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height + 6, b.top + b.height + 6) - Math.max(a.top, b.top));
  return legs.map(leg => {
    const modes = dayMapTravelModes(leg.estimate);
    const modeWidth = modes.reduce((sum, mode) => sum + 36 + [...dayMapCompactTime(mode.seconds, locale)].reduce((sum, letter) => sum + (letter.codePointAt(0)! > 127 ? 13 : 8), 0), 0);
    const cardWidth = Math.min(Math.max(128, width - 24), Math.max(128, modeWidth + (/^(?:zh|ja)/u.test(locale) ? 68 : 78)));
    const cardHeight = Math.max(modeWidth + 78 > cardWidth ? 64 : 44, measuredHeights[leg.key] ?? 0);
    const candidates: LiveCallout[] = [];
    for (const [fraction, offset] of [[0.5, 0], [0.35, -40], [0.65, 40], [0.5, -76], [0.5, 76], [0.2, 0], [0.8, 0], [0.35, -112], [0.65, 112]]) {
      const x = leg.from.x + (leg.to.x - leg.from.x) * fraction;
      const y = leg.from.y + (leg.to.y - leg.from.y) * fraction + offset;
      // Do not clamp an offscreen leg into an unrelated edge pile; it returns when panned.
      const inView = x >= 0 && x <= width && y >= 0 && y <= height;
      candidates.push({ leg, left: inView ? Math.max(8, Math.min(width - cardWidth - 8, x - cardWidth / 2)) : x - cardWidth / 2, top: inView ? Math.max(58, Math.min(height - cardHeight - 12, y - cardHeight / 2)) : y - cardHeight / 2, width: cardWidth, height: cardHeight });
    }
    const score = (card: LiveCallout) => [...pins, ...occupied].reduce((sum, rect) => sum + overlap(card, rect), 0);
    let card = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
    if (score(card) > 0) {
      // Tight phone layouts sometimes have no clear near-line spot. Search the visible
      // basemap, requiring separation from both pins and earlier labels when room exists.
      const middleY = (leg.from.y + leg.to.y) / 2;
      const rows = Array.from({ length: Math.max(0, Math.floor((height - cardHeight - 70) / 8) + 1) }, (_, index) => 58 + index * 8).sort((a, b) => Math.abs(a + cardHeight / 2 - middleY) - Math.abs(b + cardHeight / 2 - middleY));
      for (const top of rows) {
        for (const left of [Math.max(8, Math.min(width - cardWidth - 8, card.left)), 8, width - cardWidth - 8]) {
          const candidate = { leg, left, top, width: cardWidth, height: cardHeight };
          if (score(candidate) < score(card)) card = candidate;
        }
        if (score(card) === 0) break;
      }
    }
    occupied.push(card);
    return card;
  });
}

export function DayMapLiveOverlay({ id, response, locale, timeZone, selectedKey, selectedLegKey, select, selectLeg, snapshot }: LiveMapProps & { snapshot: LiveSnapshot }) {
  const copy = dayMapMessages(locale);
  const groups = groupLiveMapPoints(snapshot.points);
  const legs = dayMapLiveLegs(response, snapshot.points);
  const cards = dayMapLiveCallouts(legs, groups, snapshot.width, snapshot.height, locale, snapshot.calloutHeights);
  const icons = { walking: Footprints, driving: Car, transit: Train };
  return <div className={styles.liveOverlay}>
    <svg className={styles.connectors} viewBox={`0 0 ${snapshot.width} ${snapshot.height}`} aria-label={copy.connectors} role="img"><defs><marker id={`${id}-live-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 1 1 L 9 5 L 1 9 Z" fill="#705597" /></marker></defs>{cards.map(card => {
      const middle = { x: card.left + card.width / 2, y: card.top + card.height / 2 };
      const arrow = { x: middle.x + (card.leg.to.x - middle.x) * 0.65, y: middle.y + (card.leg.to.y - middle.y) * 0.65 };
      const outgoingLength = Math.hypot(card.leg.to.x - arrow.x, card.leg.to.y - arrow.y) || 1;
      return <g key={card.leg.key}><polyline points={`${card.leg.from.x},${card.leg.from.y} ${middle.x},${middle.y} ${arrow.x},${arrow.y} ${card.leg.to.x},${card.leg.to.y}`} className={selectedLegKey === card.leg.key ? styles.selectedConnector : styles.connector}><title>{card.leg.from.stop.title} → {card.leg.to.stop.title}</title></polyline><line x1={arrow.x - (card.leg.to.x - arrow.x) / outgoingLength * 2} y1={arrow.y - (card.leg.to.y - arrow.y) / outgoingLength * 2} x2={arrow.x} y2={arrow.y} stroke="#705597" strokeWidth={2} markerEnd={`url(#${id}-live-arrow)`} aria-hidden="true" /></g>;
    })}</svg>
    {groups.map(group => {
      const selected = group.stops.some(stop => stop.key === selectedKey);
      const labelStop = group.stops.find(stop => stop.key === selectedKey) ?? group.stops[0];
      const placeLink = selected ? dayMapLink(labelStop) : null;
      const label = group.stops.map(stop => `${copy.stop} ${stop.number}: ${stop.title} · ${copy[stop.kind]} · ${dayMapStopTime(stop, locale, timeZone)}${stop.pending ? ` · ${copy.pending}` : ""}${stop.visibility === "private" ? ` · ${copy.private}` : ""}`).join("; ");
      return <div key={group.key} className={styles.livePinGroup} style={{ left: group.x, top: group.y }}><button type="button" className={`${styles.pin} ${group.stops.some(stop => stop.pending) ? styles.pendingPin : ""} ${selected ? styles.selectedPin : ""}`} aria-label={label} title={label} aria-pressed={selected} aria-controls={`${id}-selection`} onClick={() => { const index = group.stops.findIndex(stop => stop.key === selectedKey); select(group.stops[(index + 1) % group.stops.length].key); }}><span>{labelStop.number}</span>{group.stops.length > 1 && <small>+{group.stops.length - 1}</small>}</button>{placeLink ? <a className={`${styles.livePlaceLabel} ${styles.livePlaceLink}`} href={placeLink} target="_blank" rel="noopener noreferrer" aria-label={`${copy.openPlace}: ${labelStop.title}`} title={`${copy.openPlace}: ${labelStop.title}`}>{labelStop.title}</a> : <span className={styles.livePlaceLabel} aria-hidden="true">{labelStop.title}</span>}</div>;
    })}
    {cards.map(card => {
      const modes = dayMapTravelModes(card.leg.estimate);
      const journey = `${card.leg.from.stop.title} → ${card.leg.to.stop.title}`;
      const label = `${copy.leg} ${card.leg.from.stop.number} → ${card.leg.to.stop.number}: ${journey}. ${copy.estimated}. ${modes.length ? modes.map(({ mode, seconds, meters }) => `${copy[mode]} ${dayMapTravelTime(seconds, locale)}, ${dayMapTravelDistance(meters, locale)}`).join("; ") : copy.timesUnavailable}`;
      const directions = dayMapDirectionsLink(card.leg.from.stop, card.leg.to.stop);
      return <div key={card.leg.key} data-live-leg={card.leg.key} className={styles.liveCalloutPair} style={{ left: card.left, top: card.top, width: card.width, minHeight: card.height }}><button type="button" data-map-callout className={`${styles.liveEstimate} ${selectedLegKey === card.leg.key ? styles.activeCallout : ""}`} aria-pressed={selectedLegKey === card.leg.key} onClick={() => selectLeg(card.leg.key)} onFocus={() => selectLeg(card.leg.key)} aria-label={label} title={label}>{modes.length ? <span className={styles.travelModes} aria-hidden="true">{modes.map(({ mode, seconds }) => { const Icon = icons[mode]; return <span key={mode} className={styles.travelMode}><Icon size={15} /><strong>{dayMapCompactTime(seconds, locale)}</strong></span>; })}</span> : <span className={styles.unknownTimes} aria-hidden="true">—</span>}</button>{directions && <a className={styles.inlineDirections} href={directions} target="_blank" rel="noopener noreferrer" aria-label={`${copy.directions}: ${journey} · Google Maps`} title={`${copy.directions}: ${journey} · Google Maps`}><span>{copy.directions}</span></a>}</div>;
    })}
  </div>;
}

/** Mounted only after explicit load. Unmount removes the map and cancels tile work. */
export function DayEventLiveMap(props: LiveMapProps) {
  const { response, locale } = props;
  const copy = dayMapMessages(locale);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const fit = useRef<() => void>(() => {});
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [calloutHeights, setCalloutHeights] = useState<Record<string, number>>({});
  const [tileFailed, setTileFailed] = useState(false);
  const [rendererFailed, setRendererFailed] = useState(false);
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const hasLocations = dayMapLiveCoordinates(response.stops).length > 0;
  const hasSnapshot = snapshot !== null;
  useEffect(() => {
    if (!hasSnapshot || typeof ResizeObserver === "undefined") return;
    const elements = [...(host.current?.parentElement?.querySelectorAll<HTMLElement>("[data-live-leg]") ?? [])];
    const observer = new ResizeObserver(() => {
      setCalloutHeights(current => {
        const next = { ...current }; let changed = false;
        for (const element of elements) { const key = element.dataset.liveLeg!, height = Math.ceil(element.getBoundingClientRect().height); if (height > (current[key] ?? 44) + 1) { next[key] = height; changed = true; } }
        return changed ? next : current;
      });
    });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [hasSnapshot]);
  useEffect(() => {
    const container = host.current;
    if (!container || !response.tileUrlTemplate) return;
    let disposed = false, frame = 0;
    let instance: LibreMap | null = null;
    let observer: ResizeObserver | null = null;
    const coordinates = dayMapLiveCoordinates(response.stops);
    const displayFailed = () => { if (!disposed) { setSnapshot(null); setRendererFailed(true); } };
    // Importing the installed renderer does not fetch a remote SDK or expose a provider key.
    void import("maplibre-gl").then(({ Map, setWorkerUrl, getVersion }) => {
      if (disposed) return;
      try {
        setWorkerUrl(`/vendor/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);
        instance = new Map({ container, style: dayMapRasterStyle(response.tileUrlTemplate!), center: coordinates.length ? [coordinates[0].lng, coordinates[0].lat] : [0, 0], zoom: coordinates.length ? 13 : 0, minZoom: -2, maxZoom: 19, attributionControl: false, renderWorldCopies: true, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, fadeDuration: 0, refreshExpiredTiles: false });
        map.current = instance;
        instance.touchZoomRotate.disableRotation();
        instance.getCanvas().setAttribute("aria-label", copy.interactiveMap);
        const draw = () => {
          if (disposed || !instance) return;
          const width = container.clientWidth, height = container.clientHeight;
          if (!width || !height) return;
          const center = instance.getCenter().lng;
          // Keep the app overlay on the nearest visible world when the user pans past ±180°.
          const offset = coordinates.length ? Math.round((center - coordinates[0].lng) / 360) * 360 : 0;
          setSnapshot({ width, height, points: coordinates.map(point => ({ ...instance!.project([point.lng + offset, point.lat]), stop: point.stop })) });
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };
        fit.current = () => {
          if (!instance) return;
          if (!coordinates.length) {
            // A neutral world overview is not evidence for an unresolved venue.
            instance.jumpTo({ center: [0, 0], zoom: Math.max(-2, Math.log2(Math.max(64, container.clientWidth - 32) / 512)) });
            schedule(); return;
          }
          const west = Math.min(...coordinates.map(point => point.lng)), east = Math.max(...coordinates.map(point => point.lng));
          const south = Math.min(...coordinates.map(point => point.lat)), north = Math.max(...coordinates.map(point => point.lat));
          instance.fitBounds([[west, south], [east, north]], { padding: { top: 110, bottom: 190, left: Math.min(90, container.clientWidth / 4), right: Math.min(90, container.clientWidth / 4) }, maxZoom: 15.5, duration: 0 });
          schedule();
        };
        instance.on("move", schedule);
        instance.on("resize", schedule);
        instance.on("load", () => { if (!disposed) { fit.current(); schedule(); } });
        let successfulTiles = false, currentTileError = false, loadingTiles = false;
        instance.on("sourcedataloading", event => { if (event.sourceId === "osm" && !loadingTiles) { loadingTiles = true; successfulTiles = false; currentTileError = false; } });
        instance.on("sourcedata", event => { if (event.sourceId === "osm" && event.tile?.state === "loaded") successfulTiles = true; });
        instance.on("error", () => { currentTileError = true; if (!disposed) setTileFailed(true); });
        instance.on("idle", () => { loadingTiles = false; if (!disposed && successfulTiles && !currentTileError && instance?.isStyleLoaded() && instance.areTilesLoaded()) setTileFailed(false); });
        instance.getCanvas().addEventListener("webglcontextlost", displayFailed);
        if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(() => { instance?.resize(); fit.current(); }); observer.observe(container); }
        fit.current();
      } catch { displayFailed(); }
    }).catch(displayFailed);
    return () => { disposed = true; if (frame) cancelAnimationFrame(frame); observer?.disconnect(); instance?.remove(); map.current = null; fit.current = () => {}; };
  }, [response, copy.interactiveMap, rendererAttempt]);
  return <div className={styles.liveMap} data-live-map="osm">
    <div className={styles.liveStage}><div className={styles.liveHost} ref={host} />{snapshot && !rendererFailed && <DayMapLiveOverlay {...props} snapshot={{ ...snapshot, calloutHeights }} />}<div className={styles.liveControls}><button type="button" disabled={rendererFailed} onClick={() => map.current?.zoomIn({ duration: 0 })} aria-label={copy.zoomIn} title={copy.zoomIn}><Plus size={19} aria-hidden="true" /></button><button type="button" disabled={rendererFailed} onClick={() => map.current?.zoomOut({ duration: 0 })} aria-label={copy.zoomOut} title={copy.zoomOut}><Minus size={19} aria-hidden="true" /></button><button type="button" disabled={!hasLocations || rendererFailed} className={styles.fitStops} onClick={() => fit.current()}><LocateFixed size={16} aria-hidden="true" />{copy.allStops}</button></div>{rendererFailed && <div className={styles.liveRendererFailure} role="status"><p>{copy.rendererUnavailable}</p><button type="button" onClick={() => { setSnapshot(null); setTileFailed(false); setRendererFailed(false); setRendererAttempt(attempt => attempt + 1); }}>{copy.retryDisplay}</button></div>}</div>
    <div className={styles.liveAttribution}><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">{copy.fixMap}</a><a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a>{response.legs?.length ? <a href="https://routing.openstreetmap.de/" target="_blank" rel="noopener noreferrer">{copy.routingCredit}</a> : null}</div>
    {response.legs?.length ? <p className={styles.hint}>{copy.cachedEstimates} {!response.legs.some(leg => leg.transit) && copy.transitUnavailable}</p> : null}
    {tileFailed && <p className={styles.hint} role="status">{copy.tilesUnavailable}</p>}
  </div>;
}
