export type TripDaySummary = {
  id: string;
  date: string;
};

export type DayViewItem = {
  tripDayId: string;
  startsAt: string | null;
  status: string;
};

export function tripLocalDateKey(value: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function pickCurrentTripDay<T extends TripDaySummary>(
  days: T[],
  timeZone: string,
  now: Date = new Date(),
): T | null {
  if (!days.length) return null;
  const today = tripLocalDateKey(now, timeZone);
  return days.find((day) => day.date === today)
    ?? days.find((day) => day.date > today)
    ?? days.at(-1)
    ?? null;
}

export function shiftTripDay<T extends TripDaySummary>(days: T[], selectedDate: string, offset: -1 | 1): T | null {
  const index = days.findIndex((day) => day.date === selectedDate);
  if (index < 0) return null;
  return days[index + offset] ?? null;
}

export function itemsForTripDay<T extends DayViewItem>(items: T[], tripDayId: string): T[] {
  return items.filter((item) => item.tripDayId === tripDayId);
}

export function nextUpcomingItem<T extends DayViewItem>(items: T[], nowMs: number): T | null {
  return items
    .filter((item) => item.status !== "cancelled" && item.startsAt && new Date(item.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt as string).getTime() - new Date(b.startsAt as string).getTime())[0]
    ?? null;
}

export function countdownParts(targetMs: number, nowMs: number): { days: number; hours: number; minutes: number } | null {
  if (targetMs <= nowMs) return null;
  const totalMinutes = Math.max(1, Math.ceil((targetMs - nowMs) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}
