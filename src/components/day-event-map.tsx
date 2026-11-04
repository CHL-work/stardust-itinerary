"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Car, ChevronDown, Footprints, MapPin, Move, Train } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { DayMapStop } from "@/lib/maps/day-stops";
import { createDayMapLoader, dayMapDirectionsLink, dayMapResponseMatches, groupDayMapMarkers, visibleDayMapStops, type DayMapFailure, type DayMapResponse, type DayMapLeg, type LocatedDayMapStop } from "@/lib/maps/client";
import { projectMapPoint, type MapPointPosition } from "@/lib/maps/geometry";
import { dayMapMessages } from "@/lib/maps/i18n";
import { DayEventLiveMap } from "./day-event-live-map";
import { dayMapStopTime, dayMapTravelModes, dayMapTravelTime, dayMapTravelDistance, dayMapCompactTime } from "./day-event-map-presentation";
import styles from "./day-event-map.module.css";

export { dayMapStopTime, dayMapTravelModes, dayMapTravelTime, dayMapTravelDistance, dayMapCompactTime, type MapTravelMode } from "./day-event-map-presentation";

export type DayEventMapProps = {
  tripId: string; memberId: string; tripDayId: string; date: string; timeZone: string; locale: Locale; stops: DayMapStop[];
};

type DayEventMapPanelProps = Pick<DayEventMapProps, "date" | "timeZone" | "locale"> & {
  id: string; stops: DayMapStop[]; includePrivate: boolean; busy: boolean; response: DayMapResponse | null; failure: DayMapFailure | null;
  selectedKey: string | null; selectedLegKey?: string | null; displayWidth?: number; calloutHeight?: number; previewRef?: Ref<HTMLDivElement>;
  selectLeg?: (key: string) => void;
  select: (key: string) => void; changePrivate: (value: boolean) => void; load: () => void; cancel: () => void; imageFailed: () => void;
};

export type DisplayMapLeg = { key: string; from: LocatedDayMapStop; to: LocatedDayMapStop; fromPoint: MapPointPosition | null; toPoint: MapPointPosition | null; estimate?: DayMapLeg };

/** Pair before filtering coordinates: an unknown stop must never produce a shortcut past it. */
export function dayMapDisplayLegs(response: DayMapResponse): DisplayMapLeg[] {
  return response.stops.slice(0, -1).map((from, index) => {
    const to = response.stops[index + 1];
    const project = (stop: LocatedDayMapStop) => stop.resolution === "located" && stop.coordinate && response.viewport ? projectMapPoint(stop.coordinate, response.viewport) : null;
    return { key: JSON.stringify([from.key, to.key]), from, to, fromPoint: project(from), toPoint: project(to), estimate: response.legs?.find(leg => leg.fromKey === from.key && leg.toKey === to.key) };
  });
}

type MapRect = { left: number; top: number; width: number; height: number };
type MapCallout = MapRect & { leg: DisplayMapLeg };
const intersects = (left: MapRect, right: MapRect) => left.left < right.left + right.width + 6 && left.left + left.width + 6 > right.left && left.top < right.top + right.height + 6 && left.top + left.height + 6 > right.top;
export const dayMapAttributionHeight = (width: number) => Math.max(28, width * 28 / 640);

