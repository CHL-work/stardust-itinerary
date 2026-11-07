# AI edits to pending events

Free AI (JOB-086) receives only trip-visible pending creates and updates whose canonical base is also trip-visible, with notes/URLs omitted. Private pending events remain accessible through authorized paid-provider/manual flows, not automatically exported to a free provider. Free edits keep the same pending proposal and always require review.

Custom linked-expense shares are preserved exactly during event-only AI edits. The manual pending-event expense section can edit those amounts with deterministic reconciliation; `update_pending` still rejects every `linkedExpense` key and gains no expense-edit authority.

Relevant venue/date/time edits also receive the isolated [venue-hours assessment](AI_VENUE_HOURS.md) using the effective pending patch and exact reusable evidence when available. Omitted venue/time fields and linked expenses remain preserved. The notice is saved on the same request and in the AI reply; private or unverifiable cases remain pending with quiet neutral uncertainty, while only supported hours conflicts warn. No silent replacement or approval occurs.

An explicit request such as “Update it to be in Cantonese but keep the location in Japanese” can edit the pending event discussed in the selected conversation. It updates the **same approval request**, not a duplicate event. The result remains pending even when the requester is an owner. An ambiguous target still needs clarification; conversation history is not a substitute for a current authorized request ID.

## Separate proposal identity

The planner loads at most 100 most recently updated actionable, editable pending itinerary creates/updates into `pendingItinerary`, separate from canonical `itinerary`. Entries contain request ID, proposal revision, operation, optional canonical target ID, original creator, a safe event patch and a linked-expense-presence flag. Raw approval history, reasons, requester profiles and financial details do not enter this projection. Hidden, invalidated, terminal, stale-base or unauthorized/locked editor targets are excluded. `pendingItineraryTruncated` signals an incomplete window; the model must not invent a missing ID or create a replacement merely because it cannot find a pending target.

The serialized pending projection additionally has a 60,000-character ceiling; only whole entries are included. It is not exhaustive history. The final write transaction checks for an existing pending canonical-target update across all rows, including entries omitted from context, so the model cannot bypass review by submitting a canonical edit instead.

Both existing provider adapters use the same envelope:

```json
{
  "entityType": "itinerary_item",
  "action": "update_pending",
  "entityId": "<exact pending requestId>",
  "baseRevision": 3,
  "patchJson": "{\"title\":\"午餐時間\"}",
  "reason": "Update the pending event title as requested."
}
```

For this action only, `baseRevision` is the **proposal revision**, not a canonical event revision. It is a single-operation request, not a mixed/create batch. The partial event-only schema is generated from the runtime validator and rejects empty patches, lock changes, expense fields and any `linkedExpense` key (including null). Omitted fields, privacy and the existing charge remain unchanged. Expense corrections still use the manual event editor. Explicit privacy edits remain creator-only and cannot exclude linked-expense participants.

## Validation, approval and recovery

The server resolves the exact target against current authorized pending context and validates references, trip-local dates, transport endpoints and supplied fields. The pending-editor repository function is transaction-aware: the planner calls its `WithClient` variant inside the same transaction that saves the AI answer and recoverable success receipt. It rechecks the live actor, request revision/status, invalidation, canonical base/lock where applicable, audience, day, time order and retained linked expense. A concurrent edit, approval, removal or stale base fails without a partial write; it never falls back to creating another request.

The request retains its ID, original requester, creator and source. Before/after audit records include trusted AI request provenance and `requiresOwnerReview`; direct-apply is blocked even for a self-authored manual draft edited by AI. Only explicit owner review may approve it. Canonical rows, expense shares and Calendar entries are unchanged until normal approval. A phone reconnect or exact client-request replay returns the saved response without revising the proposal again or consuming another prompt.

This does not resume a consumed create-clarification draft, grant viewers edit access, widen private audiences, add provider tools, change model/quota policy or enable public signup. Existing owner fast-path behavior for canonical edits without a pending target remains separate. The UI's generic single-proposal notice says it is awaiting approval, rather than incorrectly claiming every edit created a new request.

Every browser approval/rejection sends the proposal revision shown on that card. Missing/invalid revisions fail validation; a stale revision fails atomically with HTTP 409. The UI refreshes the proposal and asks the owner to review again, never automatically retries approval. Existing browser tabs must reload after upgrading. Internal approval of a just-created canonical request remains a separate trusted path.

## Evaluation and rollback

Tests use synthetic drafts and disposable loopback PostgreSQL only. The opt-in `pnpm test:ai:pending-edit -- --run-live --model=<registered-model>` harness uses a fresh empty `stardust_test_ai_reservation_pending_<unique-suffix>` database, the ordered migration chain and the guarded synthetic operator fixture. It tests language changes, a second explicit follow-up, retained expense/time/privacy, same-request revisions and exact-key recovery. It never loads the application environment file, approves the draft or uses real booking data; the caller creates and removes only the exact generated database. Live calls consume provider quota from the configured provider credentials.

This feature has no migration of its own. Retain the proposal/audit/AI records on rollback. Rolling back to code without AI pending-event edits loses the AI-edit audit gate for direct apply; preserve that gate for already AI-edited requests and retain the identity, funding and member-removal protections.
