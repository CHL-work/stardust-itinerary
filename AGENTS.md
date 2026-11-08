# Agent instructions

These rules apply to every human and AI contributor.

## Start and scope

1. Read [README](README.md), the [roadmap](docs/ROADMAP.md), the [documentation policy](docs/DOCUMENTATION_POLICY.md) and the relevant feature contract; the [documentation index](docs/README.md) lists them all.
2. For an implementation job, read [design](docs/DESIGN.md), [decisions](docs/DECISIONS.md), the [job system](docs/JOB_SYSTEM.md) and that job. Use the repository-local `stardust-job-runner` skill when selecting or executing a job.
3. Inspect the worktree and preserve other people's changes. Do not implement proposed work, or infer permission, from a roadmap entry, log, old job or branch.
4. User instructions override repository guidance, then accepted decisions, product design, job criteria and conventions. Report conflicting accepted requirements.

## Public repository and the public instance

- **This repository is public.** Never commit secrets, API keys, OAuth credentials, tunnel credentials, traveler data, invitations, receipts, exports, personal names or email addresses. Tests and fixtures use synthetic data only.
- The public instance runs on GKE Autopilot ([deployment](docs/DEPLOYMENT.md)). Every push to `main` deploys it once CI passes, so pushes to `main`, migrations against it, secret changes, DNS or tunnel changes and infrastructure applies need explicit owner authority.
- Coding agents never hold cloud, database, Cloudflare or secret-store credentials for the public instance. Never read or print secret values; pipe them between tools when an operator task requires it.
- Never run destructive tests against a database that holds real trips; use a disposable database (`TEST_DATABASE_URL` plus `TEST_DATABASE_CONFIRM_DESTROY`).
- Never create real trips, events or expenses just to test.

## Product and security invariants

- At most 20 members per trip, including one or more owners. Public signup stays behind `PUBLIC_SIGNUP_ENABLED`, and guest accounts behind `GUEST_MODE_ENABLED`. No booking marketplace or payment processing.
- Guest accounts never mix with real trips, and only `app_purge_expired_guest` deletes them. Only the purge job, as database administrator, runs it; never grant it to the runtime role, make it `SECURITY DEFINER`, or weaken its isolation, identity or final reference checks.
- PostgreSQL is canonical. Discord or other channels are only projections.
- Models propose; application code owns authorization, validation, deterministic money and route calculations, concurrency, and audited, versioned canonical writes.
- Every trip query enforces membership, scope and the current private audience. Preserve last-active-bound-owner protection, explicit financial reassignment, tombstones and permanent proposal invalidation.
- Google links bind atomically after sign-in, never on GET. Sessions have a 24-hour rolling window inside a 30-day fresh-authentication ceiling; trip changes cannot revive or extend it. Completed trips do not revoke active membership.
- Browser clients never receive provider, database or OAuth secrets.
- External delivery uses idempotency/outbox safeguards; provider failures degrade gracefully.
- The admin page and its APIs (JOB-069) are for the platform operator only, rechecked in every transaction. They show account metadata and counts, never trip contents, prompts, replies or keys. Suspension refuses sessions, sign-in and shared-key funding until restored.
- In-app AI gets no shell, GitHub, cloud-console, deployment or secret-store access. Provider subprocesses receive only the allowlisted environment in `src/lib/ai/provider-environment.ts`. The separate feedback reviewer has no tools or GitHub credential; its deterministic publisher is issue-create-only and files only in the configured repository after GitHub confirms it is private. Preserve redaction and historical opt-outs.

## AI providers

