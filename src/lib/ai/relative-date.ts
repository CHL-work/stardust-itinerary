type CurrentTimeContext = {
  tripLocalDate?: string;
  tomorrowLocalDate?: string;
};

export function requestedRelativeDate(prompt: string, currentTime: CurrentTimeContext): string | null {
  if (/(?:\btomorrow\b|聽日|明日)/iu.test(prompt)) return currentTime.tomorrowLocalDate ?? null;
  if (/(?:\btoday\b|今日)/iu.test(prompt)) return currentTime.tripLocalDate ?? null;
  return null;
}

export function instantDateInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
