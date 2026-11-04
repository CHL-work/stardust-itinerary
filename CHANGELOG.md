# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are identified by commit SHA; the public instance deploys from `main`.

## [Unreleased]

### Added

- Public repository with fresh history under the MIT license. Earlier development (JOB-001 to JOB-057) lives in a private archive.
- **Hosting:**
  - One container image (Dockerfile, `deploy/container/entrypoint.sh`) running the web server, background workers, migrations, encrypted backups and a provider smoke check.
  - Docker Compose self-hosting ([guide](docs/SELF_HOSTING.md)).
  - Kubernetes base and GKE overlay (`deploy/k8s`), with per-workload identities, Secret Manager mounts, network policies and non-root, read-only containers.
  - OpenTofu for the GKE Autopilot instance (`infra/`), keyless GitHub identities and a budget alert ([guide](docs/DEPLOYMENT.md)).
- **Gemini:** `gemini-4-argon`, `gemini-3.8-flash` and `gemini-3.5-flash-lite`, over the Gemini API or Vertex AI. Google Search grounding is the only tool, and the same public-subject gates apply to every reported query.
- `scripts/db/backup.mjs` (pg_dump, archive check, age encryption, upload) and `scripts/db/runtime-role.mjs` (least-privilege runtime role and grants).
- **Bring your own API key (JOB-061, D-075):**
  - Settings → AI keys stores a user's own OpenAI, Anthropic or Gemini key, checked with the provider and encrypted at rest.
  - Requests on a user's key run with only that key, in a private per-request provider directory, and record `ai_requests.credential_source`.
  - Members of unsponsored trips can now use AI with their own key. The AI composer opens once a key is saved, with a per-request picker for the models of the user's providers.
  - Migration `0054_user_ai_credentials.sql`.
  - On GKE the encryption key is a separate `stardust-credential-env` secret that only the web server mounts.
- **Key usage in Settings (JOB-066):**
  - Settings → AI keys shows, per provider, how many requests the user's key paid for today and in the last 30 days, and how many came from members using their shared key.
  - Counts only, from `GET /api/trips/{tripId}/ai/keys` (`usage`).
- **Case study and threat model:** `docs/CASE_STUDY.md`, `docs/THREAT_MODEL.md` and a draft `docs/PRIVACY.md`.
- **Guest accounts (JOB-064, D-077):**
  - **Try as guest** (behind `GUEST_MODE_ENABLED`, Cloudflare Turnstile when configured, and rate limits) gives a 24-hour account with a synthetic Tokyo demo trip, AI on the guest's own key only, and a banner saying when everything is deleted.
  - Guests never mix with real trips; database triggers enforce it.
  - An hourly `guest-purge` job (CronJob `stardust-guest-purge`, and the Compose scheduler) calls `app_purge_expired_guest`. It deletes every guest row and proves nothing references them, or rolls back.
  - Migration `0056_guest_accounts.sql`.
- **Trip-owner key sharing (JOB-063, D-076):**
  - Owners can let chosen members use their own AI keys in a trip: a checkbox on the add-member form and on join-link creation, and a per-member on/off switch in Settings.
  - Shared requests run the trip's one model, which owners of unsponsored trips can now choose, within the trip's daily limit.
  - They stop as soon as the sponsor stops being an owner or deletes the key.
  - Members see whose key and which model run, never the key.
  - Migration `0055_ai_key_sharing.sql`.

### Changed

- **Codex lockdown:** planning and disruption checks run Codex without its shell or other local tools; a turn that used one is refused.
- **AI on by default:** `trip_ai_settings.enabled` now records only whether a trip's owners allow AI; who pays is decided per request (D-075).
  - New trips start with AI on, and owners of unsponsored trips can switch it.
  - Migration 0054 turns AI on for existing unsponsored trips unless an owner turned it off.
  - The operator's keys still pay only in sponsored trips.
- **Funding rules documented:** AGENTS.md and D-023, D-024 and D-030 now describe own keys and the Gemini adapter.
- **API keys instead of subscription logins.** Model calls authenticate with the server operator's provider API keys. Migration `0053_api_key_transport.sql` records the new authentication mode and billing basis for new AI requests.
- **Allowlisted provider environment.** Provider subprocesses now receive only an allowlisted environment, instead of the whole server environment minus a few keys.
- **Copy:** the AI card's label and the owner usage heading no longer say "subscription", now that AI runs on API keys.
- **Deploy workflow:** concurrency now applies to the deploy job only, so a deploy waiting for approval no longer holds back image builds of later pushes.
- **Own-key requests and quotas:** requests on a user's own key no longer use up a sponsored trip's free daily prompts.
- **Line-ending-tolerant migrations.** A migration may now differ from its recorded checksum by line endings only, which is how migrations applied from a Windows checkout were recorded.

### Security

- **Hardening from an independent review of key sharing and guest accounts (migration `0057_guest_hardening.sql`):**
  - **Guest purge:** `app_purge_expired_guest` is no longer `SECURITY DEFINER`, so the web role cannot use it to run code as superuser. Only the purge job runs it, connecting as the database administrator with its own service account and no other secret. It reads only qualified catalogs (temporary schemas last), touches only `public`, requires the guest identity, and its final check covers every trip table.
  - **Guest status:** fixed for life, so no real trip can be turned into something the purge would erase.
  - **Guest limits:** Turnstile is required unless explicitly waived, and its answer must match this hostname and action. Limits use Cloudflare's client address, with three active guests per address.
  - **Guest allowances:** 5 key checks a day, 20 own-key AI requests a day, small map and weather allowances, and no pictures.
  - **Calendar:** refused for guests on every route.
  - **Key grants:** deleted when a member slot's identity changes or the sponsor stops being an owner, capped at 200 shared requests a day per sponsor and trip. Members are told their prompts go to the sponsor's provider account.
  - **Rate limits:** API errors now map rate limits to 429 with `Retry-After`.

- **Hardening from an independent review of bring-your-own keys (JOB-061):**
  - Key checks are limited to 10 an hour per account and 30 per address.
  - Requests on users' own keys are limited to 100 per account per UTC day.
  - The encryption key must be exact base64 and differ from `AUTH_SECRET`.
  - Undecryptable keys are logged without values.
  - Key checks and Gemini calls refuse redirects.
  - Leftover provider directories are swept.
  - Research, venue-hours, image and place-lookup Codex calls use the locked-down configuration, which also turns off the image viewer and shell snapshots.
