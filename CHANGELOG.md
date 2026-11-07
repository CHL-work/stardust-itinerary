# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are identified by commit SHA; the public instance deploys from `main`.

## [Unreleased]

### Added

- **Flight details (JOB-082, D-094):** a transport event can carry a flight number, airline, departure terminal, gate and arrival terminal, in the event editor and from the trip AI. The AI looks up a flight's terminals for its date and never guesses a gate. Cards show the departure airport with its gate and terminal, else its terminal, else the airline, and the arrival airport with its terminal. Migration 0061 adds the optional `flight` details.

- **Free guest AI (JOB-071, D-086):** with `GUEST_FREE_AI_ENABLED=true`, guests without a key plan on keyless free models through Kilo's AI Gateway, by default NVIDIA Nemotron 3.5 Super with dots.3 note as a fallback. It is limited to 10 requests per guest a day and instance-wide hourly and daily caps, and has no search, research or pictures. The AI card shows the free model, the requests left, and that free models may keep what guests send. A new funding source `free` arrives with migration 0060.

- **Own-key AI (JOB-070, D-085):** on the requester's own key, the trip AI:
  - reads up to three public pages linked in the request, such as an event page's name, time, venue and address;
  - answers questions on any topic;
  - adds the new events and expenses the requester could add by hand straight away, instead of leaving them in Approvals.

  Requests with pictures, edits and deletions, and shared-key and operator-funded requests, keep their review.

- **Admin page (JOB-069, D-084):** `/admin`, reachable from Settings by the platform operator only, shows:
  - accounts, active users, guests, trips and AI requests by who paid and by provider;
  - refused attempts, and a 14-day table;
  - a searchable account list with each account's activity: sessions, trip sizes without names, daily counts and recent audited actions.

  It never shows trip contents, prompts, replies or keys. It is localized in English, Cantonese and Japanese.
- **Account suspension (JOB-069):** the operator can suspend an account. Its sessions end at once, its sign-in and invitations are refused, and keys it shared stop paying. Restoring it is one click, and both are recorded in `operator_audit_events`.
- **Daily sign-up cap (JOB-069):** at most 50 new public sign-ups per UTC day by default, set on the admin page (0 pauses them). Invitations and existing accounts are never refused.
- **Refusal counters (JOB-069):** `platform_daily_counts` counts, per day and kind, public sign-ups, guests started, and attempts refused by rate limits, the daily trip and feedback limits and the sign-up cap. Each count names the account when there is one, and counts are kept for 90 days.
- **Users' keys in Cloud KMS (JOB-069, D-084):** with `CREDENTIAL_KMS_KEY` (and optionally `CREDENTIAL_KMS_SERVICE_ACCOUNT`) set:
  - new keys are sealed by Cloud KMS, with CRC32C checks and the same account binding;
  - `credential-reencrypt` moves ring-sealed keys into KMS and proves that each opens;
  - Settings → AI keys says which protection applies, and advises a dedicated, spend-limited key.

- **Daily off-site copy (JOB-068, D-083):** `scripts/db/offsite-copy.mjs`, the `offsite-copy` container mode and the `stardust-offsite-copy` CronJob restore one snapshot of the database into a second PostgreSQL server each day as a dated database, compare every table's row count with the snapshot, and keep the newest three within a storage budget (`STARDUST_OFFSITE_KEEP`, `STARDUST_OFFSITE_MAX_MB`). On GKE the connection is a separate `stardust-offsite-env` secret, mounted only by that job, whose network policy allows only the database, DNS and port 5432. The public instance uses a Neon free-plan project.
- **Ask AI on phones (JOB-067, D-082):** the bottom-right button on Today, Itinerary and Expenses opens the quick AI composer as a sheet, in place of Add event and Add expense, which stay at the top of each page.
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
- **Case study and threat model:** `docs/CASE_STUDY.md` and `docs/THREAT_MODEL.md`.
- **Privacy notice (JOB-065):** `docs/PRIVACY.md` describes what the public instance stores and shares, how long it keeps it, and how the instance may be used. The sign-in page links it when `PRIVACY_NOTICE_URL` is set (https only).
- **Encryption-key rotation (JOB-065):** users' saved AI keys use a key ring: `CREDENTIAL_ENCRYPTION_KEY_VERSION` names the current key and `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` lists older ones for reading only. The `credential-reencrypt` container mode re-seals every stored key under the current version and prints counts only.
- **Private feedback repository (JOB-066):** issue filing targets `STARDUST_FEEDBACK_REPOSITORY`, and the publisher refuses to deliver unless GitHub reports that repository private. On GKE the token and repository are a separate `stardust-feedback-env` secret, readable only by the publishing job's own `stardust-feedback` service account.
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

