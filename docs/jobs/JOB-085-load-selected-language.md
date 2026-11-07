---
id: JOB-085
title: Load only the selected language, with English first in the language menus
status: done
priority: P2
depends_on: [JOB-084]
claimant: CHL-work
branch: main
started: 2026-11-07T09:15Z
---

## Outcome

On 7 November 2026 the owner asked to load only the selected language, and to always show English at the top of the language menus (D-097). After [JOB-084](JOB-084-more-languages.md), every visitor's browser downloaded all eight translation packs, and the create-trip page carried time zone and currency choices for all twelve locales.

## Scope

- **In:**
  - keeping language packs out of browser code;
  - sending each page only its own language's pack;
  - one language's choices on the create-trip page;
  - English first in both language menus;
  - a build check, tests and documents.
- **Out:**
  - a native speaker's review of the packs;
  - splitting the four original locales' catalogs, which stay in browser code.

## Delivered

1. **Two pack stores:**
   - `src/lib/locale-packs/store.ts` imports every pack for the server, tests and scripts.
   - `store.browser.ts` is empty; the `turbopack.resolveAlias` entry in `next.config.ts` swaps it in for client builds.
2. **One pack per page:**
   - The locale, admin and create-trip pages pass `localePack(locale)` to `LocalePackScope` (`src/components/locale-pack-scope.tsx`), which installs the pack before the page renders.
   - The original four locales send none.
3. **Lazy records:** `messages` and the feedback copy are built when their modules load. They now read the added languages when used (`withPackLocales`), so they show a pack installed afterwards. Before a pack is installed, its text falls back to English without being cached.
4. **Create trip:**
   - The page sends only the selected language's choices.
   - Choosing another language reloads the page with `?locale=`, keeping what was typed; until it loads, the menu shows the choice and the form cannot be sent.
   - Choices are built once per language per server process, and each request gets its own copy.
5. **Menus:** `menuLocales` lists English first, then the other languages, in the header menu and on the create-trip form.
6. **Guard:** the smoke test renders the Spanish page with its pack. It also fails if any of 24 phrases from six packs appears in a client chunk, raw or `\u`-escaped.
7. **Documents:**
   - [D-097](../DECISIONS.md), with D-096's cost note superseded;
   - [localization](../LOCALIZATION.md), [architecture](../ARCHITECTURE.md), [design](../DESIGN.md), [layouts](../UI_LAYOUTS.md) and [members and trips](../PUBLIC_TRIPS_AND_MEMBERS.md);
   - [self-hosting](../SELF_HOSTING.md) `DEFAULT_LOCALE` values, which JOB-084 had missed, with the design document's language list;
   - the roadmap, changelog and [JOB-084](JOB-084-more-languages.md).

## Verification

- **Unit tests** (`locale-pack-loading.test.ts`, with the browser's empty store):
  - English shows until a pack is installed, and then the pack, including in records built at load;
  - other languages stay English;
  - a pack for an original locale, a malformed pack and a second install are ignored;
  - the browser store is empty and aliased in `next.config.ts`;
  - English heads the menus.
- **Create-trip tests:** one language's choices, English first in the form's menu, and a language change that reloads the page without sending the form.
- **Full check:** `pnpm check` on a disposable PostgreSQL 17 database, including the smoke test's pack guard.
- **Browser** (the f8aa059 production build, run locally as a guest):
  - The Spanish page hydrates in Spanish, with no hydration warnings.
  - Switching to German, then Simplified Chinese, from the menu changes every label without a reload, including the feedback button outside the page.
  - On the create-trip page, choosing German reloads the copy and time zone names in German, and keeps a typed trip name.
  - English heads both menus.
- **Production** (commit f8aa059):
  - Browser code for every page fell from 1,925 KB (565 KB compressed) to 1,375 KB (399 KB compressed).
  - A page in an added language carries its pack in the page data: 113 KB of HTML (33 KB compressed) instead of 36 KB (11 KB).
  - The English, Cantonese and Japanese pages are unchanged at 34 KB (10 KB).
  - The guard's 24 phrases were all found in the previous production code and are absent now.
  - All eight language pages render their own text.

## Rollback

Revert the commit; there is no migration. Browsers then download every pack again.
