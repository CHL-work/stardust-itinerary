---
id: JOB-092
title: Broaden compatible free models and audit upstream routes
status: review
priority: P2
depends_on: [JOB-086]
claimant: Codex
branch: agent/JOB-092-free-model-capabilities
started: 2026-11-08
---

## Outcome and authority

The user requests the other free models/routes from `dsh-our-free-model` for every account, including guests. The follow-up explicitly approves up to eight free requests across Reflection Beam and Cohere North Mini Code using synthetic trips, and GitHub push/GKE deployment after tests pass. No paid keys or real trip data are authorized for testing.

## Scope

- Audit current upstream routes against actual credentials, access requirements and provider documentation; do not execute upstream code or treat its model names as proof of free access.
- Admit compatible, currently zero-priced anonymous models even without native JSON-schema generation, preserving strict application validation and review.
- Keep explicit selection, isolated free funding, existing quotas, privacy exclusions and guest/member authorization. No paid fallback, account farming, client impersonation or private relays.
- No migration, new credentials, provider billing or real-trip test writes.

## Acceptance and verification

- Capability-aware requests use native schema, JSON-object mode or a schema-bearing prompt as supported; invalid output cannot create proposals.
- Catalog and inference revalidate zero prices and restrictions. All active accounts, including guests, receive the same eligible list.
- Tests cover unsupported parameters, parser failures, retained authorization/quotas and no silent model substitution.
- Run targeted tests and the normal local check gate; record live checks separately from deterministic tests.

## Design and evidence

[AI contract](../AI_AND_AGENTS.md#free-ai-for-every-account-job-086-d-098) · [source evidence](../SOURCES.md#november-8-2026-free-model-comparison) · [prior free implementation](JOB-086-free-ai-for-everyone.md).

## Risks / rollback

Models without native schema guarantees can fail output validation more often. Keep normal failure handling and bounded attempts; never interpret prose as a database action. Revert this change to restore native-schema-only eligibility. Catalog availability is not proof of inference quality.

## Verification (November 8, 2026)

- `pnpm check` passed: lint, type checking, 264 files / 6,229 unit tests, full disposable PostgreSQL migration/integration suite, production build and standalone smoke. The test database is loopback-only; no production credentials or trip records were used.
- Independent review passed 369 targeted tests and found no blocking authorization, privacy or validation regression. Final adapter coverage includes 44 tests across capabilities, zero-price checks, restrictions, modality checks, payload bounds and no key/substitution behavior.
- Actual public catalog GET through the updated adapter returned dots.3 note, Liquid LFM3, Reflection Beam and Cohere North Mini Code. This verifies discovery, not inference quality. Live synthetic inference for the two new models has been requested but not authorized/run.
- Relative documentation links/anchors and `git diff --check` passed. No migration or dependency changes. No upstream plugin executed or credential imported.

## Remaining limits and release

This is not all of the upstream plugin's advertised frontier lineup: other routes require client-restricted access, account credentials, subsidy authorization or host-provided compute. The [dated route audit](../SOURCES.md#november-8-2026-free-model-comparison) records those differences. Do not enable them through impersonation or describe catalog availability as successful inference.

Local implementation only; no push, deployment or production configuration change. Separate approvals for bounded synthetic inference and release are outstanding. Reverting this job restores native-schema-only eligibility without a database rollback. Keep existing free quotas and key isolation during release.

## Documentation impact

Updated CHANGELOG, D-104/D-098, roadmap/job record, AI contract and failure behavior, architecture/source map, case study, threat model, configuration comments and dated source evidence. Reviewed unchanged: README/screenshots, documentation index, AGENTS/CLAUDE/job skill/policy, product design, privacy/identity/members, keys/history/instructions/images/research/hours/booking/recovery, database schema, hosting/deployment/CI/Compose/Kubernetes/infrastructure, destination defaults, activity/feedback, Calendar/maps/weather/disruptions/flights/local times, expenses/payments/cards/layout/localization and retired preference history. No new handover document, provider credential, UI copy or deferred documentation.
