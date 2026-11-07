# Personal Google Calendar imports

Members can explicitly add events from their personal Google Calendar to a trip. This does not make Calendar public or turn the app into an automatic two-way sync service.

## Member workflow

- Connect Google Calendar in Settings if needed. If the deployment's Google OAuth app has not been verified by Google, Google first shows an unverified-app warning; choose Advanced to continue. A Calendar account may differ from the app sign-in account.
- Overview interleaves personal Calendar events with the selected day's itinerary. Itinerary puts them inside each matching date group, not a separate event list. These raw rows are visible only to the connected member.
- Choose **Add to trip**. The preview fetches the exact source from Google; its title and times are read-only. The resulting app event can be edited through the normal workflow afterward.
- Import defaults to creator-only private visibility. Explicitly select viewers or turn off private visibility to share with the trip. Owners may review a private pending import; that is not blanket access to the eventual private canonical event.
- Confirm the event type, place and optional Google Maps link, then choose **Add and link event**. Manual owner imports apply immediately; members follow their existing itinerary-review permission. AI-assisted imports always await owner approval.
- A pending or approved import replaces the raw Calendar row. Rejected/invalidated imports may retain a clearly labeled source row, but cannot be imported again; use the existing approval/recovery workflow. Cancellation/removal never makes the same source addable again.

Import reads Google but does **not** create, change or delete a Google event. The existing explicit **Update calendar** action is separate. A linked import is a source receipt, not continuous automatic propagation of subsequent Google edits into the itinerary.

## Dates and rendering

Timed events use actual instants and trip-local half-open day intervals. Overnight events appear on each overlapping day; an event ending exactly at midnight is absent from the following day. All-day sources preserve Google's `start.date` / exclusive `end.date` rather than shifting them through UTC. Imported all-day events use actual trip-zone midnight boundaries and retain source date metadata for display. Editing their bounds removes the all-day source interpretation unless the bounds still match.

An import must fit the existing trip range and have a valid start day, positive interval and supported source shape. The app does not invent times, silently clip a source or expand the trip. Recurrence imports one expanded Google event instance, not the entire recurring series. The current connector remains the member's primary Calendar.

An owner can change either trip boundary in Settings. Import day lookup uses only the current range, not every retained historical day row. After the external source fetch, the commit transaction rechecks the current trip context/range under the trip lock; normal proposal creation and later application also enforce changed dates with exact PostgreSQL timestamp comparisons. An all-day end exactly at midnight after the final date is still valid, but a later instant—even one microsecond later—is not. Existing imported canonical events and actionable pending/rejected imports prevent a contraction that would newly exclude their day or times. Date edits retain source receipts, historical day IDs, private audiences and approval requirements; they neither reschedule app/Google events nor change expenses, OAuth scope, sessions or schema.

## Missing place: optional AI lookup

The import dialog has **Find place with AI**. Enter a public venue name with its city/branch and explicitly confirm that it contains no private information. The field starts blank. Only that confirmed text enters a fresh isolated lookup; the Calendar title/description, guests, dates, booking details, account identity, conversation and preferences do not enter the model/search input.

The registered Codex SDK and Claude Agent SDK adapters and the trip's normal funding/model/quota rules apply. The location helper permits hosted public web search and schema serialization only: no shell, local files, MCP/apps, history, agents or booking tools. It asks for at most two exact-subject queries, requires observed search, checks bounded structured evidence and public source URLs, and returns an unverified/manual fallback when evidence is missing. The service deadline is 60 seconds. Source-backed text is still untrusted model evidence, not guaranteed geocoding or availability.

The server deterministically constructs a Google Maps search link from the proposed venue and full address; it does not invent a Google Place ID. Review the address, source and map, then explicitly choose **Use this suggestion**. A signed, actor-bound AI receipt keeps the final import subject to owner approval even if the address is subsequently refined. Simply opening a page/import dialog or searching without applying a result does not convert a manual import into an AI-created change.

