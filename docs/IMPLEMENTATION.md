# Implementation Reference

Source map and safe verification guide. Runtime topology is in [architecture](ARCHITECTURE.md); hosting is in [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md).

## 1. Implemented scope

- Google-bound accounts, revocable rolling sessions, assigned/reusable invitations, trip switching, owner trip creation/date settings, safe member removal and owner trip deletion that keeps records.
- Shared/private canonical events and visible pending projections, owner review/history, endpoint-specific transport rows, revisioned editing and cancelled-event tombstones.
- Per-person expense summaries, equal/exact splits, multiple bills per event, atomic linked-event bills and manual repayments.
- AI through the official Codex SDK and Claude Agent SDK: text/pictures, typed proposals, private browseable history, bounded memory/clarification drafts, manual account instructions, isolated public research and recoverable delivery.
- Optional per-member Calendar export/import with duplicate receipts; silent passive refresh and deterministic conflicts.
- Explicit-load MapLibre/OSM day map, deterministic weather, backend qualified disruptions and bounded read-only public offline itinerary.
- New default/classic optional UI, four locales, Advanced settings, owner Activity and private feedback with a separate issue-only pipeline.
- Destination Auto defaults (time zone/currency suggestions) for eligible trip creators.

Not shipped: external MCP connector, classic-layout retirement, structured preference collection (removed), full route-based reminders, Discord/Telegram delivery, closed-app push or automatic feedback fixes. Default-off public signup and operator/funding boundaries still apply.

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
- Browser verification should cover phone/desktop, relevant locales, pending/private permissions and both layouts while the classic layout remains.
- Docs-only changes need link/anchor and diff checks, not a fabricated claim of new runtime/LLM verification.

Record commands, results and skips in the job file ([job system](JOB_SYSTEM.md)) and follow the [documentation policy](DOCUMENTATION_POLICY.md). Earlier evidence is historical, not proof of a fresh run.

## 5. Routes

| Area | Main routes |
| --- | --- |
| Public/UI | `/[locale]`, `/trips/new`, `/privacy`, `/terms`; app sections are shell state, not one route per tab. |
| Account/session | `/api/auth/google/{start,callback}`, `/api/auth/trip`, `/api/auth/sign-out`, session/claim/join endpoints. |
| Trip | `/api/trips`, `/api/trips/destination-defaults`, `/api/trips/[tripId]/settings`, members, permissions and join links. |
| Read/edit/review | `/api/app/overview`, trip change-requests, payments, itinerary removal and authorized Activity detail. |
| AI | Trip `ai`, `ai/settings`, `ai/instructions`, conversation/history, request recovery and private image endpoints. |
| Calendar | Integration consent callbacks; per-trip Calendar, sync, import/preview and public-location lookup. |
| Derived/feedback | Per-trip map/weather refresh, `/api/feedback`, operator feedback review and `/api/health`. |

The exact filesystem routes under `src/app/api/` are authoritative. Authentication, origin/body validation, role/audience and no-store enforcement belong at each boundary; hiding a button is insufficient.

## 6. Code map and configuration

| Path | Purpose |
| --- | --- |
| `src/components/app-shell.tsx` | Shared app orchestration/presentation; topic components isolate newer controls. |
| `src/components/new-ui/` | New-layout additions; new-only styles stay scoped to `:root[data-ui="new"]`. |
| `src/lib/app/repository.ts`, `validation.ts`, `types.ts` | Canonical transactions, proposal policy, model registry and shared contract. |
| `src/lib/auth/` | Google binding, account/trip sessions, invitation and operator authority. |
| `src/lib/domain/` | Deterministic expense/balance/conflict/reminder primitives; primitives do not imply a scheduled reminder service exists. |
| `src/lib/ai/` | Planner/adapters, context, drafts, images, validation/repair, public research and recovery. |
| `src/lib/calendar|maps|weather|disruptions|feedback/` | Separate integration policies and derived data. |
| `database/migrations/`, `tests/database/` | Immutable forward SQL and destructive-disposable integration tests. |
| `scripts/` | Migrations, seeds, smoke, workers, guarded synthetic evaluations and maintenance tools; read before invoking. |

Server secrets come from runtime configuration (environment or the deployment's secret store), never public client variables or Git. Provider subprocesses receive only an allowlisted environment (runtime settings plus provider API keys); the feedback reviewer and destination lookup use narrower allowlists still. Destination lookup, general planner funding and feedback publication are independent settings; enabling one does not enable the others. See [security](IDENTITY_AND_SECURITY.md) and [AI boundary](AI_AND_AGENTS.md).

## 7. Schema, release and rollback

Current source has **49 SQL files through 0053**. Numeric gaps 0045–0048 are not missing migrations to invent: they belong to unrelated historical work. Applied checksums cannot be rewritten. Migration 0049 removed structured preferences and is incompatible with pre-0049 runtime rollback; 0050 is additive account-level lookup storage; 0051 moves current AI selections to the newest models, so a code rollback must first reverse them; 0052 adds trip deletion state; 0053 records API-key authentication for new AI requests. Details are in the [database compatibility checkpoints](DATABASE.md#compatibility-checkpoints).

Release and rollback procedures depend on the hosting option: see [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md). Take and verify a backup before migrating a database that holds real data.

## 8. Planned work

Planned work is listed in the [roadmap](ROADMAP.md) and tracked as job records under `docs/jobs/` (see [job system](JOB_SYSTEM.md)). Historical jobs JOB-001 to JOB-057 and their verification evidence are kept in a private archive; this reference does not repeat old test counts or deployment records.