- Use only provider-documented SDKs, authentication and endpoints. Hosted deployments authenticate with API keys. Never reuse consumer-subscription logins (ChatGPT, Claude.ai, Gemini CLI OAuth) as a hosted transport; Anthropic does not permit third-party products to offer Claude.ai login.
- Preserve the funding rules in `getAiPolicy` (`src/lib/app/repository.ts`), which decides whose key pays for each request:
  - An explicit **Free AI** choice is resolved first and never charges a key. An unsupported explicit paid-model choice is refused, never silently replaced by a different funded model.
  - **The requester's own stored key** (JOB-061) pays when they choose one of its provider's models, or in a trip the operator does not sponsor. The trip's prompt cap does not apply. Such a request may be about any topic, has its linked public pages read by the guarded fetcher in `src/lib/ai/linked-pages.ts` (never weaken its address checks), and adds new items the requester could add by hand (JOB-070, D-085).
  - **A trip owner's shared key** (JOB-063) pays next, for a member the owner chose. It runs the trip's one model, within the trip's daily limit, and only while that owner is an active owner who holds a key.
  - **Free AI** (JOB-086, D-098): with `FREE_AI_ENABLED=true`, any active member or guest can select an eligible zero-price Kilo model. The composer defaults to free without an own key and shows paid models only for the user's saved providers; legacy API automatic funding remains compatible. Named free choices never substitute or charge a key. Legacy `GUEST_FREE_AI_ENABLED` applies when the canonical setting is absent and now has all-account scope. Keep account/instance request and attempt caps, catalog validation, minimized context and retention notice. No images, search, research, background work, client impersonation or private relay. Free proposals, including owner edits, require review.
  - **The operator's own requests** on the operator's keys count as paid by the requester and follow the own-key rules above; on any request the requester pays for, pictures no longer force review (JOB-072, D-087).
  - **The operator's keys** pay only in operator-sponsored trips. There, only the verified platform operator who is also an active trip owner gets premium model choice and quota exemption; other users get the member model and the trip's daily UTC limit (default 20).
  - **Otherwise** the request is refused with `ai_key_required`.

  Users' keys are account/provider-bound and encrypted at rest. Optional Secret Manager stores KMS ciphertext with only pinned references in PostgreSQL (JOB-087); legacy database ciphertexts remain supported. Never weaken the KMS deny policy that leaves only the web server able to decrypt, or give the delete-only cleanup worker payload access. Keys never return to a browser and fund only the owner, explicitly authorized sharing, or the owner's own routine checks. Background AI workers use only the operator's keys, and only in sponsored trips. See [key storage](docs/AI_KEYS.md).
- **Routine checks on a member's own key** (JOB-094, D-106): in a trip the operator does not sponsor, flight status and disruption checks run on one active, unsuspended member's own key, owners first, only after the chosen model passed a live web search on the current key. Saving a key starts that check and turns checks on unless the member turned them off (JOB-096, D-108). They run inside the web server (`ROUTINE_CHECKS_ENABLED`), never the background worker, in small bounded batches with database claims. Shared keys and free models never pay for them. See [the AI tab](docs/AI_TAB.md).
- Every provider call runs inside a credential context entered by the code that decided who pays: `withOperatorAiCredential`, `withUserAiCredential`, or the strictly keyless `withFreeAiCredential` (`src/lib/ai/credential-context.ts`). Outside one, provider adapters throw; never add a fallback to the operator's keys. See [funding](docs/PUBLIC_TRIPS_AND_MEMBERS.md#ai-funding-is-not-a-trip-role).
- Destination-only lookup is separately available to authenticated eligible creators (`STARDUST_DESTINATION_LOOKUP=creators`), tool-free. The platform operator uses the operator's key; others use their own key's lightest model, else a free model where free AI is on (ten a day per account, 200 per instance), else, without free AI, the operator's key at ten uncached calls per account per UTC day (JOB-094). It does not fund general planning. See [defaults](docs/TRIP_DESTINATION_DEFAULTS.md).
- Model IDs and behavior come from the registry and contracts; check a provider's current model list before changing them.

## Changes and verification

- One implementation job per branch/PR unless explicitly overridden; no adjacent scope expansion or discarded changes.
- Code, comments, logs and technical docs are English. UI: English, clear Cantonese, LIHKG-style Cantonese, Japanese.
- UI copy is brief (D-088): a note is one short line or none, and an explanation someone may want sits behind at most one "?" button (`InfoTip`) per section. See [localization](docs/LOCALIZATION.md).
- LIHKG tone may mock benign situations, never protected traits or vulnerabilities. Identity, money, security, destructive actions, accessibility, disruptions and safety use neutral wording.
- There is one layout; the classic layout and its toggle were retired (JOB-081, D-093). Layout CSS stays in `src/app/new-ui/` under `:root[data-ui="new"]`. Follow [screen layout](docs/UI_LAYOUTS.md).
- Application changes need relevant tests and `pnpm check` against disposable data, including build and smoke. Close temporary servers and browser children you start.
- Docs-only work needs link/anchor and stale-instruction checks, not live provider calls or deployments.
- Update [CHANGELOG](CHANGELOG.md), affected contracts and the documentation-impact note.