/** Every located leg stays visible. Density adds room, never hides labels or distorts geography. */
export function dayMapCalloutLayout(legs: DisplayMapLeg[], pins: Array<MapPointPosition & { stops?: unknown[] }>, displayWidth: number, calloutHeight = 44, locale: Locale = "en", resolvePins?: (width: number) => Array<MapPointPosition & { stops?: unknown[] }>) {
  const availableWidth = Math.max(160, displayWidth);
  const height = Math.max(44, calloutHeight);
  const cards = legs.filter(leg => leg.fromPoint && leg.toPoint).map(leg => ({ leg, width: Math.min(availableWidth - 24, Math.max(44, 24 + dayMapTravelModes(leg.estimate).reduce((total, mode) => total + 26 + [...dayMapCompactTime(mode.seconds, locale)].reduce((size, char) => size + (char.codePointAt(0)! > 127 ? 13 : 7.5), 0), 0))) }));
  const maxCardWidth = Math.max(44, ...cards.map(card => card.width));
  // The API bounds this to 499 legs. Even the worst co-located day fits a finite real-image
  // canvas; scroll is preferable to hidden labels, blank diagram docks or false coordinates.
  const maximumWidth = Math.max(availableWidth, 4096, (height + 64) / 0.625, Math.ceil(Math.sqrt((cards.length + pins.length * 9 + 10) * (maxCardWidth + 12) * (height + 12) / 0.625)) * 2 + 256);
  const widths = [availableWidth];
  while (widths[widths.length - 1] < maximumWidth) widths.push(Math.min(maximumWidth, Math.ceil(widths[widths.length - 1] * 1.4)));
  let result = { width: availableWidth, imageHeight: availableWidth * 0.625, callouts: [] as MapCallout[] };
  for (const width of widths) {
    const imageHeight = width * 0.625;
    const attributionHeight = dayMapAttributionHeight(width);
    const buckets = new Map<string, MapRect[]>();
    const keys = (rect: MapRect) => {
      const result: string[] = [];
      for (let x = Math.floor((rect.left - 6) / 128); x <= Math.floor((rect.left + rect.width + 6) / 128); x++) for (let y = Math.floor((rect.top - 6) / 128); y <= Math.floor((rect.top + rect.height + 6) / 128); y++) result.push(`${x},${y}`);
      return result;
    };
    const occupy = (rect: MapRect) => { for (const key of keys(rect)) { const entries = buckets.get(key) ?? []; entries.push(rect); buckets.set(key, entries); } };
    const clear = (rect: MapRect) => !keys(rect).some(key => buckets.get(key)?.some(other => intersects(rect, other)));
    for (const point of resolvePins?.(width) ?? pins) { const pinWidth = point.stops?.length === 1 ? 48 : 80; occupy({ left: point.xPercent * width / 100 - pinWidth / 2, top: point.yPercent * imageHeight / 100 - 48, width: pinWidth, height: 52 }); }
    const placements: MapCallout[] = [];
    let gridCursor = 0;
    const columns = Math.max(1, Math.floor((width - 24) / (maxCardWidth + 12)));
    const rows = Math.max(0, Math.floor((imageHeight - attributionHeight - 20) / (height + 12)));
    for (const { leg, width: cardWidth } of cards) {
      let placement: MapCallout | undefined;
      const candidates = [[0.5, 0], [0.35, 0], [0.65, 0], [0.5, -height], [0.5, height], [0.2, -height], [0.8, height], [0.2, height], [0.8, -height]].map(([fraction, offset]) => {
        const x = (leg.fromPoint!.xPercent + (leg.toPoint!.xPercent - leg.fromPoint!.xPercent) * fraction) * width / 100;
        const y = (leg.fromPoint!.yPercent + (leg.toPoint!.yPercent - leg.fromPoint!.yPercent) * fraction) * imageHeight / 100;
        return { leg, left: Math.max(12, Math.min(width - cardWidth - 12, x - cardWidth / 2)), top: y - height / 2 + offset, width: cardWidth, height };
      });
      for (const candidate of candidates) if (candidate.top >= 8 && candidate.top + height < imageHeight - attributionHeight - 8 && clear(candidate)) { placement = candidate; break; }
      // A monotonic grid cursor and spatial buckets bound dense-day work; no force simulation.
      while (!placement && gridCursor < columns * rows) {
        const index = gridCursor++;
        const candidate = { leg, left: 12 + index % columns * (maxCardWidth + 12), top: 8 + Math.floor(index / columns) * (height + 12), width: cardWidth, height };
        if (clear(candidate)) placement = candidate;
      }
      if (!placement) break;
      occupy(placement); placements.push(placement);
    }
    result = { width, imageHeight, callouts: placements };
    if (placements.length === cards.length) return result;
  }
  // Never silently present an incomplete set if a future input/layout contract breaks the bound.
  throw new Error("The complete map estimate layout could not be placed.");
}

