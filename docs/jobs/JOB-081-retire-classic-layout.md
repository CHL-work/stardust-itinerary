---
id: JOB-081
title: Retire the classic layout and the layout toggle
status: done
priority: P2
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-07T06:20Z
---

## Outcome

On 7 November 2026 the owner asked to remove the classic UI. The layout that has been the default since October 2026 is now the only one, light or dark with the system (D-093).

## Scope

- **In:**
  - the layout toggle in the live and offline headers, and the Settings **Screen layout** card;
  - the stored preference and the mode store;
  - the classic-only markup and styles: the old phone bottom bar, the Overview date selector and swipe hint, and the sidebar's placeholder progress bar;
  - their copy and tests, the README screenshots, and the documents.
- **Out:**
  - behavior, data, APIs and permissions;
  - the base stylesheet `globals.css`, beyond rules nothing uses any more;
  - the `:root[data-ui="new"]` scoping of the layout files, kept so their specificity over `globals.css` does not change.

## Delivered

1. **One layout:** `src/app/layout.tsx` renders `<html data-ui="new">` with the light and dark theme colors and `colorScheme: "light dark"`. `src/lib/document-language-bootstrap.ts` keeps only the early `<html lang>` step of the old bootstrap.
2. **Removed:**
   - `src/lib/ui-mode.ts`, `src/lib/ui-mode-store.ts`, `src/components/new-ui/ui-mode-toggle.tsx`, `src/components/new-ui/ui-mode-sync.tsx` and `src/app/new-ui/layout-toggle.css`;
   - the toggle and Settings copy in four locales;
   - the layout checks in the bottom bar, AI button, trip bar and day chips, which now always render.
3. **Classic-only markup and styles:** removed from `app-shell.tsx`, the layout stylesheets and `globals.css`. The offline header keeps its actions wrapper, now styled in `shell.css`.
4. **Screenshots:** the five README screenshots were retaken from a local build without the toggle, the [same way](JOB-076-readme-screenshots.md#how-the-screenshots-were-made) with synthetic data.
5. **Documents:** [screen layout](../UI_LAYOUTS.md), rewritten as a single-layout reference; `AGENTS.md`; architecture, design, implementation, mobile cards, feedback, identity and security, destination defaults, localization, the documentation policy and index; and [D-093](../DECISIONS.md), which supersedes the October 11, 2026 layout decision.

## Verification

- **Unit tests:** the layout guard checks the scoped stylesheets, the root layout's `data-ui="new"`, theme colors and language bootstrap, and that no toggle, Settings card or classic-only markup comes back. The bootstrap test covers every locale route and confirms the script reads no storage and sets no layout attribute.
- **Full check:** `pnpm check` (lint, types, unit and database tests, build, smoke) on a disposable PostgreSQL 17 database.

## Rollback

Revert the commit. There is no migration or data change; a browser that kept `stardust.ui-mode.v1` would follow it again.
