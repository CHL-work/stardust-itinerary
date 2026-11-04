# Screen layouts: new and classic

Create Trip in both layouts offers Auto destination lookup, a manual fallback and an editable suggested currency; see [destination defaults](TRIP_DESTINATION_DEFAULTS.md). New visual overrides remain scoped under `:root[data-ui="new"]`; classic must still render and submit. The live Overview has no previous/next buttons: classic shows a native date selector, the new layout shows day chips, and phone swipe and offline navigation remain.

> **Planned change:** retiring the classic layout and the toggle is planned, not implemented (see [roadmap](ROADMAP.md)). Until it lands, this document and its "classic is frozen" rule apply as written; that change will rewrite this document as a single-layout reference.

The app has a new, easier-to-read layout for phone and desktop web and keeps the original dark design as the **classic** layout. The new layout is the default. Every signed-in user can switch between the two from a visible control; the choice is a display preference stored on that device only. Both layouts render the same `AppShell` state, handlers, API calls and permission checks, so data, approvals, money, privacy, AI and offline behavior are identical. See [the decision record](DECISIONS.md#october-11-2026-new-default-layout-with-a-preserved-classic-layout).

## How the layout is chosen

The root `<html>` element carries `data-ui="new"` or `data-ui="classic"`.

- `src/lib/ui-mode.ts` defines the modes (`new`, `classic`), `UI_MODE_STORAGE_KEY = "stardust.ui-mode.v1"`, `DEFAULT_UI_MODE = "new"`, `normalizeUiMode` (only the exact value `classic` selects classic; anything else, including a missing value, selects new) and `uiModeBootstrapScript`.
- `src/app/layout.tsx` inlines the bootstrap script in `<head>`, so the attribute is set before first paint and there is no flash of the wrong layout. `<html>` has `suppressHydrationWarning` because the attribute is intentionally set before React hydrates. If `localStorage` is blocked or unavailable (private mode, disabled site data), the new layout is used.
- The same bootstrap also sets `<html lang>` from the locale route before first paint (`/en` → `en`, `/ja-JP` → `ja-JP`, `/zh-HK` and `/zh-HK-lihkg` → `zh-HK`; any other route keeps the server-rendered `zh-HK`), so the per-script font stacks are right on first paint. `DocumentLanguage` still keeps the attribute in sync after hydration.
- `src/lib/ui-mode-store.ts` treats the `<html>` attribute as the source of truth after load: `readUiMode` (falls back to the stored choice when the attribute is missing), `applyUiMode`, `ensureUiModeAttribute` (restores a missing attribute from the stored choice), `setUiMode` (persists to `localStorage` when possible, applies the attribute and notifies subscribers) and the `useUiMode` hook (`useSyncExternalStore`; the server snapshot is `new`). One shared `storage` listener, however many components subscribe, applies a choice made in another tab of the same browser. A blocked storage write still switches the current page.
- `UiModeSync` (`src/components/new-ui/ui-mode-sync.tsx`, rendered in the root layout body) renders the browser chrome color as `<meta name="theme-color">` tags that React hoists into `<head>`: in the new layout a media pair (`#f5f3fa` for `prefers-color-scheme: light`, `#14121b` for dark), in classic a single `#171225`. The root `viewport` export no longer sets `themeColor`, so Next does not re-create a classic-colored tag on client navigation. Server HTML carries the new-layout pair because the server cannot know the device choice; a classic device switches to the classic tag at hydration. `UiModeSync` also watches `<html data-ui>` with a `MutationObserver` and restores it from the stored choice if anything removes it.

There is no server-side preference, account setting, database column or migration. The preference follows the browser profile, not the signed-in account.

## Where the toggle appears

The classic layout keeps its markup and styling except for three additions needed to reach the toggle:

1. a layout toggle button in the topbar actions, before the language switcher (both layouts);
2. a `.offline-topbar-actions` wrapper holding the toggle and the language switcher in the offline itinerary header;
3. a **Screen layout** card, first in Settings.

So that these controls fit without restyling classic surfaces, `layout-toggle.css` adds classic-only accommodations (each selector starts with `:root:not([data-ui="new"])`):

- the toggle is icon-only up to 1100px wide, where the classic sidebar leaves the topbar narrow; its accessible name comes from `aria-label`/`title`;
- on classic phones (760px and narrower) the topbar may wrap, putting the actions on their own row when an unbreakable title word needs the space (for example "Approvals" at 320px). The topbar also gives up its launcher padding there, because on classic phones the feedback launcher sits in the brand row above the topbar;
- the classic offline header lets the brand shrink first and, if the toggle and language switcher still do not fit side by side, stacks them left-aligned and clear of the launcher;
- the Screen layout card spans its own full row at the top of the classic Settings grid, so every original card keeps its column and row and the short card is not stretched to a neighbour's height.

Apart from these additions and accommodations, layout work must not change classic markup or computed styles. Without the accommodations above, the toggle would squeeze the classic phone header and the Screen layout card would reflow the classic Settings grid.

The toggle always offers the other layout: **Classic layout / New layout**, **經典版面 / 新版面** (both Cantonese modes), **クラシック表示 / 新しい表示**. Its accessible name is "Switch to the classic layout" / "Switch to the new layout" in the selected language, which contains the visible words. It is at least 44px. In the new layout it shows its label except on phones 420px wide or narrower, where it becomes icon-only; in classic it is icon-only up to 1100px wide. An icon-only toggle keeps its accessible name and shows it as a tooltip. The Settings card (**Screen layout / 畫面版面 / 画面のレイアウト**) shows two pressed-state options, New layout and Classic layout, with an **In use** badge on the current one.

## What the new layout changes

Presentation only:

- A light, high-contrast theme by default and a dark theme that follows the system `prefers-color-scheme` setting. Classic stays dark.
- System font stacks per script (`:lang(zh)`, `:lang(ja)`; `<html lang>` is set before first paint, and Japanese breaks between phrases), 16px body text with a 13px minimum (the one exception is 12px bottom-bar labels for six owner tabs on small phones), 44px buttons and other targets, 16px form text, visible focus rings on buttons, links, inputs, selects and disclosure summaries, and calmer cards using shared tokens.
- Dialogs are centered on desktop and become bottom sheets on phones (600px and narrower), the feedback dialog included. Long editors (Add/Edit event, Add expense) keep their Save/Cancel row pinned to the bottom edge of the dialog while the form scrolls.
- At every width: a trip summary bar on Today and Itinerary (a compact card on phones) and day chips on both pages (Itinerary chips appear only when the trip has two or more days). The bar shows progress only for valid, ordered trip dates (`tripProgress` returns null for invalid or reversed dates); before the trip the progress track is hidden and "Starts in N days" says it in words.
- Day chips: on Today they select the shown day and expose it with `aria-pressed`. On Itinerary they are one-shot jump buttons (today carries `aria-current="date"`): a chip opens that date's existing disclosure, scrolls it to just below the chip strip and moves focus to the day's summary heading. While the Itinerary scrolls, its chip strip stays pinned at the top of the viewport. It is a page-scoped sticky strip inside the Itinerary content, stacked below the bottom bar and dialogs; it is not a global toolbar. The feedback launcher is unaffected: it has scrolled away before the strip pins and is still not sticky, so the [launcher decision](DECISIONS.md#october-7-2026-feedback-is-a-page-control-not-a-floating-overlay) holds. A chip's accessible name is its visible text (Today or the weekday, and the date) plus the full date, which is visually hidden inside the chip.
- Desktop and tablet (wider than 760px): sidebar plus topbar. From 761px to 1100px the sidebar narrows to 200px and drops the party list and subtitle. The Today/Itinerary two-column dashboard (timeline beside a 340px utility column) starts at 1240px; below that the page is a single column. On Overview the day chips take the place of the classic date selector. From 1100px, Trip expenses uses two columns: the personal summary and settlements on the left, the date groups on the right (DOM and reading order unchanged). Approvals is a single pending-first queue capped at about 46rem wide. From 1080px Settings flows into two columns in which each card keeps its natural height instead of stretching to match a neighbour. At 1180px and narrower the AI history list stacks above the transcript as a horizontal strip.
- Phone (760px and narrower): as in classic, the sidebar is hidden and section navigation uses a fixed bottom bar, but the new layout uses a simpler bar with no sideways scrolling and an approvals badge. Its English labels are **Today / Itinerary / Expenses / AI / Approvals / Settings**, matching the page titles ("Expenses" for Trip expenses); Cantonese and Japanese labels are listed in [localization](LOCALIZATION.md). Labels wrap only between words, never mid-word, and with six owner tabs on phones 420px wide or narrower they are 12px. The classic `.bottom-nav` is still rendered and is hidden in the new layout; `NewBottomNav` replaces it. Trip switching stays in **Settings → Switch trip**. The topbar approvals bell stays hidden on phones, as in classic; the bar's Approvals item carries the count. On Overview, the day chips take the place of the swipe hint, and swiping the day view still works. Scrolling the chip strip sideways is kept local to the strip and does not trigger that day swipe. A phone add button sits above the bottom bar; at 420px and narrower it is a 56px icon-only circle whose visually hidden label stays its accessible name. Keyboard focus scrolls clear of the bottom bar and the add button.
- Phone pages: on Today the Next-up card is shown before the lodging card by CSS `order`, so DOM and reading order are unchanged (see [known limitations](#known-limitations-and-follow-ups)). Ordinary event action bars become one row of equal-width 44px buttons whose labels wrap inside the buttons (icons are dropped at 400px and narrower). Classic keeps its wrapping rows, and the pending Edit/Approve/Reject row is unchanged. In-page headings that repeat the topbar title (Itinerary, Approvals, Trip expenses, Trip activity) are visually hidden but kept for screen readers; Trip expenses and Trip activity do this at every width. Itinerary day headings drop the right-hand event count that their heading text already ends with, and at 420px and narrower the topbar eyebrow (time zone · role) is hidden.
- Expense draft/pending cards with more than one action use one equal-width, text-only Edit/Approve/Reject row like the itinerary review row, with Approve as the gold primary (all widths).

`TripDeletionCard` and `TripDeletionReview` (`src/components/trip-deletion-controls.tsx`) also appear in both layouts, for owners, directly after the trip settings card. The dialog reuses the member-removal review styles. The Delete button stays disabled until the typed name matches, and Cancel takes initial focus.

`TripAdjacentNav` (`src/components/trip-adjacent-nav.tsx`) is a behavior control, so it appears on Overview in both layouts. It links the chronologically previous and next trips and renders nothing for an account with one trip. Classic shows it with the existing `ghost-button` and no new styling. The new layout styles it in `shell.css`, with 44px targets and truncated names; full names and dates are in the accessible names and the `title`.

New-layout-only presentational components (all in `src/components/new-ui/`; each renders nothing in classic):

| Component | What it shows | Data or action it uses |
| --- | --- | --- |
| `TripOverviewBar` | Trip name, destination, localized date range, "Day X of N", "Starts in N days"/"Starts tomorrow" or "Trip ended", a thin progress bar (hidden before the trip) and up to five member initials plus "+N"; no progress for invalid or reversed dates | Existing Overview trip/member data and the trip-local date; `tripProgress` is a pure calendar-date helper that returns null for invalid or reversed dates |
| `OverviewDayStrip` | Horizontal day chips on Overview; selectors with `aria-pressed` | Selects the same Overview day state as the classic date selector and swipe |
| `ItineraryDayJump` | Day chips on Itinerary (nothing for trips with fewer than two days); one-shot jump buttons, today marked `aria-current="date"`, pinned at the top while the page scrolls | `revealItineraryDay` opens that date's existing disclosure, scrolls it below the strip and focuses its summary heading |
| `NewBottomNav` | Phone bottom bar, in place of the hidden classic `.bottom-nav`, with the labels Today/Itinerary/Expenses/AI/Approvals/Settings and an approvals count badge for owners; no horizontal scrolling | Existing section ids and `approvalPendingCount` |
| `QuickAddButton` | Phone "Add event" pill on Today/Itinerary (needs `canEditItinerary`) or "Add expense" pill on Expenses (needs `canEditExpenses`); a 56px icon-only circle at 420px and narrower | Opens the same existing event or expense editor; absent without the permission |

The classic trip picker's fixed placeholder progress bar is hidden in the new layout because the trip summary bar shows real progress. All page-level Add event / Add expense actions remain.

## What both layouts keep

These invariants hold in both layouts and must not be changed by layout work:

- APIs, schema, roles and permissions, approval flow and revisions, money and ledger math, privacy/visibility, AI/provider behavior, Calendar, disruptions and offline snapshot rules.
- URLs and deep-link intents; owner-only controls stay absent for members.
- Overview is one selected day with phone swipe (D-035); the classic date selector and the new layout's day chips select the same state.
- Weather stays in the left timeline rail above the matching time, with the Open-Meteo attribution (D-050).
- Itinerary and Expenses open today first, with other days collapsed ([mobile cards](MOBILE_CARDS.md)).
- Pending event cards keep one equal-width Edit/Approve/Reject row.
- Expense cards lead with the viewer's personal share. Color meanings are unchanged (gold primary/today/personal spend, violet selection/paid, mint/rose receivable/payable) and text is always present.
- 44px targets and 16px phone inputs.
- The day map loads only after an explicit **Load map** action ([daily map](DAILY_MAP.md)).
- The feedback launcher stays absolute at the page's top-right and scrolls away; headers that share its row keep the reserved right padding so it never covers a control (on classic phones it sits in the brand row above the topbar, so the topbar uses that space for the toggle). The pinned Itinerary chip strip is page-scoped and does not change this ([feedback](FEEDBACK.md)).
- The offline view appears only after a network or 5xx failure, never after 401/403.

## Files

| File | Role |
| --- | --- |
| `src/lib/ui-mode.ts`, `src/lib/ui-mode-store.ts` | Mode constants, normalization, bootstrap script, store and hook |
| `src/app/layout.tsx` | Inline bootstrap, `suppressHydrationWarning`, `UiModeSync`, stylesheet imports after `globals.css` |
| `src/components/new-ui/ui-mode-toggle.tsx` | `UiModeToggle` and `UiModeSettingsCard` (both layouts) |
| `src/components/new-ui/new-navigation.tsx` | `NewBottomNav`, `QuickAddButton` (new layout only) |
| `src/components/new-ui/trip-overview-bar.tsx` | `TripOverviewBar`, `OverviewDayStrip`, `ItineraryDayJump`, `tripProgress` (new layout only) |
| `src/components/new-ui/ui-mode-sync.tsx` | React-hoisted `theme-color` meta tags for the chosen layout and `<html data-ui>` recovery |
| `src/lib/app/ui-refresh-i18n.ts` | Four-locale copy for the toggle, Settings card, bottom bar, day chips, trip bar and previous/next trip |
| `src/app/new-ui/layout-toggle.css` | Shared look of the toggle and Screen layout card in both layouts, the classic safety net that hides new-layout components, and the classic-only accommodations that make room for the toggle and card |
| `src/app/new-ui/base.css` | Tokens (light and dark), typography, focus, targets, form text, dialogs |
| `src/app/new-ui/shell.css` | Sidebar, topbar, phone header, bottom bar, add pill, trip bar, auth/loading/offline pages, feedback dialog colors |
| `src/app/new-ui/today.css` | Today/Itinerary, timeline, day chips, day accordions, Calendar panel, event editor |
| `src/app/new-ui/expenses.css` | Expenses, repayments, Approvals, Activity |
| `src/app/new-ui/ai-settings.css` | AI card and history, Settings, members, Advanced settings |
| `src/lib/ui-mode.test.ts`, `src/components/new-ui/new-ui.test.ts`, `src/components/app-shell-advanced-settings.test.ts` (instrumentation scan) | Preference and early document language, attribute recovery, the shared cross-tab listener, controls, chip semantics and jump focus, theme color, copy parity, CSS scoping guard and wiring |

The new components are inserted into `src/components/app-shell.tsx` without changing any existing handler, state, API call or permission check. `src/app/globals.css`, the plain component stylesheets in `src/components/*.css` and every component CSS module are unchanged.

## CSS scoping rule and guard test

Every selector in `src/app/new-ui/` except `layout-toggle.css` must start with `:root[data-ui="new"]`. That is what keeps the classic layout untouched. The vitest guard in `src/components/new-ui/new-ui.test.ts` parses each of those files with postcss (the copy that ships with Next), not regular expressions, so comments, strings and nested parentheses cannot hide a selector. It fails on any unscoped selector, any nested rule, and any at-rule other than `@media`, `@container` and `@supports`. `layout-toggle.css` is parsed the same way, and each of its selectors must match an allowlist: `.ui-mode-*`, `.offline-topbar-actions`, or a selector starting with `:root:not([data-ui="new"])` (the classic safety net and the classic accommodations). The guard also checks that `globals.css` contains no `data-ui` selector, that `globals.css` is imported before `base.css` and every scoped file is imported in the root layout, that the bootstrap script and `suppressHydrationWarning` are present, and that the toggle appears exactly in the live header, the offline header and Settings.

Practical rules for new-layout CSS:

- Use the tokens in `base.css` instead of literal colors so light and dark both work.
- CSS Modules use hashed class names. Reach module elements through global ancestors or attributes, or rely on the tokens the modules already use; do not edit the module.
- `:root[data-ui="new"] .x` outranks classic `.x`. Some classic rules use `!important`; match with `!important` only where needed.
- Never make the feedback launcher fixed or sticky, and never move it. Pinned content must stay page-scoped like the Itinerary chip strip, sit below the bottom bar and dialogs, and never cover the launcher.

`layout-toggle.css` is the only unscoped file. Keep it limited to the toggle, the Screen layout card, `.offline-topbar-actions`, the classic safety net and the classic-only accommodations that make room for those controls. Do not restyle classic surfaces there.

## Changing the UI safely

- **Classic is frozen.** Do not change classic markup or CSS unless a classic change is explicitly requested. Behavior changes (data, permissions, workflows) naturally affect both layouts and are documented in their topic documents.
- New feature markup in shared components is expected to appear in both layouts. Classic must not receive new styling, restructuring or removal of its existing markup unless explicitly requested; give new controls classic-compatible existing classes or leave them unstyled in classic.
- Put new-layout styling in the scoped `src/app/new-ui/` files, never in `globals.css`, `src/components/*.css` or component CSS modules.
- A new presentational component for the new layout must render nothing in classic (`useUiMode() === "new"`), be added to the safety-net selector in `layout-toggle.css`, reuse existing state and handlers, and add no API call, permission path or diagnostics field.
- Feedback diagnostics: mark new controls with an existing allowlisted `data-feedback-action` code and add the component file to the privacy-safe instrumentation test in `src/components/app-shell-advanced-settings.test.ts`. The layout controls use `settings_save` for the toggle and Screen layout options, `navigate` for bottom-bar items and day chips, and `event_open` / `expense_open` for the add pill.
- Copy goes in `src/lib/app/ui-refresh-i18n.ts` (or the relevant catalog) for `en`, `zh-HK` and `ja-JP`. Layout controls are display/accessibility surfaces, so `zh-HK-lihkg` uses the identical neutral `zh-HK` text.
- Check **both** layouts at 1280px desktop and 390px and 320px phone widths (and spot-check 761–1240px, where the sidebar narrows and the dashboard is one column), in light and dark system themes, in all four locales (`en`, `zh-HK`, `zh-HK-lihkg`, `ja-JP`). Confirm no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`), that the feedback launcher covers nothing, that the offline header still fits, and that the toggle switches both ways. Use synthetic data or a loopback preview harness, never real trip data.
- `pnpm check` runs the guard and the layout tests with the rest of the suite.

## Known limitations and follow-ups

Known issues for follow-up work. Unless marked, each exists in both layouts and predates the new layout.

- Modal dialogs do not trap focus and do not close on Escape.
- The topbar eyebrow shows the raw role value, untranslated.
- The AI quick card shows its policy text before its composer.
- Expense review rows use long labels that wrap at 320px.
- In the timeline rail, the weather badge's stale or estimate state is shown only by its outline and tooltip.
- New layout only: on phones the Next-up card's visual order (before the lodging card) differs from its reading order, because CSS `order` moves it without changing the DOM.

## Storage, privacy and offline

`stardust.ui-mode.v1` is the only new browser storage key. It holds `new` or `classic` and contains no trip, identity or private data. It is intentionally **not** purged on sign-out because it is only a device display preference. Sign-out still deletes the offline itinerary snapshots and Stardust private shell caches as before ([identity and security](IDENTITY_AND_SECURITY.md)).

The offline snapshot format, service worker and cache names are unchanged. The cached locale shell includes the inline bootstrap script, so the offline page honours the device preference, and its header has the toggle.

## Rollback

- Per user, without a deployment: switch to the classic layout with the toggle or in Settings.
- The layouts add no schema, so a code rollback needs no database change. Builds without the new layout ignore the leftover `stardust.ui-mode.v1` value; no cleanup is needed. Deployment is covered in [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).
- Both layouts remain supported until the planned classic retirement is implemented. A planned retirement is not permission to remove the toggle in unrelated work.

## Wanderlog ideas: adopted and skipped

Adopted where they fit: horizontal day chips; a trip header card with real progress and member avatars; calmer time-first timeline cards; a bottom tab bar with short labels and a badge; one primary add button on phones; clearer expense rows.

Deliberately skipped: a desktop split list-and-map view (the day map is a per-day disclosure with explicit loading), route optimization (conflicts with fixed times and approvals), recommended-places and booking tabs (Stardust is not a marketplace), a compact/detailed toggle, an undo snackbar, live cursors, and photos or scraped place descriptions.