/** Keep the arrow on an exposed part of the connection, including short/coincident visits. */
export function dayMapConnector(card: MapCallout, width: number, imageHeight: number, cards: MapCallout[], pins: MapPointPosition[]) {
  const from = { x: card.leg.fromPoint!.xPercent * width / 100, y: card.leg.fromPoint!.yPercent * imageHeight / 100 };
  const to = { x: card.leg.toPoint!.xPercent * width / 100, y: card.leg.toPoint!.yPercent * imageHeight / 100 };
  const middle = { x: card.left + card.width / 2, y: card.top + card.height / 2 };
  const obstacles: MapRect[] = [...cards, ...pins.map(point => ({ left: point.xPercent * width / 100 - 40, top: point.yPercent * imageHeight / 100 - 48, width: 80, height: 52 }))];
  const visible = (point: { x: number; y: number }) => point.x >= 6 && point.x <= width - 6 && point.y >= 6 && point.y < imageHeight - dayMapAttributionHeight(width) - 6 && obstacles.every(rect => !(point.x > rect.left - 4 && point.x < rect.left + rect.width + 4 && point.y > rect.top - 4 && point.y < rect.top + rect.height + 4));
  const direct = [0.35, 0.45, 0.55, 0.65, 0.75, 0.85].map(fraction => ({ x: middle.x + (to.x - middle.x) * fraction, y: middle.y + (to.y - middle.y) * fraction })).find(visible);
  const arrow = direct ?? [{ x: middle.x, y: card.top - 6 }, { x: middle.x, y: card.top + card.height + 6 }, { x: card.left - 6, y: middle.y }, { x: card.left + card.width + 6, y: middle.y }].find(visible) ?? { x: middle.x + (to.x - middle.x) * 0.45, y: middle.y + (to.y - middle.y) * 0.45 };
  const outgoingLength = Math.hypot(to.x - arrow.x, to.y - arrow.y) || 1;
  const arrowStart = { x: arrow.x - (to.x - arrow.x) / outgoingLength * 2, y: arrow.y - (to.y - arrow.y) / outgoingLength * 2 };
  return { from, middle, arrow, arrowStart, to, points: `${from.x},${from.y} ${middle.x},${middle.y} ${arrow.x},${arrow.y} ${to.x},${to.y}` };
}

