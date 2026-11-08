# JOB-088: Lightweight event type icons

- **Status:** review
- **Priority:** P2
- **Dependencies:** JOB-081 and JOB-082 (done)
- **Claimant:** Codex event-type-icons agent
- **Started:** 2026-11-07 UTC
- **Branch:** `agent/JOB-088-event-type-icons`
- **Integrated review branch:** `agent/account-keys-and-icons-review` (includes JOB-087 and final verification; continue there)
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
- Refreshed the Today (English) and Itinerary (Cantonese) README screenshots from the production build against a separate disposable database containing only synthetic people, places and events. Both use the JOB-076 390×844 CSS-pixel, 2× light-mode capture format. Verified the flight departure/arrival and meal icons, horizontal action row and lack of horizontal overflow; the local screenshot server and browser tab were closed afterward.
- Final combined gate with JOB-087 passed: **250 unit files / 5,917 tests**, disposable PostgreSQL suite, lint/types, production build and smoke. This icon job adds no migration or database write. Documentation links/diff checks passed; temporary app/browser and disposable database processes were stopped.

## Rollback and handoff

Presentation only; revert this job without a schema migration. No production changes or provider calls are required.

Implementation is local, not pushed or deployed. The safe approval projection adds an optional derived `isFlight` boolean; it does not expose the flight number or additional booking data. Existing approval and membership checks are unchanged. Offline cards deliberately keep generic transport because snapshots do not include structured flight data. Unimported Google Calendar events keep their existing Calendar icon.

## Documentation impact

- Updated: CHANGELOG, decisions, design, implementation source map, mobile cards, screen layout, roadmap, documentation/job indexes and this job.
- Reviewed but unaffected: README text and entry-point rules (AGENTS/CLAUDE), architecture/case study, hosting/CI/configuration, schema/restore, identity/security/privacy/threat model, accounts/member removal, destination defaults, AI and its topic contracts, personal instructions/retired preferences, Activity/feedback, communications/Calendar, maps/weather/disruption/flight-status behavior, expenses/repayments, localization packs, sources, documentation policy and job-runner policy. No new strings, data model, dependency, provider call, security boundary or operating command.
- Refreshed `docs/screenshots/today.png` and `docs/screenshots/itinerary-cantonese.png`; unaffected expense/map/AI screenshots need no replacement. No real account, trip, booking or provider credential appears in these assets.
