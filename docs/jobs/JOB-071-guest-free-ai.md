---
id: JOB-071
title: Free guest AI on keyless free models
status: done
priority: P2
depends_on: [JOB-064]
claimant: CHL-work
branch: main
started: 2026-11-06T12:10Z
---

## Outcome

On 6 November 2026 the owner asked how an open-source project, "dsh-our-free-model", gets free tokens, and which other free AI options there are. The model had to be released in 2026 and not be too weak, and guests should then be able to use Stardust's AI for free.

The project's main methods were not usable:

- it poses as another app's command-line tool to use that app's keyless free tier;
- it farms accounts on consumer coding apps, with automatic check-ins and solved captchas;
- it routes through a relay that holds one shared key.

Its one documented, honest method is Kilo's AI Gateway, which allows unauthenticated use of its `:free` models. The owner asked for the same approach, so Stardust uses that gateway, identifying itself honestly.

Decision: [D-086](../DECISIONS.md#d-086-free-guest-ai-on-keyless-free-models-accepted-november-6-2026).

## Delivered

1. **The free lane** (`src/lib/ai/free-model.ts`):
   - It calls the gateway's chat completions with the planner's JSON schema, sends no key, and uses an honest Stardust user agent.
   - It tries the configured `:free` models in order (`GUEST_FREE_AI_MODELS`; by default NVIDIA Nemotron 3.5 Super, then dots.3 note). A gone or empty model falls through to the next; the per-address rate limit stops at once.
   - It runs only in the new keyless credential context (`withFreeAiCredential`). The subprocess environment builder and the Gemini endpoint refuse that context.
2. **Funding:** `getAiPolicy` gives a guest without a key the `guest-free` model slot, recorded as `credential_source = 'free'` (migration 0060). The caps:
   - 10 requests per guest per UTC day;
   - 60 an hour and 500 a day for the whole instance, kept exact by one lock.

   The slot is never offered for selection (`selectableOwnerModels`), and Calendar venue lookups refuse it.
3. **Planner:** a free-model turn with no search, no isolated research and no venue-hours lookup.
   - Free models wrote escaped JSON inside a string unreliably, so they return each proposal's patch as a nested object, which is turned into `patchJson` before the usual parsing and validation.
   - An unusable answer gets one more try.
   - Malformed patch JSON from any model is now reported as invalid model output instead of a server error.
4. **The guest's AI card:** the free model, the requests left today, and that free models may keep what guests send, so they should leave out personal details. The admin page counts free requests separately.
5. **Docs:** [privacy notice](../PRIVACY.md), [threat model](../THREAT_MODEL.md), [AI](../AI_AND_AGENTS.md), [deployment](../DEPLOYMENT.md), [self-hosting](../SELF_HOSTING.md), `.env.example`, [public trips and members](../PUBLIC_TRIPS_AND_MEMBERS.md), decisions, roadmap, sources, the README and the changelog.

## Verification

- **Unit tests:**
  - free-lane settings: off by default, `:free` models only, https only, bounded caps;
  - the free context requirement;
  - no `Authorization` header, an honest user agent, and the schema enforced with no redirects;
  - model fallback, stopping at a rate limit, and empty answers;
  - the nested-patch conversion;
  - a planner turn on the free lane: no Codex, Claude, Gemini, research or key read, recorded as `kilo`/`kilo_gateway`/`anonymous`/`free`;
  - the slot absent from selectable models and request validation.
- **Database tests** (`tests/database/guest-free-ai.mjs`):
  - off by default;
  - the free policy and overview for a guest;
  - the per-guest cap, then the instance-wide hourly cap;
  - the funding check.
- **Live, on a local build** with a synthetic guest and the real gateway:
  - a date and time question answered correctly in about 50 seconds;
  - "Add dinner at Sushi Zanmai Shibuya … on the second day" created a valid pending event at 19:00 Tokyo time in 35 seconds, with the remaining count going from 10 to 9.

## Rollback

Set `GUEST_FREE_AI_ENABLED=false`, and guests are asked for a key again. Reverting the code also needs migration 0060's check to stay; it only adds an allowed value.
