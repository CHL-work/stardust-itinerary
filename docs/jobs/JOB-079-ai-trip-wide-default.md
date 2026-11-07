---
id: JOB-079
title: AI-created events are trip-wide unless clearly solo
status: done
priority: P1
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-07T05:33Z
---

## Outcome

On 6 November 2026 the owner reported that the trip AI tends to create events as private, and asked that it create them for the whole trip unless the event or its expense is clearly for one person. On the public instance, 40 of 67 AI-created events were private, most of them from requests that never mentioned privacy.

The planner prompt set no default audience, and a reservation rule said to keep a "personal reservation" private when nobody said otherwise. Models read hotels, paid meals and flights as personal reservations.

## Scope

- **In:** the audience rule in the planner prompt (`src/lib/ai/prompt.ts`) and the reservation rule (`src/lib/ai/reservation-instructions.ts`), their tests, the AI contract, the privacy notice and D-091.
- **Out:**
  - who shares an expense (the requester plus named companions when nobody says);
  - calendar imports, which stay private by default;
  - the server's audience validation, the manual forms (already trip-wide by default) and events created before the change.

## Delivered

1. **Default:** a new AI-created event is for the whole trip (`visibility` trip, no viewers), including meals, sights, transport, stays and bookings that one person booked, paid for or is named on (D-091).
2. **Private only when:** the user asks for privacy, shares the event only with named people, or the event or its expense is clearly for the requester alone, such as their own appointment, an outing alone or a purchase for themselves. Paying for an event, or an expense split only to the requester, does not make it solo. The reply says when the model chose private unasked.
3. **Reservation rule:** the same default replaces "default a personal reservation to private".
4. **Documents:** the [AI contract](../AI_AND_AGENTS.md#4-proposal-not-direct-mutation), the [privacy notice](../PRIVACY.md#who-receives-it) and [D-091](../DECISIONS.md).

## Verification

- **Unit tests:** the prompt and reservation-instruction tests check the new rule and the absence of the old one.
- **Model evaluation:** the real planner prompt for ten synthetic requests in a synthetic four-member trip went to gpt-6.1-sol and claude-sonnet-5-5 through the providers' documented APIs, before and after the change. Nothing was written to the database.

  | Request | Expected | Before (GPT / Claude) | After (GPT / Claude) |
  | --- | --- | --- | --- |
  | Dinner tomorrow | trip | trip / no proposal | trip / trip |
  | A sight | trip | trip / trip | trip / trip |
  | Pasted hotel booking | trip | private / private | trip / trip |
  | Yakitori, in Cantonese | trip | trip / trip | trip / trip |
  | Lunch "I paid", with its expense | trip | private / private | trip / trip |
  | "My haircut, just me" | private | private / private | private / private |
  | Gym alone | private | private / private | private / private |
  | Private dinner with one member | private, one viewer | private / private | private / private |
  | Shopping, gifts for myself, with its expense | private | private / private | private / private |
  | "My flight" | either | private / private | trip / trip |

  Before, 7 and 6 of the 9 scored requests had the expected audience; after, 9 of 9 for both. One call timed out and passed on retry.
- **Documents reviewed and unaffected:** README, design, architecture, implementation, identity and security, threat model, venue hours (public meals and activities still get the hours check, now more of them), picture imports, pending edits, calendar import, expenses and database.

## Rollback

Revert the commit. There is no migration, configuration or data change, and events keep the audience they were created with.
