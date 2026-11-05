---
id: JOB-068
title: Daily off-site copy of the database in Neon
status: review
priority: P1
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-05T09:10Z
---

## Outcome

On 5 November 2026 the owner asked whether the database was backed up in Neon and, if not, to back it up there within Neon's free plan.

It was not. The daily backups were age-encrypted dumps in a Cloud Storage bucket of the same Google Cloud project, so they would be deleted with the project, for example 30 days after an unpaid free trial ends ([deployment](../DEPLOYMENT.md#operations)).

Decision: [D-083](../DECISIONS.md#d-083-a-daily-off-site-copy-in-neon-accepted-november-5-2026).

## Delivered

1. **`scripts/db/offsite-copy.mjs`** (container mode `offsite-copy`):
   - Opens one read-only snapshot, counts every table's rows in it, and dumps it with `pg_dump --snapshot`.
   - Creates `<prefix>_YYYYMMDD_HHMMSS` (UTC) on the off-site server and restores into it in one transaction, without owners or privileges, so an ordinary role with CREATEDB is enough.
   - Compares every table's row count with the snapshot, then marks the copy verified in its database comment.
   - Retention:
     - Drops unverified leftovers once they are two hours old.
     - Drops the oldest verified copies beyond `STARDUST_OFFSITE_KEEP` (default 3).
     - Refuses to start a copy that would not fit `STARDUST_OFFSITE_MAX_MB` (default 500) next to the newest copy. In that case it drops no verified copy.
   - Requires TLS with certificate checks against the system's roots, and honours `channel_binding=require`. Each PostgreSQL tool gets only its own side's credentials.
   - Logs one JSON line, and only the first line of a tool's error, which never quotes a command or row.
   - Does nothing when `STARDUST_OFFSITE_DATABASE_URL` is unset or empty.
2. **Kubernetes:**
   - CronJob `stardust-offsite-copy` runs daily at 19:00 UTC, after the 18:30 backup.
   - It has its own service account, and mounts only the administrator password and the new `stardust-offsite-env` secret.
   - A NetworkPolicy allows only the database, DNS and port 5432 on public addresses.
3. **Infrastructure:** the `stardust-offsite-env` secret, readable only by the new service account, plus that account's grant on the administrator password (`infra/main.tf`).
4. **Off-site server for the public instance:**
   - A dedicated Neon free-plan project in Singapore, the nearest region to Tokyo, on PostgreSQL 17, with its compute fixed at 0.25 CU.
   - Its direct (not pooled) connection string went from the Neon console's copy button into Secret Manager without being displayed.
5. **Docs:** [deployment](../DEPLOYMENT.md), [self-hosting](../SELF_HOSTING.md), [database](../DATABASE.md), [privacy notice](../PRIVACY.md), [threat model](../THREAT_MODEL.md), decisions, roadmap, sources, the README diagram, the case study and the changelog.

## Free-plan fit

Neon's free plan, as published on 5 November 2026 ([plans](https://neon.com/docs/introduction/plans)), allows per project:

- 1 GB of storage;
- 100 CU-hours of compute a month;
- 5 GB of public network transfer;
- a 6-hour restore window.

An idle compute is suspended after 5 minutes. Going over a limit suspends the compute or makes writes fail; it deletes nothing.

- **Storage:** each copy is about the size of the database. Three copies of today's database are far below 1 GB, and the job keeps all copies within 500 MB.
- **Compute:** one run a day keeps a 0.25 CU compute awake for a few minutes, about 1 CU-hour a month.
- **Transfer:** restores flow into Neon; only row counts come back.

## Verification

- **Unit tests** (`src/lib/db/offsite-copy.test.ts`) cover:
  - copy names;
  - option bounds, including prefixes that could match other databases;
  - retention, including stale leftovers, room-making, and no drops when even the newest copy leaves no room;
  - TLS rules, and refusing the source database;
  - the tools' scrubbed environments and first-line errors;
  - count comparison;
  - the job's identity, mounts, network policy and grant.
- **Locally**, on a disposable PostgreSQL 17 with synthetic data (migrations plus the demo fixture), against a non-superuser role with CREATEDB:
  - four runs kept the newest three verified copies;
  - a too-small budget and a failing restore left every verified copy in place, and left no partial copy;
  - an unset URL did nothing.
- **Against Neon before deploying:** two synthetic runs from a workstation into the real project under a test prefix, which the production job ignores. Both passed with TLS certificate checks and channel binding, on PostgreSQL 17.11, and the test copies were then removed.
- **After the deploy:** a manual run on the public instance (pending).

## Rollback

Delete the CronJob or add a `stardust-offsite-env` version with an empty `STARDUST_OFFSITE_DATABASE_URL=`; reverting the code removes the job. The copies already in Neon stay until they are dropped there. No migration or application change is involved.
