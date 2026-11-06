---
id: JOB-069
title: Admin page, account suspension, a daily sign-up cap, and users' AI keys sealed by Cloud KMS
status: done
priority: P1
depends_on: [JOB-061, JOB-064]
claimant: CHL-work
branch: main
started: 2026-11-06T09:20Z
---

## Outcome

On 6 November 2026 the owner asked:

- whether Stardust had any process to prevent spam;
- how users add their API keys;
- that, ideally, the owner should not be able to view users' keys, so that users finding out what the admin can see would not be a bad look;
- for a way to monitor who uses the platform and what they do.

The answers at the time:

- **Spam:** sign-up was Google-only, guests passed Turnstile, and there were rate limits. There was no way to block an account short of editing the database, no cap on daily sign-ups, and no lifetime cap per account.
- **Keys:** users add them in Settings → AI keys. The server checks each key and seals it with AES-256-GCM under a key ring kept in the operator's Secret Manager, so the operator could technically decrypt every saved key.
- **Monitoring:** nothing existed besides the operator's feedback review.

The owner chose:

- Cloud KMS for the keys, with users told plainly how it works;
- an admin page with an account list, activity, a suspend button and a daily sign-up cap.

Decision: [D-084](../DECISIONS.md#d-084-an-admin-page-suspension-a-sign-up-cap-and-keys-sealed-by-cloud-kms-accepted-november-6-2026).

## Delivered

1. **Admin page** (`/admin`): only the platform operator, identified by `OWNER_GOOGLE_EMAIL` through a verified Google identity, can open it. Everyone else gets a 404, and its APIs answer 403. It shows metadata and counts only, never trip names or contents, prompts, replies, places, expenses or keys.
   - **Overview:**
     - Google accounts and new sign-ups;
     - active users over 1, 7 and 30 days;
     - current guests and suspended accounts;
     - trips;
     - AI requests today, over 7 days and over 30 days, split by who paid (the user's own key, a shared key, or the operator's) and by provider;
     - refused and failed AI requests;
     - refused attempts by kind;
     - a table of the last 14 UTC days.
   - **Accounts**, searchable and filterable (all, Google, guests, suspended):
     - name and email (none for guests);
     - sign-up date and last activity;
     - trips owned and joined;
     - which providers have a saved key;
     - AI requests in the last 7 days by who paid;
     - refused attempts.
   - **Account details:**
     - recent sessions, with the device type only;
     - the account's trips by role, member count, event count and age, without names;
     - daily activity over 30 days;
     - recent actions from the trip audit log (record type and action only);
     - suspensions.
   - **Settings entry:** a card in Settings → Advanced, rendered only after the server confirms the operator.
   - Localized in English, Cantonese (both modes, neutral wording) and Japanese.
2. **Suspension:** suspending an account takes effect in one transaction:
   - it revokes every session and unused onboarding grant;
   - sign-in, invitations and existing sessions are refused (`verifySession`, `rotateSession`, onboarding and the Google callback);
   - keys the account shared stop paying for its trip members.

   Restoring it reverses the refusals; revoked sessions stay revoked. The operator's own account cannot be suspended. Both directions go into `operator_audit_events`.
3. **Daily sign-up cap** on new accounts from public Google sign-up:
   - 50 by default; 0 pauses sign-ups, and no value removes the cap;
   - changed on the admin page;
   - invitations and existing accounts are never counted or refused;
   - a refused sign-up sees "New sign-ups are paused for today", and the refusal is counted.
4. **Counters** (`platform_daily_counts`), per UTC day and kept for 90 days:
   - public sign-ups and guests started;
   - attempts refused by any rate limit, the daily trip limit, the feedback limit or the sign-up cap, with the account when there is one.
5. **Users' keys sealed by Cloud KMS**, when `CREDENTIAL_KMS_KEY` is set:
   - New keys go to KMS (`src/lib/ai/credential-kms.ts`) with the same user-and-provider binding as before, and CRC32C checks on every request and response.
   - The web server acts as a dedicated service account. It gets its Kubernetes identity's token from the metadata server, which only the web pod may reach.
   - An IAM deny policy refuses KMS encryption and decryption to every other principal, project owners included. Data Access audit logs record every use.
   - `credential-reencrypt` first seals and opens a synthetic value, then moves keys saved under the local ring into KMS, and opens each KMS-sealed key once to prove that the server can.
   - Settings tells users which protection applies, and advises a dedicated, spend-limited key. Self-hosted instances keep the local ring unless they configure KMS.
6. **Infrastructure** (`infra/main.tf`): the key ring and key (software protection, yearly rotation), the `stardust-credentials` service account and its two grants, the deny policy, and KMS Data Access logging. The GKE overlay adds the `web-metadata-egress` NetworkPolicy.
7. **Docs:** [privacy notice](../PRIVACY.md), [threat model](../THREAT_MODEL.md), [identity and security](../IDENTITY_AND_SECURITY.md), [database](../DATABASE.md), [deployment](../DEPLOYMENT.md), [self-hosting](../SELF_HOSTING.md), [public trips and members](../PUBLIC_TRIPS_AND_MEMBERS.md), the architecture and implementation maps, decisions, roadmap, sources and the changelog.

## Verification

- **Unit tests:**
  - KMS sealing: settings, the CRC32C vector, impersonation and request shape, no redirects, associated-data binding, checksum refusal, and token refresh after a 401.
  - Key protection reporting.
  - The admin routes: session, operator, strict query and body, same origin and no caching.
  - The Google callback for suspended accounts and paused sign-ups.
- **Database tests** (`tests/database/platform-admin.mjs`, on a disposable PostgreSQL 17):
  - Migration 0059.
  - Every admin read and write refused to a non-operator.
  - Literal search, and that neither key hints nor trip names are returned.
  - Refusal counters.
  - Suspension: sessions, rotation, a session issued anyway, the Google identity check, shared keys, restore, and the audit record.
  - The sign-up cap at N, null and 0, with invitations and existing identities never counted.
  - KMS-sealed keys through a fake KMS: save, read, move from the ring, the sealing check, and unreadable without KMS.
  - The guest purge removing a guest's counters and admin records.
- **`pnpm check`:** lint, typecheck, unit tests, database tests, build and smoke.
- **Against the real key, from a workstation, before the deny policy:** a synthetic secret sealed and opened, and opening it under another account's binding was refused (`decrypt_400`). After the deny policy, the project owner's own account gets `encrypt_403`.

- **After the deploy on 6 November 2026:**
  - Migration 0059 ran, and the cap starts at 50.
  - `credential-reencrypt` ran in the web pod with the KMS settings next to the local key, then again with the KMS settings only. Both times its synthetic round trip passed, and there were no saved keys to move.
  - The secret versions that held the local key are disabled.
  - KMS Data Access logs show each Encrypt and Decrypt by `stardust-credentials` on behalf of the web server's Kubernetes identity.
  - Signed out, `/admin` returns 404 and `/api/admin/status` returns 401.

## Rollback

- **Code:** revert the commits. Migration 0059 only adds columns, tables and indexes. Older code ignores them, except that KMS-sealed keys cannot be opened without the KMS code.
- **Keys:** to move them back to the local ring, remove `CREDENTIAL_KMS_KEY` only after users have re-added their keys, or restore keys from a backup taken before the move.
- **Deny policy:** removing it needs `roles/iam.denyAdmin` at the organization, a change recorded in Admin Activity logs.
