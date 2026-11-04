# Decisions, Tradeoffs and Pushbacks

Current decisions are summarized here; accepted direction does not imply implementation or current permission to act. [IMPLEMENTATION](IMPLEMENTATION.md) describes shipped scope; hosting is in [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md). Superseded detail remains in Git history; do not follow historical rollout commands.

## D-074: Google sign-in in production, unverified, signup still gated (accepted November 4, 2026)

The public instance's Google OAuth app is published from Testing to In production. Invitees no longer have to be registered as test users, and new Calendar tokens are not subject to the Testing-mode 7-day expiry. Public signup stays off.

The app stays unverified. Calendar consent shows Google's warning, and sensitive-scope grants are capped at 100 users until Google verification, which needs a separate decision. Stardust's own invitation and membership gates and `PUBLIC_SIGNUP_ENABLED=false` are unchanged. Self-hosted deployments make their own OAuth publishing choice.

## D-073: Deleting a trip removes it for members and keeps its records (accepted November 4, 2026)

The request was a user-friendly way to delete a trip in Settings. It did not say whether records are erased, so the chosen reading is the one that conflicts with no accepted requirement: deletion removes the trip for every member, and records stay. A true erasure would conflict with append-only audit, "cannot erase debt", retained feedback and AI history, immutable payments and Calendar receipts, and the rule that data-deleting retention needs separate review. The dialog says plainly that this is not an immediate erasure.

- **Fail closed:** every membership moves to the terminal `trip_deleted` status, so existing access checks refuse it without a new filter at each of about 50 sites, including under an older build. A trigger refuses usable memberships on a deleted trip.
- **Authority:** any active owner, because co-owners are already equal. Typing the trip's name is the confirmation.
- **Last trip:** blocked. With public signup off, an account with no trip cannot create another without an invitation.
- **Reported tension:** members lose sight of unsettled balances. Deletion does not change money facts and warns the owner, but it does not block on balances. This can be revisited.

