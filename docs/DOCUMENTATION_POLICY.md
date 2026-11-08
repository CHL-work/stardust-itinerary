# Documentation Maintenance Policy

## Goal

Every human or AI change leaves the complete documentation set accurate. This requires reviewing every document, not mechanically editing unaffected files.

## Required for every change

1. Read the root `README.md`, `AGENTS.md`, `CLAUDE.md`, and `CHANGELOG.md`.
2. Review the inventory below and decide whether each area is affected.
3. Update every affected document in the same branch/commit series as the code or behavior change.
4. Add an entry under `CHANGELOG.md` → `Unreleased`.
5. Include a documentation-impact note in the pull request with:
   - documents updated;
   - documents reviewed but unaffected;
   - any documentation intentionally deferred and its blocking job.
6. A change may not move to `review` while behavior, commands, configuration, schema, permissions, or tests disagree with documentation.

Do not edit unaffected files merely to bump dates. That hides useful history and creates merge conflicts.

## Keep instructions current and brief

- `AGENTS.md` owns repository rules; [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md) own operating commands; the [roadmap](ROADMAP.md) and job records own planned work; topic documents own feature contracts. Link instead of copying them into every entry point.
- README is a brief overview and navigation page, not a rollout journal. Details belong in the topic documents it links to.
- The [documentation index](README.md) lists every document. Add, rename or remove a document there in the same change.
- README screenshots show synthetic data only, from a local build. Replace one when its screen changes visibly, the way [JOB-095](jobs/JOB-095-readme-and-license.md#how-the-screenshots-were-made) made them.
- Remove superseded commands and implementation narratives from active guides. Keep necessary historical evidence in labeled job records, CHANGELOG and Git history; old approval or test results never grant present authority or prove current runtime health.
- Label proposal-only features and outstanding decisions. Never describe an approved design as implemented without code/release evidence.
- This repository is public. Never commit personal emails, cloud project IDs, host names, IP addresses, local machine paths, bucket names, secrets, real traveler data, or deployment evidence from a private instance; describe hosting generically and link to the hosting documents.
- For docs-only changes, verify relative links, anchors, script/config references and contradictory instructions. Do not deploy or make provider calls merely to validate documentation.

## Inventory

| Area | Documents |
| --- | --- |
| Entry points and history | `README.md` and its screenshots in `docs/screenshots/`, `docs/README.md` (documentation index), `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `docs/CASE_STUDY.md` |
| Product, decisions and plans | `docs/DESIGN.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md` |
| Architecture and source map | `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION.md` |
| Hosting and deployment | `docs/SELF_HOSTING.md`, `docs/DEPLOYMENT.md`, `Dockerfile`, `compose.yaml`, `.env.example`, `deploy/k8s/`, `infra/` |
| Continuous integration | `.github/workflows/ci.yml` |
| PostgreSQL schema and restore | `docs/DATABASE.md` |
| Security and identity | `docs/IDENTITY_AND_SECURITY.md`, `docs/THREAT_MODEL.md`, `docs/PRIVACY.md` (the public instance's privacy notice) |
| Public-ready accounts and member removal | `docs/PUBLIC_TRIPS_AND_MEMBERS.md` |
| Create Trip destination defaults | `docs/TRIP_DESTINATION_DEFAULTS.md` |
| AI | `docs/AI_AND_AGENTS.md`, `docs/AI_KEYS.md` |
| Personal AI instructions and retired preference schema | `docs/AI_CUSTOM_INSTRUCTIONS.md`, historical `docs/AI_PREFERENCE_CONVERSATIONS.md` |
| Settings audit presentation | `docs/ACTIVITY.md` |
| Advanced settings, private feedback and issue-only daily triage | `docs/FEEDBACK.md` |
| AI pending-event edits | `docs/AI_PENDING_EVENT_EDITS.md` |
| Planning-time venue hours | `docs/AI_VENUE_HOURS.md` |
| Automatic public-fact research | `docs/AI_AUTOMATIC_RESEARCH.md` |
| Source-backed ordinary booking prices | `docs/AI_BOOKING_PRICES.md` |
| Private AI picture import | `docs/AI_IMAGE_INPUTS.md` |
| AI delivery recovery | `docs/AI_REQUEST_RECOVERY.md` |
| AI provider failures | `docs/AI_PROVIDER_FAILURES.md` |
| Private AI history | `docs/AI_CONVERSATION_HISTORY.md` |
| Communications | `docs/COMMUNICATIONS.md` |
| Calendar projection | `docs/CALENDAR_CONFLICTS.md` |
| Personal Calendar imports and venue lookup | `docs/CALENDAR_IMPORT.md` |
| Daily numbered map and server Maps setup | `docs/DAILY_MAP.md` |
| Disruption display and qualification | `docs/DISRUPTION_LOCALIZATION.md`, `docs/DISRUPTION_CONFIDENCE.md` |
| Flight status checks | `docs/FLIGHT_STATUS.md` |
| Event-local times | `docs/EVENT_LOCAL_TIME.md` |
| Trip expense ledger, repayments and entry | `docs/TRIP_EXPENSES.md`, `docs/MEMBER_PAYMENTS.md` |
| Mobile cards and cancelled-event removal | `docs/MOBILE_CARDS.md` |
| Screen layout | `docs/UI_LAYOUTS.md` |
| Localization and translation packs | `docs/LOCALIZATION.md`, `src/lib/locale-packs/` |
| Evidence and policy | `docs/SOURCES.md`, this file |
| Work queue | `docs/JOB_SYSTEM.md`, job records under `docs/jobs/` (new work starts at JOB-058; JOB-001 to JOB-057 are in a private archive) |
| Agent skill | `.agents/skills/stardust-job-runner/SKILL.md`, its `agents/openai.yaml` if interface metadata changes |

## Review questions

- Did a user-visible behavior, locale string, role, or workflow change?
- Did a command, dependency, environment variable, provider, port, or deployment assumption change?
- Did a schema, API contract, permission, privacy boundary, or cost field change?
- Did test coverage or a known limitation change?
- Did a job status, dependency, acceptance criterion, or verification result change?
- Does `README.md` still lead a new contributor to the correct current document, and does the [documentation index](README.md) list every document?
