# Implementation Reference

Source map and safe verification guide. Runtime topology is in [architecture](ARCHITECTURE.md); hosting is in [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md).

## 1. Implemented scope

- Google-bound accounts, revocable rolling sessions, assigned/reusable invitations, trip switching, owner trip creation/date settings, safe member removal and owner trip deletion that keeps records.
- Shared/private canonical events and visible pending projections, owner review/history, endpoint-specific transport rows, revisioned editing and cancelled-event tombstones.
- Flight details on transport events (JOB-082), distinct plane icons (JOB-090), [location-local clocks for all events](EVENT_LOCAL_TIME.md) (JOB-091), and flight status checks in sponsored trips (JOB-083) or on an opted-in member's own key (JOB-094).
- Per-person expense summaries, equal/exact splits, multiple bills per event, atomic linked-event bills and manual repayments.
- AI through the official Codex SDK, Claude Agent SDK and Gemini REST API: text/pictures, typed proposals, private browseable history, bounded memory/clarification drafts, manual account instructions, isolated public research and recoverable delivery. AI-created events are trip-wide unless clearly solo (JOB-079), and AI expenses are split between everyone unless the request gives the parts (JOB-080).
- Bring-your-own provider keys, encrypted at rest and isolated per request (JOB-061). Trip owners can share them with chosen members (JOB-063).
- One [AI tab](AI_TAB.md) of collapsible sections: chat with a chat effort setting, 30-day token usage with an estimated cost, routine checks on the user's own key with model and effort, API keys, AI instructions and past conversations (JOB-093, JOB-094).
- Keyless Free AI for every active member and guest (JOB-086): every eligible catalog model is selectable, defaulting to free without an own saved key. Paid choices require that user's matching provider key. Text-only minimized context, pending review and exact request/upstream-attempt caps apply. The GKE web overlay enables and verifies the configuration; self-hosted base/Compose remains opt-in.
- Default-off 24-hour guest accounts starting at Create Trip, with no seeded data. A guest may create one empty isolated trip; Google sign-in never merges guest data (JOB-089).
- English-first onboarding with an explicitly selected language remembered on the browser and signed-in account (JOB-089).
- Optional per-member Calendar export/import with duplicate receipts; silent passive refresh and deterministic conflicts.
- MapLibre/OSM day map that loads when opened, deterministic weather, backend qualified disruptions and bounded read-only public offline itinerary.
- One light/dark layout (the classic layout was retired in JOB-081), twelve locales (eight of them translation packs, JOB-084, each page sending only its own language, JOB-085), Advanced settings, owner Activity and private feedback with a separate issue-only pipeline.
- Destination Auto defaults (time zone/currency suggestions) for eligible trip creators, on the creator's own key or a free model (JOB-094).

Not shipped: external MCP connector, structured preference collection (removed), full route-based reminders, Discord/Telegram delivery, closed-app push or automatic feedback fixes. Default-off public signup and operator/funding boundaries still apply.

## 2. Stack

Use `package.json` and lockfile, not copied install versions: Node 24 (`>=24 <25`), pnpm 11.19.0, Next 16.3.1, React 19.2.8, TypeScript 6.0.3, PostgreSQL via `pg`, Zod, Vitest and MapLibre. Codex SDK is pinned to 0.165.0, because 6.1 Terra needs CLI 0.159.0 or later; Claude Agent SDK is lockfile-resolved. Never upgrade dependencies just because a newer version exists.

Next standalone is the release artifact. Builds run map-asset preparation; standalone staging must include static/public assets. The `Dockerfile` packages the standalone server (port 8080); `compose.yaml` adds PostgreSQL 17 for self-hosting.

## 3. Where to work

Work on a branch in a clean checkout; check `git status` first and preserve unrelated changes.

