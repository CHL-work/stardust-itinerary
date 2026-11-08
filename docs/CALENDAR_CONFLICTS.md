# Calendar conflict policy

[Explicit personal Calendar imports](CALENDAR_IMPORT.md) interleave unlinked source rows inside date timelines. Imported/link-identified sources are replaced by the normal canonical or pending card, not another addable source row. Imports do not replace the deterministic warning rules below. Date-only and overnight timeline display use source-date/half-open semantics.

Removing a cancelled event is an active-trip projection change, not remote Calendar deletion. Exact current-trip visible removed identities are excluded from sync and local reimport; unrelated/hidden/foreign personal Calendar events stay untouched. Existing remote copies may remain, including an in-flight write racing removal. See [removal contract](MOBILE_CARDS.md#removing-a-cancelled-event).

[Deleting a trip](PUBLIC_TRIPS_AND_MEMBERS.md#deleting-a-trip) removes stored Calendar connections and links for its members. It makes no remote deletion, so events already in Google Calendar stay.

Member removal does not change deterministic conflict detection. A current-membership/role fence runs before Calendar connection or sync results are stored, so in-flight completion cannot restore local links after removal. Removal drops local credentials/links only; existing Google Calendar events remain remote. See [member removal](PUBLIC_TRIPS_AND_MEMBERS.md#removing-a-member-safely).

The personal Calendar-versus-itinerary warning projection uses deterministic rules, not an LLM classifier (decision D-060): event type, availability, identity, and interval comparisons already supply the relevant evidence, with no model latency, tokens, or disclosure of private Calendar text to an AI provider.

Flight display/export zones do not change this policy (JOB-090, D-102). Google export supplies separate departure/arrival zones while retaining the exact stored UTC instants. Conflict intervals and trip-calendar day grouping stay unchanged; conservative legacy flight presentation is not a new duplicate/linking rule.

## Occupancy, not every overlap

- Canonical `lodging` is accommodation available during a stay, not continuous required attendance. It and `note` do not block other events. This also applies to validated Google copies of those visible canonical items.
- Google `transparent`, self-declined, `workingLocation`, and `birthday` entries are background for this projection; cancelled provider events remain omitted by the existing adapter.
- Unlinked imported stays are recognized only by explicit stay/reservation language, such as `Stay at ...`, `Hotel reservation ...`, or a trailing `住宿`/`宿泊`. Attendance wording such as check-in, dinner, or meeting prevents that inference. A bare hotel name, location, long duration, or all-day flag is insufficient.
- Explicit canonical activity/meal/transport types override title-based stay inference. A required check-in appointment should be a separate activity, not the multi-night lodging record.
- Unknown busy events, opaque all-day obligations, `fromGmail`, focus time, and out-of-office entries remain eligible. Another attendee declining does not mean this member declined.
- Intervals are half-open: one ending exactly when another starts does not conflict. The existing one-hour fallback for an absent end remains; invalid supplied timestamps do not manufacture an interval.

## Duplicate representations

1. Prefer the member-scoped database link. Private provider properties may identify additional copies only when the trip ID matches and the referenced item is currently visible to that member. No raw attendee or private-property object is returned to the browser.
2. For an unlinked timed import, a matching carrier/flight number with flight wording and a start within five minutes can identify the same transport. Explicit rail/bus/ferry items are not classified as flights.
3. A meal can match a Google-style `Reservation at ...`/meal-at-venue label only when its normalized named venue agrees with the canonical meal title/place and starts within five minutes. Short/generic venue labels cannot identify a reservation. Different known canonical identities are not collapsed by these import heuristics.
4. Deduplicate repeated remote representations per itinerary item. Keep the two directions of different-item conflicts because Overview filters by the selected item's trip day; globally collapsing a cross-day pair could hide one day's warning.

These conflict heuristics suppress warnings only. They do not merge/delete events, create provider links, mark expenses paid, modify Calendar availability, or change itinerary approval/privacy. Uncertain matches remain possible conflicts. Free, declined and lodging Calendar sources remain visible in dated timelines unless a proven link/import already represents them. Explicit imports create links separately; title-based conflict heuristics alone never hide or import a source.

## Verification and limits

Automatic frontend reads are silent: retain the latest successful event/conflict display, do not toggle the shared explicit-action busy flag, and do not replace notices on passive failure. Before the first passive result, omit syncing/loading/checking prose rather than claiming an empty Calendar has been verified. Explicit Refresh and Add/Update operations still display loading/errors; successful writes retain their confirmation and View action. Reconnect detection still reconciles connection state. These display rules do not change sync cadence, provider reads/writes or conflict classification.

Pure domain tests cover both lodging directions, hotel appointments, provider availability, strict import matching, known distinct identities, duplicate copies, cross-day pairs, and interval boundaries. Mocked adapter tests cover visibility-scoped metadata, pagination, self-versus-other declines, all-day entries, and malformed timestamps. Database tests use a disposable PostgreSQL database; they never sync a real Calendar or modify a real trip.

This is not a route/travel-time feasibility engine or a detector of conflicts between all itinerary items without a Calendar connection. Pending events remain excluded. The conflict classifier still excludes all-day availability blocks; the separate timeline/import projection preserves date-only source days and real trip-zone midnight bounds. A hotel double-booking or check-in/out logistics warning would be a different, explicitly modeled category, not an occupancy warning for every hour of a stay.

Google's [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), checked 2026-09-05, documents transparency, self attendance, event types, private extended properties, and exclusive end times. The lodging/import classification above is Stardust product policy, not a claim that Google classifies every reservation reliably.
