# Screen layout

The app has one layout for phone and desktop web: light by default, dark when the system asks for it, with large text and clear cards. It began in JOB-048 as the "new" layout beside the original dark **classic** layout and a toggle between them. Classic and the toggle were retired in JOB-081 ([D-093](DECISIONS.md)). `AppShell` owns all state, handlers, API calls and permission checks; the layout is presentation only.

Create Trip offers Auto destination lookup, a manual fallback and an editable suggested currency; see [destination defaults](TRIP_DESTINATION_DEFAULTS.md). The live Overview has no previous/next buttons: day chips select the day, and phone swipe and offline day navigation remain.

## How it is applied

- `src/app/layout.tsx` renders `<html lang="zh-HK" data-ui="new">`. Every stylesheet in `src/app/new-ui/` scopes its selectors to `:root[data-ui="new"]`, which outranks the base stylesheet `src/app/globals.css` and the plain component stylesheets; those load first.
- `documentLanguageBootstrapScript` (`src/lib/document-language-bootstrap.ts`) runs in `<head>` before first paint and sets `<html lang>` from the locale route or Create Trip's validated locale query (`zh-HK-lihkg` uses `zh-HK`). Other routes keep the server-rendered remembered browser language, English initially. `DocumentLanguage` keeps it in sync after hydration; `<html>` has `suppressHydrationWarning` because the bootstrap can change `lang` before React hydrates. Explicit language selection saves browser/account preference; merely visiting a localized URL does not.
- The root `viewport` export sets `colorScheme: "light dark"` and the browser chrome color: `#f5f3fa` for `prefers-color-scheme: light`, `#14121b` for dark.

There is no layout preference: no setting, browser storage, account field or migration. Browsers that used the toggle may still hold the retired `stardust.ui-mode.v1` key; nothing reads it.

## What the layout does

Presentation only:

