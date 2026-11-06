"use client";

import { useId, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import styles from "./info-tip.module.css";

/**
 * A small "?" button that shows a short explanation only when asked (JOB-073, D-088), so screens stay brief.
 * Use it rarely: at most one per section, for a privacy or money fact someone may want. The browser's popover
 * closes it on Escape or a tap outside.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <>
    <button type="button" className={styles.button} popoverTarget={id} aria-label={label} title={label}><CircleHelp size={16} aria-hidden="true" /></button>
    <span id={id} popover="auto" role="note" className={styles.panel}>{children}</span>
  </>;
}
