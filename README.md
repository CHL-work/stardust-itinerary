# Stardust Itinerary / 星塵遠征軍

A private group-trip planner for up to 20 members per trip. Next.js 16, React 19, TypeScript, PostgreSQL 17, Node 24. It coordinates itineraries and expenses; it does not book travel or move money.

## Start here

- **Taking over:** [current handoff](docs/HANDOFF.md), then [agent rules](AGENTS.md).
- **Production operations:** [VM runbook](docs/VM_HOSTING.md). The VM is the only writer; never serve or migrate back the retired PC database.
- **Development:** [source/feature map](docs/IMPLEMENTATION.md), [decisions](docs/DECISIONS.md), and the relevant [job](docs/jobs/README.md).
- **Copyable handover:** [next-agent prompt](docs/NEXT_AGENT_PROMPT.md).

Production: [stardust-itinerary.chl-work.com](https://stardust-itinerary.chl-work.com). The recorded app release is `c620469`; later ops/docs commits do not imply another deployment.

**Accepted shutdown:** final backup/writer stop **2026-11-11 23:30 UTC** (17:30 Chicago); VM deletion **2026-11-12 00:00 UTC** (November 11, 18:00 Chicago). No replacement/extension is authorized. Recovery storage is not automatically deleted.

## Current capabilities

- Google sign-in, remembered trip selection, self-service ownership, invitations, owner/editor/viewer roles; public signup stays gated.
- Date-grouped/private itineraries, separate transport endpoint rows, optional ends, pending review and owner-editable trip dates.
- Linked expenses, equal/custom shares, personal spending/balance summaries and recorded repayments.
- Private AI conversations, image imports, resumable drafts, public-fact research and manually saved personal instructions. Application code validates/applies proposals; models cannot write the database.
- Optional Calendar connection/import, deterministic conflicts, MapLibre/OSM day maps, weather and qualified disruptions.
- Four locales, new/classic layouts, best-effort read-only offline itinerary, private feedback and owner audit/usage views.
- Create Trip **Auto** uses bounded subscription Sol lookup or validated cache to suggest time zone/currency for eligible creators. Manual choices remain; a lookup never submits a trip.

These features do not authorize new AI funding, providers or public signup. Detailed permissions/limits belong to the contracts below.

## Development and verification

Use Node 24 and the pnpm version pinned in `package.json`, in a clean development worktree with synthetic fixtures.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
```

Application changes also require `pnpm check`: a **disposable, explicitly confirmed test database**, production build and self-terminating smoke. Read [database safeguards](docs/DATABASE.md) and [isolated development](docs/LOCAL_OPERATIONS.md) first. Never use production or stale PC data, register retired Windows tasks, or start that origin. Provider calls and production changes require explicit authorization.

Deploy only through the [VM release procedure](docs/VM_HOSTING.md#deploying-a-release) after owner approval. Never edit a sealed release; the current app uses the separately installed corrected activation helper documented there.

## Documentation map

| Area | Reference |
| --- | --- |
| Design and source | [Design](docs/DESIGN.md), [Architecture](docs/ARCHITECTURE.md), [Implementation](docs/IMPLEMENTATION.md) |
| Identity, roles, privacy | [Security](docs/IDENTITY_AND_SECURITY.md), [Members](docs/PUBLIC_TRIPS_AND_MEMBERS.md) |
| AI | [Harness](docs/AI_AND_AGENTS.md), [Instructions](docs/AI_CUSTOM_INSTRUCTIONS.md), [History](docs/AI_CONVERSATION_HISTORY.md) |
| Money | [Expenses](docs/TRIP_EXPENSES.md), [Repayments](docs/MEMBER_PAYMENTS.md) |
| Calendar/map | [Import](docs/CALENDAR_IMPORT.md), [Conflicts](docs/CALENDAR_CONFLICTS.md), [Day map](docs/DAILY_MAP.md) |
| UI | [Layouts](docs/UI_LAYOUTS.md), [Cards](docs/MOBILE_CARDS.md), [Localization](docs/LOCALIZATION.md) |
| Operations | [VM runbook](docs/VM_HOSTING.md), [Backups](scripts/cloud-backup/README.md), [Secrets](docs/SECRETS.md) |
| Feedback/usage | [Feedback](docs/FEEDBACK.md), [Activity](docs/ACTIVITY.md), [Cost](docs/COST_OBSERVABILITY.md) |
| Work discipline | [Jobs](docs/jobs/README.md), [Job system](docs/JOB_SYSTEM.md), [Doc index/policy](docs/DOCUMENTATION_POLICY.md), [Changelog](CHANGELOG.md) |

Approved icon: `public/brand/stardust-app-icon-v3.png`; OAuth asset: `public/stardust-oauth-logo.png`. Historical concepts: `public/brand/archive/`.

Historical rollout evidence remains in dated job records and Git history, not active instructions.
