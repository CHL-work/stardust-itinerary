# JOB-089: Blank-trip onboarding, remembered language and Google key setup

- Status: review
- Priority: P1
- Dependencies: JOB-064, JOB-085, JOB-087 (current shipped behavior)
- Claimant: Codex
- Branch: agent/JOB-089-onboarding-language-keys
- Started: 2026-11-08 UTC
- Authority: user requested these fixes and subsequently authorized GitHub push and GKE deployment after tests pass.

## Outcome and scope

Guests and accounts with no trip start at Create Trip, not a seeded demo. Guests cannot join real trips. Google sign-in never merges guest data into an existing account. English is the initial language, and explicit language choices persist across visits and sign-in. Google AI key entry distinguishes keys from optional Vertex configuration and provides actionable safe errors.

Keep guest expiry, purge isolation, account identity, exact membership, current AI funding, encrypted key storage and bounded provider validation. Deployment uses the existing release workflow; no infrastructure changes, real test records, imported keys or paid provider calls.

## Acceptance and verification

- Synthetic unit/database coverage of empty guest onboarding, guest trip creation and blocked joining; existing accounts remain untouched on guest sign-in.
- Language selection persists on account and browser, including onboarding and login; no browser-wide translation packs.
- Google credentials validate the selected documented API mode, never confuse project ID with a key, and never expose secrets in errors.
- Run relevant tests, disposable database integration, lint, type checking, build and smoke. Record evidence and limitations before review.

## Contracts

[Identity](../IDENTITY_AND_SECURITY.md), [members](../PUBLIC_TRIPS_AND_MEMBERS.md), [localization](../LOCALIZATION.md), [AI keys](../AI_KEYS.md), [design](../DESIGN.md).

## Handoff

Implemented and locally verified. Release through the existing CI-gated main workflow is authorized; check its result before claiming the release is live.

- All 254 unit test files / 5,958 tests passed. Disposable PostgreSQL integration, typecheck, build and smoke passed. Lint has no errors (one pre-existing warning in an ignored local screenshot helper).
- Browser verification used synthetic local data: English initial screen, remembered French selection, empty guest itinerary, zero seeded events, and all three Google key forms. Feedback now follows onboarding's selected language too.
- Independent review covered guest admission/isolation, account-language authorization and key-mode transitions. No real Google login, provider key or billable provider request was used; actual key acceptance remains subject to Google's key/API configuration.
- Checked 314 relative documentation links/anchors with no broken targets; whitespace and secret/private-identifier review passed.
- Guest sign-in never transfers data, even to a new Google account. An unused guest creation grant expires after 15 minutes; restarting guest onboarding is required afterward. Guest records still expire at their original 24-hour deadline.

### Migration and rollback

0065 adds nullable account language; 0066 adds an explicit Vertex express flag defaulting to false. Neither rewrites existing trips or credentials. Preserve both migrations on rollback. Older code ignores language, but cannot route a newly saved express key: after any express save, retain an express-aware image or have the user replace it with another supported Google mode. Existing Secret Manager/KMS recovery rules still apply.

### Documentation impact

Updated README, CHANGELOG, CASE_STUDY, DESIGN, DECISIONS, ROADMAP, ARCHITECTURE, IMPLEMENTATION, SELF_HOSTING, DEPLOYMENT, DATABASE, IDENTITY_AND_SECURITY, THREAT_MODEL, PRIVACY, PUBLIC_TRIPS_AND_MEMBERS, LOCALIZATION, UI_LAYOUTS, AI_KEYS, SOURCES, `.env.example` and the jobs index.

Reviewed and unaffected: documentation index/screenshots (no existing onboarding/key screenshot), agent/job rules and skill, container/Compose/GKE/infrastructure/CI configuration, destination lookup, AI planning/memory/research/images/history/recovery/funding contracts, custom instructions and retired preferences, activity/feedback data policy, communications, Calendar, maps, weather/disruptions/flights, expenses/repayments and mobile cards. No documentation deferred. The feedback change only corrects language selection, not report capture or publication behavior.
