---
id: JOB-086
title: Free AI for signed-in users and guests
status: review
priority: P2
depends_on: [JOB-071, JOB-085]
claimant: Codex
branch: agent/JOB-086-free-ai-for-everyone
started: 2026-11-07
---

## Outcome and authority

The user requested review of the current public GKE project and `Ebony-Vinyl/dsh-our-free-model`, then implementation of free-model AI for every user, including guests. This authorizes a local implementation and synthetic verification, not a main push, deployment, cloud changes or paid calls.

## Scope

- Extend the existing documented keyless Kilo route, not account farming, client impersonation, captured credentials or private relay routes.
- Offer an explicit free choice to every active member, including owners and guests; use it by default when no paid funding is available. Preserve paid choices and never silently charge a key after a free failure.
- Keep trip AI on/off, current visibility, review, exact finance validation, suspension and guest isolation. Free requests stay text-only without search, images or background work.
- Verify upstream models are actually free and usable; bounded fallback stays within the same free service. Respect rate limits and disclose provider retention.
- Preserve per-account and instance-wide limits, keyless credential isolation and audit/reconnect behavior.
- Update concise copy in every language, tests and affected contracts.

## Acceptance and verification

Test keyed and keyless owners/editors/viewers/guests, explicit free choice, disabled AI, quotas, invalid/paid model rejection, no credential forwarding, current catalog filtering, unavailable/rate-limited models, text-only enforcement, and pending proposal behavior. Use synthetic data only. Run relevant unit/database tests, lint/types and a build/smoke; record skips honestly. A bounded live free-gateway smoke may use only synthetic prompts and no credentials.

## Handoff

Implemented locally on the named branch; no push, deployment, secret change or production access. Main pushes auto-deploy and still require explicit authority. GKE remains the production host; do not restart the archived PC/VM origin.

### Verification (2026-11-07)

- Full unit suite: 244 files / 5,817 tests passed (`pnpm exec vitest run --pool=threads --maxWorkers=1`). After the final checkpoint/audience fixes, the 302 planner/schema tests passed again.
- Full disposable PostgreSQL migration/integration gate passed, including guest isolation, registered owner/editor/viewer access, own/shared/operator versus free funding, exact quotas, concurrent admission and free off-topic accounting. Historical migration stages remain compatible.
- TypeScript passed. ESLint had no errors; one existing warning remains in an ignored local screenshot helper.
- Production build and standalone smoke passed (health, Cantonese/Spanish pages, selected language-pack delivery, identity, stylesheet and local MapLibre workers); the temporary server stopped.
- Opt-in `scripts/test-free-ai.ts` used fresh loopback-only synthetic databases and actual dots.3 note free calls through `runAiPlanner`. Final run passed registered event + linked expense and guest event, using two upstream attempts: tomorrow at 19:00 Japan time, one-hour duration, JPY 4,200, exact payer/two participants, pending review, no posted expense and `credential_source=free`.
- Earlier smoke failures exposed and fixed a mistaken draft-continuation flag discarding new creates, insufficient reference/audience output constraints, and rejection of the explicit absent checkpoint. Tests preserve consumed-draft replay protection and normal final validation. No real user data was sent. Liquid fallback is mock-tested, not live-qualified.
- Independent funding/privacy/UI review completed; relative documentation links/anchors and diff whitespace checked.

### Behavior and limits

- `FREE_AI_ENABLED=true` enables the choice for active members and guests. It is default only without paid funding; a selected free request never switches to a paid key. Canonical settings override legacy guest-only aliases, whose enabled flag now covers all accounts.
- Text-only planning; no images, search, venue-hours research, saved instructions, paid conversation history, existing expenses or private itinerary context. Only free-lane memory is reused. The prompt itself may contain sensitive information: the visible retention notice is important, and users should not submit confidential data.
- Default limits: 10 requests/account/UTC day, 60 instance requests/upstream attempts per rolling hour, 500/day. Retries consume attempt capacity. Provider availability, capacity and catalog prices can change; fail closed without paid fallback.
- Parser-derived generation schemas narrow IDs and require create fields. Application code still validates permissions, exact money, current audience and revisions; all free proposals require review.

### Release / rollback

No schema migration or dependency change. Before an authorized deployment, review existing free-model overrides and set canonical configuration explicitly; obsolete NVIDIA/opaque trial routes are excluded. Verify the current zero-price catalog and use synthetic staging requests. Disable `FREE_AI_ENABLED` to hide/block this lane without changing stored chats or paid keys; reverting this release restores the old guest-only implementation. Never start a second production writer.

### Documentation impact

Updated entry points/history, AI contracts (funding, context/history/instructions, images, pending edits, provider failures, research/hours), architecture/source map, case study, database, design/D-098, privacy/security/threat model, members, hosting/deployment/configuration, sources and job indexes. Reviewed unchanged: CLAUDE, documentation index/policy/job skill, CI/image/Compose/Kubernetes/infrastructure, destination lookup, Activity/feedback, booking-price/recovery, Calendar/map/weather/disruptions/flights, expenses/payments/cards/layout/localization contracts and retired preference history. No deferred documentation. Screenshots remain representative; changes are confined to small composer controls.
