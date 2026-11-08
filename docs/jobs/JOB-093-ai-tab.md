---
id: JOB-093
title: One AI tab with usage and estimated cost, keys, instructions and past conversations
status: done
priority: P2
depends_on: [JOB-066, JOB-086]
claimant: Claude
branch: agent/JOB-093-ai-tab
started: 2026-11-08T07:45Z
---

## Outcome

On 8 November 2026 the owner asked for one AI tab: a token usage chart with an estimated cost and which service used how many tokens, API keys and AI instructions moved from Settings, and past conversations at the bottom under a Conversations section, with every section collapsible (D-105).

## Scope

- **In:**
  - collapsible sections on the AI tab: Chat, Usage, Routine checks (JOB-094), API keys, AI instructions and Conversations;
  - a 30-day token chart by service, an estimated cost for requests your key pays for, and per-service and per-model tables;
  - a published price table, checked against the providers' pricing pages;
  - moving API keys and AI instructions out of Settings, and pointing copy that names "Settings → AI keys" at the AI tab;
  - every language, tests and documents.
- **Out:**
  - a spending cap or budget alert;
  - the owner's trip AI log and access settings, which stay in Settings → Advanced.

## Delivered

1. **Sections:** `src/components/ai-tab.tsx` composes Chat (transcript, composer, chat effort), Usage, Routine checks (JOB-094), API keys and AI instructions (the existing editors in an embedded mode) and Conversations at the bottom. `ai-section.tsx` is a native disclosure; `src/lib/ai/section-preference.ts` remembers open sections per browser. Choosing a past conversation opens Chat and scrolls to it.
2. **Usage:** `GET /api/trips/{tripId}/ai/usage` (`src/lib/ai/usage-summary.ts`) sums 30 UTC days of the account's requests, members' requests on its shared key, routine checks its key paid for and its destination lookups, by day, service and model. `ai-usage-section.tsx` draws a stacked SVG bar chart in validated categorical colors (stepped for dark mode), a legend, a tap readout and two tables.
3. **Estimate:** `src/lib/ai/model-prices.ts` holds published standard prices for every registered model with dated windows, plus search fees; only requests on the account's own keys carry a cost. `ai_requests.web_search_count` (migration 0068) records searches from now on.
4. **Moved from Settings:** API keys and AI instructions; the unsaved-instructions guard now protects leaving the AI tab. Copy that named Settings → AI keys names AI → API keys in every language.
5. **Copy:** a new `aiTab` catalog in English, both Cantonese tones (neutral), Japanese and the eight packs.

## Verification and documentation impact

- Full `pnpm check` passed in an isolated worktree: lint, types, 6,242 unit tests in 273 files, the database suite on disposable PostgreSQL 17, the production build and the smoke test.
- Production: commit `9985cf3` passed CI and the deploy workflow on November 8, 2026 (pre-deploy backup and migration jobs completed). Both web pods run it with `ROUTINE_CHECKS_ENABLED=true`, `/api/health` reports the database ready, the new usage and preferences endpoints refuse signed-out requests, and a read-only probe confirmed migration 0068 and its columns, with no preference rows yet. No real trips were written.
- Unit tests: prices and windows, usage aggregation and payer rules, the chart and tables, section memory, the moved editors and the locale packs. Database test at migration head: preferences, payer selection, request records and the usage summary.
- Documents: new [AI tab contract](../AI_TAB.md); D-105; index, design, layouts, conversation history, instructions, keys, members and funding, identity, implementation, database, sources, changelog and roadmap.
