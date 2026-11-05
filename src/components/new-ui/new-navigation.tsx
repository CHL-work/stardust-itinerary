"use client";

import { Sparkles, type LucideIcon } from "lucide-react";

import { uiRefreshMessages, type UiRefreshCopy } from "@/lib/app/ui-refresh-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";
import { useUiMode } from "@/lib/ui-mode-store";

type NavItem<T extends string> = { id: T; label: string; icon: LucideIcon };

function shortLabel(id: string, fallback: string, copy: UiRefreshCopy): string {
  switch (id) {
    case "today": return copy.navToday;
    case "itinerary": return copy.navItinerary;
    case "expenses": return copy.navExpenses;
    case "ai": return copy.navAi;
    case "requests": return copy.navRequests;
    case "settings": return copy.navSettings;
    default: return fallback;
  }
}

/** Phone-only bottom bar for the new layout: short labels, no horizontal scrolling, approvals as a badge. */
export function NewBottomNavView<T extends string>({ items, section, navigate, pendingCount, locale }: {
  items: Array<NavItem<T>>; section: string; navigate: (id: T) => void; pendingCount: number; locale: Locale;
}) {
  const copy = uiRefreshMessages(locale);
  return <nav className="new-bottom-nav" aria-label={copy.navLabel} data-count={items.length}>
    {items.map(({ id, label, icon: Icon }) => {
      const active = section === id || (section === "activity" && id === "settings");
      const waiting = id === "requests" && pendingCount > 0;
      return <button type="button" data-feedback-action="navigate" key={id}
        className={active ? "new-bottom-item is-active" : "new-bottom-item"} aria-current={active ? "page" : undefined}
        aria-label={waiting ? formatMessage(copy.navRequestsWaiting, { count: pendingCount }) : undefined}
        onClick={() => navigate(id)}>
        <span className="new-bottom-icon">
          <Icon size={22} aria-hidden="true" />
          {waiting ? <span className="new-bottom-badge" aria-hidden="true">{pendingCount > 99 ? "99+" : pendingCount}</span> : null}
        </span>
        <span className="new-bottom-label">{shortLabel(id, label, copy)}</span>
      </button>;
    })}
  </nav>;
}

export function NewBottomNav<T extends string>(props: Parameters<typeof NewBottomNavView<T>>[0]) {
  return useUiMode() === "new" ? <NewBottomNavView {...props} /> : null;
}

export function QuickAiButtonView({ label, open }: { label: string; open: () => void }) {
  return <button type="button" className="new-quick-add" data-quick-add="ai" aria-haspopup="dialog"
    data-feedback-action="dialog_open" onClick={open}>
    <Sparkles size={20} aria-hidden="true" />
    <span>{label}</span>
  </button>;
}

/** Phone shortcut to the quick AI composer (D-082). Absent when the trip's owners turned AI off. */
export function QuickAiButton({ section, available, label, open }: {
  section: string; available: boolean; label: string; open: () => void;
}) {
  const mode = useUiMode();
  if (mode !== "new" || !available || !["today", "itinerary", "expenses"].includes(section)) return null;
  return <QuickAiButtonView label={label} open={open} />;
}
