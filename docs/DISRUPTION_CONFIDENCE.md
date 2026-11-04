# High-confidence, meaningful disruption warnings

The backend disruption monitor raises only actionable attendance advisories, not a general travel-news feed. Ordinary deterministic weather icons and forecasts are separate.

A deleted trip has its checks disabled and is excluded from the worker's due query.

## When a warning qualifies

The monitor runs Sol (`gpt-6.1-sol`) at medium effort with live hosted search. It extracts a bounded `impactAssessment`: source authority, qualitative confidence, event/transport match, affected public entity, effect, supported minimum delay, short evidence facts and whether the incident is explicitly ongoing. Structured output is not proof that the facts are true. Application code in `src/lib/disruptions/eligibility.ts` independently enforces the following applicability rules:

- `confirmed`, warning/critical severity, high confidence and an official issuing source with supporting public URL and facts are required. Possible, low/medium-confidence, informational, nearby/unknown matches and legacy output without assessment stay quiet.
- Evidence must identify the venue or an explicitly planned transport service. A station serving a shop/hotel district does not establish the traveler's route. Network/road/strike notices cannot attach to non-transport events; endpoints alone cannot identify a planned line. Address/district substrings are not exact venue matches, and an endpoint name alone is not a service.
- Confirmed cancellation, unavailability or blocked access qualifies without an invented delay. Other delays/schedule changes require a source-supported **minimum of 30 minutes**. “May be delayed,” “up to 30 minutes,” reduced frequency without a supported minimum, and minor inconvenience are insufficient.
- Weather must directly cause event/venue cancellation, closure or blocked access. Ordinary rain, a district-wide advisory and merely being near an affected area do not qualify. Normal hotel key/intercom procedures and non-blocking lodging schedule notices remain quiet.
- The source-supported interval must overlap the event. Known ends are exclusive; an unknown end is checked at the known start without inventing a duration. A live, explicitly ongoing incident without an announced end may apply only to an event happening now or starting within 30 minutes. Future events otherwise need a known overlapping interval. Missing bounds are not blanket evidence for all dates.

The model must not invent entities, source authority, delay lower bounds or time coverage to pass this gate. Ambiguous aliases or insufficiently specific stored venue/service names may be suppressed. Officialness and real-world source truth still depend on correct source extraction: this is stricter advisory filtering, not independently verified certainty, a calibrated probability or guaranteed disruption detection. Users should still check official links before changing plans.

## Persistence, display and phone alerts

Migration `0039_disruption_qualification.sql` adds `qualification_policy_version` to immutable `event_disruption_observations`. Existing/old-worker inserts default to zero; new accepted evidence is version one. Current-warning and monitor-prior-warning reads bind the exact source observation and require version one, confirmed state, warning/critical severity, matching event revision and freshness. Both event cards and optional phone notifications consume this filtered projection. There is no second client-side reconstruction of suppressed warnings.

Legacy evidence is hidden pending the normal scheduled recheck, **not deleted, relabeled as resolved or silently promoted**. A qualifying recheck appends a new version-one observation even when legacy text/fingerprint is identical. Same-reason/revision episode timing is retained; policy version and observation identity do not become notification identity, so upgrading alone does not trigger a new pop-up.

Successful researched responses retain parsed claims, assessment facts, policy version and content-free suppression reasons in the existing owner-visible AI audit. A weak, omitted or failed result never renews an existing warning's TTL and is not affirmative recovery. Qualified existing warnings expire normally unless fresh qualifying evidence renews them. Resolution still requires the exact qualified current warning, matching reason/source host and the existing affirmative-evidence/revision checks. The gate does not edit trip events or propose cancellations.

## Monitor boundaries

- `gpt-6.1-sol`, medium effort; no model switch or extra page-load call.
- Backend-only checks: current-trip-date events at the configured 30-minute default, later seven-day events once per rolling day, staggered in bounded batches with leases/deadlines. The deployment's scheduler (for example cron or a Kubernetes CronJob) runs `pnpm monitor:disruptions` periodically; each run handles a small bounded batch, and the database decides which checks are due.
- Private, pending, cancelled and completed events are excluded from external disruption research; public payloads are privacy-sanitized.
- Selected-language neutral safety text, append-only [translations](DISRUPTION_LOCALIZATION.md), open-app notification permission and persistent device-local [deduplication](COMMUNICATIONS.md#current-local-browser-notification-subset) apply. There is no reliable closed-app push.
- The qualification gate does not affect weather refresh, calendar conflicts, AI trip planning, owner approvals or expense math.

## Upgrade, rollback and verification

Migration 0039 is additive. The read gate tolerates the old schema by treating a missing version as zero, so an upgrade cannot expose unqualified legacy rows. Do not rewrite old observation evidence or qualification metadata. Downgrading to an old reader would re-expose weak warnings; retain the read gate on any application rollback. Complete backups include the column normally. Deploy and recover with [deployment](DEPLOYMENT.md) or [self-hosting](SELF_HOSTING.md); backup, restore and migration rules are in [database](DATABASE.md).

Synthetic tests cover closure/delay positives, nearby network/weather/routine-access negatives, confidence/source/entity/time failures, nullable ends and ongoing limits. Worker tests cover mixed accepted/suppressed results, raw-claim audit, unchanged-warning freshness, legacy requalification and affirmative resolution. Projection/notification tests cover common filtered input and retained deduplication. Disposable PostgreSQL integration tests verify migration upgrade/idempotency/defaults/constraints, immutable history, exact observation/localization identity and privacy/freshness/revision gates. Testing needs no real event, expense or notification writes.

The [official OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) explicitly distinguishes schema adherence from factual correctness. It informed structured facts plus application-side validation and synthetic cases; these specific thresholds are Stardust product policy, not provider guarantees.
