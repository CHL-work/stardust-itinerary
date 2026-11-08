# Flight status checks

Before a flight departs, the server looks up its current status and keeps the event up to date (JOB-083, [D-095](DECISIONS.md)). A flight is a transport event with [flight details](AI_AND_AGENTS.md#4-proposal-not-direct-mutation) (D-094).

## When it checks

- **Schedule:** 24 and 12 hours before departure, then every hour from 6 hours to 1 hour before: eight checks in all.
- **Follows the departure:** check times come from the event's current departure. When a check, or a member, moves the departure, the remaining checks move with it. The check that found a new time counts as the new time's current check, so the next one follows the new schedule instead of running again at once.
- **No replays:** a check missed while the worker was down is not run late; only the latest due one runs.
- **Bounded:** the disruption CronJob, which wakes every 5 minutes, runs at most `FLIGHT_STATUS_MAX_CHECKS` (default 2) flight checks first and leaves the disruption monitor the rest of its time. Each check is one row in `flight_status_checks`, so a slot runs once per departure time. A check that never finished gives up its slot after 10 minutes.

## Which flights

All of these must hold:
- the trip is sponsored by the operator, so the operator's keys pay;
- the trip's background checks are on, the same switch the disruption monitor uses;
- the event is a trip-visible, planned transport event with a flight number;
- the event departs within the next 24 hours.

Private, pending, cancelled and completed events are never looked up.
Legacy title-only flight recognition is presentation only (JOB-090, D-102); it does not make an event eligible for status checks.

## The lookup

`gpt-6.1-sol` at medium effort with live web search, as the disruption monitor runs it, on the operator's keys. The prompt carries only public flight facts: the flight number, airline, departure and arrival airports, planned departure instant and departure-local date/time. The departure zone comes from a validated explicit zone or the bundled airport lookup, including DST. An unresolved zone is labeled as a trip-zone fallback, not claimed as airport-local. It never includes titles, notes, people or booking details. The answer is structured JSON:
- status;
- scheduled and estimated departure and arrival;
- terminals and gate;
- confidence;
- up to five sources and a one-line summary.

Each lookup is recorded as a system AI request (`feature = 'flight_status'`).

## What changes

Application code (`src/lib/flights/status.ts`) decides from the answer; the model only reports. Every change needs a public https source for this exact flight number and date.

| Found | Needs | The event |
| --- | --- | --- |
| Departure moved by 15 minutes or more (a delay, or an earlier time) | high confidence | New departure; the arrival is the reported one, or shifted by the same amount. Its canonical day follows the new **trip-zone** date when the trip has that day. Cards show a **Changed** badge; tapping it shows departure/arrival changes in their respective endpoint zones. |
| Cancelled | high confidence | Marked cancelled, not deleted, with its times kept. Cards show the cancelled label and a red warning icon; tapping it says the airline lists the flight as cancelled. Later checks stop. |
| New terminal or gate | medium or high confidence | Flight details updated quietly; cards show the gate, else the terminal, else the airline (D-094). |
| Anything else | | No change. A drift under 15 minutes, a departed or landed flight, low confidence, another flight or date, or no usable source changes nothing, and unknown details never clear known ones. |

A badge shows only while the event still reflects that change. A member who edits the time or restores the event clears it. Zone labels never reinterpret stored UTC instants or change check scheduling; status updates retain the flight's saved endpoint zones.

## Records and audit

An update is a canonical revision like any other, with `changed_by_source = 'flight_status'` and no member (migration 0062). It also:
- adds an audit event with no actor, which Activity shows as System;
- marks Google Calendar links stale;
- appends a row to `flight_status_changes` with the previous and new times, status and details and the sources.

A pending proposal on the event goes stale as after any edit. History stays complete, so a wrong update can be undone in the event editor.

## Limits

Source-backed extraction can still be wrong; check the airline before acting on a change. There are no phone notifications for flight changes. Flights without a flight number, flights in unsponsored trips and guests' trips are not checked.

## Rollback

For JOB-083 alone, migration 0062 is additive: older builds ignore its new tables and column, and revision inserts still name a member. After JOB-090 endpoint zones have been saved, retain a zone-aware runtime: older strict parsers may discard the flight metadata. Follow the [flight-time compatibility guidance](jobs/JOB-090-flight-local-times.md#compatibility-and-rollback) and prefer a compatible forward fix.
