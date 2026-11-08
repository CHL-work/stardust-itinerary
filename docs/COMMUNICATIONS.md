# Notifications and communication boundaries

PostgreSQL is canonical. Current delivery consists of optional open-page disruption notifications and the separately configured [feedback issue publisher](FEEDBACK.md). A Discord trip bot, route/leave-by reminders and reliable closed-app push are not implemented.

## Current local browser-notification subset

Here "local" means device-local: an open Stardust page in the member's browser shows these notifications; there is no server push.

Warnings come from the disruption monitor, whether the operator's keys or a member's own key paid for the check ([routine checks](AI_TAB.md#routine-checks-on-your-own-key)). Only [qualified disruptions](DISRUPTION_CONFIDENCE.md) can display a badge or notify: high-confidence official evidence of direct meaningful impact, including supported delays of at least 30 minutes, cancellation, closure or blocked access. Broad weather/network notices, possible/info rows and legacy unqualified observations stay quiet. The model cannot send a notification or change the itinerary directly.

After explicit browser permission, an open Stardust page receiving a new or updated warning during its normal refresh may show up to three tagged notifications through the registered service worker. Selecting one focuses or opens the same-origin app. Text follows the selected locale; both Cantonese modes use neutral safety language. The in-app detail remains authoritative and includes the check time, sources and uncertainty disclaimer.

### Deduplication and privacy

- Identity uses trip/member/event, original warning detail (NFKC/case/whitespace normalized), episode `firstSeenAt`, state, reason and severity. A meaningful original-content/classification/severity change or new episode can notify once.
- Check/last-seen/stale timestamps, source URLs, translations, title, evidence fingerprint, observation ID and interval bookkeeping do not reset notification identity. Updated impact/timing must be represented in original warning content.
- `stardust-disruption-receipts-v1` holds at most 4,096 SHA-256 baseline/receipt keys and timestamps, never raw identifiers, warning text, email, prompt or URL. It survives sign-out solely for deduplication and grants no read access. Private itinerary snapshots and shell caches are still cleared normally.
- Web Locks serialize tabs. A receipt is reserved before display; a rejected display can release it for a later refresh. A crash can miss an optional alert, so exactly-once OS delivery is not guaranteed.
- First arrival quietly baselines existing warnings. Denied/default permission baselines rather than queuing a later burst. Missing storage, hashing, locking or service-worker support fails quietly instead of repeatedly notifying.
- Clearing/eviction, private browsing, bounded-ledger pruning or another browser/origin/device can reset local receipts. No cross-device delivery synchronization exists.

There is no Push API subscription, VAPID key, server delivery queue, guaranteed closed-app wake or offline-origin notification delivery. Browser/OS power and background restrictions still apply.

## Health checks and feedback

`GET /api/health` reports database readiness (HTTP 200, or 503 when the database is unavailable) for the deployment's own probes. Uptime alerting belongs to the deployment, not the application, and is separate from traveler notifications.

[Feedback](FEEDBACK.md) uses private reports, redacted review and an issue-only deterministic publisher for one fixed GitHub repository. New reports disclose eligibility; historical opt-outs remain excluded. Immutable delivery markers and bounded read-only reconciliation handle uncertain POST outcomes. No automated code-fixing agent, issue edits/comments, pull request or deployment follows.

## Future integration constraints

A Discord projection, route/leave-by reminders and pre-trip readiness checks are planned, not implemented (see [roadmap](ROADMAP.md)). Any implementation must follow these constraints:

- Discord is a projection, never a second itinerary/database. Reconciliation must prefer canonical authorized app state.
- Restrict a bot to explicitly selected private channels and minimum permissions; never request administrator access. Keep credentials server-side.
- Prefer one editable daily summary, with event threads only when useful. Include [location-local event times](EVENT_LOCAL_TIME.md), known transport endpoints and authorized app/map links; do not disclose private instructions or hidden events.
- Outbound integration work requires a transactional outbox, bounded retries, idempotency and visible failure handling. Incoming actions require signature/replay checks and normal member/trip authorization.
- Keep commands narrow; complex edits return to the app. Channel/mention/quiet-hours routing, Telegram and closed-app web push are not current user settings.
- Safety, financial and consent text stays neutral and understandable in every supported locale.
