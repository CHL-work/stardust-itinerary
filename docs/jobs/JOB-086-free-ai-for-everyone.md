---
id: JOB-086
title: Free AI for signed-in users and guests
status: done
priority: P2
depends_on: [JOB-071, JOB-085]
claimant: Codex
branch: agent/JOB-086-free-ai-for-everyone
started: 2026-11-07
---

## Outcome and authority

The user requested review of the current public GKE project and `Ebony-Vinyl/dsh-our-free-model`, then implementation of free-model AI for every user, including guests. The follow-up explicitly authorized GitHub push and GKE deployment, with each supported free model selectable and paid models hidden until the user saves the matching API key. No unrelated infrastructure, paid provider calls or real-trip test writes are authorized.

## Scope

- Extend the existing documented keyless Kilo route, not account farming, client impersonation, captured credentials or private relay routes.
- Offer every eligible free model to active members, owners and guests; default to free without an own saved key. Show paid choices only for the user's saved providers. Never silently substitute a named free choice or charge a key after a free failure.
- Keep trip AI on/off, current visibility, review, exact finance validation, suspension and guest isolation. Free requests stay text-only without search, images or background work.
- Verify upstream models are actually free and usable; bounded fallback stays within the same free service. Respect rate limits and disclose provider retention.
- Preserve per-account and instance-wide limits, keyless credential isolation and audit/reconnect behavior.
- Update concise copy in every language, tests and affected contracts.

## Acceptance and verification

Test keyed and keyless owners/editors/viewers/guests, explicit free choice, disabled AI, quotas, invalid/paid model rejection, no credential forwarding, current catalog filtering, unavailable/rate-limited models, text-only enforcement, and pending proposal behavior. Use synthetic data only. Run relevant unit/database tests, lint/types and a build/smoke; record skips honestly. A bounded live free-gateway smoke may use only synthetic prompts and no credentials.

## Handoff

Accepted, merged and deployed to GKE on November 7, 2026. Main pushes run CI then deploy to GKE. Do not restart the archived PC/VM origin. Release evidence is below; future production changes still need explicit authority.

### Verification (2026-11-07)

- Full unit suite: 244 files / 5,817 tests passed (`pnpm exec vitest run --pool=threads --maxWorkers=1`). After the final checkpoint/audience fixes, the 302 planner/schema tests passed again.
- Full disposable PostgreSQL migration/integration gate passed, including guest isolation, registered owner/editor/viewer access, own/shared/operator versus free funding, exact quotas, concurrent admission and free off-topic accounting. Historical migration stages remain compatible.
- TypeScript passed. ESLint had no errors; one existing warning remains in an ignored local screenshot helper.
- Production build and standalone smoke passed (health, Cantonese/Spanish pages, selected language-pack delivery, identity, stylesheet and local MapLibre workers); the temporary server stopped.
- Opt-in `scripts/test-free-ai.ts` used fresh loopback-only synthetic databases and actual dots.3 note free calls through `runAiPlanner`. Final run passed registered event + linked expense and guest event, using two upstream attempts: tomorrow at 19:00 Japan time, one-hour duration, JPY 4,200, exact payer/two participants, pending review, no posted expense and `credential_source=free`.
- Earlier smoke failures exposed and fixed a mistaken draft-continuation flag discarding new creates, insufficient reference/audience output constraints, and rejection of the explicit absent checkpoint. Tests preserve consumed-draft replay protection and normal final validation. No real user data was sent. Liquid fallback is mock-tested, not live-qualified.
- Independent funding/privacy/UI review completed; relative documentation links/anchors and diff whitespace checked.

### Release refinement verification (2026-11-07)

- Individual free-model selection, own-key-only paid controls and all 12 locales are covered by UI/API/recovery tests. Full unit rerun: 247 files / 5,853 tests passed; the final field-guidance regression passed separately (11 schema tests).
- Exact-selection live smoke passed for a synthetic registered event plus linked JPY 4,200 expense and a guest event, with two keyless upstream attempts. A prior run omitted the duration/category from its valid proposal; field-adjacent instructions now preserve supplied details without requiring invented end times.
- Database migration/integration gate, TypeScript, ESLint (no errors), production build and isolated standalone smoke, shell syntax and documentation links passed. The final affected-file rerun passed 152 tests, including 15 effective rollout configuration tests.

### Release evidence

- Implementation commits `73d2de8` and `dffeab3` reached `main` through the authorized fast-forward push. [CI](https://github.com/CHL-work/stardust-itinerary/actions/runs/42416869730) and [GKE deployment](https://github.com/CHL-work/stardust-itinerary/actions/runs/42417096932) succeeded, including backup/migration, rollout, effective free/guest configuration gate and public health check.
- Post-release read-only checks: public health reported database ready; the new catalog route returned 401 without a session. The sign-in page exposed an enabled guest entry after its normal browser check. No real trips or provider credentials were used in these checks; inference verification used only the disposable synthetic database described above.
- Temporary local test server and database were stopped. Provider availability can change after this verification; the live catalog and normal fail-closed behavior remain authoritative.
- Final UI review removed the legacy sponsored quota/unlimited summary from Settings when free AI is available; the free allowance stays visible, and no backend limits or owner trip-limit controls changed. Regression tests cover no-key members and the operator.

### Behavior and limits

- `FREE_AI_ENABLED=true` enables the choice for active members and guests. The composer defaults to free without an own saved key and shows paid models only for that user's saved providers. The member-scoped catalog lists every eligible free model; `freeModel` is validated, hashed for delivery recovery and sent exactly. Canonical settings override legacy aliases, whose enabled flag now covers all accounts.
- Text-only planning; no images, search, venue-hours research, saved instructions, paid conversation history, existing expenses or private itinerary context. Only free-lane memory is reused. The prompt itself may contain sensitive information: the visible retention notice is important, and users should not submit confidential data.
- Default limits: 10 requests/account/UTC day, 60 instance requests/upstream attempts per rolling hour, 500/day. Retries consume attempt capacity. Provider availability, capacity and catalog prices can change; fail closed without paid fallback.
- Parser-derived generation schemas narrow IDs and require create fields. Application code still validates permissions, exact money, current audience and revisions; all free proposals require review.

### Release / rollback

No schema migration or dependency change. The web-only GKE patch sets canonical free configuration independently of legacy mounted values; a post-rollout check verifies effective free/guest admission settings without printing secrets. To disable, set `FREE_AI_ENABLED=false` in that patch and deploy (mounted dotenv cannot override process environment). Stored chats and paid keys remain untouched; reverting this release restores the old guest-only implementation. Never start a second production writer.

### Documentation impact

Updated entry points/history, AI contracts (funding, context/history/instructions, images, pending edits, provider failures, research/hours), architecture/source map, case study, database, design/D-098, privacy/security/threat model, members, deployment/configuration and GKE web overlay/entrypoint/verifier, sources and job indexes. Reviewed unchanged: CLAUDE, documentation index/policy/job skill, CI workflow/image/Compose/infrastructure, destination lookup, Activity/feedback, booking-price/recovery contract, Calendar/map/weather/disruptions/flights, expenses/payments/cards/layout/localization contracts and retired preference history. No deferred documentation. Screenshots remain representative; changes are confined to small composer controls.
