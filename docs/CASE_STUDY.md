# Case study: building Stardust Itinerary

A collaborative trip planner where AI proposes and application code decides. This page explains the engineering choices for readers who want the why; [architecture](ARCHITECTURE.md), [decisions](DECISIONS.md) and the feature contracts hold the details.

## The product in one paragraph

Up to 20 people share one trip: day-by-day events, private events visible only to chosen members, expenses with exact splits, repayments, approvals and a full change history. An AI planner (OpenAI, Anthropic or Google models) reads the trip and the web, then proposes events and expenses. Members review the proposals; nothing the model says is written directly. The UI is in English, Cantonese, LIHKG-style Cantonese and Japanese, plus Simplified and Traditional Chinese, Spanish, Brazilian Portuguese, French, German, Russian and Indonesian.

## Design principles

- **Models propose, code decides.** Every AI change is a typed proposal that application code validates, authorizes and applies in one audited, versioned transaction. Money and routes are computed deterministically, never by the model.
- **PostgreSQL is the source of truth.** It enforces 50-plus migrations of constraints and triggers: append-only history, private audiences, financial consistency, guest isolation. Application bugs fail closed instead of corrupting data.
- **Least privilege everywhere:** the browser, AI subprocesses, workers, the database role and CI each get only what they need.

## Hosting: one image, two ways to run it

- **Container:** one container image runs the web server, workers, migrations, encrypted backups and a provider smoke check, selected by an entrypoint mode.
- **Self-hosting:** Docker Compose runs it on one machine.
- **The public instance** runs on GKE Autopilot:
  - Everything in Google Cloud is OpenTofu (`infra/`). Everything in the cluster is Kustomize.
  - There are no service-account keys. Nodes, workloads and GitHub Actions authenticate with Workload Identity.
  - Secret Manager secrets are mounted as files, and each workload may read only its own. The key that decrypts users' AI keys is mounted only in the web server.
  - Pods run as non-root with read-only file systems and no Kubernetes token.
  - NetworkPolicies block the metadata server, give the guest-purge job only the database and DNS, and the off-site copy only the database, DNS and PostgreSQL's port.
  - Traffic arrives through an outbound-only Cloudflare Tunnel: no load balancer, no public IP.
  - PostgreSQL 17 runs in the cluster, with daily age-encrypted, verified backups, and a daily copy outside Google Cloud, in a Neon free-plan project, that is restored and checked table by table.
- **Release:** every push to `main` builds an image, after CI runs lint, typecheck, about 4,700 unit tests, a database suite on real PostgreSQL, a production build, a smoke test and gitleaks. When CI passes, the image is built and deployed without manual steps. The deploy takes a pre-migration backup, runs migrations as a job that must succeed, then rolls out.

**Moving production without losing writes:** the instance moved from a single VM to GKE.
1. A full rehearsal on a staging hostname restored a dump and migrated it. That rehearsal revealed migrations recorded with Windows line endings, so checksums now accept line-ending-only differences.
2. The real cutover stopped the old writers, took a final dump, restored it, migrated and switched the tunnel route, in six minutes, keeping existing sessions.

## AI without handing over the keys

- **Transports:** the planner uses the official SDKs (Codex for OpenAI, the Claude Agent SDK for Anthropic) and plain REST for Gemini, including Google Search grounding.
- **Locked-down subprocesses:** each provider subprocess gets an allowlisted environment. In-app Codex runs with its shell, file and image tools, MCP, apps and memories turned off, and a turn that used anything else is refused. The read-only sandbox alone would still let a shell read mounted secrets.
- **Bring your own key** (JOB-061):
  - Users store their own provider keys, checked with the provider (rate limited, so the server cannot be used to test stolen keys).
  - Keys are encrypted with AES-256-GCM, with the user and provider bound as authenticated data, so a ciphertext copied to another row will not open.
  - On the public instance Cloud KMS seals them instead (JOB-069):
    - The key cannot be exported, and only one service account may use it, which only the web server may act as.
    - An IAM deny policy also refuses the project's owners, so the person running the site cannot quietly decrypt users' keys. Every use is in the audit log.
    - Settings tells users exactly that, and that the server still decrypts a key to send their requests.
  - A request on a user's key runs inside an `AsyncLocalStorage` context. Its subprocess sees only that key and a private, per-request state directory, never the operator's keys or another request's files. A test runs two users concurrently to prove it.
  - One resolver decides who pays (own key, an owner's shared key, operator sponsorship, or explicit keyless Free AI). The composer offers each eligible free model and only the user's own-key paid models, defaulting to free without an own key; legacy automatic funding remains compatible. No free failure silently charges a key (JOB-086).
- **Free without hidden billing** (JOB-086): a live catalog confirms zero prices and structured-output support, a keyless context cannot use keyed adapters, and database locks cap both admitted requests and actual upstream attempts. The narrower context excludes private events, expenses, notes and paid-chat memory, with retention disclosed; free changes stay pending review.
- **Key sharing** (JOB-063): an owner can let chosen members use their key in one trip. A checkbox on the invite or join link, and a per-member switch, control it. Every use re-checks that the sponsor is still an owner who holds a key, and is recorded with whose key paid.

## Letting strangers try it safely

Guest accounts (JOB-064) give anyone a 24-hour demo trip. Real trips deliberately keep their history forever (append-only triggers and `RESTRICT` foreign keys), so "delete everything about this guest" cannot be a cascade. The solution is one guarded function:
1. It checks that the guest is expired and isolated.
2. It deletes the guest's rows from every table with a `trip_id`, plus the guest's account rows, with triggers suspended for its own deletes only.
3. It turns triggers back on and proves that no foreign key still references the deleted rows. Otherwise everything rolls back.

Database triggers keep guests and real trips from ever mixing, even if application code has a bug. A test plants a deliberate leak and shows the purge refuses it and changes nothing.

## How the work was checked

- **Security reviews:** each new public surface gets an independent review before release. Findings are fixed, or recorded with their reason, in the job files.
- **End-to-end checks:** a local run in a real browser checks the user's path, not just the units. For guest mode, that run found a gap the unit tests had missed.
- **Threat model:** [the threat model](THREAT_MODEL.md) lists what could go wrong and the gates before public sign-up.
- **Tests:** synthetic data only. The repository is public, so no traveler data, keys or personal identifiers are ever committed.