/** Map-only presentation: leg estimates, stop selection and unresolved-place detail stay contextual. */
export function DayEventMapPanel({ id, date, timeZone, locale, stops, includePrivate, busy, response, failure, selectedKey, selectedLegKey, displayWidth = 280, calloutHeight = 44, previewRef, select, selectLeg, changePrivate, load, cancel, imageFailed }: DayEventMapPanelProps) {
  const copy = dayMapMessages(locale);
  const live = response?.status === "ready" && response.renderer === "osm" ? response : null;
  const liveHasLocations = live?.stops.some(stop => stop.resolution === "located" && stop.coordinate) ?? false;
  const ready = response?.status === "ready" && response.viewport && response.imageDataUrl ? response : null;
  const selected = stops.find(stop => stop.key === selectedKey);
  const fallback: DayMapResponse = { status: "ready", stops: stops.map(stop => ({ ...stop, coordinate: null, resolution: !stop.locationName && !stop.mapUrl ? "missing" : "unresolved" })), viewport: null, imageDataUrl: null };
  const legs = dayMapDisplayLegs(ready ?? fallback);
  const selectedLeg = legs.find(leg => leg.key === selectedLegKey) ?? legs.find(leg => leg.from.key === selectedKey) ?? legs.find(leg => leg.to.key === selectedKey) ?? legs[0];
  const pinLocations = [...new Map(legs.flatMap(leg => [leg.fromPoint, leg.toPoint]).filter((point): point is MapPointPosition => point !== null).map(point => [JSON.stringify(point), point])).values()];
  const layout = dayMapCalloutLayout(legs, pinLocations, displayWidth, calloutHeight, locale, width => ready?.viewport ? groupDayMapMarkers(ready.stops, ready.viewport, width) : []);
  const groups = ready?.viewport ? groupDayMapMarkers(ready.stops, ready.viewport, layout.width) : [];
  const enlarged = layout.width > displayWidth;
  const arrowId = `${id}-direction`;
  const unplotted = response?.status === "ready" ? response.stops.filter(stop => stop.resolution !== "located") : [];
  const notice = failure ? copy[failure] : response && response.status !== "ready" ? copy[response.status] : live && !liveHasLocations ? copy.noLocatedPins : response?.status === "ready" && !ready && !live ? copy.noLocations : stops.length === 0 ? includePrivate ? copy.emptyIncluded : copy.empty : null;
  const chooseLeg = (leg: DisplayMapLeg) => { if (selectLeg) selectLeg(leg.key); else select(leg.from.key); };
  const modeIcons = { walking: Footprints, driving: Car, transit: Train };

  return <section id={id} className={styles.panel} aria-label={`${copy.title} · ${date}`} data-feedback-private>
    <p className={styles.hint} id={`${id}-privacy`}>{copy.disclosure}</p>
    <div className={styles.toolbar}><label className={styles.consent}><input type="checkbox" checked={includePrivate} onChange={event => changePrivate(event.target.checked)} aria-describedby={`${id}-private-help`} /><span>{copy.privateConsent}</span></label><div className={styles.actions}><button type="button" className={styles.load} disabled={busy || stops.length === 0} onClick={load} aria-describedby={`${id}-privacy`}>{busy ? copy.loading : response || failure ? copy.reload : copy.load}</button>{busy && <button type="button" onClick={cancel}>{copy.cancel}</button>}</div></div>
    <details className={styles.privacy}><summary>{copy.privacyDetails}</summary><p className={styles.hint} id={`${id}-private-help`}>{copy.privateHint} {copy.calendarHint}</p></details>
    <div aria-live="polite" aria-atomic="true">{busy && <p className={styles.hint} role="status">{copy.loading}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}</div>
    {live && <figure className={styles.figure}><DayEventLiveMap id={id} response={live} locale={locale} timeZone={timeZone} selectedKey={selectedKey} selectedLegKey={selectedLegKey ?? null} select={select} selectLeg={key => selectLeg?.(key)} /><figcaption><p className={styles.orderNote}>{copy.connectors}</p>{live.stops.filter(stop => stop.resolution === "located").length === 1 && <span className={styles.hint}>{copy.singleStop}</span>}</figcaption></figure>}
    {ready && <figure className={styles.figure}>
      <div className={styles.preview} ref={previewRef}>
        <div className={styles.mapScroller} style={{ height: enlarged ? Math.min(layout.imageHeight, Math.max(320, displayWidth * 0.75)) : layout.imageHeight }} tabIndex={enlarged ? 0 : undefined} role={enlarged ? "region" : undefined} aria-label={enlarged ? copy.pan : undefined}>
        <div className={styles.mapCanvas} style={{ width: layout.width, height: layout.imageHeight }}>
        <div className={styles.imagePlane}>
          {/* Uniform scaling keeps every coordinate on the real image; density never creates blank docks. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.image} src={ready.imageDataUrl!} width={640} height={400} alt={copy.image} onError={imageFailed} />
          {groups.map(group => <button type="button" key={group.key} className={`${styles.pin} ${group.stops.some(stop => stop.pending) ? styles.pendingPin : ""} ${group.stops.some(stop => stop.key === selectedKey) ? styles.selectedPin : ""}`}
            style={{ left: `${group.xPercent}%`, top: `${group.yPercent}%` }} aria-pressed={group.stops.some(stop => stop.key === selectedKey)}
            aria-label={group.stops.map(stop => `${copy.stop} ${stop.number}: ${stop.title} · ${dayMapStopTime(stop, locale, timeZone)}${stop.pending ? ` · ${copy.pending}` : ""}${stop.visibility === "private" ? ` · ${copy.private}` : ""}`).join("; ")}
            aria-controls={`${id}-selection`} onClick={() => { const index = group.stops.findIndex(stop => stop.key === selectedKey); select(group.stops[(index + 1) % group.stops.length].key); }}>
            <span>{group.stops[0].number}</span>{group.stops.length > 1 && <small>+{group.stops.length - 1}</small>}
          </button>)}
        </div>
        <svg className={styles.connectors} viewBox={`0 0 ${layout.width} ${layout.imageHeight}`} aria-label={copy.connectors} role="img">
          <defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9 Z" fill="#705597" /></marker><clipPath id={`${id}-connector-area`}><rect width={layout.width} height={layout.imageHeight - dayMapAttributionHeight(layout.width)} /></clipPath></defs>
          <g clipPath={`url(#${id}-connector-area)`}>{layout.callouts.map(card => {
            const connector = dayMapConnector(card, layout.width, layout.imageHeight, layout.callouts, groups);
            return <g key={card.leg.key}><polyline points={connector.points} className={card.leg.key === selectedLeg?.key ? styles.selectedConnector : styles.connector} vectorEffect="non-scaling-stroke"><title>{`${card.leg.from.title} → ${card.leg.to.title}`}</title></polyline><line x1={connector.arrowStart.x} y1={connector.arrowStart.y} x2={connector.arrow.x} y2={connector.arrow.y} stroke="#705597" strokeWidth={2} markerEnd={`url(#${arrowId})`} vectorEffect="non-scaling-stroke" aria-hidden="true" /></g>;
          })}</g>
        </svg>
        {layout.callouts.map(card => {
          const modes = dayMapTravelModes(card.leg.estimate);
          const label = `${copy.leg} ${card.leg.from.number} → ${card.leg.to.number}: ${card.leg.from.title} → ${card.leg.to.title}. ${copy.estimated}. ${modes.length ? modes.map(({ mode, seconds, meters }) => `${copy[mode]} ${dayMapTravelTime(seconds, locale)}, ${dayMapTravelDistance(meters, locale)}`).join("; ") : copy.timesUnavailable}`;
          const tooltip = `${card.leg.from.title} → ${card.leg.to.title}. ${copy.estimated}. ${modes.length ? modes.map(({ mode, seconds, meters }) => `${copy[mode]} ${dayMapTravelTime(seconds, locale)}, ${dayMapTravelDistance(meters, locale)}`).join("; ") : copy.timesUnavailable}`;
          const directions = dayMapDirectionsLink(card.leg.from, card.leg.to);
          return <div key={card.leg.key} className={styles.legacyCalloutPair} style={{ left: card.left, top: card.top }}><button type="button" data-map-callout className={`${styles.callout} ${card.leg.key === selectedLeg?.key ? styles.activeCallout : ""}`} style={{ position: "relative", minWidth: card.width, minHeight: card.height }} aria-pressed={card.leg.key === selectedLeg?.key} onClick={() => chooseLeg(card.leg)} onFocus={() => chooseLeg(card.leg)} aria-label={label} title={tooltip}>
            {modes.length ? <span className={styles.travelModes} aria-hidden="true">{modes.map(({ mode, seconds }) => { const Icon = modeIcons[mode]; return <span className={styles.travelMode} key={mode}><Icon size={15} /><strong>{dayMapCompactTime(seconds, locale)}</strong></span>; })}</span> : <span className={styles.unknownTimes} aria-hidden="true">—</span>}
          </button>{directions && <a className={styles.inlineDirections} href={directions} target="_blank" rel="noopener noreferrer" aria-label={`${copy.directions}: ${card.leg.from.title} → ${card.leg.to.title} · Google Maps`}>{copy.directions}</a>}</div>;
        })}
        </div>
        </div>
        {enlarged && <><div className={styles.attribution} style={{ height: dayMapAttributionHeight(displayWidth) }} aria-hidden="true">
          {/* Preserve the source attribution at viewport scale while panning the complete image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ready.imageDataUrl!} width={640} height={400} alt="" style={{ width: displayWidth, height: displayWidth * 0.625 }} />
        </div><p className={styles.panHint}><Move size={14} aria-hidden="true" />{copy.pan}</p></>}
      </div>
      <figcaption>{ready.stops.filter(stop => stop.resolution === "located").length === 1 && <span className={styles.hint}>{copy.singleStop}</span>}<p className={styles.orderNote}>{copy.connectors}</p></figcaption>
    </figure>}
    <div id={`${id}-selection`} className={styles.selectedStop} aria-live="polite" aria-atomic="true">{selected && <><strong>{selected.number}. {selected.title}</strong><span>{copy[selected.kind]} · {dayMapStopTime(selected, locale, timeZone)}{selected.pending ? ` · ${copy.pending}` : ""}{selected.visibility === "private" ? ` · ${copy.private}` : ""}</span></>}</div>
    {unplotted.length > 0 && <details className={styles.unplotted} open={live !== null && !liveHasLocations}><summary>{copy.unplotted} ({unplotted.length})</summary>{unplotted.map(stop => <p key={stop.key}><strong>{stop.number}. {stop.title}</strong> — {copy[stop.resolution]}{stop.pending ? ` · ${copy.pending}` : ""}</p>)}</details>}
  </section>;
}

/** Parent keys this by trip/member/day/locale/projection, discarding consent and data at context changes. */
export function DayEventMap({ tripId, tripDayId, date, timeZone, locale, stops }: DayEventMapProps) {
  const id = useId();
  const copy = dayMapMessages(locale);
  const [open, setOpen] = useState(false);
  const [includePrivate, setIncludePrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<DayMapResponse | null>(null);
  const [failure, setFailure] = useState<DayMapFailure | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedLegKey, setSelectedLegKey] = useState<string | null>(null);
  const [loader] = useState(() => createDayMapLoader());
  const [displayWidth, setDisplayWidth] = useState(280);
  const [calloutHeight, setCalloutHeight] = useState(44);
  const preview = useRef<HTMLDivElement>(null);
  const visibleStops = visibleDayMapStops(stops, includePrivate);

  useEffect(() => () => loader.cancel(), [loader]);
  useEffect(() => {
    const element = preview.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width && width > 0) setDisplayWidth(width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [response]);
  useEffect(() => {
    const elements = [...(preview.current?.querySelectorAll<HTMLButtonElement>("[data-map-callout]") ?? [])];
    if (!elements.length || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { setCalloutHeight(current => Math.max(current, 44, ...elements.map(element => element.getBoundingClientRect().height))); });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [response, selectedLegKey, selectedKey, displayWidth]);

  const clearMap = () => { loader.cancel(); setResponse(null); setFailure(null); setBusy(false); setSelectedKey(null); setSelectedLegKey(null); };
  const toggle = () => { clearMap(); if (open) setIncludePrivate(false); setOpen(!open); };
  const changePrivate = (value: boolean) => { clearMap(); setIncludePrivate(value); };
  const load = () => {
    if (!open || busy || visibleStops.length === 0) return;
    void loader.load({ tripId, tripDayId, includePrivate, locale }, {
      start: () => { setBusy(true); setFailure(null); setResponse(null); },
      success: result => {
        if (result.status === "ready" && !dayMapResponseMatches(result, visibleStops)) { setFailure("changed"); return; }
        setResponse(result);
      },
      failure: kind => { setResponse(null); setFailure(kind); },
      complete: () => setBusy(false),
    });
  };

  return <div className={styles.root} data-feedback-private>
    <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={id} onClick={toggle}><MapPin size={18} aria-hidden="true" /><span>{open ? copy.hide : copy.show}</span><ChevronDown size={18} aria-hidden="true" className={open ? styles.expanded : undefined} /></button>
    {open && <DayEventMapPanel id={id} date={date} timeZone={timeZone} locale={locale} stops={visibleStops} includePrivate={includePrivate} busy={busy} response={response} failure={failure} selectedKey={selectedKey} selectedLegKey={selectedLegKey} displayWidth={displayWidth} calloutHeight={calloutHeight} previewRef={preview} select={key => { setSelectedKey(key); setSelectedLegKey(null); }} selectLeg={key => { setSelectedLegKey(key); setSelectedKey(null); }} changePrivate={changePrivate} load={load} cancel={clearMap} imageFailed={() => { setResponse(null); setFailure("unavailable"); }} />}
  </div>;
}
