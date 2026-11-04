"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { dateRange } from "@/components/new-ui/trip-overview-bar";
import { uiRefreshMessages } from "@/lib/app/ui-refresh-i18n";
import { adjacentTrips, type TripNavigationEntry } from "@/lib/app/trip-navigation";
import { formatMessage, type Locale } from "@/lib/i18n";

/** Overview shortcut to the account's chronologically adjacent trips, in both layouts. Renders nothing for one trip. */
export function TripAdjacentNav({ trips, currentTripId, locale, disabled, select }: {
  trips: readonly TripNavigationEntry[]; currentTripId: string; locale: Locale; disabled: boolean; select: (tripId: string) => void;
}) {
  const copy = uiRefreshMessages(locale);
  const { previous, next } = adjacentTrips(trips, currentTripId);
  if (!previous && !next) return null;
  const accessibleName = (template: string, trip: TripNavigationEntry) => formatMessage(template, { name: trip.name, dates: dateRange(trip.startsOn, trip.endsOn, locale) ?? "" });
  return <nav className="trip-adjacent-nav" aria-label={copy.tripNavLabel}>
    {previous ? <button type="button" data-feedback-action="trip_switch" className="ghost-button trip-adjacent-button" disabled={disabled} title={previous.name} aria-label={accessibleName(copy.previousTripLabel, previous)} onClick={() => select(previous.id)}>
      <ChevronLeft size={16} aria-hidden="true" /><span className="trip-adjacent-text"><small>{copy.previousTrip}</small> <strong>{previous.name}</strong></span>
    </button> : null}
    {next ? <button type="button" data-feedback-action="trip_switch" className="ghost-button trip-adjacent-button is-next" disabled={disabled} title={next.name} aria-label={accessibleName(copy.nextTripLabel, next)} onClick={() => select(next.id)}>
      <span className="trip-adjacent-text"><small>{copy.nextTrip}</small> <strong>{next.name}</strong></span><ChevronRight size={16} aria-hidden="true" />
    </button> : null}
  </nav>;
}
