---
id: JOB-098
title: Several destinations with optional days and their own clocks, and an AI that plans by destination
status: done
priority: P1
depends_on: [JOB-091, JOB-097]
claimant: Claude
branch: agent/JOB-098-multi-destination
started: 2026-11-16T02:17Z
---

## Outcome

On 15 November 2026 the owner asked for four things (D-110):
- trips with multiple destinations;
- optional dates for when the travellers are in each;
- awareness of each destination's time zone;
- an AI that knows the destinations and creates events by them.

Until now a trip had one destination and one time zone. A Tokyo-then-New York trip put New York evenings on the next day, refused a last-night dinner as outside the trip, and told the AI that "now" was Tokyo time.

## Scope

- **In:**
  - an ordered destination list in Create Trip and Settings;
  - per-day clocks for event zones, day grouping, today and the trip window;
  - the same clocks for bills and repayments;
  - AI context, prompt and proposal checks;
  - weather, Calendar export and offline snapshots;
  - offline zone suggestions;
  - copy in every language, tests and documentation.
- **Out:**
  - the Activity view, flight status and public research, which keep the trip zone as their fallback;
  - an AI zone lookup for extra destinations;
  - any rewrite of stored instants.

## Delivered

1. **Data:** migration 0070 adds `trip_destinations` (up to 12, ordered, IANA zone, optional inclusive dates inside the trip). It copies every trip's destination into position 0, which `trips` keeps mirroring. Create Trip and Settings validate the list, refuse dates outside the trip (also when the trip's own dates change), and audit the before and after.
2. **Clocks:** `src/lib/app/trip-destinations.ts` gives each dated day its destination's zone, the arriving one on travel days. An event without a place zone falls back to its day's zone. An event belongs to the day whose own clock shows its date, today follows the travellers, and the trip window opens and closes at midnight on the first and last days' clocks. Trips whose days all share one clock keep their exact earlier behaviour.
3. **Money:** bills and repayments are dated, shown and typed on their day's clock in the expense list, the bill and repayment forms, linked bills and approvals.
4. **AI:**
   - planning context and Free AI list the destinations, each day's destination and, on multi-zone trips, each day's zone;
   - `currentTime` is today's own clock;
   - a prompt paragraph tells the model how to use them, and proposal checks for events and bills use the same day clocks.
5. **Elsewhere:** weather forecasts each day at its destination; Calendar export and offline snapshots use the day's zone.
6. **Editing:**
   - one destinations editor (place, zone, optional dates; move, remove and add);
   - in Create Trip, below the main destination, which keeps its AI lookup;
   - in Settings, every row is editable;
   - zones are suggested offline from the place's name (catalog first, then a short alias list), and never sent anywhere;
   - the trip header joins the names ("Tokyo → New York").

## Verification and documentation impact

- **Tests (synthetic trips only):**
  - day zones, travel days, instant grouping, today and the trip window;
  - bill clocks, grouping and linked bill times;
  - validation and the editor in every language;
  - zone suggestions and the AI context;
  - a database test for creation, the overview, renaming, replacing, reordering, the date guards and a New York dinner on the last evening.
- **Full check:** `pnpm check` passed (lint, typecheck, unit tests, database tests, build, smoke).
- **Local UI at phone width (375 px), synthetic guest trip Tokyo 14–16 then New York 16–19 November:**
  - the header read "Tokyo → New York", and today was the travel day;
  - a Tokyo lunch showed at 12:00 PM on the 15th;
  - a New York breakfast with no place zone showed at 9:00 AM on the 17th (New York's clock);
  - an 8:00 PM New York dinner on the last evening was accepted and shown on the 19th, and its bill sat on the 19th at 8:30 PM, editable as "When · America/New_York";
  - Settings listed and saved a third destination, with Paris's zone suggested, and the header followed;
  - Create Trip showed the main destination as a fixed first row and suggested Los Angeles's zone for "ロサンゼルス";
  - no page scrolled sideways.
- **Production (16 November 2026 UTC):**
  - commit 8e2ba6d passed CI and deployed: the backup and migration jobs completed, the web server runs the new image, and health is ok;
  - a read-only probe found migration 0070 applied, with each of the 8 trips having its destination at position 0, matching the trip's own name and zone;
  - no trip had several destinations yet.
- **Documents:**
  - D-110 and the new [destinations contract](../TRIP_DESTINATIONS.md);
  - the event-local time, AI, Create Trip defaults and database docs;
  - the changelog, the roadmap and the jobs list.
