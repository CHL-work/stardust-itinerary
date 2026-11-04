function wallTimeToMilliseconds(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
}

export function addMinutesToWallTime(value: string, minutes: number): string {
  const milliseconds = wallTimeToMilliseconds(value);
  if (milliseconds === null || !Number.isFinite(minutes)) return "";
  const end = new Date(milliseconds + minutes * 60_000);
  if (!Number.isFinite(end.getTime()) || end.getUTCFullYear() > 9999 || end.getUTCFullYear() < 1) return "";
  return end.toISOString().slice(0, 16);
}

export function minutesBetweenWallTimes(startsAt: string, endsAt: string): number | null {
  const start = wallTimeToMilliseconds(startsAt);
  const end = wallTimeToMilliseconds(endsAt);
  if (start === null || end === null || end <= start) return null;
  return Math.round((end - start) / 60_000);
}
