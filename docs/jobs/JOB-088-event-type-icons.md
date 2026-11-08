# JOB-088: Lightweight event type icons

- **Status:** in_progress
- **Priority:** P2
- **Dependencies:** JOB-081 and JOB-082 (done)
- **Claimant:** Codex event-type-icons agent
- **Started:** 2026-11-07 UTC
- **Branch:** `agent/JOB-088-event-type-icons`
- **Authority:** the user's request for small, performant event icons; no push or deployment authorized.

## Outcome and scope

Recognizable inline icons distinguish flights, meals/restaurants, lodging, other transport, activities and notes on event cards. Reuse the existing icon package; no image requests, model calls, new dependency or database change. Keep localized text, privacy/status indicators and all event permissions.

Out of scope: changing event types, inferring travel modes from titles, maps, expenses, provider credentials or deployment.

## Design and acceptance

- Follow [cards](../MOBILE_CARDS.md), [layout](../UI_LAYOUTS.md) and [design](../DESIGN.md#6-itinerary-model-and-editing).
- One deterministic mapping uses stored type and structured flight details; no text/language guessing.
- Today, Itinerary and pending/approval event displays use the same mapping. Private/locked events retain their existing privacy/status meaning.
- Icons supplement text; decorative SVGs are hidden from assistive technology, do not take focus and have fixed dimensions.
- No remote assets, extra API requests or animation; responsive card/action layout remains intact.

## Verification

- `pnpm exec vitest run --pool=threads --maxWorkers=1`: **248 files / 5,890 tests passed**. Dedicated tests cover every stored type, fallback, fixed dimensions/accessibility, flight endpoints, all-locale canonical/pending cards, privacy/lock labels, one action set and the safe approval flight flag.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` and `git diff --check`: passed.
- Browser inspection used only a loopback, static render of the actual card components with synthetic data: 390px English/light, 320px spicy Cantonese/dark, 1280px German/dark and 320px Japanese/light. No horizontal overflow; glyphs are 16px in the rail. The Japanese pending Edit/Approve/Reject buttons shared one row and retained 44px height. Temporary preview tab/server were closed and emulation reset.
- The combined release gate still needs disposable PostgreSQL integration tests and smoke after integration with the concurrent credentials job. This job adds no migration or database write.

## Rollback and handoff

Presentation only; revert this job without a schema migration. No production changes or provider calls are required.

Implementation is local, not pushed or deployed. The safe approval projection adds an optional derived `isFlight` boolean; it does not expose the flight number or additional booking data. Existing approval and membership checks are unchanged. Offline cards deliberately keep generic transport because snapshots do not include structured flight data. Unimported Google Calendar events keep their existing Calendar icon.

## Documentation impact

- Updated: CHANGELOG, decisions, design, implementation source map, mobile cards, screen layout, roadmap, documentation/job indexes and this job.
- Reviewed but unaffected: README text and entry-point rules (AGENTS/CLAUDE), architecture/case study, hosting/CI/configuration, schema/restore, identity/security/privacy/threat model, accounts/member removal, destination defaults, AI and its topic contracts, personal instructions/retired preferences, Activity/feedback, communications/Calendar, maps/weather/disruption/flight-status behavior, expenses/repayments, localization packs, sources, documentation policy and job-runner policy. No new strings, data model, dependency, provider call, security boundary or operating command.
- Before release, refresh the affected Today/Itinerary README screenshots from a full local synthetic app. The card-only QA preview is not a replacement for those whole-app screenshots. This remains with JOB-088's final integration gate; unaffected expense/map/AI screenshots need no replacement.