The lookup occupies the same one-in-flight-per-bound-user admission slot as planning; different users remain independent. Orphaned lookup admission/delivery expires after two minutes (planning retains ten), so a restart does not leave an eight-minute false busy lock. Each new accepted lookup counts once against the normal daily policy. Exact request retries and self-only GET recovery reuse the saved result without another model call or quota charge. The applied AI receipt expires after 30 minutes; self-only recovery can issue a fresh receipt from the saved evidence. Public prompts, results, usage and outcome events are retained in existing `ai_requests` / `ai_request_events` as `calendar_location`, separate from private planning history. No event or expense is created by lookup alone.

## Persistence, identity and API

Migration **0042** adds verified Calendar account subject and connection generation, account-scoped provider-link uniqueness and immutable `calendar_import_receipts`. A receipt binds the exact trip/member/immutable app user/Google account/primary Calendar/event-instance ID to one create request and, on approval, one canonical item. Admission, source reservation, normal validation, audit and any direct apply are atomic; normal later owner approval binds the same link in its transaction. Source identity survives rejection, removal and uncertain delivery.

Preview/commit revalidate the current member, permissions, verified account, connection generation, source digest/etag and trip bounds. The signed preview expires after ten minutes. Same-account reconnect retains deduplication; a different account cannot inherit the old import. Basic `openid` accompanies existing `calendar.events` consent so the server can verify the access token's account through Google's userinfo endpoint. Legacy connections continue to read/export, but need explicit reconnect before import. A legacy unverified export link is adopted only after an exact remote read proves matching Stardust trip/item properties; ambiguous identity fails safely rather than writing through another account.

All endpoints authenticate the current trip member and return `private, no-store` with `Vary: Cookie`; mutations require same-origin requests and bounded JSON bodies.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/trips/:tripId/calendar` | Personal Calendar rows/conflicts; no import or AI calls |
| `POST /api/trips/:tripId/calendar/import/preview` | `{eventId}` → source-bound preview |
| `POST /api/trips/:tripId/calendar/import` | Signed preview + explicit type/privacy/place choices → request/link result |
| `POST /api/trips/:tripId/calendar/location-search` | `{subject, consent:true, locale, requestId}` → public venue suggestion |
| `GET /api/trips/:tripId/calendar/location-search?requestId=…` | Self-only lookup delivery; never restarts work |

Raw Calendar data and imported private/pending records remain outside the offline itinerary snapshot. Trip-visible canonical imports use its existing allowlisted fields; source date metadata is not added to offline storage, so its existing limited timeline display rules still apply. Browser scope-generation checks discard stale Calendar/import replies after trip/member changes. Imported records use normal canonical/proposal audience rules, not the raw Calendar response as a permission grant.

## Tests and rollback

Synthetic tests cover source/date normalization, every locale's cards/forms, actor-bound tokens, request/permission/AI policy gates, replay, adapter isolation, timeouts and route privacy. The disposable database fixture exercises the ordered migration chain, legacy upgrade, concurrent commits, pending/direct/AI review paths, same/different account reconnects, stale-source races, private visibility and safe removal. It uses encrypted synthetic credentials and mocked Google GETs only; no real Calendar writes or traveler event/expense mutations.

Migration 0042 is additive. Retain its schema and source receipts on any rollback; do not delete source history or down-migrate after imports exist. A recovery target must be schema-compatible, not automatically a build from before imports existed. Deploy and recover with [deployment](DEPLOYMENT.md) or [self-hosting](SELF_HOSTING.md); backup, restore and migration rules are in [database](DATABASE.md).

References checked September 16, 2026: Google's [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events) and [expanded event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), and the official [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) and [execution security guidance](https://learn.chatgpt.com/docs/security). Deterministic duplicate/date/privacy rules and the human review requirement are Stardust product policy, not provider guarantees.