Not decided here: in-app restore, a retention period, or true erasure. A database operator can reopen a trip with the [restore procedure](DATABASE.md#restoring-a-deleted-trip).

## D-072: Registered models track the newest provider version (accepted October 31, 2026)

Every registered model moves to its newest version. Each tier uses its newest documented ID, so Sol moves to `gpt-6.1-sol` because the provider lists it as newer than GPT-6 Sol. Tiers, efforts, transports and funding rules are unchanged. References to "Sol" elsewhere mean the current registered Sol. Historical audit rows keep the model that ran. Migration 0051 holds the mapping; see its [rollback rule](DATABASE.md#compatibility-checkpoints).

## D-071: Destination Auto lookup for eligible creators (accepted October 28, 2026)

Operator-only and fixed-table-first destination lookup were rejected. **Auto means a tool-free Sol (low effort) lookup**, including country destinations, for authenticated eligible trip creators, using the server operator's configured provider credentials. `creators` is default; `operator`/`off` restrict it. Non-operators get ten uncached calls/account/UTC day; all callers retain thirty/hour and one-in-flight protections, strict output validation, private account logging and a 30-day versioned validated cache. Manual fallback and editable currency remain; suggestions never submit the form.

This is a narrow funding exception, not general trip AI entitlement or public-signup activation. The same change removed Overview previous/next text buttons. [Contract](TRIP_DESTINATION_DEFAULTS.md).

## October 28, 2026: Earlier work order (superseded)

Superseded: the earlier job order and hosting plan. Planned work is in the [roadmap](ROADMAP.md); hosting is in [deployment](DEPLOYMENT.md).

## October 27, 2026: Earlier hosting (superseded)

Superseded: earlier single-VM hosting; see [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).

## October 11, 2026: New default layout with a preserved classic layout

New UI defaults on phone/desktop; classic remains reachable through the shared toggle and Settings until its planned retirement is separately implemented. Choice is device-local `stardust.ui-mode.v1`, applied before paint; missing storage means new. It stores no identity/trip data and is not purged on sign-out.

New-only selectors stay scoped to `:root[data-ui="new"]`; presentational components reuse existing state/permissions without new APIs or diagnostics. Both layouts retain readable personal amounts, today-first disclosures, horizontal pending review actions, endpoint weather, 44px touch targets and 16px phone inputs. Overview previous/next text buttons were later removed (D-071); chips/date selection/swipe remain.

## October 7, 2026: Manual AI instructions replace preferences

Forward migration 0049 removes structured profiles, catalog/import schema and automatic collection. Each user explicitly saves/clears private account instructions (8,000 characters, revisioned); the next planning request gets a lower-trust snapshot, including in existing conversations. No model writes this setting. Legacy preference chats are permanently read-only; Git/backups/history are not silently erased. Pre-0049 builds are incompatible rollback targets. [Instructions](AI_CUSTOM_INSTRUCTIONS.md).

## October 7, 2026: Feedback is a page control, not a floating overlay

The document-top-right report launcher scrolls away; no sticky/global toolbar replacement. Keep safe-area spacing, accessible modal, touch sizing and offline-header clearance. New reports optionally include ten minutes of allowlisted actions and always disclose sanitized issue-review eligibility. Historical publication opt-outs and exact old retry hashes remain honored. [Feedback](FEEDBACK.md).

## October 7, 2026: MapLibre/OSM selected

MapLibre with OpenStreetMap raster supersedes the Google-default/setup-blocked design. Explicit-load public Photon/FOSSGIS geocoding/routing is bounded/cached best-effort with no API credits; compact icons/times appear on arrowed connections beside Directions links. No duplicate stop list is needed. Private places are not publicly queried/routed; unknown pins/times remain unknown and connectors are not road geometry. No LLM or silent metered fallback.

Only the server-verified operator is exempt from rolling map request quotas; concurrency/provider bounds remain. Renderer retries reuse results rather than spend another lookup; an unresolved venue cannot hide the basemap. No fuzzy different-branch substitution. [Map contract](DAILY_MAP.md).

## Accepted decision register

IDs are retained for older references. **Superseded** means do not use the old implementation instruction; **future** means accepted direction, not delivered capability.

| ID | Current decision / disposition |
| --- | --- |
| D-001 | Names: Stardust Itinerary / 星塵遠征軍. |
| D-002 | PostgreSQL is canonical. Discord-centered discussion is future direction, not current delivery. |
| D-003 | Telegram optional/future; WhatsApp excluded; Signal experimental, not an installed integration. |
| D-004 | Editors default, owner-reviewed itinerary changes by default, item locks and revision/audit protection. |
| D-005 | High-entropy claim URLs bind after Google sign-in/explicit claim, never a preview GET. |
| D-006 | Revocable rotating sessions: 24-hour rolling activity inside fixed 30-day fresh-authentication age; independent of trip dates. |
| D-007 | Google OIDC identity is the explicit vendor dependency; retain standard issuer/subject binding. |
| D-008 | Portable standard PostgreSQL, not Firestore. |
| D-009 | **Superseded:** earlier hosting plans (Cloud Run/Neon, then a single VM); see [deployment](DEPLOYMENT.md). |
| D-010 | Modular monolith; no unnecessary microservices. |
| D-011 | Provider-neutral planning port. Current adapters are the official Codex SDK and Claude Agent SDK; Google/manual import adapters remain unimplemented. |
| D-012 | Record billing basis per transport, not vendor name. Vendor-policy statements require fresh review when changing access. |
| D-013 | Manual core planning stays usable without AI; no silent paid fallback. |
| D-014 | Zero–20 typed proposals; multi-proposal batches create-only. Preflight every item, atomically persist success/proposals/audit, and require owner review for every AI create. Existing-expense AI update/void unsupported. |
| D-015 | Route duration/arithmetic use deterministic/provider data, not LLM guesses. A full departure/reminder service remains future work. |
| D-016 | App AI and code-writing/deployment agents are separate trust domains. |
| D-017 | **Superseded by D-040:** operational cost/request records are not member-visible. |
| D-018 | Selected LIHKG tone may be sharp, never hateful or vulnerability-targeted. Safety, money, auth, approvals, errors and destructive actions remain neutral. |
| D-019 | No silent dormant-data deletion. |
| D-020 | Every change gets CHANGELOG plus whole-documentation impact review; avoid meaningless edits to unaffected docs. |
| D-021 | Node24/Next16/React19/strict TypeScript/pnpm/Vitest and portable standalone packaging. Lockfile is authoritative. |
| D-022 | Future GitHub→Google Cloud automation should use short-lived OIDC/Workload Identity Federation, not service-account JSON keys. |
| D-023 | Original owner-only connector rule is narrowed by D-030 and D-071: provider credentials stay server-side and restricted; explicit bounded member/creator mediation does not grant general provider access. |
| D-024 | No copied sub2api/private endpoints/OAuth clients/token relay. Gemini CLI token reuse is unsupported; there is no Gemini adapter. |
| D-025 | Ordered plain SQL via pg, SHA-256 checked; never edit an applied migration. |
| D-026 | Git stores schema/rebuild materials, never real dumps/secrets. Backups are encrypted; their storage target is a deployment choice ([database](DATABASE.md#4-dump-and-restore-contract)). |
| D-027 | **Hosting mechanics superseded:** preserve recoverability/retention; old paid-database/dormancy plans are not active. |
| D-028 | Future reminders use due-time work/coarse reconciliation; no claim of a delivered serverless reminder queue. |
| D-029 | Google Authorization Code + PKCE/state/nonce; opaque purpose-hashed claim/session tokens, replay/revocation and independent authentication-age expiry. |
| D-030 | Current general funding: verified platform operator **and active owner** may select registered premium models and avoid app prompt caps. Other entitled members/co-owners are Sol-only and quota-bound; provider limits still apply. Astra is opt-in, not fallback. |
| D-031 | Editors may edit visible approved/pending events; review by default. All AI creates pending, text-only validated operator-owner canonical itinerary update/cancel/restore fast path retained; expense AI create-only. |
| D-032 | Calendar is personal projection, not canonical trip data; explicit idempotent actions and optional consent. |
| D-033 | Switching replaces trip-scoped session and records last selection without extending absolute auth age; fresh login revalidates active membership, including completed trips. |
| D-034 | Original optimistic Part 3 desert-journey homage: five back-facing travelers/luggage, not official series artwork/typography. |
| D-035 | Overview selected-day-only, next planned time/countdown, no guessed departure. Prior previous/next text controls are replaced by existing day selectors/swipe (D-071). |
| D-036 | Exact Google Maps links prefer venue/branch plus full address; vague neighborhood search is fallback, not an exact match claim. |
| D-037 | One event create/edit may include one new linked bill, applied atomically; one event may have multiple independent expenses. |
| D-038 | Canonical private audience is creator plus selected viewers; linked expenses cannot widen it. Owner proposal review does not grant canonical access. |
| D-039 | Capacity 1–20 includes active/invited/disabled owners/members; removed seats freed. Reusable link final-seat exhaustion is atomic and permanent. |
| D-040 | Approvals history, Activity and AI usage operational data are owner-only, enforced server-side. Own AI history browsing is separate. |
| D-041 | Public facts may use authorized hosted search with actual evidence and sanitized sources; no shell/arbitrary network/private-data search. Isolated research is a separate narrow projection. |
| D-042 | App-owned user/trip/conversation context, bounded tail/versioned checkpoint, no provider-thread source of truth. Exact identity closure prevents inheritance. |
| D-043 | Rejection reversible after fresh review checks; approval terminal and at-most-once. History is authorized/pending-first/keyset-paginated. |
| D-044 | Conservative deterministic certainly-unrelated scope guard, safety-neutral exceptions, zero-provider audit and normal counted app quota; ambiguous travel requests reach model. |
| D-045 | **Superseded by migration 0049:** typed preference profiles removed; manual self-authored instructions replace them. |
| D-046 | **Retired by migration 0049:** normalized personal media assertions/catalog import removed; retained historical Git/chat evidence is not active memory/setup. |
| D-047 | One transport event, at least one named departure/destination endpoint; separate chronological time/weather rows and one action identity. |
| D-048 | **Retired:** an earlier host watchdog and shared ingress; hosting is in [deployment](DEPLOYMENT.md). |
| D-049 | Bounded read-only public offline itinerary, not a durable backup/replica/mutation queue; excludes private/money/AI/Calendar/pending data, purges on sign-out. |
| D-050 | Deterministic Open-Meteo seven-day forecast/30-minute freshness, per-endpoint timing, labeled approximate fallback, no private exact-location queries; attribution retained. |
| D-051 | Backend Sol/medium disruption verifier: current-day 30-minute default, future seven-day rolling 24-hour cadence, at most four oldest-due events and a 120-second call. The deployment's scheduler runs it. |
| D-052 | **Superseded:** earlier machine-bound local backups; backup rules are in [database](DATABASE.md#4-dump-and-restore-contract). |
| D-053 | Visible pending itinerary create/update is editor-editable under permissions; same proposal/revision, requester/source preserved, no reviewer authority, audience creator-only. Cross-editor edits force review. |
| D-054 | Public pending creates visible to active trip members; private ones selected audience plus proposal-only owner review. Existing-target requests retain effective/current audience checks. |
| D-055 | Pending expenses limited to requester/payer/splits/owner reviewer; excluded from posted totals until approval. |
| D-056 | Private itinerary create/update owner review is proposal-only; approving-owner history retained. Private cancel/restore/standalone expenses have stricter current visibility. |
| D-057 | Schema-derived reservation extraction, one stay/final linked total, deterministic timestamp normalization and at most one same-model timestamp-only repair. Secret redaction; no money/privacy repair. |
| D-058 | Unfulfilled create may resume from exact-user, 24-hour root-bound draft references: at most 8 sources/30,000 characters; no historical mutation replay, pure-lookup consumption or expiry extension on failure. |
| D-059 | Natural payer/clarification replies and disclosed reviewable defaults allowed; ambiguous identities/private audiences/exact math/current authorization still enforced. |
| D-060 | Calendar occupancy/conflicts deterministic: exclude lodging/background availability and strong duplicate identity, retain unknown busy overlaps. |
| D-061 | Passive Calendar refresh silent; explicit writes/refresh retain loading/error/result feedback. |
| D-062 | Neutral localized disruption bodies are immutable observation-bound display data; evidence/freshness/notification identity unchanged. |
| D-063 | One in-flight request per bound user across trips, others concurrent; persisted keyed results survive phone suspension without provider replay. |
| D-064 | Self-only browsable trip conversations/explicit continuation; identity revocation permanent, new chats archive rather than erase. |
| D-065 | Device content/episode notification dedupe, not source-refresh fingerprint; quiet baseline and fail-quiet storage/lock errors. No closed-app push. |
| D-066 | Private bounded image extraction before planning, exact-identity access, no raw-image search; one app quota unit, image-derived changes owner-reviewed. |
| D-067 | Settings Activity with current-target permission checks retained. Preference-only conversation/schema portion **retired by 0049**, old chats read-only. |
| D-068 | Private feedback + optional 10-minute diagnostics; new reports always review-eligible, historical opt-outs honored. Separate sanitized issue-only reviewer/publisher, no coding agent. |
| D-069 | Reserved by historical hosting work; no decision recorded. |
| D-070 | **Google default superseded by October 7 MapLibre decision.** Explicit load/audience/unknown-place/privacy and no-metered-fallback protections remain. |
| D-071 | Eligible-creator Auto LLM destination defaults, separate narrow funding/quotas/cache; see accepted decision above. |

## Additional shipped refinements

These accepted changes refine the register without introducing duplicate decision IDs:

- **Trip dates:** owner may change both boundaries, maximum 366 inclusive days; retain IDs and reject newly excluded canonical/actionable proposals with privacy-safe conflicts. Exact timestamp/date checks repeat during apply; finances/session age are independent. [Design](DESIGN.md#51-create-and-prepare-a-trip).
- **Sessions:** completed trips remain accessible with active binding; fresh auth alone starts the 30-day ceiling. Switching/creating/date edits never renew it. [Identity](IDENTITY_AND_SECURITY.md).
- **Calendar import:** immutable account/member/source receipts, date-only/exclusive-end fidelity, creator-only default and isolated explicit public-place lookup; signed AI suggestions remain reviewed. [Import](CALENDAR_IMPORT.md).
- **Expenses:** personal allocated costs lead, full bills-paid/net separate; exact custom shares preserve sparse edits, no automatic FX. Repayments join date groups without inflating spending; accessible hints explain private/shared/pending exclusions and non-bank verification. [Expenses](TRIP_EXPENSES.md).
- **Repayments:** real-money movement is external; immutable actual parties/amount/currency/time, revisioned status and explicit void/reassignment preserve history. No AI payment mutation. [Payments](MEMBER_PAYMENTS.md).
- **Cards:** today-only initial expansion, current-day jump without refresh scroll theft; horizontal short review buttons; personal day totals right-aligned; optional end/duration and trip-zone Now. Cancelled removal is owner-confirmed tombstone; remove duplicate bill-entry action. [Mobile cards](MOBILE_CARDS.md).
- **Public preparation:** creator ownership and role changes do not activate public signup/funding; member-removal preview/reassignment preserves private access and history. [Members](PUBLIC_TRIPS_AND_MEMBERS.md).
- **Pending edits/bills:** AI event-only same-proposal edits preserve linked finances and require review; event expense forms preserve drafts and actual eligible audiences on errors. [Pending AI edits](AI_PENDING_EVENT_EDITS.md).
- **Research:** one isolated same-model round, exact hours reuse, neutral unknown fallback, deterministic conflict warnings, truthful stage failures, bounded completion reserve and cleanup separate from primary outcome. No automatic provider upgrade/search over private context. [Research](AI_AUTOMATIC_RESEARCH.md) · [hours](AI_VENUE_HOURS.md) · [timing](ARCHITECTURE.md#ai-transport-boundary).
- **Failures/prices:** typed redacted provider failures; source-bound tariffs are estimates, not actual paid amounts; preserve original confirmed totals and image-row identity. [Failures](AI_PROVIDER_FAILURES.md) · [prices](AI_BOOKING_PRICES.md).
- **Disruptions:** official direct event/service evidence plus meaningful impact (supported minimum 30-minute delay or closure/cancellation/blockage), not generic nearby transport/weather. Versioned observations retain audit; failed checks never resolve warnings. [Qualification](DISRUPTION_CONFIDENCE.md).
- **Approval order:** pending priority occurs before SQL pagination; exact microsecond cursor, stable client partition and refreshed legacy cursor. No authority/visibility expansion.

## Questions before future implementation

Open questions for planned work (an external MCP connector, retiring the classic layout) belong with those jobs and the [roadmap](ROADMAP.md), not with obsolete global questions about regions, editor defaults or map providers already decided. Future route/reminder/communication providers require explicit cost, privacy and current terms review; existing optional infrastructure does not authorize activation.
