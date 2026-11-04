import { useId } from "react";
import type { EventEditorMessages } from "@/lib/app/event-editor-i18n";

export function EventTimeFields({ startsLabel, endsLabel, durationLabel, copy, startsAt, endsAt,
  durationMinutes, min, max, busy, changeStart, changeEnd, changeDuration, fillNow }: {
  startsLabel: string;
  endsLabel: string;
  durationLabel: string;
  copy: EventEditorMessages;
  startsAt: string;
  endsAt: string;
  durationMinutes: string;
  min: string;
  max: string;
  busy: boolean;
  changeStart: (value: string) => void;
  changeEnd: (value: string) => void;
  changeDuration: (value: string) => void;
  fillNow: (field: "startsAt" | "endsAt") => void;
}) {
  const id = useId();
  return <fieldset className="event-time-fields full-field" disabled={busy}>
    <div className="event-time-field">
      <div className="event-time-heading"><label htmlFor={`${id}-start`}>{startsLabel}</label>
        <button type="button" className="mini-button event-time-now" aria-label={copy.startNow}
          onClick={() => fillNow("startsAt")}>{copy.now}</button></div>
      <input id={`${id}-start`} required type="datetime-local" min={min} max={max}
        value={startsAt} onChange={(event) => changeStart(event.target.value)} />
    </div>
    <div className="event-time-field">
      <div className="event-time-heading"><label htmlFor={`${id}-end`}>{endsLabel} ({copy.optional})</label>
        <button type="button" className="mini-button event-time-now" aria-label={copy.endNow}
          onClick={() => fillNow("endsAt")}>{copy.now}</button></div>
      <input id={`${id}-end`} type="datetime-local" min={startsAt || min} max={max}
        aria-describedby={`${id}-hint`} value={endsAt} onChange={(event) => changeEnd(event.target.value)} />
    </div>
    <label className="event-time-duration" htmlFor={`${id}-duration`}>{durationLabel} ({copy.optional})
      <input id={`${id}-duration`} type="number" min="1" step="1" inputMode="numeric"
        aria-describedby={`${id}-hint`} value={durationMinutes}
        onChange={(event) => changeDuration(event.target.value)} /></label>
    <p id={`${id}-hint`} className="muted-copy event-time-hint">{copy.unknownEnd}</p>
  </fieldset>;
}
