---
id: JOB-100
title: Flights home that land on the trip's last day, and a clear message for dates outside the trip
status: review
priority: P1
depends_on: [JOB-098]
claimant: CHL-work
branch: agent/JOB-100-flight-home-arrival
started: 2026-11-16T15:40Z
---

## Outcome

On 16 November 2026 the owner pasted a round-trip flight booking into the AI on a trip with two destinations and got "AI request failed. Please try again." twice. They asked for the cause and a fix (D-112).

## Diagnosis

- **What production recorded:** both attempts ran on the owner's own Claude Sonnet 5.5 key. Claude answered each time (about 3,200 output tokens), then the request failed with error code `Error` and no provider or validation detail, so the failure came from the application after a valid reply. The web log had nothing, because conflicts are answered with 409 and only server errors are logged.
- **What refused it:** the planner checks only that each event starts on a trip day. Saving then rechecks the trip window, which since JOB-098 closes at midnight after the last day on that day's clock (D-110). The flight home leaves on the last day and lands, several time zones east, the same day where it lands, which is already the next day on the last destination's clock. `assertCurrentItineraryDates` refused it with "The event dates must be within the current trip dates.", the whole batch was rolled back, and the browser showed its generic message for a 409 it did not recognise.
- **Why it was inconsistent:** the event editor already checked an end on its own clock on trips with several clocks, so it would have accepted the same flight. On one-destination trips both refused it, before JOB-098 too.

## Scope

- **In:** the server's trip window, the event editor's end check, a stable code for refusals outside the trip with a message in every language, tests and documentation.
- **Out:** the prompt (the model's flights were right), which day an event belongs to, and other refusal messages.

## Delivered

1. **Own clock at the edges:** `assertCurrentItineraryDates` also accepts a start or end inside the trip's dates on the event's own clock for that end, resolved by `resolveEventTimeZones` with the event's day zone as the fallback. New events, updates, pending edits and approvals (the AI's included) pass the event as it will be saved. The rule only widens: past midnight on both clocks is still refused.
2. **Editor:** `eventTimeWithinTrip` in `trip-destinations.ts` states the same rule by date, and the event editor's end check uses it on every trip.
3. **Code and message:** `AppConflictError` can carry a code. The trip-window refusal and the planner's three outside-the-trip checks carry `TRIP_DATES_OUTSIDE`, which the API returns, the AI request records as its error code and request recovery passes on after a reconnect. The browser then shows `aiOutsideTrip`, "Nothing was added: one of the dates is outside this trip.", live and after reconnecting, in all 11 languages.

## Verification and documentation impact

- **Tests (synthetic):** a database test with a Singapore-then-Sydney trip and a one-destination Sydney trip: an outbound flight, a flight home that lands in Los Angeles on the last day, a later landing that day as an update, airport codes alone, a pending edit and its approval, and refusals with the code for a next-day landing and for a late snack with no place of its own. Unit tests cover the date rule, the event editor, the API code, the planner's recorded code, request recovery and the message in every language.
- **Real model, end to end (keyless Free AI, a synthetic booking of the same shape, fresh loopback databases):** a Singapore-then-Sydney trip with a flight out from Los Angeles and a flight home that lands there on the last day.
  - before the fix: the request failed with error code `Error` and "The event dates must be within the current trip dates.", as in production;
  - after it: both flights were proposed with their airports' clocks, the flight home ending on the last day in Los Angeles. One other run failed earlier because the model sent an empty `linkedExpense` (null), which validation refuses; that is unrelated to this job.
- **Full check:** `pnpm check` passed on a disposable PostgreSQL 17 cluster: lint, typecheck, 281 files / 6,364 unit tests, the database migration and integration suite, the production build and the standalone smoke.
- **Production:** pending.
- **Documents:** D-112; the destinations contract, event-local times and AI notes; the changelog, the roadmap and the jobs list. Reviewed and unchanged: the README, the database guide (no migration) and deployment.