- **AI expenses split between everyone (JOB-080, D-092):** when a request does not say who shares an expense, the trip AI splits it equally between everyone who can see it, instead of charging the requester alone. It leaves out people the request excludes, uses just the named people when it is shared with them, and charges the requester alone when it is clearly theirs. Parts the request gives become exact shares, and several payers of one bill become one expense each. The default split no longer adds the "confirm the payer and split members" notice. On ten synthetic expense requests, gpt-6.1-sol and claude-sonnet-5-5 went from 6 and 8 to 10 of 10.

- **Trip-wide AI events (JOB-079, D-091):** the trip AI adds new events for the whole trip by default, including hotels, flights and meals one person booked or paid for. It makes an event private only when asked, when it is shared with named people only, or when the event or its expense is clearly just for the requester, and its reply says when it chose private unasked. On the same synthetic requests, gpt-6.1-sol and claude-sonnet-5-5 went from 7 and 6 to 9 of 9 correct audiences.

- **Several operator accounts (JOB-078, D-090):** `OWNER_GOOGLE_EMAIL` may list several comma-separated Google accounts of the same person, and each is the platform operator: the server's keys pay for trips it creates and for its own requests, and it can open the admin page. A list with an entry that is not an email names nobody.

- **Brief README (JOB-076):** the README shows five phone screenshots of a synthetic trip, a short list of highlights and a **Find your way** table. A new [documentation index](docs/README.md) lists every document. The diagram moved to [deployment](docs/DEPLOYMENT.md#what-runs-where) and the stack summary to [architecture](docs/ARCHITECTURE.md#at-a-glance).

- **Brief expense summary (JOB-075, D-088):** the notes under the summary's figures and the paragraph on what is excluded moved into each figure's "?" help, in the full summary and the Overview widget. Copy that JOB-073's review skipped is brief too:
  - trip creation, with what **Find defaults** sends behind a "?";
  - the guest sign-in line, which no longer says AI needs your own key;
  - the operator's feedback panel.

- **Brief UI copy (JOB-073, D-088):** notes, hints, warnings and long errors are shortened in every language.
  - Removed: the day map's **Privacy details**, the AI memory notice, the context line under AI replies (still shown when older messages were summarized), and two notes in AI instructions.
  - Added: three "?" buttons for details people may want, on the day map, in AI keys and in the feedback form.

- **Privacy notice (JOB-068):** lists Neon, which keeps the daily copies of the database, and how long they are kept.
- **Quick AI answers expire (JOB-067, D-082):** the quick composer hides an answer after ten idle minutes, and the next quick question starts a new conversation. AI history and the AI tab are unchanged.
- **Day map (JOB-067, D-081):**
  - **Show day map** loads the map at once.
  - Private places are included unless the viewer turns them off, and the browser remembers that choice. Included private places are looked up and routed like other stops, without titles, notes or people, and never cached.
  - Matching version 4 accepts saved "venue, street, city, region postcode" text, confirmed by postcode or by city and state.
  - The privacy notice lists the map and weather services.
- **Explicit funding context:** every AI provider call runs inside a credential context entered by the code that decided who pays (the planner, Calendar lookup, destination lookup, disruption and feedback workers, provider smoke). Outside one, the provider adapters throw instead of falling back to the operator's keys, and the operator-funded destination lookup refuses a user's context.
- **Feedback issue hash:** the stored payload hash no longer names a repository, since the target is configured and checked at delivery. No issue had been queued on the public instance.
- **Continuous deployment:** every push to `main` deploys once CI passes. The `production` environment no longer waits for an approval and accepts only `main`; the workflow deploys only CI runs for pushes to this repository, and a manual run deploys only commits on `main`. The deploy script now runs with `bash`, since the fresh repository did not keep its executable bit.
- **Smaller pod requests on GKE:** the web server requests 250m CPU and 768 MiB (at most two replicas), the database 100m and 512 MiB, and each job 100m. The pods used about a tenth of their old requests, and every job run needed a second node; with the free trial's 250 GB SSD quota, a third node could not start, which left the first automatic deploy's backup job unscheduled.

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

### Removed

- **Classic layout (JOB-081, D-093):** the original dark layout, the layout toggle in the header and the Settings **Screen layout** card are gone; everyone gets the one layout, light or dark with the system. The classic phone bottom bar, Overview date selector and swipe hint, the sidebar's placeholder progress bar, their classic-only styles and the stored `stardust.ui-mode.v1` preference went with them. The README screenshots were retaken without the toggle.

### Fixed

- **Guest notice, counts and free-model line breaks (JOB-077, D-088):**
  - The guest notice is one short line, and says AI needs your own API key only when free guest AI is off and the guest has none.
  - English counts have a singular form: "1 expense", "1 pending expense", "1 repayment", "1 record", "1 place currently reserved", "1 prompt remaining" and others, instead of "1 expenses" and the like.
  - `<br>` tags in a free model's reply and reasons become line breaks before the reply is stored, instead of showing as text.

- **Codex web search, disruption checks and OpenAI-model planning (JOB-074, D-089):** since Codex 0.147 every tool runs through the CLI's code-mode host, which the lockdown had turned off. No Codex turn could search the web, the disruption monitor failed every run, and OpenAI-model planning failed. The host stays on now, with code mode and every other disabled feature still off. The monitor reports its own disallowed-tool check as `DISRUPTION_PROVIDER_TOOL` instead of a provider sign-in failure.

- **The operator's own AI (JOB-072, D-087):** the platform operator's requests on the server's keys now follow the own-key rules, as JOB-070 intended for anyone paying for their own AI: they read pasted public links, take any topic and add new events and expenses at once. On a request the requester pays for, items and owner edits from pictures no longer wait for approval either. The operator's AI card says so in one line.

- **Place lookups at most once a second:** the day map's place lookup could start a request 999 ms after the previous one, because a timer may fire a millisecond early by the wall clock; it now waits until a full second has passed.

- **Guest purge on GKE:** its network policy now allows DNS through NodeLocal DNSCache (`169.254.20.10`) and the metadata address, which the first scheduled run could not reach.

### Security

- **Guarded link reading (JOB-070):**
  - The page fetcher for own-key requests reaches only public addresses on ports 80 and 443. Every resolved IPv4 and IPv6 address is checked, the connection is pinned to it, and every redirect is checked again.
  - Limits: 8 seconds and 1.5 MB, HTML or text only, and links flagged as private are never read.
  - Page text reaches the model as escaped, untrusted data.

- **Only the web server may use the key that seals users' keys (JOB-069):** `infra/` adds:
  - a KMS key, and a `stardust-credentials` service account that only the web server's Kubernetes identity may act as;
  - an IAM deny policy that refuses KMS encryption and decryption to every other principal, project owners included;
  - KMS Data Access audit logs.

  The `gke` overlay's `web-metadata-egress` NetworkPolicy lets only the web pod reach the metadata server.

- **Deploys after a second review:** an automatic deploy needs the newest commit of `main` (checked in both jobs), so re-running an older CI run never rolls production back. Workload Identity accepts tokens only from `deploy.yml` on `main` for its own triggers, Artifact Registry tags are immutable, and the workflows' actions are pinned to commit SHAs.
- **Feedback token away from the model:** publishing is now its own `stardust-feedback-publish` CronJob with the token and the database, and no model or AI keys; the reviewer job no longer mounts the token. The publisher accepts only `visibility: private`, not `internal`.
- **Key ring strictness:** an older key always names its version, keys must be canonical base64, and reuse is checked on the decoded bytes. Re-encryption also opens the keys already on the current version, so a key replaced without raising its version is reported instead of passing silently.
- **Funding by policy, not elimination:** Calendar lookups use the operator's keys only when the policy says the operator pays.
- **AI load cap:** at most `STARDUST_AI_MAX_CONCURRENT` (default 4) AI requests run at once per web server; more get 429 with `Retry-After`. The web pod requests 1 GiB.
- **Codex tool lockdown, completed:** the pinned Codex CLI turns on code mode, browser and computer use, plugins, skills, goals, agent collaboration, image generation and other tools by default, and the shared lockdown turned off only the shell, exec, apps, agents, hooks, memories and the image viewer. A probe of a locked-down turn in production listed a code-execution tool, `apply_patch`, goal, agent and MCP-resource tools (it found no way to read files). Every in-app turn, the feedback reviewer, the destination lookup and the provider smoke now turn all of those off, and a test runs the installed CLI's `features list` with the lockdown and fails if any feature outside a reviewed harmless list is on.

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
