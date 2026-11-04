# Trip expenses

Public tariff evidence from AI research is response-only reference information, not a new expense type. Unknown prices/mandatory fees cannot be guessed, and explicit free does not create a zero-value bill. The AI must retain the user's confirmed final amount or ask for it before proposing the affected charge; estimates do not bypass owner review. No ledger schema/math/split change. See [booking-price limits](AI_BOOKING_PRICES.md).

Posted, draft and pending expenses use the same personal-first card in each date group. Your share leads at the right; full bill and payer are secondary. Posted cards omit Recorded, while draft/pending cards have yellow indicators and owner review. Existing bills linked to removed events keep their audience/financial history and remain editable. See [card states and removal](MOBILE_CARDS.md).

Deleting a trip retains its expenses, but members can no longer see them or the balances, so the confirmation warns the owner first. See [deleting a trip](PUBLIC_TRIPS_AND_MEMBERS.md#deleting-a-trip).

[Member repayment records](MEMBER_PAYMENTS.md) are separate (migrations 0040–0041). PostgreSQL remains canonical; there is no payment processing or automatic FX conversion.

## Reading the summary

Each day's collapsible heading places its date and separate expense/repayment counts on the left and your daily spending on the right on both phone and desktop. The figure remains your posted expense share, not the whole group's bill total or repayment money; currencies stay separate. Repayment cards appear in chronological order alongside expenses using the actual payment's trip-local date, including dates before/after the trip. There is no separate repayment history disclosure or tab. Repayment-only groups contain the records rather than a misleading no-expenses empty state.

Trip Expenses and the Overview expense widget use the same explicit labels and in-flow question-mark calculation help:

- **My own trip expenses** / **我的個人總開支** / **自分が負担する旅行費用**: sum the signed-in person's allocated portion of every authorized `posted` expense for this trip, across all dates. Includes their portions of private, shared and standalone bills, even when another person paid. It is their cost, not their remaining debt. An event without an expense record contributes nothing.
- **Bills paid by me** / **我已支付的帳單總額** / **自分が支払った会計総額**: full posted bills recorded under the viewer as payer, including private bills, shared bills and advances for others, even with zero personal share. This is before reimbursements, excludes separate member repayments and is not a bank-verified cash-outflow total.
- **Still owed to me / I still owe**: bill-paid minus personal share plus posted repayments sent minus received. Positive means owed to the viewer, negative means the viewer owes; zero remains neutral. Repayments affect only this balance, not spending or bill-paid totals; explicit removal bookkeeping assignments still apply.

Short hints stay visible beside the metrics, and each label/question mark opens a native keyboard/touch-accessible explanation without hover or a remote request. Both Cantonese modes use identical neutral money wording. These are recorded ledger figures, not verified bank movements.

Currencies stay separate. Pending requests, drafts and void records do not count in spending, balances or suggested settlements. A person with no posted costs sees zero in the default currency, not the group's spending. On entry only the actual current trip-local day is expanded and scrolled into view; other groups are collapsed and retain personal day totals. Manual toggles survive refreshes during the visit and reset on re-entry or trip/member/date change. If today is absent from the displayed dates, all days remain collapsed and the nearest heading is shown without a Today label. A current repayment-only date outside the trip does open normally. The yellow Add expense action is right-aligned; nonzero personal spending is gold, paid amounts violet, and existing receivable/payable labels keep distinct colors. Zero/void values stay neutral.

The owner may expand **Owner details · visible trip totals** below the personal summary. It totals only records the server permits that owner to view. Ownership never unlocks another member's private event/expense. Members do not get the owner aggregate control; normal authorized expense history is unchanged.

Personal suggested settlements involve the signed-in member only. Owner details can show all settlements from that owner's visible ledger. These are deterministic simplification suggestions, not proof a transfer happened. **Record repayment** starts a separate form, with an outgoing suggestion optionally prefilling recipient/amount/currency. Enter the actual partial/full payment and confirm it happened outside the app. Existing expense-review settings apply; pending/rejected/void repayments do not affect balances. All repayment statuses remain readable in their date groups without entering daily expense totals. See [recording, visibility, corrections and member removal](MEMBER_PAYMENTS.md).

## Separate bills for one event

1. Choose **Add expense**. A new standalone bill defaults to the signed-in person as payer and sole participant.
2. Enter that person's own bill amount, currency and payment time; select the restaurant/event in **Linked event (optional)**.
3. Save, or request approval if required by the owner's expense policy.
4. Another traveler can link another independent expense to that event through **Add expense** or the event editor's expense section. Expense cards do not repeat an Add my bill shortcut; their edit and owner review actions remain.

Use **Share with others** to select eligible people, then adjust payer/participants. **Equal** is the default; **Custom amounts** lets you enter the amount each person owes, including an explicit zero. The allocations must exactly match the whole bill, and the form shows remaining or overallocated money rather than guessing a remainder. Both standalone and event-linked forms use the same currency precision and deterministic validation. Do not enter the whole table's total again for an individual payment.

The existing non-unique event foreign key supports many independent expenses, each with its own revision and audit history. An event-editor save may still carry one *new* nested expense atomically; existing linked charges are separate records, not overwritten. Pending events have no canonical ID: an embedded charge can be proposed with one, and additional standalone links are available after event approval.

Private-event payer/split choices stay within the eligible creator/viewer audience. Standalone private expense approval still requires an authorized reviewer. Existing private links cannot be removed to expose the expense publicly. Approval/privacy rules are unchanged.

## Editing and failure behavior

Edits preserve existing payer and exact allocations. Unequal shares reopen as custom; financially equal shares may reopen as equal because there is no stored UI mode. Description/payer/date-only changes and an explicitly unchanged total preserve the original allocation rows. A changed unequal total requires a complete reconciled custom allocation or explicit equal-split participant selection; it never silently becomes equal. An equal expense retains its legacy amount-only recalculation behavior. Unchanged date/time keeps seconds and milliseconds; every mutation is audited and revision-checked.

The wire contract adds optional `splitAmounts: [{ memberId, amountMinor }]` to the existing `splitMemberIds` list. Custom amounts must contain one unique entry for every selected participant, with nonnegative safe integer minor units and an exact sum to the positive total. No `splitMode` is sent or stored. Omitting custom amounts means equal splitting when creating or explicitly changing participants. A sparse custom-map update may omit participant IDs and use the expense's existing members/total; ordinary nonfinancial updates preserve all shares. The same resolver protects pending projections, linked expenses, owner approval and AI creation. Approved expense history prefers the immutable applied revision's recorded shares, not a recalculation or today's canonical record.

Expense totals and custom shares are parsed from decimal digits into integer minor units without floating-point rounding. Existing ledger precision is retained: JPY/KRW use whole units, other currently supported codes use two decimal places. Excess nonzero fractions and unsafe integer amounts are rejected. Enter a leading zero for fractional amounts, such as `0.50`. This is not a new general ISO-currency conversion facility.

Validation/save failures appear inside the modal without clearing input. In-flight saves block double submission, editing controls, closing and opening replacement expense drafts. Network uncertainty never automatically resends a financial mutation; check current expenses/approvals before an explicit retry.

Summary, date history, presets and form labels/feedback support English, neutral Cantonese in both tone selections, and Japanese. User-authored names remain unchanged.

## Verification and limits

Synthetic checks cover records across dates/currencies, individual same-event bills, pending/draft/void exclusion, no personal charges, owner/member rendering, integer parsing, preserved allocations/timestamps, private audiences and uncertain-network handling. Disposable PostgreSQL tests create and edit two individual bills against one event, check distinct revisions/audits and confirm an owner outside a private audience sees neither bill. No successful financial test writes target real traveler records.

Synthetic coverage also includes zero/custom shares, exact sum/member validation, sparse preservation, pending and approved history, AI normalization/deduplication, private audiences, atomic linked expenses and repayment balances after unequal allocations. No real financial records are created for testing.

Receipt metadata, weighted/percentage entry and CSV export are not implemented. Custom splits added no migration or existing-balance recomputation. A code rollback must retain custom-map validation/application until pending custom proposals are safely handled; a legacy writer must not drop `splitAmounts` or recalculate existing unequal shares. Retain repayment math/history/visibility and removal guards too; see [repayment records](MEMBER_PAYMENTS.md).