- A light, high-contrast theme by default and a dark theme that follows the system `prefers-color-scheme` setting.
- System font stacks per script (`:lang(zh)`, `:lang(ja)`; Japanese breaks between phrases), 16px body text with a 13px minimum (the one exception is 12px bottom-bar labels for six owner tabs on small phones), 44px buttons and other targets, 16px form text, visible focus rings on buttons, links, inputs, selects and disclosure summaries, and calm cards using shared tokens.
- Dialogs are centered on desktop and become bottom sheets on phones (600px and narrower), the feedback dialog included. Long editors (Add/Edit event, Add expense) keep their Save/Cancel row pinned to the bottom edge of the dialog while the form scrolls.
- At every width: a trip summary bar on Today and Itinerary (a compact card on phones) and day chips on both pages (Itinerary chips appear only when the trip has two or more days). The bar shows progress only for valid, ordered trip dates (`tripProgress` returns null for invalid or reversed dates); before the trip the progress track is hidden and "Starts in N days" says it in words.
- Day chips: on Today they select the shown day and expose it with `aria-pressed`. On Itinerary they are one-shot jump buttons (today carries `aria-current="date"`): a chip opens that date's existing disclosure, scrolls it to just below the chip strip and moves focus to the day's summary heading. While the Itinerary scrolls, its chip strip stays pinned at the top of the viewport. It is a page-scoped sticky strip inside the Itinerary content, stacked below the bottom bar and dialogs; it is not a global toolbar. The feedback launcher is unaffected: it has scrolled away before the strip pins and is still not sticky, so the [launcher decision](DECISIONS.md#october-7-2026-feedback-is-a-page-control-not-a-floating-overlay) holds. A chip's accessible name is its visible text (Today or the weekday, and the date) plus the full date, which is visually hidden inside the chip.
- Desktop and tablet (wider than 760px): sidebar plus topbar. From 761px to 1100px the sidebar narrows to 200px and drops the party list and subtitle. The Today/Itinerary two-column dashboard (timeline beside a 340px utility column) starts at 1240px; below that the page is a single column. From 1100px, Trip expenses uses two columns: the personal summary and settlements on the left, the date groups on the right (DOM and reading order unchanged). Approvals is a single pending-first queue capped at about 46rem wide. From 1080px Settings flows into two columns in which each card keeps its natural height instead of stretching to match a neighbour. At 1180px and narrower the AI history list stacks above the transcript as a horizontal strip.
- Phone (760px and narrower): the sidebar is hidden and section navigation uses a fixed bottom bar with no sideways scrolling and an approvals badge. Its English labels are **Today / Itinerary / Expenses / AI / Approvals / Settings**, matching the page titles ("Expenses" for Trip expenses); Cantonese and Japanese labels are listed in [localization](LOCALIZATION.md). Labels wrap only between words; a single word too long for its tab breaks at a syllable with a hyphen. With six owner tabs on phones 420px wide or narrower they are 12px, and the Latin- and Cyrillic-script languages get a narrower icon pill so their longer labels fit from 360px. Trip switching stays in **Settings → Switch trip**. The topbar approvals bell is hidden on phones; the bar's Approvals item carries the count. Swiping the Overview day view still changes the day, and scrolling the chip strip sideways is kept local to the strip, so it does not trigger that swipe. A phone add button sits above the bottom bar; at 420px and narrower it is a 56px icon-only circle whose visually hidden label stays its accessible name. Keyboard focus scrolls clear of the bottom bar and the add button.
- Phone pages: on Today the Next-up card is shown before the lodging card by CSS `order`, so DOM and reading order are unchanged (see [known limitations](#known-limitations-and-follow-ups)). Ordinary event action bars are one row of equal-width 44px buttons whose labels wrap inside the buttons (icons are dropped at 400px and narrower); the pending Edit/Approve/Reject row keeps its own grid. In-page headings that repeat the topbar title (Itinerary, Approvals, Trip expenses, Trip activity) are visually hidden but kept for screen readers; Trip expenses and Trip activity do this at every width. Itinerary day headings drop the right-hand event count that their heading text already ends with, and at 420px and narrower the topbar eyebrow (time zone · role) is hidden.
- Expense draft/pending cards with more than one action use one equal-width, text-only Edit/Approve/Reject row like the itinerary review row, with Approve as the gold primary (all widths).

`TripDeletionCard` and `TripDeletionReview` (`src/components/trip-deletion-controls.tsx`) appear for owners directly after the trip settings card. The dialog reuses the member-removal review styles. The Delete button stays disabled until the typed name matches, and Cancel takes initial focus.

`TripAdjacentNav` (`src/components/trip-adjacent-nav.tsx`) appears on Overview. It links the chronologically previous and next trips and renders nothing for an account with one trip. `shell.css` styles it with 44px targets and truncated names; full names and dates are in the accessible names and the `title`.

Layout components (all in `src/components/new-ui/`):

| Component | What it shows | Data or action it uses |
| --- | --- | --- |
| `TripOverviewBar` | Trip name, destination, localized date range, "Day X of N", "Starts in N days"/"Starts tomorrow" or "Trip ended", a thin progress bar (hidden before the trip) and up to five member initials plus "+N"; no progress for invalid or reversed dates | Existing Overview trip/member data and the trip-local date; `tripProgress` is a pure calendar-date helper that returns null for invalid or reversed dates |
| `OverviewDayStrip` | Horizontal day chips on Overview; selectors with `aria-pressed` | Selects the same Overview day state as the phone swipe |
| `ItineraryDayJump` | Day chips on Itinerary (nothing for trips with fewer than two days); one-shot jump buttons, today marked `aria-current="date"`, pinned at the top while the page scrolls | `revealItineraryDay` opens that date's existing disclosure, scrolls it below the strip and focuses its summary heading |
| `NewBottomNav` | Phone bottom bar with the labels Today/Itinerary/Expenses/AI/Approvals/Settings and an approvals count badge for owners; no horizontal scrolling | Existing section ids and `approvalPendingCount` |
| `QuickAiButton` | Phone "Ask the trip AI" pill on Today, Itinerary and Expenses; a 56px icon-only circle at 420px and narrower | Opens the quick AI composer in a sheet (D-082); absent when the trip's owners turned AI off |

All page-level Add event / Add expense actions remain.

## What layout work must not change

- APIs, schema, roles and permissions, approval flow and revisions, money and ledger math, privacy/visibility, AI/provider behavior, Calendar, disruptions and offline snapshot rules.
- URLs and deep-link intents; owner-only controls stay absent for members.
- Overview is one selected day with phone swipe (D-035); the day chips and the swipe select the same state.
- Weather stays in the left timeline rail above the matching time, with the Open-Meteo attribution (D-050).
- Itinerary and Expenses open today first, with other days collapsed ([mobile cards](MOBILE_CARDS.md)).
- Pending event cards keep one equal-width Edit/Approve/Reject row.
- Expense cards lead with the viewer's personal share. Color meanings are unchanged (gold primary/today/personal spend, violet selection/paid, mint/rose receivable/payable) and text is always present.
- 44px targets and 16px phone inputs.
- The day map loads when its disclosure is opened, never merely by opening a date ([daily map](DAILY_MAP.md), D-081).
- The feedback launcher stays absolute at the page's top-right and scrolls away; headers that share its row keep the reserved right padding so it never covers a control. The pinned Itinerary chip strip is page-scoped and does not change this ([feedback](FEEDBACK.md)).
- The offline view appears only after a network or 5xx failure, never after 401/403.

## Files

| File | Role |
| --- | --- |
| `src/app/layout.tsx` | `<html data-ui="new">`, the language bootstrap, `suppressHydrationWarning`, theme colors, stylesheet imports after `globals.css` |
| `src/lib/document-language-bootstrap.ts` | The script that sets `<html lang>` before first paint |
| `src/components/new-ui/new-navigation.tsx` | `NewBottomNav`, `QuickAiButton` |
| `src/components/new-ui/trip-overview-bar.tsx` | `TripOverviewBar`, `OverviewDayStrip`, `ItineraryDayJump`, `tripProgress` |
| `src/components/event-type-icon.tsx` | Static inline event glyphs shared by cards; resolved flights have takeoff/arrival variants. No image requests or inference inside the icon; the shared presentation resolver owns the narrow D-102 legacy rule. See [event icons](MOBILE_CARDS.md#event-icons). |
| `src/lib/app/ui-refresh-i18n.ts` | Copy for the bottom bar, day chips, trip bar and previous/next trip (the added languages in their packs) |
| `src/app/new-ui/base.css` | Tokens (light and dark), typography, focus, targets, form text, dialogs |
| `src/app/new-ui/shell.css` | Sidebar, topbar, phone header, bottom bar, add pill, trip bar, auth/loading/offline pages, feedback dialog colors |
| `src/app/new-ui/today.css` | Today/Itinerary, timeline, day chips, day accordions, Calendar panel, event editor |
| `src/app/new-ui/expenses.css` | Expenses, repayments, Approvals, Activity |
| `src/app/new-ui/ai-settings.css` | AI card and history, Settings, members, Advanced settings |
| `src/lib/document-language-bootstrap.test.ts`, `src/components/new-ui/new-ui.test.ts`, `src/components/app-shell-advanced-settings.test.ts` (instrumentation scan) | Early document language, controls, chip semantics and jump focus, theme colors, copy parity, the CSS scoping guard and wiring |

## CSS rules and guard test

`src/app/globals.css` is the base stylesheet the layout builds on; the files in `src/app/new-ui/` override it. Every selector in `src/app/new-ui/` must start with `:root[data-ui="new"]`. The vitest guard in `src/components/new-ui/new-ui.test.ts` parses each of those files with postcss (the copy that ships with Next), not regular expressions, so comments, strings and nested parentheses cannot hide a selector. It fails on any unscoped selector, any nested rule, and any at-rule other than `@media`, `@container` and `@supports`. It also checks that `globals.css` contains no `data-ui` selector, that `globals.css` is imported before `base.css` and every layout file is imported in the root layout, that `<html>` carries `data-ui="new"`, the language bootstrap and `suppressHydrationWarning`, and that no layout toggle, Screen layout card or classic-only markup comes back.

Practical rules:

- Use the tokens in `base.css` instead of literal colors so light and dark both work.
- CSS Modules use hashed class names. Reach module elements through global ancestors or attributes, or rely on the tokens the modules already use; do not edit the module.
- `:root[data-ui="new"] .x` outranks `.x` in `globals.css`. Some base rules use `!important`; match with `!important` only where needed.
- Never make the feedback launcher fixed or sticky, and never move it. Pinned content must stay page-scoped like the Itinerary chip strip, sit below the bottom bar and dialogs, and never cover the launcher.

## Changing the UI safely

- Put layout styling in the scoped `src/app/new-ui/` files. Leave `globals.css`, `src/components/*.css` and component CSS modules alone except to remove rules nothing uses any more.
- A new presentational component reuses existing state and handlers and adds no API call, permission path or diagnostics field.
- Feedback diagnostics: mark new controls with an existing allowlisted `data-feedback-action` code and add the component file to the privacy-safe instrumentation test in `src/components/app-shell-advanced-settings.test.ts`. Bottom-bar items and day chips use `navigate`, and the AI pill uses `dialog_open`.
- Copy goes in `src/lib/app/ui-refresh-i18n.ts` (or the relevant catalog) for `en`, `zh-HK` and `ja-JP`, and in every pack for the added languages. Layout controls are display/accessibility surfaces, so `zh-HK-lihkg` uses the identical neutral `zh-HK` text.
- Check 1280px desktop and 390px and 320px phone widths (and spot-check 761–1240px, where the sidebar narrows and the dashboard is one column), in light and dark system themes, in the original four locales (`en`, `zh-HK`, `zh-HK-lihkg`, `ja-JP`) and at least one Latin-script pack language with long words, such as `de`. Confirm no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`), that the feedback launcher covers nothing and that the offline header still fits. Use synthetic data or a loopback preview harness, never real trip data.
- `pnpm check` runs the guard and the layout tests with the rest of the suite.

## Known limitations and follow-ups

- Modal dialogs do not trap focus and do not close on Escape.
- The topbar eyebrow shows the raw role value, untranslated.
- The AI quick card shows its policy text before its composer.
- Expense review rows use long labels that wrap at 320px.
- In the timeline rail, the weather badge's stale or estimate state is shown only by its outline and tooltip.
- On phones the Next-up card's visual order (before the lodging card) differs from its reading order, because CSS `order` moves it without changing the DOM.

## Storage, privacy and offline

The layout stores nothing in the browser. Sign-out still deletes the offline itinerary snapshots and Stardust private shell caches as before ([identity and security](IDENTITY_AND_SECURITY.md)).

The service worker and cache names are unchanged. The offline snapshot accepts optional privacy-reduced flight/zone presentation (D-102); old snapshots remain readable. The cached locale shell includes the language bootstrap.

## Rollback

Reverting JOB-081 brings back the classic layout and the toggle. It needs no database change, and the retired `stardust.ui-mode.v1` value, where a browser still holds it, would apply again. Deployment is covered in [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).

## Wanderlog ideas: adopted and skipped

Adopted where they fit: horizontal day chips; a trip header card with real progress and member avatars; calmer time-first timeline cards; a bottom tab bar with short labels and a badge; one primary add button on phones; clearer expense rows.

Deliberately skipped: a desktop split list-and-map view (the day map is a per-day disclosure that loads when opened), route optimization (conflicts with fixed times and approvals), recommended-places and booking tabs (Stardust is not a marketplace), a compact/detailed toggle, an undo snackbar, live cursors, and photos or scraped place descriptions.
