"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

import { InfoTip } from "@/components/info-tip";
import { suggestDestinationTimeZone } from "@/lib/app/destination-time-zones";
import { getTripCreationOptions } from "@/lib/app/trip-creation-options";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import { MAX_TRIP_DESTINATIONS, type TripDestination } from "@/lib/app/trip-destinations";
import { tripDestinationsMessages } from "@/lib/app/trip-destinations-i18n";
import type { Locale } from "@/lib/i18n";
import "./trip-destinations-editor.css";

const zoneOptionsByLocale = new Map<Locale, readonly { value: string; label: string }[]>();

/** Every time zone with its friendly label, built once per language (no hook, so plain renders can call it). */
export function destinationZoneOptions(locale: Locale): readonly { value: string; label: string }[] {
  let options = zoneOptionsByLocale.get(locale);
  if (!options) {
    options = Object.freeze(getTripCreationOptions(locale).timeZones);
    zoneOptionsByLocale.set(locale, options);
  }
  return options;
}

/** One editable destination; dates are "" when unset, and `zonePicked` stops the zone following the name. */
export type TripDestinationDraft = { key: string; name: string; timeZone: string; startsOn: string; endsOn: string; zonePicked: boolean };

let destinationKey = 0;
function nextDestinationKey(): string {
  destinationKey += 1;
  return `destination-${destinationKey}`;
}

export function destinationDrafts(destinations: readonly TripDestination[]): TripDestinationDraft[] {
  return destinations.map((destination) => ({ key: nextDestinationKey(), name: destination.name, timeZone: destination.timeZone,
    startsOn: destination.startsOn ?? "", endsOn: destination.endsOn ?? "", zonePicked: true }));
}

export function destinationsFromDrafts(drafts: readonly TripDestinationDraft[]): TripDestination[] {
  return drafts.map((draft) => ({ name: draft.name.trim(), timeZone: draft.timeZone, startsOn: draft.startsOn || null, endsOn: draft.endsOn || null }));
}

/** The first problem with the drafts' dates, as a copy key, or null. */
export function destinationDraftProblem(drafts: readonly Pick<TripDestinationDraft, "startsOn" | "endsOn">[], tripStartsOn: string,
  tripEndsOn: string): "datesIncomplete" | "datesOutside" | null {
  for (const draft of drafts) {
    if (Boolean(draft.startsOn) !== Boolean(draft.endsOn)) return "datesIncomplete";
    if (draft.startsOn && draft.endsOn && (draft.endsOn < draft.startsOn || (tripStartsOn && draft.startsOn < tripStartsOn)
      || (tripEndsOn && draft.endsOn > tripEndsOn))) return "datesOutside";
  }
  return null;
}

/**
 * The trip's destinations in order (JOB-098, D-110): a place, its time zone (suggested from the place, always
 * editable) and, optionally, the days the travellers are there. In trip creation the first destination's place
 * and zone come from the fields above it, so only its days are edited here.
 */
export function TripDestinationsEditor({ drafts, onChange, locale, zoneOptions, tripStartsOn, tripEndsOn, fixedFirst = null, disabled = false }: {
  drafts: TripDestinationDraft[];
  onChange: (drafts: TripDestinationDraft[]) => void;
  locale: Locale;
  zoneOptions: readonly { value: string; label: string }[];
  tripStartsOn: string;
  tripEndsOn: string;
  fixedFirst?: { name: string; zoneLabel: string } | null;
  disabled?: boolean;
}) {
  const copy = tripDestinationsMessages(locale);
  const update = (index: number, patch: Partial<TripDestinationDraft>) =>
    onChange(drafts.map((draft, position) => position === index ? { ...draft, ...patch } : draft));
  const rename = (index: number, name: string) => {
    const suggested = drafts[index]!.zonePicked ? null : suggestDestinationTimeZone(name);
    update(index, { name, ...(suggested ? { timeZone: suggested } : {}) });
  };
  const move = (index: number, offset: -1 | 1) => {
    const next = [...drafts];
    const [row] = next.splice(index, 1);
    next.splice(index + offset, 0, row!);
    onChange(next);
  };
  const add = () => onChange([...drafts, { key: nextDestinationKey(), name: "", timeZone: drafts.at(-1)?.timeZone ?? "",
    startsOn: "", endsOn: "", zonePicked: false }]);
  const problem = destinationDraftProblem(drafts, tripStartsOn, tripEndsOn);
  return <fieldset className="trip-destinations" disabled={disabled}>
    <legend>{copy.title}<InfoTip label={infoTipLabel(locale)}>{copy.help}</InfoTip></legend>
    <p className="trip-destinations-hint">{copy.hint}</p>
    <ol className="trip-destination-list">
      {drafts.map((draft, index) => {
        const fixed = index === 0 && fixedFirst ? fixedFirst : null;
        const movable = !fixedFirst;
        const removable = drafts.length > 1 && !(fixedFirst && index === 0);
        return <li key={draft.key} className="trip-destination">
          {fixed ? <p className="trip-destination-fixed"><strong>{fixed.name || "—"}</strong>{fixed.zoneLabel ? ` · ${fixed.zoneLabel}` : ""}</p> : <>
            <label>{copy.place}<input required maxLength={160} value={draft.name} onChange={(event) => rename(index, event.target.value)} /></label>
            <label>{copy.timeZone}<select required value={draft.timeZone}
              onChange={(event) => update(index, { timeZone: event.target.value, zonePicked: true })}>
              {!draft.timeZone ? <option value="" /> : null}
              {draft.timeZone && !zoneOptions.some((option) => option.value === draft.timeZone)
                ? <option value={draft.timeZone}>{draft.timeZone}</option> : null}
              {zoneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
          </>}
          <div className="trip-destination-dates" role="group" aria-label={copy.dates}>
            <label>{copy.from}<input type="date" min={tripStartsOn || undefined} max={tripEndsOn || undefined} value={draft.startsOn}
              onChange={(event) => update(index, { startsOn: event.target.value })} /></label>
            <label>{copy.to}<input type="date" min={draft.startsOn || tripStartsOn || undefined} max={tripEndsOn || undefined} value={draft.endsOn}
              onChange={(event) => update(index, { endsOn: event.target.value })} /></label>
          </div>
          {movable || removable ? <div className="trip-destination-actions">
            {movable && index > 0 ? <button type="button" className="ghost-button" aria-label={copy.moveUp} title={copy.moveUp}
              onClick={() => move(index, -1)}><ArrowUp size={16} aria-hidden="true" /></button> : null}
            {movable && index < drafts.length - 1 ? <button type="button" className="ghost-button" aria-label={copy.moveDown} title={copy.moveDown}
              onClick={() => move(index, 1)}><ArrowDown size={16} aria-hidden="true" /></button> : null}
            {removable ? <button type="button" className="ghost-button" onClick={() => onChange(drafts.filter((_, position) => position !== index))}>
              <X size={16} aria-hidden="true" />{copy.remove}</button> : null}
          </div> : null}
        </li>;
      })}
    </ol>
    {drafts.length < MAX_TRIP_DESTINATIONS
      ? <button type="button" className="ghost-button fit-button trip-destination-add" onClick={add}><Plus size={16} aria-hidden="true" />{copy.add}</button>
      : <p className="trip-destinations-hint">{copy.limit}</p>}
    {problem ? <p role="alert" className="trip-destinations-error">{copy[problem]}</p> : null}
  </fieldset>;
}
