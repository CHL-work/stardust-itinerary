# Mobile event and expense cards

The layout styles these cards without changing their rules: today-first disclosures, chronological pending cards with the single equal-width Edit/Approve/Reject row, personal-first expense amounts, explicit cancelled labels, the gold/violet/mint/rose meanings with text always present, 44px targets and 16px phone inputs. Itinerary day chips stay pinned at the top of the Itinerary while it scrolls; a chip opens that date's existing disclosure, lands it just below the strip and moves focus to the day's heading. On phones, an AI button (a 56px icon-only circle at 420px and narrower) on Today, Itinerary and Expenses opens the quick AI composer, and Today shows the Next-up card before the lodging card using CSS order, so DOM and reading order are unchanged. The page-level Add event and Add expense actions remain. A flight that a [status check](FLIGHT_STATUS.md) moved shows a **Changed** badge, and a cancelled one a red warning; tapping either says briefly what changed. See [screen layout](UI_LAYOUTS.md).

A separate personal Calendar card kind is interleaved inside dated Overview/Itinerary timelines. Short localized actions use the same mobile-friendly horizontal layout. The import dialog retains source title/times, defaults to private and keeps manual editing usable while optional public-place search runs. Applied AI evidence is explicit and never silently overwrites manual fields. Linked imports are represented by normal event/request cards rather than duplicate Calendar cards. See [Calendar imports](CALENDAR_IMPORT.md).

These card and safe-removal rules add no provider or payment processing.

## Reading and actions

Entering Itinerary or Trip Expenses opens only the actual current date in the trip's time zone and jumps to that group. Other days are initially collapsed; all their headings/totals remain visible. Manual open/close choices survive data refreshes during a visit and reset on page re-entry, trip/member change or trip-local midnight. The clock refreshes on navigation and return from phone suspension. If today is outside the displayed dates, all groups stay collapsed and navigation lands on the nearest date heading without falsely labeling it Today. An empty current-day group still opens.

Explicit Calendar event links take precedence over the default today jump: they reveal the rendered event's day before scrolling, including transport owning-action endpoints and a pending update replacing its canonical event. Automatic entry jumps are instant, not animated, and do not repeat on routine data refresh. The yellow Add event action and right-aligned Add expense use short localized labels and 44px targets. Today's group and nonzero personal spending have gold accents; paid amounts use violet, existing receivable/payable labels retain mint/rose, and zero/void values remain neutral. Color supplements text rather than replacing it.

Quick AI replies and saved message history use escaped paragraph blocks, 16px body text (17px on phones), 1.75 line height and long-token wrapping. Phone composer text is 16px and relevant controls have 44px touch targets. This is display only: no new Markdown/HTML execution, memory, request or model behavior.

Overview and Itinerary interleave visible pending and canonical events chronologically using the same timeline layout. Pending cards carry a yellow approval indicator; visible editable create/update proposals keep Edit, and owners get separate Approve/Reject controls. Transport departure/arrival retain one logical request and one action set, including a cross-day Overview fallback. Cancel/restore proposals remain read-only except owner review. Calendar sync remains unavailable before event approval.

On phones, ordinary event action bars are one row of equal-width 44px buttons whose labels wrap inside the buttons (icons are dropped at 400px and narrower). Draft/pending expense cards with more than one action use one equal-width, text-only row at every width. Cancelled canonical events have an explicit localized label, not only a muted color. Money, status and destructive copy use neutral Cantonese for both Cantonese tone choices.

Pending-event review controls keep their own grid: one equal-width row uses **Edit / Approve / Reject**, **編輯 / 批准 / 拒絕** in both Cantonese modes, or **編集 / 承認 / 却下** in Japanese. Text-only buttons avoid icon crowding and retain 44px touch height. Edit stays short while loading (`aria-busy` still reports progress). Owners receive review actions; other authorized editors receive Edit only. Missing actions do not leave empty grid columns. This applies to pending create/update cards in both Overview and Itinerary, not their editor dialog titles.

## Event time editor

Create/edit/pending event forms permit blank end time and duration. New events do not assume one hour; clearing either field clears both, and saved unknown ends stay unknown. Entered valid end/duration still calculate one another. Start and end have distinct 44px Now buttons beside their labels, using the trip-zone current date/time at click time without submitting. At phone widths the fields stack and use 16px input text. Invalid ranges/outside-trip times keep the draft and localized feedback. A known start remains required; these controls do not extend trips or change owner-review rules.

## Expense cards

The full Expense summary and compact Overview widget use explicit personal-cost, bill-paid and remaining-balance labels. The figures carry no notes; native details/summary question-mark help on each label explains what counts, expands in flow and is reachable by touch or keyboard. Targets are at least 44px with visible focus; explanations use readable wrapping text, not hover-only tooltips or floating panels that cover amounts. The help does not change currency separation, neutral zero values, money colors or financial/navigation actions.

