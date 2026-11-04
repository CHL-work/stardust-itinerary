# Database Contract

Current schema, transaction and recovery constraints. Where PostgreSQL runs, how backups are scheduled and how a release applies migrations are hosting choices described in [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md). This file does not authorize migrating, restoring or seeding any particular database.

## 1. Scope and invariants

Standard PostgreSQL 17 is canonical. The web runtime connects with `DATABASE_URL`; migrations, workers and maintenance tools use `DATABASE_DIRECT_URL` when it is set and otherwise `DATABASE_URL`. Outside local development, give the web runtime a role that is not a superuser, schema owner or migration writer, and keep migration credentials out of the web environment.

| Area | Current tables / purpose |
| --- | --- |
| Identity/admission | `app_users`, `oidc_identities`, `auth_sessions`, `auth_account_sessions`, `auth_rate_limits`, `member_claim_links`, `trip_join_links`, `account_trip_creations`. |
| Trip/events | `trips`, `trip_members`, `member_permissions`, `trip_days`, `itinerary_items`, `itinerary_item_viewers`, `itinerary_revisions`. |
| Money | `expenses`, `expense_splits`, `expense_revisions`, `member_payments`, `member_payment_revisions`, `member_payment_actions`. |
| Review/history | `change_requests`, `audit_events`, `outbox_events`, `delivery_attempts`. Outbox schema does not imply every proposed delivery integration exists. |
| Planning AI | `trip_ai_settings`, `ai_requests`, `ai_request_events`, `ai_conversations`, `ai_conversation_checkpoints`, `ai_request_images`. |
| Account AI | Manual instructions/revision on `app_users`; immutable terminal `account_ai_lookups` for destination defaults, separate from trip logs. |
| Calendar | `calendar_connections`, `calendar_event_links`, `calendar_import_receipts`. |
| Derived context | Weather forecasts/runs/member leases; disruption settings/runs/check state, immutable observations/localizations and current projection. |
| Feedback | `feedback_reports`, `feedback_triage_runs`, `feedback_triage_items`, `feedback_issue_outbox`, `feedback_events`. |

Structured preference/catalog/import tables were deliberately dropped by 0049. Do not recreate them to satisfy an old document or run retired import scripts. Existing preference-purpose conversations remain closed/read-only; ordinary history/checkpoints/audits remain.

Important enforced rules:

