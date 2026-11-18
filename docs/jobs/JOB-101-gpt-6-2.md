---
id: JOB-101
title: GPT 6.2 only
status: done
priority: P1
depends_on: [JOB-100]
claimant: Codex
started: 2026-11-18T21:14Z
branch: agent/JOB-101-gpt-6-2
---

## Outcome and scope

Offer GPT-6.2 Sol and Astra as the only OpenAI models, migrate saved choices and accept retired IDs from stale clients. Keep historical usage priced without rewriting request history. Claude, Gemini, free AI, funding, privacy and review rules are unchanged.

The owner authorized implementation, the main-branch push and deployment. Production verification is read-only; tests use disposable synthetic data. No new resources, secrets or real trip records.

## Acceptance and verification

- Registry, helper defaults, localized descriptions and scripts use 6.2.
- Retired Sol, Terra and Luna map to Sol 6.2; retired Astra maps to Astra 6.2. Unknown stored defaults safely use Sol.
- Migration 0071 updates configuration/defaults and preserves request history and historical pricing.
- Verify request-schema aliases, funding/default normalization, prices, migration and the real Codex lockdown/offline transport.
- Keep the dependency release-age gate. Upgrade Codex only to a release at least one day old with a 6.2 catalog; otherwise retain the current pin and record the follow-up.
- Run `pnpm check` against disposable PostgreSQL 17, then verify CI, rollout, deployed pod image, public health and stored models. The health endpoint reports readiness and app version, not the image SHA.

## References

[AI contract](../AI_AND_AGENTS.md), [AI tab](../AI_TAB.md), [database](../DATABASE.md), [deployment](../DEPLOYMENT.md), [documentation policy](../DOCUMENTATION_POLICY.md).

## Verification

- Focused registry/pricing/effort: 35 tests passed; model-copy/current harness subset: 1,504 tests passed, plus all-locale checks.
- Real installed Codex 0.165.0 feature-report lockdown passed. Loopback captures with a dummy key confirm Sol/low with search and Astra/medium without search send the exact new IDs/efforts. Fallback metadata still advertises `request_user_input`; forbidden-item coverage explicitly rejects it. These are not live model evaluations.
- Full `pnpm check` passed on disposable PostgreSQL 17: lint, types, 282 files / 6,380 unit tests, staged database upgrade/integration checks, production build and standalone smoke. The first run found a missing migration-inventory entry and the upgrade test scheduled after an all-head fixture migration; both were corrected without changing old migrations or weakening the head assertion. Documentation checks passed for 15 changed/new Markdown files and 242 relative links/anchors; `git diff --check` passed.
- Released in [`df38d2d`](https://github.com/CHL-work/stardust-itinerary/commit/df38d2df22f12ceaf2f35cf16a85b6198ddd48d8) after [CI](https://github.com/CHL-work/stardust-itinerary/actions/runs/44402545819) and [deployment](https://github.com/CHL-work/stardust-itinerary/actions/runs/44403234641) passed. Read-only rollout, readiness and migration checks completed; no real trip records were created as tests.
- A real GPT-6.2 answer remains unverified: the tiny smoke returned `credit_balance_exhausted`. Model availability and offline request captures do not prove successful inference. No repeated inference requests were made after the quota response.
- SDK catalog upgrade is tracked by [JOB-102](JOB-102-codex-6-2-catalog.md); the release-age gate is unchanged.

## Migration and rollback

0071 changes configuration, not historical requests. It preserves completed feedback runs and all lookup/request history, retains legacy member/feedback constraints for rolling compatibility, and advances affected routine preference revisions. New feedback claims/retries explicitly record the model they run. Old pods may briefly save a legacy routine ID during rollout; unknown routine selections fail closed until rechecked/currently saved. Follow the [database checkpoint](../DATABASE.md#compatibility-checkpoints) before a code rollback.

## Documentation impact

- Updated: changelog, decisions (D-113), roadmap/jobs index, this job and JOB-102; AI contract/tab, disruption/flight checks, feedback, destination defaults, implementation, sources and database compatibility/rollback.
- Reviewed, unaffected: README/AGENTS/CLAUDE and documentation index/policy/skill; design, architecture and case study; hosting/CI/infra and secret storage; identity/security/threat/privacy and public member lifecycle; manual AI instructions and retained preference history; AI planning/research/prices/images/recovery/conversation feature contracts; Activity, communications, Calendar, maps, weather, expense/payment, card/layout and localization structure. Model-name copy changed in every locale without new keys or layout changes; screenshots need no replacement. Historical jobs and dated evidence stay historical.
- Deferred only: the release-age-gated SDK catalog verification in JOB-102. No separate handover document or new infrastructure.
- Completion-only update: this job, roadmap/jobs index and changelog record the release and verification limit; the sources bibliography clarifies its dated evidence. Feature contracts and runtime code are unchanged.
