# Architecture

Current application architecture. Hosting options are described separately: [self-hosting](SELF_HOSTING.md) with Docker Compose and [deployment](DEPLOYMENT.md) of the public instance.

## At a glance

- **App:** Next.js 16 (App Router), React 19, TypeScript and Zod. One container image runs the web server, the workers, migrations and backups.
- **Data:** PostgreSQL 17 is the source of truth: forward-only SQL migrations with checksums, append-only audit and revision tables, scope checks in every query, and database constraints and triggers for invariants such as the last active owner and deleted-trip lockout.
- **AI:** the official Codex SDK and Claude Agent SDK, and Gemini's REST API, with an explicit environment allowlist, typed output schemas, evidence for researched facts, and recovery of requests still running when a phone suspends ([AI](AI_AND_AGENTS.md)).
- **Infrastructure as code:** OpenTofu for the Google Cloud project and Kustomize for Kubernetes; no service-account keys exist ([deployment](DEPLOYMENT.md)).
- **Quality gate:** ESLint, TypeScript, Vitest and a PostgreSQL integration suite on every push (`pnpm check`; [verification](IMPLEMENTATION.md#4-verification)).

## 1. Runtime and topology

Stardust is a modular monolith: Next.js 16 / React 19 / strict TypeScript, Node.js 24, PostgreSQL 17, standard SQL migrations and a Next.js standalone server build. Exact versions are in `package.json` and `pnpm-lock.yaml`.

```text
browser → HTTPS ingress / reverse proxy → Next.js standalone server (Node 24)
                                                  ↓
                                            PostgreSQL 17
                                                  ↑
                     scheduled workers: disruption monitor and flight status checks, feedback reviewer
```

One web process serves pages and APIs, runs AI provider subprocesses for interactive requests and performs all user-initiated writes. Two short-lived workers, `pnpm monitor:disruptions` and `pnpm feedback:run`, are started by the deployment's scheduler (for example cron or a Kubernetes CronJob); the database decides which work is due. The disruption worker first runs any due [flight status checks](FLIGHT_STATUS.md), whose updates are the only automatic canonical writes (D-095). `GET /api/health` reports database readiness.

The `Dockerfile` builds the standalone server into a non-root image listening on port 8080, and `compose.yaml` runs PostgreSQL 17 plus that image for self-hosting. TLS/ingress, process supervision, secrets, backups and worker scheduling are deployment responsibilities. Map lookup rate limits and caches are per process; read [daily map](DAILY_MAP.md) before running more than one web replica.

## 2. Code boundaries

| Area | Source / responsibility |
| --- | --- |
| Browser and routes | `src/components/`, `src/app/`: presentation, validated HTTP boundaries, no provider/database secrets. |
| Identity | `src/lib/auth/`: Google binding, account/trip sessions, invitation admission, operator distinction, account suspension and account language. Guests start with a one-use creation grant, not a demo trip; Google sign-in never merges guest data. |
| Administration | `src/lib/admin/`: the operator-only admin page (metadata and counts), suspension, the daily sign-up cap and daily counters (JOB-069). |
| Trip transactions | `src/lib/app/`: canonical records, permissions, proposals, optimistic revisions and audits; `src/lib/domain/` supplies deterministic accounting/conflict primitives. |
| AI | `src/lib/ai/`: adapters, prompts, memory/drafts, recovery and privacy-limited research; user keys sealed by the local ring or KMS, optionally stored as KMS ciphertext in Secret Manager (`credential-secret-manager.ts`) with a delete-only lifecycle worker. [Key contract](AI_KEYS.md). |
| Database | `src/lib/db/`, `database/migrations/`: pool, checksummed ordered SQL and constraints. |
| Integrations | `src/lib/calendar/`, `src/lib/maps/`, `src/lib/weather/`, `src/lib/disruptions/`. |
| Feedback / activity | `src/lib/feedback/`, `src/lib/app/`: private diagnostics, safe review links, separate issue-only publication. |
| Offline / i18n | `src/lib/offline/` and `public/sw.js`; `src/lib/i18n.ts` plus topic `*-i18n.ts` dictionaries, and the added languages' packs in `src/lib/locale-packs/`. The server has every pack; a page sends the browser only its own language's pack (D-097). `locale-preference*` persists explicit browser/account choices, defaulting to English (D-101). |
| Scripts | `scripts/`: migrations, seeds, smoke, workers, guarded evaluations and maintenance tools; presence does not authorize running them. |
| Packaging | `Dockerfile`, `compose.yaml`; Kubernetes manifests in `deploy/k8s/` and infrastructure code in `infra/` serve the public instance. |

Verify current paths before editing. Do not split this small workload into distributed services without a demonstrated requirement.

## 3. Canonical data and consistency

PostgreSQL owns identity, trips/days/members, events/viewers/revisions, expenses/splits, repayments, proposals, AI requests/history/images, audit, Calendar links and feedback. Maps/weather/disruption reads are derived. Historical preference tables were removed by forward migration 0049; manual account instructions replace them. [Database contract](DATABASE.md).

Domain transactions use short locks and revision checks. No database lock is held across provider/network work. Before committing an external computation, recheck current identity, role, membership, trip range, target revision and audience. A batch's preflight validates every proposal before its first write; success, proposals and audit complete atomically. Financial arithmetic uses integer currency minor units, never model arithmetic or floating-point balances.

Existing canonical events stay intact while pending replacements are reviewed. Private reads intersect current visibility and retained effective-audience snapshots; owner status does not grant canonical private access. Member removal preserves accounting/history with explicit reassignment and tombstones. [Member removal](PUBLIC_TRIPS_AND_MEMBERS.md) · [expenses](TRIP_EXPENSES.md).

Authentication has a 24-hour rolling window within a fixed 30-day fresh-authentication ceiling, independent of trip dates. Switching/creating trips cannot reset that ceiling. Exact issuer/subject binding, opaque purpose-hashed tokens, CSRF/origin checks, membership revalidation and no-store responses are server boundaries. [Identity/security](IDENTITY_AND_SECURITY.md).

## AI transport boundary

Server-side adapters call models with the key `getAiPolicy` chooses for the request: the requester's own, a trip owner's shared key, or the server operator's in a sponsored trip. Users' keys are decrypted only in the web server and carried in an `AsyncLocalStorage` credential context (`src/lib/ai/credential-context.ts`) with a private per-request provider directory. Operator-funded work enters an explicit operator context, and outside any context the adapters refuse to run. The adapters are OpenAI through the official Codex SDK, Anthropic through the Claude Agent SDK, and Google Gemini directly over its REST API (Gemini API, projectless Vertex express, or project/location Vertex with a service-account-bound key). Google modes are explicit, never guessed from a key or switched on failure. SDK subprocesses receive an explicit environment allowlist (`src/lib/ai/provider-environment.ts`): operating-system, locale and proxy settings plus provider keys and state directories, never database URLs, session or OAuth secrets, map keys, base-URL overrides or the feedback publisher token. Gemini calls run in-process with the key in a request header and Google Search grounding as the only tool. Credentials never enter the browser, prompts or ordinary app logs. No undocumented endpoint, consumer-subscription login, browser-token harvesting or silent model switch is used.

An explicit Free AI choice uses a separate keyless Kilo credential context (`free-model.ts`), never a key. With no paid funding it can be the default. The adapter checks a fresh zero-price catalog, excludes restricted routes, selects native schema/JSON-object/schema-prompt output by capability, and reserves every upstream attempt under a short shared database lock (`free-attempt.ts`), including retries/fallbacks. Application validation is independent of generation mode. `free-context.ts` projects trip-wide planning fields without private events, expenses, notes, URLs or saved instructions; free memory excludes paid turns and shared summaries. No images, search or background calls use this lane. [Free contract](AI_AND_AGENTS.md#free-ai-for-every-account-job-086-d-098).

The planner gets application-built context and emits typed proposal envelopes, not database-write tools. Public research is separately projected and bounded. No shell, arbitrary files/network, GitHub/cloud credentials or deployment capability is exposed to in-app AI. In operator-funded requests, premium choice is reserved for the verified platform operator acting as a trip owner; others use Sol within the trip limit. Users' keys and the explicit free choice are separate routes. Creating a trip does not confer operator privileges. [AI funding](PUBLIC_TRIPS_AND_MEMBERS.md#ai-funding-is-not-a-trip-role).

| Boundary | Current maximum / behavior |
| --- | --- |
| Whole planning work | 180 seconds text; 225 seconds with images. |
| Image extraction | Up to 45 seconds within the same work budget. |
| Isolated public research | One round, at most three subjects, up to 90 seconds; reserve 60 seconds for finalization when budgeting. |
| Optional hours fallback | Launch only with at least 30 seconds remaining. |
| Timestamp-only repair | At most one same-model/no-tools correction; at least 15 seconds remaining. |
| Browser delivery wait / route ceiling | 200/245 seconds; route ceiling 300 seconds. |
| Active-request fence | 600 seconds, one per immutable bound user across trips; different users can run concurrently. |

Timeouts are ceilings, not guaranteed response times. Provider limits remain even for an app-quota-exempt operator. Cleanup failure is separate metadata and cannot turn completed output into a false provider failure. Failed calls are not silently replayed/switched.

Client idempotency binds to payload/conversation. Completion persists a safe result envelope with fenced proposals; self-only status GETs recover after phone suspension without another provider call. Expired work cannot commit late. [Recovery](AI_REQUEST_RECOVERY.md).

Context is provider-neutral: current authorized canonical data, versioned checkpoint, newest complete successful exchanges within a 6,000-token budget, one lower-trust manual-instruction snapshot, and any separate root-bound clarification draft. The free route uses the narrower projection and free-only history described above instead. History is not mutation authority. [Full harness contracts](AI_AND_AGENTS.md).

Destination Auto is a separate account-level exception: a tool-free Sol (low effort) public-place lookup for eligible creators, versioned validated cache and explicit form submission. It neither supplies planner context nor grants general AI funding. [Defaults](TRIP_DESTINATION_DEFAULTS.md).

## 5. Integrations and derived state

- **Calendar:** per-member encrypted grants, explicit idempotent export/import, account-bound receipts, private-by-default imports and silent background reads. Current canonical privacy is always rechecked. Deterministic occupancy excludes lodging/background availability and strong duplicates. [Import](CALENDAR_IMPORT.md) · [conflicts](CALENDAR_CONFLICTS.md).
- **Maps:** MapLibre/OSM rendering that loads when a day map is opened, with bounded Photon/FOSSGIS lookups, cached for trip-visible places only. No paid Google or LLM fallback. Unknown pins/times stay unknown; private places are included unless the viewer turns them off (D-081). [Daily map](DAILY_MAP.md).
- **Weather:** deterministic Open-Meteo, seven-day horizon, 30-minute freshness, role-specific location/departure/destination targets. Per-member short leases coalesce refreshes; no held connection during network work, bounded 25-second provider budget. Private/unresolved exact locations use labeled trip-area fallback, not fabricated precision.
- **Disruptions:** the scheduled monitor is designed to run every five minutes; by default each run processes one oldest-due trip batch of up to four public approved planned events. Current local-day intervals use 30-minute default cadence; future seven-day events use rolling 24 hours. Sol/medium public search has a 120-second call ceiling. Immutable observations plus revision/freshness/direct-material-impact checks control display; failures do not resolve warnings or advance successful checks. [Qualification](DISRUPTION_CONFIDENCE.md).
- **Feedback:** private report API and bounded action trail, separate Astra/medium reviewer and deterministic Issues-only publisher that files only in a verified private repository. New reports are review-eligible; old opt-outs remain. No automatic fixes/PRs/deploys, and no publisher credential in planner subprocesses. [Feedback](FEEDBACK.md).

## 6. Browser and offline behavior

The app shell projects authorized events/proposals into timeline cards; transport endpoints remain one underlying event. The shared [event-zone resolver](EVENT_LOCAL_TIME.md) uses explicit corrections and offline airport/location evidence, with a labeled unknown fallback. UTC instants and trip-zone grouping remain canonical; flight recognition changes display only. [Cards/editor](MOBILE_CARDS.md) reuse the same result. There is one light/dark layout ([screen layout](UI_LAYOUTS.md)); Itinerary/Expenses default to today expanded and Overview is selected-day-only. [Localization](LOCALIZATION.md) keeps safety copy neutral.

The service worker warms a locale shell/static assets, never authenticated API responses. Separate bounded offline storage allows public confirmed display records only (up to 500 events/370 days), including safe flight-kind/known-zone metadata but no flight numbers or terminal/gate/booking facts; excludes private events, notes, expenses, pending proposals, AI, Calendar, weather/disruption and credentials. It is read-only, falls back for network/5xx rather than authorization denial, and is purged on sign-out. Browser retention is not guaranteed.

Optional open-app disruption notifications are deduplicated by content/episode with device receipts and Web Locks. There is no server Web Push/VAPID delivery or guaranteed closed-phone wake. [Communications](COMMUNICATIONS.md).

## 7. Reliability, recovery and future work

Application-level safeguards are bounded worker deadlines, database-gated due work, idempotent outbox delivery, revision fences and no locks across network calls. They do not create an availability SLA. Process restarts, backups, log retention and alerting belong to the deployment; database backup and restore rules are in [database](DATABASE.md#4-dump-and-restore-contract).

An external MCP connector is planned, not implemented ([roadmap](ROADMAP.md)). Discord delivery, full route-based reminders and provider-managed conversation IDs are not implemented, regardless of interface names or older design prose.
