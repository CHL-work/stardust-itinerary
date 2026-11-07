---
id: JOB-084
title: Eight more languages, and "Cantonese" in the README
status: done
priority: P2
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-07T07:54Z
---

## Outcome

On 7 November 2026 the owner asked two things:
- call the Cantonese interface just "Cantonese" in the README;
- add Simplified Chinese, Traditional Chinese and six more of the languages most used on the internet.

The six are Spanish, Brazilian Portuguese, French, German, Russian and Indonesian; Arabic is left out because the layout is left-to-right only (D-096).

## Scope

- **In:**
  - the eight locales and their translation packs;
  - every catalog selector, the language menus and the browser-language guess for guests;
  - AI response languages, map labels and fonts;
  - migration 0063;
  - tests and documents.
- **Out:**
  - right-to-left layouts;
  - a native speaker's review of the packs;
  - disruption details in the added languages, which keep English;
  - sending only the selected language's pack and create-trip choices to the browser, done in [JOB-085](JOB-085-load-selected-language.md). Before that, every pack shipped in browser code, about 185 KB compressed, and the create-trip page carried about 96 KB of compressed choices for twelve locales, up from 32 KB.

## Delivered

1. **Locales:** `zh-CN`, `zh-TW`, `es`, `pt-BR`, `fr`, `de`, `ru` and `id` follow the original four in `locales` (`src/lib/i18n.ts`), with native names in the language menu and the create-trip form (`localeNames`).
2. **Packs:**
   - One JSON file per language in `src/lib/locale-packs/`, with 39 sections and about 1,400 strings each.
   - `localizedCatalog` gives the four original locales their own catalog, and an added language the English catalog with its pack laid over it, so a gap shows English.
   - Every catalog selector reads through it: the main messages and 38 feature catalogs, including copy moved out of the create-trip form and the feedback review panel into plain modules.
   - `catalogs.ts` lists each section with the English catalog it translates.
3. **Translation:** AI drafted each pack from the English copy, with the Japanese and Cantonese text for context, under one brief:
   - placeholders kept and brief copy;
   - one term per concept;
   - `zh-TW` in Taiwanese Mandarin, not Cantonese;
   - Russian counts written as "label: number".
4. **Language follows the locale:**
   - AI answers, through a response-language instruction per locale, and image-extraction prose;
   - map labels, and `Intl` country, time zone and currency names;
   - `<html lang>` before paint, with Simplified and Taiwanese Chinese font stacks;
   - a guest's demo trip, from the browser's language;
   - feedback diagnostics.
   Disruption details show in English.
5. **Data:** migration 0063 adds the eight locales to the checks on `trips.default_locale`, `account_ai_lookups.display_locale` and the feedback diagnostics locale.
6. **Layout:**
   - The language menu is a little wider, and scrolls on short screens.
   - The repeated brand subtitle is hidden in every language that keeps the English name.
   - With six owner tabs at 375px, the German, French and Indonesian bottom-bar labels ran into each other. They now use shorter words: German Plan and Anfragen, French Frais and À valider, Indonesian Biaya.
   - The Latin- and Cyrillic-script languages get a narrower tab icon pill, and a word still too long hyphenates. Every language fits from 360px; at 320px a few labels run a few pixels long, as English nearly does.
7. **Documents:** the README; [D-096](../DECISIONS.md); [localization](../LOCALIZATION.md); [disruption languages](../DISRUPTION_LOCALIZATION.md); [database](../DATABASE.md); the documentation index and policy; and current-state wording in the implementation, member, destination, image, calendar, feedback and layout documents.

## Verification

- **Pack tests** (`src/lib/locale-packs/locale-packs.test.ts`):
  - every section the code reads is listed;
  - every pack has every English string with the same placeholders and lists;
  - no English sentence is left;
  - no "(s)" and no Cantonese-only characters.
- **Existing tests over every locale:** counts in the singular and plural, number and time formats per locale, the guest browser-language guess, the language bootstrap, and invalid-locale examples changed to a locale that is still unsupported.
- **Database tests** (`tests/database/more-locales.mjs`): trips and feedback diagnostics accept the eight locales and refuse unknown ones, both checks list all twelve, and a Spanish guest's demo trip and events are written in Spanish.
- **Phone check:** the production build at 375px, signed in as a local guest:
  - the German Expenses page and tab bar;
  - the twelve-language menu, which fits a 375 by 812 screen;
  - Simplified Chinese fonts and `lang`;
  - a Traditional Chinese demo trip from a `zh-TW` browser.
  Measured: no text runs off the screen on the German, French and Russian main pages, and every language's tab bar fits at 360 and 375px.
- **Full check:** `pnpm check` on a disposable PostgreSQL 17 database.

## Rollback

Revert the commit. Migration 0063 only widens checks, and an older build never writes the new locales; trips created in one keep their stored locale.
