import type { Locale } from "@/lib/i18n";
import type { DayMapStop } from "@/lib/maps/day-stops";
import type { DayMapLeg } from "@/lib/maps/client";
import { dayMapMessages } from "@/lib/maps/i18n";

export type MapTravelMode = "walking" | "driving" | "transit";

export function dayMapStopTime(stop: DayMapStop, locale: Locale, timeZone: string): string {
  const copy = dayMapMessages(locale);
  if (stop.allDay) return copy.allDay;
  if (!stop.at || !Number.isFinite(Date.parse(stop.at))) return copy.noTime;
  return new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(stop.at));
}

export function dayMapTravelModes(leg?: DayMapLeg): Array<{ mode: MapTravelMode; seconds: number; meters: number }> {
  return (["walking", "driving", "transit"] as const).flatMap(mode => {
    const estimate = leg?.[mode];
    return estimate && Number.isFinite(estimate.seconds) && estimate.seconds >= 0 && Number.isFinite(estimate.meters) && estimate.meters >= 0 && (mode !== "walking" || estimate.seconds <= 18_000)
      ? [{ mode, seconds: estimate.seconds, meters: estimate.meters }] : [];
  });
}

export function dayMapTravelTime(seconds: number, locale: Locale): string {
  const copy = dayMapMessages(locale);
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `~${minutes} ${copy.minutesShort}` : `~${Math.floor(minutes / 60)} ${copy.hoursShort}${minutes % 60 ? ` ${minutes % 60} ${copy.minutesShort}` : ""}`;
}

export function dayMapTravelDistance(meters: number, locale: Locale): string {
  const copy = dayMapMessages(locale);
  const format = new Intl.NumberFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { maximumFractionDigits: meters >= 1000 ? 1 : 0 });
  return meters >= 1000 ? `${format.format(meters / 1000)} ${copy.kilometersShort}` : `${format.format(meters)} ${copy.metersShort}`;
}

export function dayMapCompactTime(seconds: number, locale: Locale): string {
  const minutes = Math.ceil(seconds / 60);
  const minute = locale === "en" ? "m" : "分";
  const hour = locale === "en" ? "h" : locale === "ja-JP" ? "時間" : "時";
  return minutes < 60 ? `~${minutes}${minute}` : `~${Math.floor(minutes / 60)}${hour}${minutes % 60 ? `${minutes % 60}${minute}` : ""}`;
}
