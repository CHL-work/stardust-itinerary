---
id: JOB-082
title: Flight details on transport events, and the AI looks up terminals
status: done
priority: P1
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-07T07:10Z
---

## Outcome

On 7 November 2026 the owner asked the trip AI to look up a flight's terminal, and added that a gate or terminal may not be findable: without a gate, show the terminal; without either, show the airline (D-094). This job adds flight details to transport events; JOB-083 checks a flight's status before departure.

## Scope

- **In:**
  - migration 0061 and the `flight` details in event patches;
  - the repository, overview and pending projections;
  - the event editor fields and the card display;
  - the planner prompt and research guidance;
  - tests and documents.
- **Out:**
  - flight status checks (JOB-083);
  - offline snapshots, calendar exports, weather and the day map, which keep using the airport names;
  - guest free AI, which has no search, so it sets only what the request states.

## Delivered

1. **Data:** nullable `itinerary_items.flight` (migration 0061), one object with the flight number (required) and the airline, departure terminal, departure gate and arrival terminal when known. A check keeps it on transport events, small and keyed by a valid flight number; `src/lib/app/flight.ts` validates the same shape. An edit replaces the whole object, and an event that stops being transport loses it.
2. **Display:** `flightPointLocation` (`src/lib/app/flight-i18n.ts`) shows the departure airport with its gate and terminal, else its terminal, else the airline, and the arrival airport with its terminal. It is used on the next-up card, timeline rows and pending cards. Map links keep the airport name.
3. **Editor:** a **Flight** fieldset for transport events: flight number (normalized, such as `jl 123` to JL123), airline, departure terminal, gate and arrival terminal.
4. **AI:** the patch contract includes `flight`. The prompt tells the model to:
   - set the flight number and airline;
   - look up the terminals for the flight's date by direct search or isolated `travel` research;
   - set a gate only when a source states it, and never guess.
   The planner normalizes AI flight numbers, includes flight details in the event context, and keeps a private flight's number out of research subjects.
5. **Documents:** [AI contract](../AI_AND_AGENTS.md), [automatic research](../AI_AUTOMATIC_RESEARCH.md), [design](../DESIGN.md), [database](../DATABASE.md) (with the missing 0060 row), [localization](../LOCALIZATION.md) and [D-094](../DECISIONS.md).

## Verification

- **Unit tests:** flight number normalization and pattern, which also must match the migration's check; display rules in four locales; patch validation; the prompt rules; and the editor's flight fields through the editor test harnesses.
- **Database tests** (`tests/database/flight-details.mjs`, at migration head):
  - a flight created and updated through change requests;
  - its revision snapshot and overview details;
  - a change to another event type dropping them;
  - the check refusing flight details on an activity or with an invalid flight number.

  Reads go through `to_jsonb`, and an update writes the column only when the row has it, so older schemas in the upgrade test still work.
- **Full check:** `pnpm check` on a disposable PostgreSQL 17 database.

## Rollback

Revert the commit. Migration 0061 is additive; an older build ignores the `flight` column, and the column can stay.