Development uses synthetic data only: a local PostgreSQL 17 (for example `docker compose up -d postgres`), `.env.local` based on `.env.example`, `pnpm db:migrate`, optionally `pnpm db:seed` (redacted demo fixture) or `pnpm db:seed:local-trip`, then `pnpm dev` on `127.0.0.1:3100`. Google sign-in needs an OAuth client registered with the localhost callbacks listed in `.env.example`. Never point a development server, seed or test at a database holding real trips, and never attach production credentials or callbacks to a development server.

## 4. Verification

For implementation changes, the normal gate is `pnpm check`: lint → typecheck → Vitest → database suite → build → smoke. Inspect scripts before running; an environment-less database skip is **not** a passing database verification.

- Database tests require a separately created disposable loopback database and exact `TEST_DATABASE_CONFIRM_DESTROY` name; they reset its public schema. Never use a database holding real data. [Database test boundary](DATABASE.md#5-tests).
- Smoke uses the standalone artifact on `127.0.0.1:3210`; keep that port free and do not attach production credentials.
- Live AI evaluations are opt-in, consume the configured provider quota and require fresh per-evaluator synthetic databases. Some intentionally pin historical migrations. Never replay real user bookings/prompts or approve synthetic proposals in a real trip. [AI evaluations](AI_AND_AGENTS.md#11-evaluation).
- Browser verification should cover phone/desktop, light and dark themes, relevant locales and pending/private permissions.
- Docs-only changes need link/anchor and diff checks, not a fabricated claim of new runtime/LLM verification.

Record commands, results and skips in the job file ([job system](JOB_SYSTEM.md)) and follow the [documentation policy](DOCUMENTATION_POLICY.md). Earlier evidence is historical, not proof of a fresh run.

## 5. Routes

| Area | Main routes |
| --- | --- |
| Public/UI | `/[locale]`, `/trips/new`, `/privacy`, `/terms`; app sections are shell state, not one route per tab. |
| Account/session | `/api/auth/google/{start,callback}`, `/api/auth/trip`, `/api/auth/sign-out`, session/claim/join endpoints. |
| Trip | `/api/trips`, `/api/trips/destination-defaults`, `/api/trips/[tripId]/settings`, members, permissions and join links. |
| Read/edit/review | `/api/app/overview`, trip change-requests, payments, itinerary removal and authorized Activity detail. |
| AI | Trip `ai`, `ai/settings`, `ai/instructions`, `ai/keys`, `ai/preferences`, `ai/usage`, conversation/history, request recovery and private image endpoints. |
| Calendar | Integration consent callbacks; per-trip Calendar, sync, import/preview and public-location lookup. |
| Derived/feedback | Per-trip map/weather refresh, `/api/feedback`, operator feedback review and `/api/health`. |

The exact filesystem routes under `src/app/api/` are authoritative. Authentication, origin/body validation, role/audience and no-store enforcement belong at each boundary; hiding a button is insufficient.

## 6. Code map and configuration

Account-owned Secret Manager support (JOB-087) is opt-in for self-hosted instances and enabled on the public instance. `credential-secret-manager.ts` owns bounded cloud access; `credential-secret-lifecycle.ts` and `scripts/cleanup-credential-secrets.ts` remove unreferenced resources. Migration 0064 stores references and lifecycle metadata. [Setup, compatibility and security](AI_KEYS.md).

| Path | Purpose |
| --- | --- |
| `src/components/app-shell.tsx` | Shared app orchestration/presentation; topic components isolate newer controls. |
| `src/components/event-type-icon.tsx` | Fixed-size decorative inline SVGs selected from event type/resolved flight state, shared by canonical/pending/approval cards; no image fetch or added dependency. |
| `src/lib/app/flight-presentation.ts`, `airport-time-zones.ts`, `zoned-event-time.ts` | Offline airport/explicit-zone resolution, conservative legacy flight display, and DST-safe manual editing; canonical UTC instants and trip-date grouping stay unchanged. Catalog source/license are pinned by `scripts/generate-airport-time-zones.mjs`. |
| `src/lib/app/event-time-zones.ts`, `event-time-zone-contract.ts`, `place-time-zones.ts` | Shared all-event location-local resolution and correction lifecycle; pinned offline locality/coordinate data, no provider lookup. [Contract and generation](EVENT_LOCAL_TIME.md). |
| `src/components/new-ui/` | Layout components; layout styles in `src/app/new-ui/` stay scoped to `:root[data-ui="new"]`. |
| `src/lib/app/repository.ts`, `validation.ts`, `types.ts` | Canonical transactions, proposal policy, model registry and shared contract. |
| `src/lib/auth/` | Google binding, account/trip sessions, invitation and operator authority, suspension checks. |
| `src/lib/admin/`, `src/app/admin/`, `src/app/api/admin/` | The operator's admin page: overview, accounts, activity, suspension, the sign-up cap and daily counters (JOB-069). |
| `src/lib/domain/` | Deterministic expense/balance/conflict/reminder primitives; primitives do not imply a scheduled reminder service exists. |
| `src/lib/ai/` | Planner/adapters, context, drafts, images, validation/repair, public research and recovery; users' keys under the local ring or Cloud KMS (`credential-kms.ts`). Free transport/catalog in `free-model.ts`, minimized context in `free-context.ts`, parser-derived constrained output in `free-output-schema.ts`, cross-replica attempt quotas in `free-attempt.ts`. The member-scoped `api/trips/[tripId]/ai/free-models` route exposes eligible choices; `scripts/verify-free-ai-config.ts` checks effective rollout settings without provider or database calls. |
| `src/lib/calendar|maps|weather|disruptions|feedback/` | Separate integration policies and derived data. |
| `src/components/ai-tab.tsx`, `ai-section.tsx`, `ai-usage-section.tsx`, `ai-routine-section.tsx` | The AI tab's sections, usage chart and routine-check controls (JOB-093, JOB-094). |
| `src/lib/ai/model-prices.ts`, `usage-summary.ts`, `preferences.ts`, `effort.ts`, `routine-check-provider.ts`, `trip-destination-models.ts` | Published prices and usage estimates, account AI preferences and effort, provider-neutral routine checks with the web search gate, and trip setup on a user's key or a free model. |
| `src/lib/routine-checks/`, `src/instrumentation.ts` | Who pays for routine checks, and the web server's five-minute loop for member-funded checks (`ROUTINE_CHECKS_ENABLED`). |
| `database/migrations/`, `tests/database/` | Immutable forward SQL and destructive-disposable integration tests. |
| `scripts/` | Migrations, seeds, smoke, workers, guarded synthetic evaluations and maintenance tools; read before invoking. |

Server secrets come from runtime configuration (environment or the deployment's secret store), never public client variables or Git. Provider subprocesses receive only an allowlisted environment (runtime settings plus provider API keys); the feedback reviewer and destination lookup use narrower allowlists still. Destination lookup, general planner funding and feedback publication are independent settings; enabling one does not enable the others. See [security](IDENTITY_AND_SECURITY.md) and [AI boundary](AI_AND_AGENTS.md).

## 7. Schema, release and rollback

Current source has **63 SQL files through 0067**. Numeric gaps 0045–0048 are historical, not missing migrations to invent. Applied checksums cannot be rewritten. Review the [database compatibility checkpoints](DATABASE.md#compatibility-checkpoints) before choosing an older runtime; 0067 adds optional event-zone corrections and must retain a zone-aware writer after use.

Release and rollback procedures depend on the hosting option: see [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md). Take and verify a backup before migrating a database that holds real data.

## 8. Planned work

Planned work is listed in the [roadmap](ROADMAP.md) and tracked as job records under `docs/jobs/` (see [job system](JOB_SYSTEM.md)). Historical jobs JOB-001 to JOB-057 and their verification evidence are kept in a private archive; this reference does not repeat old test counts or deployment records.
