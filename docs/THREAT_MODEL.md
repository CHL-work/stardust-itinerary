# Threat model for the public instance

What could go wrong when strangers can use the public instance, and what stops it (JOB-065). Hosting is in [deployment](DEPLOYMENT.md); identity and secrets in [identity and security](IDENTITY_AND_SECURITY.md). This page states the current design; [decisions](DECISIONS.md) record why.

## What is worth protecting

| Asset | Where it lives | Who can read it |
| --- | --- | --- |
| Users' own AI provider keys | `user_ai_credentials`, AES-256-GCM ciphertext | Only the web server, which holds `CREDENTIAL_ENCRYPTION_KEY` (its own Secret Manager secret) |
| The operator's AI keys | `stardust-ai-env` secret | Web server and the disruption/feedback workers |
| Google OAuth client secret, `AUTH_SECRET` | `stardust-app-env` secret | Web server, workers and migrations |
| Sessions and invitations | Hashed tokens in the database; session cookie in the browser (`httpOnly`, `secure`, `SameSite=Lax`) | The holder of the token |
| Trip data, including private events and money | PostgreSQL in the cluster, plus age-encrypted daily backups in Cloud Storage | Trip members, scoped by role and private audience |
| Google Calendar tokens | Encrypted in the database | The connected member's requests |

## Who might attack

- **Anonymous visitors**, including guests (JOB-064): they can start guest accounts and use the guest's own key.
- **Signed-in users**, members of some trips: they may try to reach other trips, other users' keys, or the operator's funding.
- **Prompt-injected content:** web pages, reservation emails and images processed by the models.
- **A compromised dependency or CI run.**

## Threats and what stops them

| Threat | Mitigation | Remaining risk |
| --- | --- | --- |
| **Guest flooding** to exhaust storage, CPU or the operator's money | Guest mode is off by default and refuses to run without Turnstile, unless explicitly waived. Creation is limited, per Cloudflare client address, to 3 an hour and 3 active guests, plus `GUEST_ACTIVE_LIMIT` in total. Guests get no operator-funded AI or lookups, no pictures, and small key-check, AI, map and weather allowances. Every guest is purged after 24 hours | A distributed attacker who solves Turnstile challenges can still fill the total cap, which makes guest mode unavailable rather than costly. Lower `GUEST_ACTIVE_LIMIT` if that happens |
| **Theft of users' AI keys** | Keys are encrypted at rest, decrypted only for the owner's request (or a grant's) and never returned. The encryption key is mounted only in the web server. Each request gets its own provider environment and state directory. Provider tools that read files are off everywhere | Same-uid provider processes could read each other's `/proc/<pid>/environ` if a model ever got a file-reading tool; every Codex config turns those off. Rotating the encryption key is not supported yet |
| **Using the server to test stolen keys** | Key checks are limited to 10 an hour per account, 30 per Cloudflare client address and 5 a day per guest, and never follow redirects | None significant |
| **Prompt injection aimed at secrets or actions** | In-app models have no shell, file, MCP or app tools. Their output is a proposal that application code validates and audits. Secrets never enter prompts | A model can still write misleading text in its reply. Members review proposals |
| **Reaching another trip** | Every trip query checks the session's trip, active membership and private audience. Guests are isolated by database triggers | Only through an application bug. Tests cover the boundaries |
| **Spending the operator's AI money** | Operator keys pay only in operator-sponsored trips, under the operator's model choice and per-member daily limits. Own-key requests are capped at 100 per account per day. Guests and own-key requests never fall back to operator keys | The destination lookup is operator-funded for eligible creators, limited to ten calls an account a day. Guests are excluded |
| **Abusing a shared key** | Only the owner can grant sharing, per member and trip. A grant belongs to the person: it is deleted when the identity in the slot changes or the sponsor stops being an owner. Each use is re-checked against the sponsor's current ownership and keys, limited to the trip's model and daily limit, and capped at 200 a day per sponsor and trip. Every use is recorded with its sponsor | A member, or a leaked sharing link, can use up to that cap of the owner's provider budget each day; owners choose whom to trust |
| **CSRF or session theft** | Writes require an allowed `Origin`. Session tokens are opaque and hashed. Sessions have a 24-hour rolling window inside a 30-day ceiling | A stolen cookie works until it expires or the member signs out |
| **Secrets in logs or audit** | Provider failures are reduced to fixed codes. Audit events hold no key material. Undecryptable keys are logged without values | Operator-side log access is trusted |
| **Supply chain and deploy** | GitHub Actions authenticate to Google with Workload Identity Federation (no keys). Only `main` builds images, and only the approved `production` environment deploys. gitleaks scans every push. The lockfile is authoritative | A malicious dependency update would still need to pass review and CI |
| **Turning the guest purge against real data** | The purge runs with its caller's rights and is executable only by the purge job, which connects as the database administrator and holds no other secret. It reads only schema-qualified catalogs with temporary schemas last, and touches only `public` tables. Guest status is fixed for life by triggers, the purge requires the synthetic guest identity, and a final check rolls back any leftover reference | Someone holding the database administrator password can do anything anyway; that password is mounted only in the database, migration, backup and purge pods |
| **Losing or leaking data** | Daily backups are verified and age-encrypted, with a 30-day lifecycle. Guests are deleted after 24 hours. Deleted trips keep their records for recovery (D-073) | Restoring from backup is manual |

## Before public sign-up or guest mode is turned on

The owner decides when; these are the gates:

1. Deploy a build with JOB-061 to JOB-064. It requires the owner's approval in the `production` environment.
2. ~~Fix the findings of the independent security review of key sharing and guest accounts.~~ Done (migration 0057; see JOB-065).
3. Add Turnstile keys (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) to `stardust-app-env`, then set `GUEST_MODE_ENABLED=true`.
4. Publish a privacy notice and terms that describe the instance as it is (draft: [privacy](PRIVACY.md)).
5. Decide on Google OAuth verification. While unverified, Calendar consent shows Google's warning, and sensitive-scope grants are capped at 100 users.
6. Check the budget alert and the web autoscaling limit (`maxReplicas`).
