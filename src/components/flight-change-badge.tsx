"use client";

import { useId } from "react";
import { History, TriangleAlert } from "lucide-react";

import type { FlightChange } from "@/lib/app/flight";
import { flightChangeNote, flightMessages } from "@/lib/app/flight-i18n";
import type { Locale } from "@/lib/i18n";
import styles from "./flight-change-badge.module.css";

/**
 * Marks an automatic flight status update on an event (JOB-083, D-095): a "changed" badge for a new
 * time, a red warning for a cancellation. Tapping it says briefly what changed; the browser's popover
 * closes it on Escape or a tap outside.
 */
export function FlightChangeBadge({ change, locale, timeZone, endTimeZone }: { change: FlightChange; locale: Locale; timeZone: string; endTimeZone?: string }) {
  const id = useId();
  const copy = flightMessages(locale);
  const cancelled = change.kind === "cancelled";
  const label = cancelled ? copy.cancelledLabel : copy.changedLabel;
  return <>
    <button type="button" className={cancelled ? `${styles.badge} ${styles.cancelled}` : styles.badge} popoverTarget={id}
      aria-label={label} title={label} data-flight-change={change.kind} data-feedback-action="dialog_open">
      {cancelled ? <TriangleAlert size={16} aria-hidden="true" /> : <History size={15} aria-hidden="true" />}
      {cancelled ? null : <span>{copy.changedShort}</span>}
    </button>
    <span id={id} popover="auto" role="note" className={styles.panel}>{flightChangeNote(change, locale, timeZone, endTimeZone)}</span>
  </>;
}
