---
id: JOB-097
title: Plain local times without zone names, retaken screenshots, and no free-model refresh button
status: done
priority: P2
depends_on: [JOB-090, JOB-091, JOB-095]
claimant: Claude
branch: agent/JOB-097-plain-local-times
started: 2026-11-08T16:40Z
---

## Outcome

On 8 November 2026 the owner raised three things (D-109):
- the itinerary screenshot looked out of date;
- the app should not show time zones such as "GMT 0";
- the refresh-models button should go from the AI conversation.

The screenshots showed every time as "09:30 AM GMT+9 · Trip time", wrapped over five lines in the itinerary's time column.

## Scope

- **In:**
  - zone names removed from displayed times;
  - friendly zone names in the event editor;
  - the free-model refresh button removed;
  - screenshots whose screens changed retaken;
  - tests and documentation.
- **Out:** zone resolution, DST handling, local dates, UTC ordering, Calendar export (which keeps real zones) and AI prompts, which still name zones explicitly.

## Delivered

1. **Times:** the timeline, Today's next-up, approval cards, Activity, Calendar previews, day map stops and flight change notes show each place's own clock with no zone name. `timeZoneName` is gone from those formatters, and so is the " · Trip time" suffix. A local date that differs from the trip date still appears.
2. **Editor:** the event editor's time fields name the zone in words through the new `timeZoneDisplayName` ("Japan / Tokyo", "Central European Time"), never an offset or a raw IANA ID. They still say Trip time for a guessed zone, since that is where it is corrected.
3. **Free models:** the Refresh models button and its copy in every language are gone. The catalog status line shows only when there is something to say, and a failed list loads again when the AI tab is opened again.
4. **Screenshots:** `overview.png`, `itinerary-flight-changed.png`, `ai-proposal.png` and `day-map.png` were retaken with JOB-095's method (local build, synthetic Tokyo trip, scripted flight delay, deterministic AI proposal). Since it is now after midnight in Tokyo, the trip runs 8–10 November, with today on the 9th. `api-keys.png` shows no times and is unchanged.

## Verification and documentation impact

- **Tests:**
  - every test that expected zone names now checks the local clock without them; the Dallas and Salt Lake City clocks still differ;
  - a test checks that no city zone, in any language, is named by an offset;
  - the free-model card shows no refresh button.
- **Full check:** `pnpm check` passed.
- **Screenshots:** viewed after retaking. None shows a zone name, and the map has its three numbered stops.
- **Documents:**
  - D-109, plus notes on D-102 and D-103;
  - the event-local time contract;
  - the daily map, flight status, localization and mobile cards docs;
  - the changelog, the roadmap and the jobs list.
