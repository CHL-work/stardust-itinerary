"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState, type TouchEvent } from "react";

import { uiRefreshMessages } from "@/lib/app/ui-refresh-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";
import { useUiMode } from "@/lib/ui-mode-store";

const dayMs = 86_400_000;
const utcDay = (date: string) => /^\d{4}-\d{2}-\d{2}$/u.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;

export type TripProgress =
  | { state: "upcoming"; total: number; daysUntil: number }
  | { state: "active"; total: number; day: number }
  | { state: "past"; total: number };

/**
 * Calendar-date arithmetic in the trip's own dates; `today` is the trip-local date key.
 * Returns null for invalid or reversed dates so the bar shows no misleading progress.
 */
export function tripProgress(startsOn: string, endsOn: string, today: string): TripProgress | null {
  const start = utcDay(startsOn);
  const end = utcDay(endsOn);
  const now = utcDay(today);
  if (![start, end, now].every(Number.isFinite) || end < start) return null;
  const total = Math.round((end - start) / dayMs) + 1;
  if (now < start) return { state: "upcoming", total, daysUntil: Math.round((start - now) / dayMs) };
  if (now > end) return { state: "past", total };
  return { state: "active", total, day: Math.round((now - start) / dayMs) + 1 };
}

function progressText(progress: TripProgress, locale: Locale): string {
  const copy = uiRefreshMessages(locale);
  if (progress.state === "active") return formatMessage(copy.dayOf, { day: progress.day, total: progress.total });
  if (progress.state === "past") return copy.tripEnded;
  return progress.daysUntil === 1 ? copy.startsInOne : formatMessage(copy.startsInMany, { count: progress.daysUntil });
}

export function dateRange(startsOn: string, endsOn: string, locale: Locale): string | null {
  const start = utcDay(startsOn);
  const end = utcDay(endsOn);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const format = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  try {
    return format.formatRange(new Date(start), new Date(end));
  } catch {
    return `${format.format(new Date(start))} – ${format.format(new Date(end))}`;
  }
}

type TripSummary = { name: string; destinationName: string; startsOn: string; endsOn: string };
type MemberSummary = { id: string; displayName: string; status: string };

export function TripOverviewBarView({ trip, members, today, locale }: {
  trip: TripSummary; members: MemberSummary[]; today: string; locale: Locale;
}) {
  const copy = uiRefreshMessages(locale);
  const progress = tripProgress(trip.startsOn, trip.endsOn, today);
  const range = dateRange(trip.startsOn, trip.endsOn, locale);
  const active = members.filter((member) => member.status !== "revoked" && member.status !== "removed");
  const percent = progress?.state === "active" ? Math.round((progress.day / progress.total) * 100) : progress?.state === "past" ? 100 : 0;
  return <section className="new-trip-bar" data-trip-state={progress?.state ?? "unknown"}>
    <div className="new-trip-bar-main">
      {trip.destinationName ? <p className="new-trip-bar-destination">{trip.destinationName}</p> : null}
      <h2>{trip.name}</h2>
      {range || progress ? <p className="new-trip-bar-dates">
        <CalendarDays size={16} aria-hidden="true" />
        {range ? <span>{range}</span> : null}
        {progress ? <strong>{progressText(progress, locale)}</strong> : null}
      </p> : null}
      {progress ? <span className="new-trip-bar-progress" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span> : null}
    </div>
    <div className="new-trip-bar-members" role="img" aria-label={formatMessage(active.length === 1 ? copy.membersOne : copy.membersMany, { count: active.length })}>
      {active.slice(0, 5).map((member) => <i key={member.id} title={member.displayName} aria-hidden="true">{member.displayName.slice(0, 2).toUpperCase()}</i>)}
      {active.length > 5 ? <i className="new-trip-bar-more" aria-hidden="true">+{active.length - 5}</i> : null}
    </div>
  </section>;
}

export function TripOverviewBar(props: Parameters<typeof TripOverviewBarView>[0]) {
  return useUiMode() === "new" ? <TripOverviewBarView {...props} /> : null;
}

type StripDay = { date: string };

function chipParts(date: string, locale: Locale) {
  const value = new Date(utcDay(date));
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(value),
    day: new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "UTC" }).format(value),
    full: new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(value),
  };
}

/**
 * Horizontal day chips; no data is changed.
 * - "select" (Today): chips choose the shown day and expose it with aria-pressed.
 * - "jump" (Itinerary): chips are one-shot jump buttons; today carries aria-current="date".
 * The accessible name starts with the visible text (Today / weekday, date) plus the full date.
 */
export function DayStripView({ days, selectedDate, todayDate, locale, select, variant = "select" }: {
  days: StripDay[]; selectedDate: string | null; todayDate: string; locale: Locale; select: (date: string) => void;
  variant?: "select" | "jump";
}) {
  const copy = uiRefreshMessages(locale);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scroller.current;
    const chip = root?.querySelector<HTMLElement>(".new-day-chip.is-selected");
    if (!root || !chip) return;
    root.scrollTo({ left: Math.max(0, chip.offsetLeft - (root.clientWidth - chip.clientWidth) / 2), behavior: "auto" });
  }, [selectedDate, days.length]);
  // Scrolling the strip sideways must not also trigger the Overview's page-level day swipe.
  const keepTouchLocal = (event: TouchEvent) => event.stopPropagation();
  return <div className="new-day-strip" role="group" aria-label={copy.daysLabel} data-variant={variant} ref={scroller}
    onTouchStart={keepTouchLocal} onTouchEnd={keepTouchLocal}>
    {days.map((day) => {
      const parts = chipParts(day.date, locale);
      const isToday = day.date === todayDate;
      const selected = day.date === selectedDate;
      return <button type="button" data-feedback-action="navigate" key={day.date} data-day-chip={day.date}
        className={`new-day-chip${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
        aria-pressed={variant === "select" ? selected : undefined}
        aria-current={variant === "jump" && isToday ? "date" : undefined} onClick={() => select(day.date)}>
        <span className="new-day-chip-weekday">{isToday ? copy.todayChip : parts.weekday}</span>
        <strong>{parts.day}</strong>
        <span className="sr-only">{parts.full}</span>
      </button>;
    })}
  </div>;
}

export function OverviewDayStrip(props: Parameters<typeof DayStripView>[0]) {
  return useUiMode() === "new" ? <DayStripView {...props} variant="select" /> : null;
}

/** Opens the chosen date's existing Itinerary disclosure, scrolls to it and moves focus to its heading. */
export function revealItineraryDay(root: ParentNode, date: string): boolean {
  const target = [...root.querySelectorAll<HTMLDetailsElement>(".itinerary-days details[data-day-date]")]
    .find((day) => day.dataset.dayDate === date);
  if (!target) return false;
  target.open = true;
  target.scrollIntoView({ behavior: "instant", block: "start" });
  target.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  return true;
}

/** Itinerary variant of the chips. */
export function ItineraryDayJump({ days, todayDate, locale }: { days: StripDay[]; todayDate: string; locale: Locale }) {
  const mode = useUiMode();
  const [chosen, setChosen] = useState<string | null>(null);
  if (mode !== "new" || days.length < 2) return null;
  const fallback = days.some((day) => day.date === todayDate) ? todayDate : null;
  const reveal = (date: string) => {
    setChosen(date);
    revealItineraryDay(document, date);
  };
  return <DayStripView days={days} selectedDate={chosen ?? fallback} todayDate={todayDate} locale={locale} select={reveal} variant="jump" />;
}
