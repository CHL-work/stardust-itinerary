export type TripNavigationEntry = { id: string; name: string; startsOn: string; endsOn: string };

export type AdjacentTrips<T extends TripNavigationEntry> = { previous: T | null; next: T | null };

/**
 * The account's trips in travel order: start date, then end date, with name and
 * ID so overlapping or same-day trips always resolve to one stable order.
 * ISO calendar dates compare correctly as strings.
 */
export function adjacentTrips<T extends TripNavigationEntry>(trips: readonly T[], currentTripId: string): AdjacentTrips<T> {
  const ordered = [...trips].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const index = ordered.findIndex((trip) => trip.id === currentTripId);
  if (index < 0) return { previous: null, next: null };
  return { previous: ordered[index - 1] ?? null, next: ordered[index + 1] ?? null };
}
