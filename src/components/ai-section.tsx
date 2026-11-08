"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { readSectionOpen, saveSectionOpen } from "@/lib/ai/section-preference";

/**
 * One AI tab section's open state, remembered per browser (JOB-093). The AI tab renders only after the
 * page has loaded its data in the browser, so reading storage on first render cannot cause a mismatch.
 */
export function useAiSectionOpen(id: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => readSectionOpen(id, defaultOpen));
  const setOpen = useCallback((next: boolean) => { setOpenState(next); saveSectionOpen(id, next); }, [id]);
  return [open, setOpen];
}

/** A collapsible AI tab section: a native disclosure, so it works with keyboard and screen readers. */
export function AiSection({ id, title, summary, open, onOpenChange, children }: {
  id: string; title: string; summary?: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
}) {
  return <details className="ai-section" data-section={id} open={open}
    onToggle={(event) => { const next = event.currentTarget.open; if (next !== open) onOpenChange(next); }}>
    <summary><span className="ai-section-title">{title}</span>
      {summary ? <span className="ai-section-summary">{summary}</span> : null}
      <ChevronDown className="ai-section-chevron" size={18} aria-hidden="true" /></summary>
    <div className="ai-section-body">{children}</div>
  </details>;
}
