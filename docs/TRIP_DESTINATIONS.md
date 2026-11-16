# Trip destinations

A trip can visit up to 12 destinations, in order, each with its own time zone and, optionally, the days the travellers are there (JOB-098, D-110). A trip with one destination and no dates behaves exactly as before.

## Data

- Migration `0070_trip_destinations.sql` adds `trip_destinations`: position 0–11, name (1–160 characters), IANA zone, and optional inclusive `starts_on`/`ends_on`, both or neither, in order. The migration copies every trip's existing destination and zone into position 0.
- Position 0 is the trip's own destination: `trips.destination_name` and `trips.time_zone` always mirror it, so older readers, money dates and invitations keep working. Reordering the list changes the trip's name and zone to the new first destination.
- Destination dates must sit inside the trip's dates. Changing the trip's dates so a destination falls outside is refused until that destination is changed. Ranges may overlap, and the shared day is a travel day.
- `src/lib/app/trip-destinations-store.ts` reads and replaces the list; schemas without the table read the trip's single destination. Changes are audited with the list before and after.

## Each day's clock

`src/lib/app/trip-destinations.ts` is shared by the server, the browser and the AI:

- A day takes the zone of the destination whose dates cover it. On a travel day, it takes the zone of the destination the travellers arrive at: the one that starts latest, then the later one in the list. Days no dated destination covers use the trip's zone.
- When every day uses the trip's zone, no per-day zones exist and every rule below is the single-zone rule from before.
- An event without a location zone falls back to its day's zone, not the trip's (D-103's fallback, now "destination"). Explicit corrections, airports and place evidence still win.
- An event belongs to the day whose own clock shows its date. Near a zone change, two days can claim one instant; the event's own zone decides first, then the day it was saved on, so an evening flight stays on its departure day.
- Today is the latest day whose own clock shows today's date, so the trip moves forward when the travellers do.
- Bills and repayments have no place of their own. They are dated, shown and typed on the clock of the day they fall on (the earlier day at a zone change), so a New York dinner's bill sits on its New York day. Amounts, shares and balances do not depend on it.
- The trip's window opens at midnight on the first day's clock and closes at midnight after the last day's clock. A New York dinner on the last evening of a Tokyo-then-New York trip is inside it.

## Editing

- **Create Trip:** the main destination keeps its time zone lookup ([defaults](TRIP_DESTINATION_DEFAULTS.md)). Further destinations come below it, each with a place, a zone suggested offline from the place's name, and optional dates.
- **Settings:** the same editor lists every destination, with move up, move down and remove. The first row is the trip's destination and time zone.
- **Zone suggestions:** the offline locality catalog first, then a short curated list of famous cities the catalog sees more than once (Paris, Los Angeles) and single-zone countries. Anything else, or a multi-zone country, waits for the traveller to choose. No name is sent anywhere.
- **Display:** the trip header joins the names ("Tokyo → New York"). Times keep D-109's plain local clocks.

## AI

- Planning context lists `trip.destinations`. When dates are set, each day carries its `destination`, and multi-zone trips also give each day its `timeZone`.
- On multi-zone trips, `currentTime` is today's own clock, so "tonight" and "tomorrow" follow the travellers.
- The prompt tells the model to use each day's zone wherever its rules say the trip zone, set `timeZones.start`, pick `tripDayId` by that day's clock, put a named city's plans on its days, use the arriving destination on travel days, and keep a date the user gave even when it conflicts, saying which destination applies.
- Proposal checks use the same day clocks and trip window as manual edits, for bills too. Free AI gets the same destination facts.

## Elsewhere

- **Weather:** each day's forecast uses that day's destination name and zone.
- **Calendar export:** an event without its own zone exports in its day's zone.
- **Offline snapshots:** they keep the destinations, and their saved times use each day's clock. Older snapshots stay readable.
- **Unchanged:** Activity, flight status and public research keep the trip's zone as their fallback. Existing UTC instants are never rewritten.

## Compatibility and rollback

Migration 0070 is additive. An older build ignores the table and treats the first destination as the trip's only one. If it renames the trip or changes its zone, position 0 goes stale until the list is saved again. Prefer a compatible forward fix; do not drop the table as routine rollback.

Tests use synthetic trips only: the day-zone and travel-day rules, instant grouping, validation, the editor in every language, the AI context, and a database test covering creation, settings, guards and the trip window.
