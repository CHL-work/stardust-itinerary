# JOB-090: Flight icons and airport-local endpoint times

- Status: review
- Priority: P1
- Dependencies: shipped JOB-082, JOB-083 and JOB-088
- Claimant: Codex
- Branch: agent/JOB-090-flight-local-times
- Started: 2026-11-08 UTC
- Authority: user requested distinct flight icons and departure/arrival local-time display, then explicitly approved GitHub push and GKE deployment after tests pass.

## Outcome and scope

Flights use plane/takeoff/landing icons rather than generic transport. Each flight endpoint displays its own local time, including different dates and daylight-saving offsets, rather than applying the trip zone to both. Preserve canonical instants, duration, privacy, review and one-event identity. Unknown zones must remain honestly labeled, not guessed.

Inspect structured flight metadata, legacy presentation, timeline/day grouping, next-up display, editing and status-check dependencies. Use synthetic tests only; no real itinerary writes, paid lookups, infrastructure changes or automatic historic data rewrite.

## Acceptance and verification

- Synthetic cross-zone, date-boundary, DST and generic-transport regressions.
- Departure and arrival icons/times agree across Today and Itinerary, including pending items.
- Manual edits do not silently change instants because display zones changed.
- Relevant unit/database tests, lint, types, build, smoke and local UI checks.

## Contracts

[Design](../DESIGN.md), [cards](../MOBILE_CARDS.md), [flight checks](../FLIGHT_STATUS.md), [AI](../AI_AND_AGENTS.md), [localization](../LOCALIZATION.md).

## Handoff

Implemented and verified locally; the owner authorized the CI-gated GitHub/GKE release. Use the release workflow in [deployment](../DEPLOYMENT.md#releases); no real traveler records were created or edited for testing.

- Shared flight presentation uses explicit IANA zones, then a pinned offline IATA catalog, then a labeled trip-zone fallback. Narrow legacy recognition covers an airline/flight marker plus flight number and one known route; it never changes stored facts or monitoring eligibility. Country suffixes such as USA are not treated as airport codes.
- Canonical/pending/approval cards, next-up, maps, Calendar exports and public offline snapshots agree. The editor preserves precise instants through airport/zone changes, handles DST gaps/folds without guesses and retains actual click instants for Now. Linked expense dates stay in trip time.
- Trip-date grouping stays in the trip zone; local dates appear where different. Generic transport still uses trip time. Existing ambiguous or wrongly saved flight timestamps are not automatically rewritten.
- Local browser checks used actual components with synthetic fixtures at 320, 390 and 1280px: English, Cantonese and German, light/dark, distinct takeoff/landing versus route icons, endpoint clocks, pending actions and editor layout; no horizontal overflow. The isolated preview was stopped afterward.
- No provider calls, real Calendar writes, data migrations, airport geocoding or deployment configuration changes. The reproducible airport catalog is 41 KB and ships its MIT notice in source and container.

### Verification

- `pnpm check` passed: 259 unit-test files / 6,098 tests, disposable PostgreSQL integration, types, build and smoke. Lint has no errors and one pre-existing warning in an ignored local screenshot helper.
- Final monitoring alignment additionally passed its 28 unit tests, scoped lint, the complete disposable database suite and production build; its title-derived airport resolution never sends the title to the provider. Final standalone smoke also passed.
- Synthetic coverage includes DFW/SLC winter/summer, differing local dates, DST folds/gaps, optional ends, precise saved instants/Now, pending revisions, linked expenses, country-code ambiguity, Calendar payloads and private/offline projections.
- Airport generator reproducibility, 261 relative documentation links/anchors, whitespace and a scoped secret/private-identifier scan passed. No new dependency or migration. Browser preview and disposable database server were stopped after verification.
- Independent release review passed 160 focused tests and found no code blockers. Release documentation clarifies flight-metadata rollback compatibility and the current migration inventory.

### Compatibility and rollback

No new migration. Optional zone values fit the existing bounded `flight` JSON contract and existing revisions/proposals. Old offline snapshots remain readable. Retain an endpoint-zone-aware runtime after zones have been saved: older strict parsers may discard a flight object containing unknown zone keys. Roll forward with a corrected compatible image rather than erase metadata or rewrite canonical timestamps.

### Documentation impact

Updated CHANGELOG, DESIGN, DECISIONS (D-102 refines D-100), ROADMAP/jobs index, ARCHITECTURE, IMPLEMENTATION, DATABASE, AI_AND_AGENTS, AI_IMAGE_INPUTS, FLIGHT_STATUS, MOBILE_CARDS, DAILY_MAP, CALENDAR_CONFLICTS, LOCALIZATION, UI_LAYOUTS and SOURCES.

Reviewed and unaffected: README/screenshots/index (existing screenshots contain no cross-zone flight), CASE_STUDY, AGENTS/CLAUDE, job system/skill/documentation policy; self-hosting/deployment, container/Compose/GKE/infrastructure/CI/env configuration; identity/security/threat model/privacy and public accounts; destination defaults; key storage/funding, custom instructions/retired preferences, pending-AI edit authorization, venue hours/research/prices/history/recovery/provider failures; Activity/feedback, communications, Calendar import, weather/disruption qualification/localization and expense/repayment rules. Public offline data remains public-only and adds no booking facts or external disclosure. No documentation deferred.
