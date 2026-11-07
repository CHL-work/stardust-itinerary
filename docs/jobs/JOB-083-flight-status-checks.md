---
id: JOB-083
title: Flight status checks before departure
status: done
priority: P1
depends_on: [JOB-082]
claimant: CHL-work
branch: main
started: 2026-11-07T07:40Z
---

## Outcome

On 7 November 2026 the owner asked for routine checks on the day of a flight: 24 hours before departure, then 12, 6, 5, 4, 3, 2 and 1 hours before. The owner set what each kind of change does:
- a time change or delay updates the time and shows a changed icon that says briefly what changed;
- a cancellation keeps the event, marked cancelled with a red warning icon;
- a gate or terminal change just updates them.

The checks follow a changed departure (D-095). Flights come from [JOB-082](JOB-082-flight-details.md).

## Scope

- **In:**
  - migration 0062;
  - the schedule, status rules, lookup prompt and worker (`src/lib/flights/`), run first by the disruption CronJob;
  - the system revision and change records;
  - the changed and cancelled badges on cards;
  - copy, tests and documents.
- **Out:**
  - phone notifications;
  - flights in unsponsored or guest trips, private flights and flights without a flight number;
  - a separate CronJob, since the existing five-minute job runs the checks.

## Delivered

1. **Schedule** (`schedule.ts`): eight slots, 1440 to 60 minutes before departure; the latest due slot runs and missed ones are not replayed. Slots come from the current departure, so they follow a change, and the check that moved a departure counts as the new time's current check.
2. **Lookup** (`prompt.ts`, `status.ts`): `gpt-6.1-sol` at medium effort with live web search on the operator's keys, via the disruption monitor's locked-down Codex provider. Only the flight number, airline, airports and planned local departure are sent. The answer is strict JSON, recorded as a system AI request (`feature = 'flight_status'`).
3. **Rules** (`decideFlightStatusUpdate`):
   - **Time change:** a departure that moved at least 15 minutes, with high confidence, updates the times. The arrival is the reported one, or shifted by the same amount.
   - **Cancellation:** with high confidence, it marks the event cancelled.
   - **Terminal or gate:** with at least medium confidence, a new one updates the flight details.
   - **Always:** every change needs an https source for this exact flight and date, and unknown details never clear known ones.
4. **Worker** (`monitor.ts`):
   - claims each check in `flight_status_checks`, with a 10-minute lease;
   - calls the provider and applies the update through `applyFlightStatusUpdate`, which refuses if the event changed meanwhile;
   - runs at most `FLIGHT_STATUS_MAX_CHECKS` (default 2) checks before the disruption monitor, which keeps the rest of the job's 10 minutes.
5. **Records:** a revision with `changed_by_source = 'flight_status'` and no member, an audit event with no actor (shown as System), stale Calendar links, and an append-only `flight_status_changes` row. The event's day follows a new local date when the trip has that day.
6. **Cards:** a **Changed** badge for a time change and a red warning for a cancellation, on timeline rows and the next-up card. Each opens a brief note: what moved and when it was checked, or that the airline lists the flight as cancelled. A badge shows only while the event still reflects that change.
7. **Documents:** a new [flight status](../FLIGHT_STATUS.md) contract; [D-095](../DECISIONS.md); [database](../DATABASE.md); [AI contract](../AI_AND_AGENTS.md); [disruption warnings](../DISRUPTION_CONFIDENCE.md); [architecture](../ARCHITECTURE.md); [privacy notice](../PRIVACY.md); [identity and security](../IDENTITY_AND_SECURITY.md); [threat model](../THREAT_MODEL.md); [mobile cards](../MOBILE_CARDS.md); and the documentation index and policy.

## Verification

- **Unit tests:**
  - the schedule at every boundary and after a moved departure;
  - every decision rule: delay, early departure, arrival shift, cancellation, quiet details, confidence, sources, wrong flight or date, departed flights, links and identifiers in details;
  - parsing, the prompt's public-only content, and the badge and its note in four locales.
- **Database tests** (`tests/database/flight-status.mjs`, at head, with a scripted provider): driving the real worker on a synthetic sponsored trip:
  - a quiet gate update;
  - one run per slot;
  - a 90-minute delay with its system revision and overview badge;
  - the checks following the new departure without an immediate rerun;
  - an unchanged later check;
  - a cancellation that stops later checks;
  - a private flight never looked up, four system AI requests, append-only changes and the revision source check.
- **Live lookup:** after deployment, a status lookup of a real scheduled flight through the pod's provider and parser, without writing anything.
- **Full check:** `pnpm check` on a disposable PostgreSQL 17 database.

## Rollback

Revert the commit. Migration 0062 is additive; an older build ignores the new tables and column, and its revision inserts still name a member.
