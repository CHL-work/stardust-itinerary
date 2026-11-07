# Selected-language disruption details

## Display and evidence

Warning eligibility is filtered first by [high-confidence material-impact rules](DISRUPTION_CONFIDENCE.md). Only qualified exact-source observations reach the shared event/phone projection; translations do not qualify legacy or weak evidence. Migration 0039 adds an immutable observation policy version, separate from the localization contract below. Existing unqualified warnings remain stored but hidden pending scheduled recheck, not resolved.

Disruption details follow the route-selected UI language: English (`en`), neutral Hong Kong Cantonese (`zh-HK`), or Japanese (`ja-JP`). The spicy Cantonese selection deliberately uses the same neutral safety text, and the languages added in JOB-084 show the English text. Sources, checked time, affected services, uncertainty, negation and the advisory disclaimer remain intact.

The scheduled Sol/medium check emits all three variants alongside its sourced result. This is bounded extra output in the same logged request, not a new model request on page view or language switch. Localization changes neither the current-day/daily-future cadence nor the privacy exclusion of private/pending events.

Original observation `detail`, source URLs, fingerprint and timestamps are evidence, not translated display fields. Migration `0032_disruption_localizations.sql` adds `event_disruption_localizations`, keyed by `(trip_id, observation_id)` with a composite observation/item foreign key. `details` must have exactly three nonempty language keys, each at most 800 characters. `origin` records `monitor` or reviewed `maintenance`; rows reject update/delete. Translations are inserted transactionally with a new observation or filled against its existing ID when evidence is unchanged. Translation insertion is absent from fingerprint and notification identity calculations.

The overview read joins only the current exact observation behind existing event visibility checks. It capability-checks the table, so reads still work against a pre-0032 schema during a rolling upgrade. Invalid/missing translation data never discards otherwise valid sourced warnings. Non-English UI shows a localized unavailable message and collapsed original text; English labels its source-original fallback. New translated warnings use the chosen variant directly. Old offline snapshots still exclude disruptions entirely.

Translations do not count as renewed research. A stale or replaced observation's translations cannot attach to a different current warning. Stored translations are append-only: correcting an already stored translation requires a separately designed, authorized correction mechanism, not an ad-hoc evidence overwrite.

## Notification identity

Browser notification deduplication uses original warning content/state/reason/severity and episode, not the research evidence fingerprint. Original evidence remains immutable; alternate source links, inferred interval adjustments, translations and check timestamps do not cause another pop-up. Content-free browser receipts survive refresh/reopening and are serialized across tabs. See [communications](COMMUNICATIONS.md#current-local-browser-notification-subset) for the first-open baseline, failure behavior and device-local limits. Deduplication runs in the browser and needs no schema, translation, provider or cadence support.

## Existing-warning maintenance

`scripts/backfill-disruption-localizations.ts` accepts a **reviewed** JSON array from stdin. Each entry has `sourceHash` (lowercase SHA-256 of the exact UTF-8 stored original detail) and `localizedDetails` with `en`, `zh-HK`, `ja-JP`. Do not put real trip exports, credentials or warning bodies in Git. This command does not call a model or retrieve evidence.

The input is capped at 1 MiB/100 unique hashes. Each run selects at most 200 missing translations for current, fresh, trip-visible planned events at the same revision. Applying takes bounded shared locks on those warning/event rows, matches the exact source hash, and inserts `origin=maintenance` with conflict-do-nothing semantics. Original warnings, monitoring state, itinerary records and times are never updated. Re-running is safe; unmatched/stale/already-translated rows are skipped.

This is an explicit maintenance operation, not routine startup work. Running it against a production database needs the operator's explicit approval, an exact target review and a fresh backup (see [database](DATABASE.md)).

Run dry first against the reviewed target. The tool loads normal database environment settings (`DATABASE_DIRECT_URL` preferred over `DATABASE_URL`), refuses non-loopback URLs or query/fragment overrides, and writes only with both `--apply` and `--confirm-database=<exact decoded database name>`. A loopback URL can still reach a production database through a tunnel or port-forward, so passing the loopback check is not permission to write. Standard output contains counts only (`selected`, `matched`, `inserted`, `skipped`); errors do not echo source text or connection secrets. Use UTF-8 stdin for Cantonese/Japanese text. Never guess the confirmation name or bypass target guards.

## Verification

Unit tests cover complete/invalid locale maps, legacy evidence compatibility, bounded prompt instructions, fresh/unchanged-observation writes and unchanged notification fingerprints. Rendered tests cover every UI selection, untranslated fallback, escaped content, retained links/times and no render-triggered network work. Maintenance tests exercise input/target guards, dry-run, bounded selection/locking, exact source matching, append-only inserts, idempotency and rollback. The disposable PostgreSQL integration suite verifies the pre-0032 projection, migration upgrade/idempotency, strict shape/length constraints, composite identity, append-only behavior, and exclusion of old-observation translations.

The full gate is `pnpm check` with a newly created disposable loopback test database, confirmed by name through `TEST_DATABASE_CONFIRM_DESTROY`. Its build and smoke steps run locally; they neither deploy anything nor rewrite user itinerary data.
