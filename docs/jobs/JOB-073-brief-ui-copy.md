---
id: JOB-073
title: Brief UI copy, with a few "?" buttons for details
status: done
priority: P2
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-06T21:00Z
---

## Outcome

On 6 November 2026 the owner said the UI should be brief: sections had too many words, and most warnings were unnecessary because nobody reads them. Their examples were the day map's disclosure and its **Privacy details** section, the AI memory notice, and the picture picker's note. Anything that needs explaining should sit behind a "?" button that people can click, without too many of those buttons.

Decision: [D-088](../DECISIONS.md#d-088-brief-ui-copy-with-details-behind-a-few-help-buttons-accepted-november-6-2026).

## Delivered

1. **Removed:**
   - the day map's **Privacy details** section;
   - the AI memory notice in the AI card;
   - the context line under each AI reply, which now appears only when older messages were summarized;
   - the instruction-timing and boundary notes in Settings.
2. **A "?" button** (`src/components/info-tip.tsx`) uses the browser's popover: it closes on Escape or a tap outside, has a 44px tap area, and adapts to light and dark themes. There are three:
   - the day map, for what loading it sends;
   - Settings → AI keys, for advice on a dedicated key with a spending limit;
   - the feedback form, for how reports are reviewed.
3. **Shorter copy** in English, Cantonese and Japanese, for:
   - notes and hints in the AI card, Settings, events, expenses, repayments, member removal, trip deletion, Calendar import, feedback and the admin page;
   - long errors and confirmations.

   Facts that matter stay: the old and new dates in a trip-date change, what to check when an AI change fails validation, that a pending event is not confirmed, that the Calendar connection is separate from sign-in, and that reports are reviewed by AI.
4. **Rules** in [localization](../LOCALIZATION.md) and the agent guide, so new copy stays brief.

## Verification

- **Unit tests:** the full suite, with expectations updated to the brief copy, and placeholder parity in every locale.
- **In a browser**, on a local production build at phone width with a synthetic guest trip:
  - the map shows no disclosure or **Privacy details**, and its "?" opens the short disclosure;
  - the AI card has no memory notice;
  - AI keys and feedback each show one short line and a "?";
  - the popover opens above the feedback dialog, and reads well in light and dark themes.

## Rollback

Revert the commit. There is no migration.

## Follow-up

This review read only the `*i18n.ts` modules. [JOB-075](JOB-075-expense-summary-help.md) covered the copy it skipped, starting with the expense summary.
