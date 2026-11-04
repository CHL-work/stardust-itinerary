# Member repayment records

Repayment records are manual records of money already paid between trip members. They are separate from expense entry: Stardust never sends money, connects to a bank or treats a repayment as new trip spending. In-app AI has no payment mutation tool.

## Record a repayment

Choose **Record repayment** in the expense summary, or the action beside an outgoing suggested settlement. A suggestion prefills the recipient, currency and amount; it is not a payment instruction or automatic confirmation. The generic form defaults to the signed-in payer, the trip currency and the current trip-zone time. Select the recipient and enter the actual amount, currency, payment time and optional note. Partial payments are valid.

Members may record only themselves as the actual sender and must have the existing expense-edit permission. Owners may explicitly select another eligible sender to record on their behalf. Enabled active or named-invited same-trip members are eligible counterparties; self-payments are invalid. Payment dates can be outside the trip dates because people settle before or after travel, but more than five minutes in the future is not a completed payment. Currency precision follows existing expense entry (whole JPY/KRW, two decimals otherwise); no exchange rate is inferred.

The confirmation explains that this records an external payment only. A payment is not capped to a suggestion: an overpayment can leave the sender owed money in return. Choosing a different currency creates a separate-currency balance, not a conversion. Errors keep the form open and preserve input; in-flight controls prevent accidental double submission. Client request IDs make an explicit identical retry safe after an uncertain response. A different real payment requires a different request ID.

## What changes in the summary

Per member and currency:

`remaining net = expense-paid − expense-share + posted repayments sent − posted repayments received`

The Expense summary and Overview now label the first two numbers **My own trip expenses** and **Bills paid by me**, with short hints and question-mark help. Personal expense portions include authorized private and shared bills regardless of payer; bill-paid is the whole amount recorded under that payer, including advances. Neither includes separate member repayments. Balance help explains the formula above and existing bookkeeping reassignment, without claiming bank verification. The underlying calculations are unchanged; see [summary definitions](TRIP_EXPENSES.md#reading-the-summary).

Positive means owed to this member; negative means this member owes money. Example: Bob owes Alice JPY 500; recording Bob's JPY 200 repayment leaves Bob owing JPY 300. Both people's trip spending and original bill-paid amounts stay unchanged. Multiple partial payments accumulate, and repayment-only currencies are retained. Integer minor-unit arithmetic and exact reconciliation are deterministic; no model performs settlement math.

If member removal explicitly reassigns payment bookkeeping to the viewer, a localized summary note distinguishes those attributed totals from the original cash sender/recipient retained in history. Supported amounts and combined ledger totals must remain within safe minor-unit precision; the app rejects an overflowing post/approval rather than allowing a broken balance page. Database guards also protect a later expense change in a currency with posted repayments.

Pending, rejected and void payments do not count. They never appear in expense-day spending totals. Suggestions are recomputed from the viewer-authorized expenses and payments, not hidden private ledgers or bank evidence. Because members can have different private-expense audiences, a suggestion is not necessarily a complete or uniquely required group settlement route.

## Review, history and corrections

The existing **expense requires approval** policy also applies to repayment records. An owner record or a permitted member record without that requirement is posted immediately; otherwise it waits pending for owner review. Both original payment participants, current accounting assignees, the recorder and active trip owners may view the payment history. Other members cannot read it. This explicit payment audience does not expose an underlying private event, bill or receipt.

Owners may approve a pending/rejected payment or reject a pending one. A posted record cannot be rejected, edited into different money facts or deleted, and deleting the whole trip retains it too, though members can no longer see it. Correct a mistake by explicitly voiding its record and recording the correct payment; voiding does not move/refund real money. Owners may void records. The creator may withdraw pending/rejected records, or void a posted record only while retaining expense-edit permission without an approval requirement. Every action uses the displayed revision and explicit confirmation. Voided records are terminal.

On Trip Expenses, repayment history appears inside the existing collapsible date groups, interleaved chronologically with bills and pending expenses. There is no separate repayment tab or history disclosure. The date comes from the actual payment time (`occurredAt`) in the trip time zone, not the record creation time. Repayment-only dates before/after travel remain visible. Only today's group opens by default; manual toggles and nearest-date navigation retain the usual behavior. Each repayment is labeled distinctly and counted separately in the day heading; it never increases daily spending.

Cards retain original sender, recipient, amount/currency, actual payment time, note, status and accounting reassignment facts. Owner review is available alongside the records and in the owner Approvals surface. There, actionable pending repayments appear before event/expense request history; other repayment review records stay below, with empty groups omitted. Pending/rejected records remain outside the balance until approved. All financial copy uses neutral language, including both Cantonese modes.

## Safe member removal

Actual sender and recipient are immutable facts. Separate current accounting sender/recipient IDs say whose reimbursement claim/obligation now affects the trip ledger. The removal preview includes affected posted payments, their revisions and eligible bookkeeping recipients. The owner must explicitly reassign every affected leg against the exact preview digest; there is no default debt erasure or automatic cash reversal.

Reassignment keeps the actual payment and earlier revisions intact, appends an accounting revision/audit and prevents removed-member obligations remaining in current balances. Both accounting legs may converge on the same member, producing zero net change without deleting the payment. Pending/rejected payments involving the departing participant or recorder are permanently voided so a later approval cannot revive removed obligations. Existing private-expense resolution and last-active-bound-owner safeguards remain intact.

## Storage and API

- Migration `0040_member_payments.sql`: trip-scoped `member_payments`, append-only `member_payment_revisions` and payload-bound `member_payment_actions` receipts. Same-trip composite foreign keys, positive safe-integer amounts, finite instants, immutable actual facts, legal versioned transitions and exact revision snapshots protect history.
- Migration `0041_member_payment_removal.sql`: deferred safeguards prevent committed posted obligations or approvable payments from retaining removed-member references. Changed accounting legs must replace a member removed by commit with an active same-trip member; unchanged disabled historical counterparties remain valid. Removal and payment writes use compatible trip/member/row locks.
- `POST /api/trips/{tripId}/payments`: actual sender/recipient, currency, amountMinor, occurredAt, optional note, stable clientRequestId and `confirmation:true`.
- `PATCH /api/trips/{tripId}/payments/{paymentId}`: approve/reject/void, expectedRevision, stable clientRequestId, optional reason and `confirmation:true`.
- Both APIs require same-origin authenticated active membership and current server permissions. An actor cannot use another trip or spoof another sender. Idempotency is actor/trip/payload bound; a reused key with different content conflicts, and replay cannot recreate a voided record.
- Overview reads the complete authorized payment projection in the same read-only repeatable snapshot as expenses. The server and personal UI summary apply the same posted bookkeeping legs. There is no arbitrary history limit that could drop older payments from balances.

## Verification and operations

Use synthetic domain, API, form/render and disposable PostgreSQL tests, never fabricate a real traveler transfer. Required cases include exact/partial/overpayment, multiple currencies, pending/void exclusion, unchanged spending, stable uncertain retries, cross-trip/role/audience denial, stale review, immutable financial history, and member-removal reassignment/invalidation.

After payments exist, rolling back to code older than migrations 0040–0041 would misstate outstanding balances or break safe removal; retain payment math, visibility and removal guards. Never drop financial tables to roll back UI. Full database backups retain payment/revision/idempotency records normally. Deploy and recover with [deployment](DEPLOYMENT.md) or [self-hosting](SELF_HOSTING.md); backup, restore and migration rules are in [database](DATABASE.md).
