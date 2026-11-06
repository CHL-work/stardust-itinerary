---
id: JOB-075
title: Expense summary notes behind its "?" help, and the copy JOB-073 missed
status: done
priority: P2
depends_on: [JOB-073]
claimant: CHL-work
branch: main
started: 2026-11-06T22:40Z
---

## Outcome

On 6 November 2026 the owner found the expense summary still too long: the note under the balance and the paragraph on what is excluded. They asked for it behind a "?".

JOB-073's copy review read only the `*i18n.ts` modules, so it skipped copy kept elsewhere: the expense summary's `src/lib/expense-copy.ts` and copy objects inside a few components.

Decision: [D-088](../DECISIONS.md#d-088-brief-ui-copy-with-details-behind-a-few-help-buttons-accepted-november-6-2026); no new decision.

## Delivered

1. **Expense summary and the Overview widget:**
   - no notes under the three figures. Each figure already had a "?" that opens its explanation in place, so nothing covers an amount, and what its note said is there now;
   - the balance note opens the balance help;
   - the exclusions are in the help for **My own trip expenses**: pending, draft and void expenses, events without a bill, and currencies kept apart. That help already said it counts only expenses you can view, and the bill-paid help says it is not bank-verified;
   - no new "?" buttons; the settlement and owner-totals notes are one short line.
2. **Trip creation:** the intro is one line, and what **Find defaults** sends moved behind a "?" beside the button, the fourth `InfoTip`.
3. **Guest sign-in:** the line no longer says AI needs your own key. Since JOB-071, guests may have free AI.
4. **The operator's feedback panel:** two short lines.
5. **Rule:** [localization](../LOCALIZATION.md) now says to review copy wherever it lives, not only in `*i18n.ts` files.

## Verification

- **Unit tests:** the expense copy and summary tests, the trip-creation form tests, and the full suite.
- **Full check** on a disposable PostgreSQL 17: lint, types, unit and database tests, the production build and the smoke test.
- **In a browser**, on a local production build at phone width with a synthetic guest trip:
  - the Overview widget and the full summary show only the figures and their "?", with no sideways scrolling;
  - the balance "?" opens with the moved note, and the **My own trip expenses** "?" with the exclusions;
  - the guest sign-in line is the short one.

  **Find defaults** needs a Google account, so a guest never sees it; its "?" is covered by the form's unit test.

## Rollback

Revert the commit. There is no migration.