- Trip-scoped composite references prevent cross-trip linking. Active role/membership, target visibility and revisions are rechecked before writes; last active bound owner cannot be removed.
- Canonical private event audience is creator plus selected viewers, with no owner bypass. Linked expenses cannot widen it; deferred checks protect payers/splits. Existing-target request reads intersect retained effective audience and current visibility. Private itinerary create/update owner review is proposal-only.
- Active/invited/disabled members reserve capacity; removed tombstones do not. Admission locks the trip and atomically consumes/exhausts links. No deletion of history to free a seat.
- Money uses integer minor units per currency. Exact shares are nonnegative, uniquely cover selected members and sum to the positive total; deterministic equal split is default. Pending/draft/void records do not enter posted totals. Repayments adjust balances, not spending.
- Trip deletion (0052) marks `trips.deleted_at` and moves every invited, active or revoked membership to terminal `trip_deleted`, keeping the prior status in `status_before_trip_deletion`. It erases no history, and a trigger refuses usable memberships on a deleted trip. Plain `DELETE FROM trips` still fails by design. Restoring is an operator action: see [Restoring a deleted trip](#restoring-a-deleted-trip).
- Member removal explicitly reassigns financial responsibility, retains immutable actual-payment facts/audit/AI identity and invalidates dependent actionable proposals. It cannot erase debt or expose inaccessible private expenses.
- Event/proposal revisions, immutable history/audit rows and current participant checks prevent stale approvals. Approved review is terminal; rejected requests can be reconsidered only after fresh checks.
- Weather is disposable revision-bound role-specific cache. Disruption current rows must exactly reference/mirror their immutable same-item observation; qualification policy, freshness and audience determine display.
- AI requests bind exact immutable users; system work has explicit system attribution, not an impersonated owner. Request fences and idempotency prevent late/duplicate writes; provider I/O holds no transaction.
- Calendar receipts bind verified account/member/source identity and preserve duplicate prevention through approval. Feedback terminal/outbox history and old publication opt-outs remain immutable.

## 2. Migration contract

The repository contains **50 SQL files through `0054_user_ai_credentials.sql`**. Numbering gaps 0045–0048 are intentional historical separation, not a request to invent replacements.

`scripts/db/migration-lib.mjs` sorts unique `NNNN_name.sql` files, takes an advisory lock, validates every applied SHA-256 against `app_schema_migrations`, runs each missing migration in its own transaction and records it only after success. A missing applied file or changed checksum is a hard failure. Never edit an applied migration; add a forward migration.

Checksums are taken over raw file bytes, so line endings matter. `.gitattributes` keeps `database/migrations/*.sql` as LF in every working tree; do not normalize or re-save old SQL. `pnpm db:migrate` applies pending migrations with `DATABASE_DIRECT_URL` (or `DATABASE_URL`). Migrations issue no grants: when the web runtime uses a separate role, re-apply its grants after migrating so new tables are not silently inaccessible.

### Compatibility checkpoints

| Migration / feature | Recovery implication |
| --- | --- |
| 0012–0013, 0027–0031 | Effective-audience snapshots, pending visibility and proposal-only private owner review are security semantics, not interchangeable function versions. |
| 0018–0019 | Explicit transport endpoints preserve departure/destination; dropping them loses data. Generic location is non-transport-only. |
| 0020–0025 | Weather/disruption observations, exact current-observation integrity, per-member refresh leases and endpoint weather roles. |
| 0026, 0028, 0030 | Pending optimistic versions, last-selected trip and editor review defaults. |
| 0032–0035 | Observation-bound translations, durable AI completion envelopes, irreversible identity closure/history purpose and private image attachments. |
| 0036–0038 | Account onboarding, safe member-removal tombstones and owner-removed cancelled-event state. |
| 0039 | Immutable disruption qualification version; old unqualified warnings are hidden, not deleted/resolved. A rollback must not redisplay them as current qualified warnings. |
| 0040–0041 | Repayments and removal reassignment preserve historical actual parties while changing accounting responsibility. |
| 0042 | Durable Calendar import receipts; deleting receipts/links can re-enable duplicates. |
| 0043–0044 | Immutable conversation purpose; feedback triage/outbox/publication-consent history. |
| 0049 | **Destructive preference retirement**. Pre-0049 builds are not compatible rollback targets. No automatic conversion to manual instructions; history remains read-only. |
| 0050 | Additive account-private destination lookup audit/cache; terminal rows finish once, are not deletable and do not enter trip-owner AI logs. |
| 0051 | Moves current trip AI selections and defaults to the newest models; audit rows keep the model that ran and checks accept both Sol IDs (`gpt-5.6-sol`, `gpt-6.1-sol`). Older builds lack registry entries for the new owner selections, so a code rollback must first map `trip_ai_settings` back to identifiers that build knows (the inverse of the mapping in `0051_model_refresh.sql`). |
| 0052 | Additive trip deletion state (`deleted_at`, terminal `trip_deleted` memberships with their prior status). Every access path requires an active membership, so an older build keeps deleted trips hidden; reopen a trip only with the procedure below. |
| 0053 | New AI requests default to `authentication_mode = 'api_key'` and `billing_basis = 'api'`; account lookups accept `api_key` alongside the historical `chatgpt_subscription`. Older builds still insert their own explicit values, so the change is rollback-compatible. |
| 0054 | Additive `user_ai_credentials` (encrypted per-user provider keys, deleted with the account) and nullable `ai_requests.credential_source`. Older builds ignore both; keys saved meanwhile simply go unused by them. |

Owner-editable trip dates changed no schema: retained day IDs remain, but current-range guards are required. After date edits, an older range-unaware build may be schema-compatible but behaviorally unsafe. Prefer a forward fix; never alter real dates or restore old data to fit old code.

## 3. Commands and safe targets

`pnpm db:migrate` loads local configuration and writes its target; `db:seed`, `db:seed:local-trip`, bootstrap and maintenance scripts also mutate data. Their existence is not authorization to run them. During development use a local database with synthetic data, never a database holding real trips.

Before migrating a database that holds real data: take a backup and prove it restores (section 4), confirm the exact target, migrate with the migration identity, re-apply runtime grants if needed and check `/api/health`. Never print connection strings, tokens, private prompts or dumps.

## 4. Dump and restore contract

Real dumps are private data and are never committed, attached to issues or placed in public artifacts. Use PostgreSQL 17 `pg_dump` (custom format for backups) and keep backups encrypted at rest. A checksum or TOC listing alone does not prove restoreability: perform a full restore into an isolated database and compare schema/migration inventory plus all-table counts or digests, accounting for PostgreSQL's normalized constraint output. CI also checks that a plain-format dump of its test database restores into a fresh database.

Backup frequency, retention and storage location are deployment choices ([self-hosting](SELF_HOSTING.md), [deployment](DEPLOYMENT.md)). Restoring a dump replaces every write made after it; never restore an old dump over newer user writes as a routine rollback.

### Restoring a deleted trip

There is no in-app undelete. A database operator can reopen a deleted trip in one transaction; members come back with exactly the status they had before deletion:

```sql
BEGIN;
UPDATE trips SET deleted_at = NULL, deleted_by_member_id = NULL WHERE id = :trip_id;
UPDATE trip_members
   SET status = status_before_trip_deletion, status_before_trip_deletion = NULL,
       current_revision = current_revision + 1
 WHERE trip_id = :trip_id AND status = 'trip_deleted';
UPDATE trip_disruption_settings
   SET enabled = (SELECT (metadata->>'disruptionChecksEnabled')::boolean
                    FROM audit_events
                   WHERE trip_id = :trip_id AND action = 'deleted'
                   ORDER BY created_at DESC LIMIT 1)
 WHERE trip_id = :trip_id;
COMMIT;
```

Deletion also revoked the trip's sessions and open claim/join links, deleted its Calendar connections and event links, failed in-flight AI requests and cleared members' last-selected trip. The restore does not bring those back: members sign in again, owners issue new invitations, and members reconnect Calendar. `tests/database/trip-deletion.mjs` exercises this procedure.

## 5. Tests

`pnpm test:db` is **destructive to its explicit test database**. It refuses non-loopback hosts, demands `TEST_DATABASE_CONFIRM_DESTROY` exactly equal the database name, requires a test/disposable name outside CI and rejects either configured application database. These are safeguards, not substitutes for verifying the actual target.

Create a unique disposable database first, set process-only test variables, run the suite, and remove only that exact successfully created database afterward. Never reset an existing database as a convenience. Record skips truthfully: no configured test database means no database verification. No secrets/dumps in console output.

Tests cover migration idempotency/checksums, upgrades, permissions/private audiences, concurrency, exact money, membership/session lifetime, pending/review semantics, request recovery, Calendar receipts, destination lookups and trip deletion. Historical AI evaluation scripts may deliberately migrate only through a pinned older schema; they require their own fresh databases and do not prove latest-schema compatibility. [AI evaluation boundaries](AI_AND_AGENTS.md#11-evaluation).

## 6. Upgrades and rollback

Prefer forward fixes. A code rollback must remain compatible with every applied migration (see the compatibility checkpoints); never drop tables, delete history or rewrite applied migrations to fit older code. Schema compatibility alone does not make an older build behaviorally safe.

## 7. GitHub versus data backups

Git contains source, immutable migration files, redacted fixtures and recovery procedures—not real database dumps, private receipt attachments, provider credentials or live environment files. Git history preserves retired designs; backups preserve data. Neither is a substitute for the other.