Standalone bills and the event editor's optional linked-expense section share the same Equal / Custom amounts editor. New expenses remain equal across the existing selected-person defaults. Saved unequal shares reopen as custom; each selected member has an exact currency amount field, including explicit zero. Assigned, remaining and overallocated values update locally; custom saves stay disabled until every amount is valid and the shares match the bill total exactly. Blank is not zero. The two-column person/amount layout uses 16px numeric inputs, 44px controls and wrapping names/totals at narrow phone widths.

Unrelated edits preserve saved shares and remainder ownership. Changing a custom total or participant selection retains the other entered amounts and requires reconciliation; it does not silently redistribute money. Choosing Equal explicitly requests redistribution. Pending event-linked shares retain the proposal's exact amounts and existing audience/revision checks. This adds neither currency conversion nor payment processing.

The personal expense summary keeps **Record repayment** and outgoing settlement shortcuts. Repayment cards share the expense date disclosures; there is no separate history section/tab. They are labeled Repayment / 還款 / 精算 and ordered by actual payment time alongside bills, with a separate repayment count in the date heading. Repayment-only dates outside the trip remain visible, with only the current day expanded initially. Daily spending still excludes all repayments. Original facts/status/review/void behavior stays unchanged; phone controls and optional note disclosures retain 44px targets and neutral four-locale financial copy. See [repayment records](MEMBER_PAYMENTS.md).

Expense cards omit the redundant Add my bill to this event shortcut. Creation remains available through the event editor's linked-expense section or the page's Add expense action. Bill edit and draft/pending owner review controls stay on the cards.

Daily expense headings keep the date/collapse control on the left and the existing personal day total on the right, including on phones. Long labels or separate currency totals wrap within their columns; this changes no ledger math or approval inclusion.

Each date interleaves ordinary and pending expenses. The signed-in person's share is the large right-hand number, followed by the smaller full bill and payer. Self-paid posted shares are labeled accordingly; a different payer is identified without claiming an unrecorded reimbursement has happened. Draft/pending shares are explicitly proposed, not confirmed debt. Split details expand independently.

Ordinary posted cards have no redundant Recorded badge. Drafts show a yellow pencil badge at the top right; pending requests show a yellow clock/approval badge. Both stay outside spending/balances until posted. Owner approval posts a canonical draft with an audited revision; rejection voids it without deleting financial history. Pending request decisions use the existing reversible rejection/final approval workflow. Canonical draft rejection is a void correction, not a rejected pending request that can later be reapproved. Approved records expose no reject button.

## Removing a cancelled event

Only an active bound owner who can view a canonical cancelled event can remove it. The UI explicitly confirms permanent removal from trip views, retained linked expenses/audit history and unchanged remote Calendar copies. The server rechecks membership, private visibility, cancelled state and expected revision in one transaction.

`POST /api/trips/:tripId/itinerary/:itemId/remove` accepts `{expectedRevision, confirm: true}`. Migration `0038_cancelled_event_removal.sql` adds a cancelled-only tombstone, owner attribution and guards against restoration/new financial links. Removal adds a revision/audit and supersedes actionable target changes without changing approved history. It is not exposed as an AI operation.

The event disappears from active overview/itinerary, AI context, Calendar sync, weather and disruption targets. Linked bills, their private audience, revisions and financial totals remain intact and editable; their editor retains a historical link option and its authorized audience. New bills cannot link to the removed event. Calendar writes already in flight cannot mark a removed item synced, but a remote write may already have happened; there is no compensating remote delete.

Offline snapshots refresh on the next successful authorized load. An already offline device can still show its older snapshot until reconnection; this is not a remote purge guarantee. External Calendar copies remain the user's responsibility.

## Verification and rollback

Synthetic tests cover rendered controls/locales, personal amounts and ordering, double-click/revision guards, per-role/private removal, linked finances/history, stale proposals, AI exclusion and draft posting/voiding. Successful mutation tests use disposable PostgreSQL only, never real traveler records.

Migration 0038 adds the tombstone columns and guards. A code rollback must retain removed-row filtering, server guards, expense audience fallback and removal metadata snapshots; older code could show tombstones or reject legitimate historical edits. Do not drop tombstones or restore over newer financial activity as routine rollback. Later member-removal cleanup may still drop viewer participation on a removed event and append revisions; removal attribution is retained. Deploy and recover with [deployment](DEPLOYMENT.md) or [self-hosting](SELF_HOSTING.md); backup, restore and migration rules are in [database](DATABASE.md).
