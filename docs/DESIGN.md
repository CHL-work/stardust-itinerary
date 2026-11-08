# Product Design

Current product behavior, not deployment instructions. Hosting is covered by [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md). Historical proposals are not implemented features.

## 1. Product summary

**Stardust Itinerary / 星塵遠征軍** is a mobile-first group trip planner: shared/private events, deterministic expense accounting, reviewable AI proposals, optional personal Google Calendar integration and day maps. PostgreSQL is canonical; Calendar, maps and AI are supporting integrations.

## 2. Goals

- Make each day's itinerary and each person's costs readable on a phone.
- Let editors collaborate without silently replacing approved plans or financial records.
- Accept conversational text and pictures through bounded, recoverable AI; keep authorization and arithmetic in application code.
- Preserve private audiences, immutable identities, revisions and recoverable backups.

## 3. Non-goals and unshipped work

The app does not transmit money, guarantee venue availability/disruption detection, track live traveler location, give an LLM database/shell access, or promise closed-phone push delivery. Discord/Telegram delivery, the full departure-reminder engine and external-agent MCP access are not delivered; planned work is tracked in the [roadmap](ROADMAP.md). Public signup and guests remain deployment-controlled.

## 4. Roles and permissions

| Role | Current authority |
| --- | --- |
| Owner | Trip settings, invitations, roles, review and member removal; at least one active Google-bound owner must remain. |
| Editor | Default member role; edit visible approved/pending events under per-member permissions. Itinerary changes require owner review by default. |
| Viewer | Read authorized content; no editor/reviewer authority. |
| Platform operator | Separate server-configured identity (`OWNER_GOOGLE_EMAIL`, one or more of the operator's Google accounts, each matched to a stored verified Google identity) governing operator-funded AI and operator-only views such as feedback review; creating or owning a trip does not grant it. |

Private canonical events belong to their creator plus selected viewers, **without an owner read bypass**. Active owners have a narrow proposal-only private itinerary create/update review exception; approval does not add them to the canonical audience. Private expenses remain constrained to involved authorized people. [Member lifecycle](PUBLIC_TRIPS_AND_MEMBERS.md) · [database enforcement](DATABASE.md).

Only owners approve/reject requests. Free/shared-funded AI changes remain reviewable; eligible requester-funded creates can apply directly under the [AI funding/review contract](AI_AND_AGENTS.md). Pending-event edits remain pending and preserve linked expenses. AI cannot edit/void existing expenses.

## 5. Core user journeys

### 5.1 Create and prepare a trip

Accounts without a trip start at Create Trip; opening the app or completing sign-in never seeds a demo. Eligible creators own the new trip. Guests may explicitly create one empty isolated trip with their original 24-hour expiry, but must sign in with Google to join real trips. Guest data never transfers into either new or existing Google accounts. Public signup is default-off; account creation is rate limited. Capacity is 1–20 including owners: active, assigned/invited and disabled members reserve seats; removed members do not. Reusable admission is atomic and permanently exhausts the link at the last seat.

Create Trip defaults time zone to **Auto**, a bounded Sol lookup of the public destination, including countries, run with the server operator's configured provider credentials. Eligible authenticated creators may use this separately funded lookup; it grants no general planning entitlement. Suggestions are strictly validated, currency stays editable and creation needs explicit form submission. Manual fallback remains. [Destination defaults](TRIP_DESTINATION_DEFAULTS.md).

Owners may change both trip dates. The inclusive ordered range is at most 366 days; new day rows are inserted and existing IDs retained. Narrowing fails if it newly excludes canonical events (including private/removed records) or actionable pending/rejected effective proposals. Conflict messages do not reveal hidden records. Exact timestamp comparisons allow an end at midnight immediately after the final day. Unchanged legacy outliers may survive unrelated edits; new/changed date facts must be in range. Expense/payment dates and authentication lifetime remain independent.

### 5.2 Return, switch trips and invite members

Fresh Google login prefers the last selected trip after active exact-membership revalidation, including completed trips. Sessions have a 24-hour rolling window inside a fixed 30-day authentication ceiling; switching/creating trips inherits that deadline. Overview also offers Previous trip and Next trip, ordered by travel date, through the same switch path. Invite admission has separate token/trip-end-grace checks. Claim links bind after login and explicit claim, never a link-preview GET. Disabled/bound assigned members do not retain usable invitations. [Identity](IDENTITY_AND_SECURITY.md).

An owner can delete a whole trip from Settings after an impact preview and typing its name. It disappears for every member, records are retained, and a user's only trip cannot be deleted ([deleting a trip](PUBLIC_TRIPS_AND_MEMBERS.md#deleting-a-trip)).

Member removal requires a current impact preview and explicit confirmation. Reassign financial responsibility rather than erase debt; unresolved inaccessible private charges block removal. Tombstones, audit and AI records retain history, dependent proposals are invalidated and active access/participation is removed. Other-trip identity is unaffected.

### 5.3 Read and edit the day

Overview shows one selected day, its hotel, events, planned next-event time and countdown; never a guessed departure time. Day chips/date selection and phone swipes navigate days; Overview has no previous/next day text buttons. Itinerary and Expenses open/jump to the actual current trip-local day; other days initially collapse. Absent today, another day is not labeled Today.

Pending events occupy ordinary timeline positions under their authorized audience. Short Edit/Approve/Reject controls stay horizontal; review buttons are owner-only. Cancelled cards say so; owner-confirmed removal is a retained tombstone, not deletion of expenses/history/remote Calendar copies. [Mobile cards](MOBILE_CARDS.md).

Small inline icons distinguish activities, meals, hotels, notes, transport and flights (including narrowly recognized legacy flights under D-102). Type icons supplement the separate privacy/lock/approval/status text and require no image download. [Event icons](MOBILE_CARDS.md#event-icons).

### 5.4 Ask AI and continue conversations

The AI tab gathers a user's AI on one page of collapsible sections: Chat, Usage with an estimated cost, Routine checks on their own key, API keys, AI instructions, and trip-specific Conversations at the bottom, which it browses and resumes ([the AI tab](AI_TAB.md)). Picture extraction, bounded memory, manual account instructions, public research and structured clarification drafts feed typed proposals. Current dates derive from the trip's IANA zone, not trip start. Phone suspension does not require resending: persisted request status/results recover without provider replay. One request per bound user may run; different users run concurrently. [AI flow](AI_AND_AGENTS.md).

Where enabled, every active member and guest may select each eligible free catalog model without a key. The composer defaults to free without an own saved key and exposes paid models only for that user's saved providers. Free requests are text-only, omit private/stored-personal and paid-chat context, disclose retention, and keep every change pending review. Named free choices never substitute another model or charge a key. Legacy automatic paid funding remains compatible (JOB-086, D-098).

### 5.5 Record expenses and repayments

One event may link multiple independent bills. Event create/edit can atomically include one new linked expense; standalone Add expense can select an existing visible event. Equal shares are default; exact nonnegative per-person minor-unit amounts must sum to the positive total. Sparse edits preserve unequal shares.

The leading summary is **my allocated costs**, including visible private/shared posted expenses. **Bills I paid** is the full recorded payer amount, including others' portions. Net reimbursement is `paid − allocated costs + repayments sent − repayments received`, separately per currency. Pending/draft/void items do not count as posted spending. Owner visible-trip totals are secondary, not a private-data bypass. Help explains these are records, not bank verification. Repayments share date groups but are not additional spending. [Expenses](TRIP_EXPENSES.md) · [repayments](MEMBER_PAYMENTS.md).

### 5.6 Compare and project Google Calendar

Calendar consent is optional after basic sign-in. A user's encrypted connection/private Calendar rows are not shared automatically. Explicit add/update/import actions give feedback; passive refresh stays silent. Stable links and account/member/source receipts prevent duplicate imports across approval. Imports default to creator-only visibility. Missing-place lookup receives only explicitly confirmed public venue text; linked rows disappear from candidates. This is not automatic two-way canonical synchronization. Deterministic conflicts exclude lodging/background availability and strong duplicates. [Import](CALENDAR_IMPORT.md) · [conflicts](CALENDAR_CONFLICTS.md).

## 6. Itinerary model and editing

An event has a trip day, type, status, title, visibility, revision and optional timing/location details. Manual start is required; end/duration are optional. Duration is an editing aid, not a separate stored fact. Every event uses its location's zone; Now captures the actual click instant in that zone. Known end must follow start in elapsed time. [Local time, corrections and fallback](EVENT_LOCAL_TIME.md). Maps links should identify the actual venue/branch.

Transport remains **one canonical event** with optional departure/destination endpoints, at least one named. Start/end mean departure/arrival; endpoint rows have their own place, zone, time and weather, with one action set. Non-transport uses `locationName`/`mapUrl`. A flight adds optional flight number, airline, terminals and gate; cards prefer gate, then terminal, then airline (D-094). UTC instants and trip-calendar grouping remain unchanged (D-103). Integration end-time fallbacks never fabricate a canonical end.

Apply rechecks revisions, authorization, current trip dates, audiences and participant eligibility. Approved records stay canonical until reviewed replacement. Approval is terminal; rejection remains reapprovable after fresh checks. [Pending AI edits](AI_PENDING_EVENT_EDITS.md).

## 7. Maps, weather and disruptions

- **Map:** MapLibre/OpenStreetMap raster that loads when opened, numbered stops and arrowed connections; compact mode icons/times and Directions links. Public geocoding/routing is bounded, cached and best-effort, not guaranteed live timing. Private places are included unless the viewer turns them off, and their lookups are never cached (D-081); unknown stays unknown. No silent paid Google or LLM fallback. [Contract](DAILY_MAP.md).
- **Weather:** deterministic Open-Meteo next-seven-day forecasts, 30-minute freshness; icons/probability above each matching endpoint time, with attribution. Approximate trip-area fallback is labeled; private exact locations are not sent.
- **Disruptions:** backend Sol/medium, not page-open calls: current local-day events every 30 minutes by default; other eligible future events once per rolling day. Official/direct/material evidence is required. Device receipts suppress unchanged phone warnings; closed-app delivery is not implemented. [Confidence](DISRUPTION_CONFIDENCE.md) · [communications](COMMUNICATIONS.md).

## 8. Settings, feedback and localization

Settings holds sign-out, trip/member controls, manual personal AI instructions and initially collapsed advanced permissions/usage/activity. Migration 0049 removed structured preference profiles/catalogs and automatic extraction; old preference conversations remain read-only. Instructions are private account text, not model-editable policy. [Instructions](AI_CUSTOM_INSTRUCTIONS.md).

Activity, Approvals history and AI usage history are owner-only. Feedback is a document-top-right control that scrolls away. Reports may attach an optional allowlisted **ten-minute** action trail; new reports always permit sanitized issue review, historical opt-outs remain respected. A separate reviewer/publisher creates issues only, never fixes. Actual credentials/scheduling determine delivery availability. [Feedback](FEEDBACK.md) · [Activity](ACTIVITY.md).

One language control selects English, clear Hong Kong Cantonese, 廣東話(辛辣), Japanese, or one of the eight added languages: Simplified and Traditional Chinese, Spanish, Brazilian Portuguese, French, German, Russian and Indonesian. English is the initial default. Explicit choices are remembered by the browser and account; Google sign-in restores that account's choice instead of importing another account's or guest's choice. Safety/auth/money/approvals/errors/destructive actions stay neutral. There is one layout; the classic layout and its toggle were retired (D-093).

## 9. Availability and lifecycle

Bounded read-only offline storage includes public confirmed itinerary display only, never private events, finances, proposals or AI. Browser retention is best-effort; sign-out clears it.

Deployment, backup and restore procedures are in [deployment](DEPLOYMENT.md), [self-hosting](SELF_HOSTING.md) and [database](DATABASE.md).

