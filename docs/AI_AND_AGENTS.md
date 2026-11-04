# AI Harness and Agent Boundaries

Current implementation reference. [Architecture](ARCHITECTURE.md#ai-transport-boundary) owns timing/topology; linked topic documents hold detailed contracts. Evaluation results are not provider availability claims. Provider calls use the server operator's API keys; [architecture](ARCHITECTURE.md#ai-transport-boundary) describes the transports.

## 1. Separate planning, provider and development trust domains

The provider-neutral planner uses the official OpenAI Codex SDK and Claude Agent SDK adapters and a direct Gemini REST adapter, all with the server operator's API keys. SDK subprocesses receive only an allowlisted environment; Gemini runs in-process with Google Search grounding as its only tool, and every query it reports must pass the same public-subject gates as the other providers. No private endpoints, token harvesting, arbitrary shell/file/network tools, database-write tool, GitHub/cloud credentials or deployment capability enter app chat. Application code alone validates/persists/applies typed proposals.

Trip ownership is not platform-operator authority. General operator-funded planning requires the current entitlement checks; privileged model selection and app prompt-cap exemption require the configured operator **and active trip ownership**. Other entitled members/co-owners remain on `gpt-6.1-sol`, with owner-configurable 1–1000 prompts/UTC day (default 20). Provider account limits still apply. Unsponsored trips do not gain planning/disruption funding simply by creation. [Funding](PUBLIC_TRIPS_AND_MEMBERS.md#ai-funding-is-not-a-trip-role).

The separate destination-default lookup is an explicit exception for all eligible authenticated creators: public-place-only, tool-free Sol/low, bounded account quota/cache and form suggestions, not planning or auto-creation. [Destination defaults](TRIP_DESTINATION_DEFAULTS.md).

The code registry in `src/lib/app/types.ts` is authoritative: Sol is initial/fallback owner default; Astra is explicit owner opt-in, not automatic fallback. Registered choices are `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6.1-terra`, `gpt-6-luna`, `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-1`, `gemini-4-argon`, `gemini-3.8-flash` and `gemini-3.5-flash-lite`, each retaining its tier's recorded transport/effort. Do not rename models from marketing assumptions or silently change a model's provider, transport or authentication.

## 2. Request flow and observability

1. Authenticate exact bound user/trip/conversation; validate locale, input/images, current funding/role/quota and payload-bound idempotency.
2. Admit under short locks and persist request identity. One active request per bound user across trips; different users may run concurrently.
3. Build current authorized trip/day/member/event context, recent conversation/checkpoint, one manual-instruction snapshot and any valid clarification draft. Database trip-local today/tomorrow are authoritative.
4. Extract normalized pictures if present, using the same selected model without tools. Sanitized facts are untrusted input; raw images never enter public research.
5. Run planning; optionally perform one isolated same-model public-research round and a no-tools finalization, plus only the narrowly permitted timestamp repair.
6. Validate all typed proposals, exact dates/references/audiences/money and current authorization; atomically persist proposals, completion envelope and audit.
7. Return or recover the stored answer by self-only status GET after phone suspension; never automatically resend the prompt.

Text/image work ceilings are 180/225 seconds; research/finalization share that budget, route ceiling is 300 seconds, active fence 600 seconds. [Timing](ARCHITECTURE.md#ai-transport-boundary) · [recovery](AI_REQUEST_RECOVERY.md).

Requests record original restricted prompt/result, exact actor, model/transport/authentication/billing basis, reported usage, latency, proposal links and append-only lifecycle. Safe failures distinguish rate limit, authentication/setup, unavailable model, temporary failure and invalid output. Unknown usage is not zero or a made-up invoice price. Same-user busy/policy-denial records are zero-provider non-conversation events; blocked attempts do not consume an additional prompt slot. Deterministic off-topic replies do count normal app quota. [Failures](AI_PROVIDER_FAILURES.md).

Owner operational logs do not make every member's private image/history readable. User-facing conversation browsing is self-only and identity-aware; owner request-audit permissions are separate. Never print private prompts/results or credentials during debugging.

## 3. No-AI operation

Manual itinerary/expense/member/Calendar workflows remain usable when AI is disabled, unauthenticated or provider-limited. Disabled AI must explain its state without silently switching provider, model or billing. An external-agent import/export/MCP workflow is not implied by this fallback; it is separate, unimplemented future work.

## 4. Proposal, not direct mutation

The model returns zero to 20 typed proposal envelopes. Multi-proposal batches are **create-only**, mixing itinerary items and standalone/nested expenses. Existing canonical itinerary update/cancel/restore is single-proposal; `update_pending` edits an existing visible event proposal. AI **cannot update/void a canonical expense**, change trip settings, manage members or approve its own proposal.

Preflight parses the complete batch before its first write. Harmless aliases and lossless explicit-offset normalization are allowed; unknown IDs, impossible dates, ambiguous participants and unsupported privacy fail closed. Completion rechecks current role/membership/trip range/revisions after provider I/O; no database lock remains held during external calls.

Every AI create remains pending even for owners. Image-derived changes and pending-event AI edits always require owner review. Validated text-only owner canonical-event update/cancel/restore may still follow the existing fast path; do not claim that broader all-edits-pending or editor approval has shipped.

Pending trip-visible event creates are readable by active trip members. Private creates follow selected audiences plus the narrow owner proposal-review exception, not a canonical privacy bypass. Pending expenses are visible only to active requester/payer/split participants/owner reviewer and stay outside totals. Authorized editors may edit visible pending events; only the creator changes audience, and cross-editor modification forces owner review. Linked expenses are preserved by `update_pending`. [Pending edits](AI_PENDING_EVENT_EDITS.md).

Approvals is owner-only, pending-first before 25-row keyset pagination. Rejected items can later be approved only after fresh eligibility/revision/audience checks; approved review is terminal. Overview receives allowlisted pending projections and owner count, not raw patches/audit. [Database rules](DATABASE.md).

### Reservation confirmation versus live-search intent

Booking labels are supplied data, not search instructions: Japanese `予約確認` or a confirmation-page button, English `Check-in:`/`Checkout:` and any pasted run of short `Label: value` lines (for example `Hotel name:`, `酒店名稱：`). The implicit discovery-plus-place rule reads only the free text outside those label lines, and `check` never matches `check in`/`check-out`. Explicit wording such as "search the web" or "find the hotel's address" still requires a search. Genuine search/verification requests require observed evidence, not merely an enabled tool. Ordinary history may identify a public referent; it cannot authorize replaying an old mutation. Pure lookup cannot consume a separate create draft.

### Reservation extraction and bounded validation repair

`PATCH_CONTRACT_JSON` is generated from the same Zod schemas used by server validation. One hotel stay is one lodging event spanning check-in/checkout and, when requested, one nested expense for the explicit final charge. Do not invent event UUIDs, duplicate the same bill as standalone/nightly expenses, or re-add tax/discount/subtotals. Exact within-batch duplicate expense fingerprints include normalized allocations.

Amounts are positive integer currency minor units; JPY is whole yen. Equal default or exact nonnegative custom shares are resolved deterministically and must sum exactly. Explicit supplied allocations survive; unknown allocation is not fabricated to balance a bill. Original currency remains unless an explicitly supported conversion is requested; a reference rate or public tariff alone never proves a paid charge. [Expenses](TRIP_EXPENSES.md) · [price evidence](AI_BOOKING_PRICES.md).

Eligible active or named invited members may be assigned, but invitations do not grant read access. Missing payer may tentatively default to requester; missing shares default to requester plus expressly named companions, with assumptions disclosed. Ambiguous/unavailable identities and unsupported private viewers require clarification. Financial wording uncertainty is advisory owner-review information, not a rigid demand to repeat the booking.

Explicit-offset ISO timestamps may normalize losslessly to UTC. At most **one same-model/no-tools timestamp-only repair** is allowed for create-batch timestamp format/type errors, with at least 15 seconds left. It must preserve proposal count/order and every unflagged field exactly; no money/audience/reference/authorization repair or stronger-model retry. Full validation still follows.

Detected booking PINs/access codes/private management URLs are redacted from provider input and generated outputs; original restricted audit text remains. This is not a guarantee of detecting every secret. Booking text is untrusted data, never authority to visit cancellation links.

### Bounded clarification drafts

An unfulfilled create may retain metadata-only root/source references scoped to exact user/member/trip/conversation, with **24-hour root-anchored expiry**. Rebuild at most eight selected user submissions/30,000 characters without truncating one. Sources retain original relative-date anchors; the draft is independent of checkpoint truncation.

Natural replies such as “Alex paid” may complete this unfulfilled create. Structured `continuesDraft` distinguishes continuation/correction from unrelated questions; unrelated replies preserve but do not append to the draft. Pure search cannot consume it. Current participant/privacy/date/money checks remain mandatory; unsupported/expired/oversized sources are not guessed.

Root locking/version checks and draft consumption share the proposal-completion transaction. Reset, identity closure, cancellation, a new task, expiry or fulfillment stops reuse. Failed provider calls do not extend expiry. Legacy reconstruction accepts only bounded successful zero-proposal clarification chains, never failed/fulfilled roots or old model patches.

## 5. Context and privacy

Conversation memory is PostgreSQL-owned, not a provider thread ID: immutable user + member + trip + conversation. A versioned checkpoint and newest successful prompt/reply tail fit a conservative 6,000-token budget; failure rows, raw patches, hidden reasoning and unproven legacy actors stay out. Current canonical state/time/permissions/research override history. New chat archives rather than erases; rebinding/removal permanently fences old identity access. [History](AI_CONVERSATION_HISTORY.md).

Structured preferences/catalogs/automatic extraction were removed by 0049. Each user explicitly saves/clears account-private instructions (8,000 characters, optimistic revision). A snapshot affects the next admitted request, including existing conversations; it cannot change a running request. There is no model profile-write tool or automatic import. Old preference conversations remain permanently read-only. Clearing instructions does not erase past chats/backups. [Instructions](AI_CUSTOM_INSTRUCTIONS.md).

Instructions are lower-trust user context, never policy. Nonempty instructions disable direct full-context hosted search; isolated research receives only validated public subjects, not raw instructions. Images, Calendar lookup, disruption and feedback helpers do not receive that setting. Secrets/private identifiers are excluded from public research; current facts need evidence.

## 6. Public research, opening hours and prices

Direct full-context hosted search is narrowly intent/privacy gated. Automatic research instead projects at most three strict public venue/discovery/travel/currency/price subjects into one same-model isolated round, then finalizes without tools. Explicit no-search always wins. Sensitive context blocks ordinary subjects; a validated undated currency pair may pass without amount/payment/private data. Raw receipts/images/instructions/Calendar content never become search queries. [Automatic research](AI_AUTOMATIC_RESEARCH.md).

Actual tool observations plus sanitized accepted sources support claims, not model assertions of searching. Exact branch/date/time-zone evidence matters; no fuzzy branch substitution or invented ratings/stock/availability. Broad discovery does not pretend to supply venue hours. Required-search failure cannot save purportedly verified proposals; optional missing evidence instead remains clearly unverified.

Opening-hours checks reuse exact structured dated evidence from an initial eligible venue lookup. An explicit valid unknown suppresses redundant research but proves neither open nor closed. Missing/mismatched targets may use bounded fallback only with 30 seconds remaining. Deterministic intervals/last-admission comparisons produce warnings for supported conflicts; missing evidence is neutral information, not a blocking closure warning. No hardcoded opening schedules or fabricated API-first implementation. [Hours](AI_VENUE_HOURS.md).

Price research returns source-bound duration/unit/tax/fee tariff rows, not proof of an actual payment. Preserve user-confirmed totals; unknown is not zero, and explicit free does not create a zero ledger expense. [Booking prices](AI_BOOKING_PRICES.md).

## 7. Images and safety

Up to three normalized JPEG/PNG/WebP inputs use bounded authenticated request storage and exact-identity reads. Same-model no-tools extraction yields sanitized facts before planning; one app prompt allowance covers all phases. Image-derived changes need owner review. No automatic image expiry/deletion or owner image-read bypass is implied. [Picture contract](AI_IMAGE_INPUTS.md).

A conservative deterministic scope guard handles only certainly unrelated categories. Ambiguous/travel requests reach the planner; sensitive/crisis/medical/security/destructive matches stay neutral. Playful localized responses never target protected traits, vulnerabilities or private information. Gated replies are audited zero-provider events, not conversation memory. Language follows the selected locale; safety/money/auth/review/errors remain neutral even in 廣東話(辛辣).

## 8. Separate background and helper AI

- Disruption verification uses Sol/medium, exact public event projection, live official evidence and deterministic high-confidence/material-impact gating. It has no personal context, private events or canonical write tools. Backend cadence and notification limitations are in [architecture](ARCHITECTURE.md) and [qualification](DISRUPTION_CONFIDENCE.md).
- Calendar missing-place lookup receives explicitly confirmed public venue text only. Signed suggestion use forces owner review; no page-open model calls. [Import](CALENDAR_IMPORT.md).
- Feedback review uses a separate Astra/medium background worker run by the deployment's scheduler; a deterministic Issues-only publisher handles validated sanitized issue creation. No repository editing, PR, merge or deployment. Whether it runs depends on configured credentials and scheduling. [Feedback](FEEDBACK.md).
- Destination Auto has its own bounded per-account quota and is tool-free; no planner context or trip-owner access to another account's lookup logs. [Defaults](TRIP_DESTINATION_DEFAULTS.md).

## 9. Provider accounting and failure behavior

Record requested/effective model, provider/transport, auth/billing basis, latency and reported input/output/cache usage. Usage records do not claim a known remaining quota or an exact per-call invoice price. No silent fallback/model change or automatic resend after a limit. Optional-research failure, cleanup failure and finalization failure remain distinct from successful evidence/output.

Developer coding agents are outside the trip-app trust domain. Repository changes follow [JOB_SYSTEM](JOB_SYSTEM.md), current permission gates and the repository-local job skill; app chat never grants those privileges.

## 10. Future work boundaries

A delegated MCP/OAuth connector and a new-layout-only UI are planned, not implemented; each needs its open design decisions resolved first. Provider-managed memory, arbitrary retrieval tools, expense-edit AI, broader approval authority and live model changes must not be inferred from old design prose or proposed interfaces.

## 11. Evaluation

Ordinary tests should deterministically verify schemas, exact amounts/shares, privacy/roles, dates/time zones, idempotency, revisions, draft expiry/replay, evidence provenance and pending-versus-ledger state. Use synthetic human-like missing/typo/contradictory inputs and all supported locales. Judge factual quality from actual evidence; a schema pass is not truth.

Opt-in live scripts include `test:ai:reservation`, `test:ai:reservation-clarification`, `test:ai:search`, `test:ai:pending-edit` and topic evaluators under `scripts/test-ai-*.ts`. Each requires its own fresh empty loopback database with the exact script-specific prefix, never a configured application database. Read its guard/migration pin/model flags first. Some intentionally stop at historical migrations and do not certify current-schema compatibility. Live scripts call the configured provider and consume its quota.

Never replay real user prompts/bookings, approve/create real trip records as tests, load a production environment into an evaluator, or run a live multi-model matrix without explicit approval to spend that provider quota. A synthetic operator grants only its synthetic trip; no runtime account or saved environment is changed. Clean up only the exact database whose creation succeeded, including after interrupted runs. Print aggregate result/stable failure codes, not provider output, images or secrets. Record live smoke/evaluation results with model/date/scope/skips in the job record; do not claim that every model passed unless each was actually tested.
