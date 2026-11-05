---
id: JOB-067
title: Phone AI button, quick answers that expire, and day-map fixes
status: done
priority: P2
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-04T23:00Z
---

## Outcome

The owner asked for these on 4 November 2026, after using the public instance on a phone:

1. The bottom-right plus button on phones opens AI instead.
2. The quick AI composer stops showing an old answer after ten minutes and starts a new chat.
3. **Show day map** shows the map without another click.
4. Private places are included on the map unless the viewer turns them off.
5. A trip whose only event was a private hotel showed nothing on its day map.

Decisions: [D-081](../DECISIONS.md#d-081-the-day-map-loads-when-opened-and-includes-private-places-accepted-november-4-2026) for the map, [D-082](../DECISIONS.md#d-082-phone-ai-button-and-quick-answers-that-expire-accepted-november-4-2026) for AI.

## Why the hotel did not appear

Three rules stacked up:

- The event was private, and private places were left out by default, so the map had no stops and **Load map** was disabled.
- Even when included, a private stop was plotted only from saved coordinates. This one had a saved Google Maps search (name and address) and no coordinates.
- Its text read "venue, street address, city, state, postcode, country". The matcher required every word to appear in the result's name or address, and the street was spelled differently in OpenStreetMap ("West 300 North" against "300 North"), so even a trip-visible copy would not have matched.

## Delivered

1. **Ask the trip AI** (`QuickAiButton` in `src/components/new-ui/new-navigation.tsx`): on Today, Itinerary and Expenses in the new layout on phones. It opens the quick AI composer in a sheet, without the card's own heading, and focuses the field when no answer is showing. It is hidden only when the trip's owners turned AI off: the overview's `enabled` stays false until the viewer has a key, so the button also shows when `keyRequired` is set, and the sheet then explains how to add a key. Add event and Add expense remain at the top of their pages.
2. **Quick answers expire** (`src/lib/ai/quick-reply.ts`):
   - The AI card and the sheet hide an answer, its sources and memory note once it is ten minutes old and nothing is running. The age comes from the saved completion time, or from when the page received a direct answer.
   - A timer, plus focus and visibility events (phones pause timers), re-checks at the deadline.
   - The next quick question first calls the existing new-conversation action, then sends the prompt to the new conversation. A busy or failed reset shows the existing notices.
   - The AI tab's composer and history are unchanged.
3. **Day map loads when opened** (`src/components/day-event-map.tsx`): opening requests the map with explicit values, changing the private choice reloads it, and closing discards it. **Reload map** remains.
4. **Private places by default:**
   - The checkbox starts checked. Turning it off is remembered in one localStorage flag (`src/lib/maps/private-places-preference.ts`), which stores nothing else.
   - The map service looks up an included private stop's place text and routes legs that touch it, with `persist: false`: the shared cache is read but never written.
   - Text with private-looking wording is still never looked up. Titles, dates, notes and members are never sent.
5. **Matching version 4** (`savedAddressConfirms` in `src/lib/maps/osm.ts`): saved "venue, street, city, region postcode" text matches when the whole venue name before the first comma equals the result's name, and the result's postcode, or its city and state, appear as later parts. The cache key moved to `photon-venue-v4`.
6. **Copy:** the map disclosure and private-places help in English, Cantonese (both modes share neutral privacy wording) and Japanese.
7. **Docs:** [daily map](../DAILY_MAP.md), [privacy notice](../PRIVACY.md) (it now lists the map and weather services), [threat model](../THREAT_MODEL.md), [UI layouts](../UI_LAYOUTS.md), [AI history](../AI_CONVERSATION_HISTORY.md), [request recovery](../AI_REQUEST_RECOVERY.md), architecture, design, implementation, identity and security, decisions, roadmap and changelog.

## Verification

- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (227 files, 4,732 tests); `pnpm test:db` against a disposable database, the production build and the smoke test pass.
- New and changed tests:
  - the matcher accepts synthetic "venue, street, city, region postcode" text confirmed by postcode, or by city and state, and rejects wrong cities, missing confirmation, a different venue name and ambiguous results;
  - a private lookup reads but never writes the cache;
  - the service looks up and routes included private stops with `persist: false`, keeps trip-visible routes cached, sends no titles, and does nothing for private stops that are turned off;
  - opening the map requests it with private places included, a remembered "off" is respected, the private choice reloads at once, and closing requests nothing;
  - the preference module stores only its flag;
  - the AI button appears only on Today, Itinerary and Expenses while AI is on;
  - quick answers expire at ten minutes, never while running.
- A live check of the public Photon service with the original hotel's text returned one matching hotel. Its street was spelled differently, which is the case version 4 accepts.
- A local production build on a disposable database, with a synthetic guest trip at phone width:
  - the button showed for a guest without a key and opened the sheet, which fit the screen;
  - **Show day map** started loading at once with private places checked;
  - a private lodging event carrying the original hotel's address text was plotted, was left out with private places off, and was absent from the map cache.
  - The first local check found the button hidden for a viewer without a key; the `keyRequired` rule above fixed it.

## Rollback

Code only: no migration or data change. Reverting restores explicit loading, private places off by default and matching version 3. The browser flag is then ignored, and cache entries under the version 4 key are unused and expire on their own.
