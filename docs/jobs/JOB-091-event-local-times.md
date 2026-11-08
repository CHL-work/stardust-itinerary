# JOB-091: Location-local clocks for every event

- Status: review
- Priority: P1
- Dependencies: shipped JOB-090
- Claimant: Codex
- Branch: agent/JOB-091-event-local-times
- Started: 2026-11-08 UTC
- Authority: implement location-local times for all event types, compare the existing free-model transport with the referenced public project, and update existing documentation. The owner subsequently approved GitHub push and GKE deployment after tests pass; no separate handover document is wanted.

## Scope

Hotels, meals, activities, notes and transport endpoints use their location's IANA time zone, not automatically the trip's starting zone. Preserve UTC instants, deterministic duration, private audiences, review, revisions and financial dates. Resolve location evidence locally where possible; expose an explicit correction and an honest trip-time fallback for unknown places. Do not guess or rewrite old booking instants.

Keep this work in an isolated worktree; the owner clarified that the other agent has not started yet. Do not change AI funding or free-provider access; document the comparison only. No real trip mutations, paid model calls or infrastructure changes for tests.

## Verification

Final `pnpm check` passed: lint, types, 6,203 unit tests across 264 files, disposable-PostgreSQL migration/integration checks, production build and smoke. Coverage includes cross-zone hotel/meal/transport, date-boundary/DST, editing, pending/approval, Calendar, Activity and offline display. A mocked planner accepts a human-style late-night SLC request while separately enforcing venue date and trip bounds. Independent review confirmed private-audience and UTC-preservation behavior.

All 384 relative documentation links/anchors checked; the pinned locality generator reproduces its output (157,492 bytes gzip, below the 180 KB cap), the changed-file secret scan and `git diff --check` passed. No live-model quality claim follows from mocked tests or the metadata-only free-model comparison.

Release uses the existing authorized `main` push → CI → GKE pipeline, including its pre-migration backup and public health check. GitHub Actions is the release-status source of truth; this job is kept in review for human acceptance, not as a duplicate deployment journal.

Actual-component synthetic preview checked at desktop, 390px and 320px: SLC hotel/meal/pending clocks and the editor use Denver, transport endpoints differ correctly, unknown places label Trip time, no horizontal overflow. No production trips or paid inference used. Temporary preview stopped; no permanent local app enabled.

## Documentation impact

- Updated the concise [event-time contract](../EVENT_LOCAL_TIME.md), source/DB/code maps, Calendar/AI/venue-hours/flight/map/offline/mobile/Activity/localization contracts, decisions, roadmap, index and changelog. Corrected stale trip-zone wording and Secret Manager activation status. GeoNames attribution and reproducible generation checks accompany the data.
- Reviewed the remaining inventory: entry rules/agent skill, hosting/CI/infra, identity/privacy/security, account/member/funding/keys, feedback, AI history/recovery/failure/instructions/prices, disruptions and expense/repayment rules are unchanged. No new credentials, services, scopes, funding, quota or private-data export.
- No deferred documentation or separate handover document. `AGENTS.md` → `docs/README.md` / feature contracts remains the agent entry point; the existing repository job skill remains valid.

## Compatibility

Migration 0067 is additive; existing instants are untouched. Keep a zone-aware writer and the migration after corrections are saved; use a compatible forward fix rather than an older writer that ignores the metadata. Detailed limits and rollback are in the [contract](../EVENT_LOCAL_TIME.md#storage-and-compatibility).
