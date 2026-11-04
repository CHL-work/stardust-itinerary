export const tripDateErrors = {
  stale: "The trip dates changed. Refresh and try again.",
  occupied: "The trip dates would exclude existing itinerary or pending changes. Move those items first.",
  order: "The end date must be on or after the start date.",
  length: "A trip can contain at most 366 calendar days.",
  event: "The event dates must be within the current trip dates.",
} as const;

export function validTripDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000-")) return false;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

export function validTripDateRange(startsOn: string, endsOn: string): boolean {
  return validTripDate(startsOn) && validTripDate(endsOn) && endsOn >= startsOn
    && (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000 <= 365;
}

