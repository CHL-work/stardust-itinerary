# Event-local times

Hotels, meals, activities, notes and transport display their location's local time, independently of the trip's base zone (JOB-091, D-103). A Salt Lake City restaurant or hotel uses `America/Denver` even in a Dallas trip; flights and other transport may use different departure/arrival zones.

## Resolution and editing

`src/lib/app/event-time-zones.ts` is the shared, synchronous resolver:

1. An explicit validated `timeZones.start` / `timeZones.end` correction wins. Non-transport uses `start` for both ends.
2. Existing flight endpoint zones and unambiguous airport codes remain supported.
3. Saved venue coordinates or unambiguous locality/address evidence resolve offline. A Maps camera center or short link is not coordinate evidence; links are never followed.
4. Unknown or contradictory evidence uses the trip zone. The event editor says **Trip time** beside its time fields, where users can correct the zone; the app never claims that fallback is verified local time.

**Display (JOB-097, D-109).** Every time shows its place's own clock with no zone name: no `GMT+9`, `UTC`, `CST` or "Trip time" beside it, because the airport or place shown with it already says where. A local date that differs from the trip date still appears. The event editor, where times are typed and corrected, names the zone in words ("Japan / Tokyo", "Central European Time"; `timeZoneDisplayName`), never as an offset.

The compact coordinate grid is approximate, especially near borders. The locality catalog covers cities of at least 50,000 people and capitals, retaining conflicting namesakes from the source; it is not a universal venue database. A hotel name without geographic evidence may need an explicit zone. No location, private title or booking is sent to a provider for these lookups, and there are no per-render API/model calls.

Create/edit/pending forms, Now, duration, cards, next-up, hotel check-in/out, approvals, authorized Activity event details, maps, Calendar and public offline snapshots use the same zones. Zone/location corrections re-express existing UTC instants rather than silently rescheduling them. New entered wall times are converted in the selected zone; DST gaps/folds require unambiguous input. AI receives the same schema guidance; venue-hours checks use the proposed venue's local date/time.

AI keeps the existing current-date anchors for “today/tomorrow,” then validates the requested date in the venue's clock. The resulting instant selects the trip-calendar day separately: a late-night SLC visit can fall on the next Chicago trip day. Linked-page offsets are preserved; expense date validation remains unchanged.

**Unchanged:** UTC ordering, countdowns, elapsed duration, trip-calendar day grouping and trip-range validation. A local date different from the trip date appears beside the clock. Financial dates stay in trip time; a zone correction does not move a bill. Old incorrectly entered booking instants are not automatically rewritten. Date-only Calendar imports retain date-only semantics.

Google Calendar's source zone is not a manual venue override. Known venue geography wins for raw rows, preview and import; a valid source zone is retained only for an unresolved place, rechecked when a place is supplied during import.

## Storage and compatibility

Migration `0067_event_time_zones.sql` adds nullable bounded `itinerary_items.time_zones` JSON. Optional corrections flow through snapshots, revisions, pending projections, optimistic concurrency and existing private-audience rules. Sparse unrelated edits preserve them; moving a place clears its stale correction unless explicitly replaced, including legacy flight overrides. Neither automatic inference nor page rendering backfills canonical records.

Safe offline/approval projections retain only known display zones, never additional flight booking details. Existing snapshots remain readable. Keep migration 0067 and a zone-aware runtime after saving corrections: an older writer may ignore them or retain stale zones after moving a venue. Prefer a compatible forward fix; do not rewrite timestamps or erase fields as routine rollback.

## Data and verification

- Localities: [GeoNames cities15000](https://download.geonames.org/export/dump/), reviewed snapshot SHA-256 in `scripts/generate-place-time-zones.mjs`; derived data is CC BY 4.0, with attribution beside the generated file. Regenerate with `node scripts/generate-place-time-zones.mjs <cities15000.txt> [--check]`; a changed source hash requires review. Compressed data is capped at 180 KB.
- Coordinates: pinned `@photostructure/tz-lookup`, CC0; [accuracy limitations](https://github.com/photostructure/tz-lookup#caution-this-package-trades-speed-and-size-for-accuracy). Runtime ICU applies date-specific offsets/DST, never a fixed offset table.
- Airports: the existing pinned MIT catalog and generation check remain unchanged.
- Synthetic tests cover SLC meals/hotels in a Dallas trip, generic transport, explicit corrections, ambiguous localities, country/state collisions, DST, private/pending records, editing, Calendar, offline display and schema compatibility. Never use real trips as test fixtures.
