# Settings Activity

Saving [personal AI instructions](AI_CUSTOM_INSTRUCTIONS.md) adds only revision, character count and clear-state audit metadata; the private instruction text is never an Activity snapshot. Changing [AI preferences](AI_TAB.md) records chat effort and routine-check on/off, model and effort, never a key, and appears as a generic system change.

Activity is not part of the primary desktop/mobile navigation. Owners open it from **Settings → Advanced settings → View activity**. Activity keeps a distinct page title and a return-to-Settings action. The entry and the feed are owner-only; members receive no Activity entries.

The feed is the latest 50 currently authorized entries, not a full audit export. Entries describe the actor, localized action/category, trip-local recorded timestamp and allowlisted changed field names. Relevant current authorized event times use [location-local zones](EVENT_LOCAL_TIME.md); expense and audit timestamps stay in trip time. Only safe display-zone metadata reaches the browser, not extra venue/booking details. Raw audit metadata, previous/current snapshots, prompts, booking secrets and private preference contents are never rendered.

## Links and privacy

An Activity link is a read-only navigation intent, not permission to edit. Before following it, the app rechecks the exact audit entry with current active bound-owner authorization. A canonical event or expense must independently pass its current trip/audience visibility. Navigation refreshes the projection and reveals the corresponding collapsed date. Pending/review-history records can open an authorized read-only approval view without automatically editing or approving.

Proposal-only owner review access does not imply access to a private canonical target. A private event later made public does not authorize disclosure of earlier private notes/audiences from historical snapshots. Removed, missing, revoked or otherwise unavailable targets receive explicit localized feedback without an unsafe link or a guessed replacement ID. Late responses are fenced to the originating trip/member scope.

Unknown actions receive safe generic labels. Rich detail is deliberately allowlisted rather than a JSON viewer. The PostgreSQL audit trail remains append-only and unchanged; this is an authorized presentation over it, not data cleanup or a new audit store.

## Verification

Test owner/member/cross-trip authorization, current private audiences, proposal-only owner visibility, missing and removed targets, raw metadata suppression, correct collapsed-day navigation and read-only request rendering. Controls and details support every interface language (English, Cantonese, LIHKG Cantonese, Japanese and the eight translation packs) with neutral security/financial language and touch-sized controls.
