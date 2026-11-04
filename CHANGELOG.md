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
- **Bring your own API key (JOB-061):** Settings → AI keys stores a user's own OpenAI, Anthropic or Gemini key, checked with the provider and encrypted at rest. Requests on a user's key run with only that key in a private per-request provider directory, and record `ai_requests.credential_source`. Members of unsponsored trips can now use AI with their own key. Migration `0054_user_ai_credentials.sql`.

### Changed

- **Codex lockdown:** planning and disruption checks run Codex without its shell or other local tools; a turn that used one is refused.
- **API keys instead of subscription logins.** Model calls authenticate with the server operator's provider API keys. Migration `0053_api_key_transport.sql` records the new authentication mode and billing basis for new AI requests.
- **Allowlisted provider environment.** Provider subprocesses now receive only an allowlisted environment, instead of the whole server environment minus a few keys.
- **Line-ending-tolerant migrations.** A migration may now differ from its recorded checksum by line endings only, which is how migrations applied from a Windows checkout were recorded.
