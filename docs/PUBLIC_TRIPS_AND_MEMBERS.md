# Public-ready trips, member removal and approvals

Create Trip offers [Auto destination defaults](TRIP_DESTINATION_DEFAULTS.md). With the default `STARDUST_DESTINATION_LOOKUP=creators`, every authenticated eligible creator may use the bounded destination-only Sol lookup, including members of unsponsored trips; public signup remains gated. This operator-funded exception does not fund normal planning or make trip ownership platform authority. Lookup never consumes onboarding identity or creates a trip; explicit creation still validates current identity, zone/currency, quotas and session lifetime. Existing owner-only settings and trip currency boundaries remain.

Every active signed-in member, including viewers, has a self-only **Settings → Your AI instructions** editor. The account-global text starts empty, is saved/cleared explicitly with revision conflict protection, and applies to the next admitted planning request even in an existing trip chat. It cannot change trip roles, funding, quotas, tool permissions or owner-approval requirements. There is no automatic preference collection, catalog import or model-written profile. Ordinary chat history remains; old preference-only conversations are permanently read-only. Trip owners cannot read another account's instruction field, but logged prompts/replies may reflect it under the existing owner audit policy. See [personal instructions](AI_CUSTOM_INSTRUCTIONS.md).

Private feedback also survives member removal as retained diagnostic history, without reassigning report ownership or exposing it to a rebound member slot. Feedback uses immutable app-user binding and fresh scope proof; self reads require current active membership, and cross-user report review is platform-operator-only rather than any trip owner. Financial removal choices and proposal invalidation are unchanged. See [feedback privacy](FEEDBACK.md).

Immutable Calendar import receipts are retained across membership removal and approval history. Access still requires the exact current active trip/member/immutable app user, and reconnects are scoped to verified Google account identity. Private imports follow normal proposal-only owner review and canonical audience rules; retained history cannot revive removed membership or make a linked source addable again. See [Calendar imports](CALENDAR_IMPORT.md).

Owners have a distinct cancelled-event removal action. It does not delete members, linked financial history or private audiences. Later member cleanup still removes viewer participation and appends a revision retaining event removal metadata; creator/remover identities remain tombstones. See [event removal](MOBILE_CARDS.md).

Self-service account/trip creation is implemented, but public signup remains a separate server gate, `PUBLIC_SIGNUP_ENABLED` (default `false`). While it is off, a Google account that can sign in still cannot reach a trip without an invitation or membership (D-074 in [decisions](DECISIONS.md)).

## Accounts and trip ownership

Create Trip uses time-zone and currency dropdowns, not free text. Options are generated on the server for all four locales and passed unchanged to the browser; values are canonical identifiers, independent of display language. Dallas uses `America/Chicago` (DST-aware US Central), not `Dallas`; US dollars use `USD`, not `USA`. UTC is included explicitly. Currency choices use a pinned recognized-code catalog matching current ledger precision (JPY/KRW whole units, other supported currencies two decimal places); runtime ICU upgrades cannot silently expand this financial boundary. Unsupported precision such as KWD is not offered. Existing trip/expense values are not rewritten.

The form retains entered values on failure, identifies invalid fields and separately explains sign-in expiry, unavailable access, the existing UTC-day cap and uncertain network/server outcomes. An uncertain save must be checked in the trip list before manual retry; it is never automatically replayed. Date constraints use the selected destination time zone, not Tokyo for every trip. Repeated clicks during one submission cannot create simultaneous client requests. Server validation, same-origin checks, atomic creation and all membership/session/funding limits remain authoritative.

Every active Google-bound member, including an editor or viewer, can choose **Create trip**. Creation atomically creates the trip, its complete date range, an active owner membership, defaults and audit records, selects that trip and issues its session. Do not switch to the same trip again after the creation API response.

Returning access is independent of the travel window. An active bound membership remains eligible for ordinary sign-in and explicit switching after the trip ends; disabled/removed/unbound identities remain blocked. The last selected completed trip stays preferred when that exact membership is still valid. New Google authentication supplies a fixed 30-day ceiling and authenticated activity rolls the idle window forward at most 24 hours within it. Existing-session creation and switching inherit the exact persisted source-session ceiling under lock; they are not fresh authentication and cannot revive expired sessions. Travel-date/time-zone changes never modify session deadlines. Existing legacy ceilings are not bulk extended.

For a Google account without an eligible trip, `PUBLIC_SIGNUP_ENABLED=true` permits ordinary no-invitation sign-in to obtain a short-lived app-account grant and open `/trips/new`. The default is `false`; leave it off until a public-launch review. The opaque grant lasts 15 minutes, is consumed once by explicit creation, and cannot authorize trip APIs. Merely visiting a page or finishing OAuth never creates a trip. An invalid, expired or revoked invitation is not silently converted into public signup. Google OAuth eligibility remains an independent requirement.

The first trip session created from that grant is capped at the persisted grant's original `created_at` plus 30 days, not 30 days from the later creation request. Claim/join admission retains its independent trip-end-plus-`AUTH_TRIP_GRACE_DAYS` window and token checks; supporting returning members does not resurrect old invitations or admit new members outside that window.

Creation allows at most 10 new trips per account per UTC day, serialized in PostgreSQL. A trip spans at most 366 dates and has at most 20 seats including every owner. Named invited and disabled members still reserve seats. Removing a member does not reactivate an exhausted reusable invitation.

An active owner can edit both start and end dates in ordinary **Settings → Trip settings**, with real ordered dates, the same 366-inclusive-date ceiling and confirmation of the old/new range. The form sends its original dates for a locked stale-edit check. Either boundary can expand; narrowing is refused if it newly excludes a canonical event day/time (including private, cancelled or removed records) or an actionable pending/rejected itinerary proposal. The message does not disclose private content. Historical day IDs and labels remain stored; only current-range days can be selected for new plans. No event, proposal, expense or repayment is automatically rescheduled, deleted or financially changed.

Date changes do not change membership or any session expiry. New invitation admission continues to evaluate the current end date plus grace, so a date change can close or reopen that window for an otherwise valid link; it never revives consumed, expired, revoked or exhausted tokens. The date-setting feature adds no migration or new role/provider authority. See [full range and history safeguards](DESIGN.md#51-create-and-prepare-a-trip).

In **Settings → Members**, an owner can assign **owner**, **editor** or **viewer**. A new co-owner must already be active and Google-bound. At least one active Google-bound owner must remain after demotion, disabling or removal. The historical primary `trips.owner_user_id` is reassigned to a remaining bound owner when necessary; authorization uses active trip roles, not that primary pointer. Role changes require the displayed member revision and are audited. Demotion resets stored permissions; a viewer cannot inherit old editor capabilities. Any member can still rename their own membership.

## AI funding is not a trip role

An arbitrary trip creator or promoted co-owner does not receive the platform operator's provider funding or model privileges. `trip_ai_settings.host_subscription_enabled` marks a trip as operator-funded; migration 0036 enabled it for every trip that existed before the migration, and new trips default to unsponsored. Only new trips created by the configured platform operator receive that entitlement. The setting is server-side and cannot be changed through member/AI-settings APIs.

The operator is verified through the stored Google identity and configured `OWNER_GOOGLE_EMAIL`, never a client email or an `owner` role alone. In an entitled trip, the operator must also be a trip owner to choose premium models and bypass the application prompt quota. Other users, including co-owners, receive server-forced Sol and the trip's configured per-member daily limit (default 20 prompts per UTC day). Unsponsored trips can never use the operator's keys, for the planner or for the operator-funded disruption worker, even if a client requests an enabled state or premium model; members there use their own keys (below). Trip owners can still manage ordinary trip roles and daily-limit settings.

`trip_ai_settings.enabled` records only whether a trip's owners allow AI ([D-075](DECISIONS.md#d-075-users-can-bring-their-own-ai-provider-keys-accepted-november-4-2026)). Every new trip starts with AI on, and owners of an unsponsored trip may turn it off and on again. Migration 0054 turned it on for existing unsponsored trips, unless an owner had turned it off.

### Your own API keys

Any member can add their own OpenAI, Anthropic or Gemini API key in **Settings → AI keys** (JOB-061). The key is checked with the provider before it is saved, stored encrypted, and never shown again; only its last four characters are. A request uses the requester's own key when they explicitly choose a model of a provider they hold a key for, or when the trip is not operator-sponsored and they hold any key. In that case the trip's daily prompt limit does not apply, because the requester's own provider account pays. With no explicit choice, a sponsored trip keeps its free sponsorship, so adding a key never silently starts charging a member. An owner who turns AI off for a trip turns it off for own-key requests too. A member without a key in an unsponsored trip is asked to add one (`ai_key_required`). Trip owners never see or use other members' keys; sharing an owner's key with invited members is JOB-063.

In the app:
- The overview tells the browser only which providers the viewer holds a key for.
- The AI composer opens as soon as a key is saved.
- A member with keys gets a model picker listing their providers' models. The choice applies to one request at a time and never changes the trip's settings.
- In a sponsored trip, the picker's first option stays the free trip AI. In an unsponsored trip, it is the model the server would pick.

## Deleting a trip

Decision: [D-073](DECISIONS.md#d-073-deleting-a-trip-removes-it-for-members-and-keeps-its-records-accepted-november-4-2026). Any active owner can open **Settings → Delete this trip**. `GET /api/trips/{tripId}/deletion` returns an owner-only, private/no-store preview with totals only: other members, events, expenses, posted repayments and pending requests. It never names other members' private records.

`DELETE /api/trips/{tripId}/deletion` takes `{confirmationName}`. The name must match, forgiving only surrounding spaces and Unicode composition. One transaction then:

- marks the trip deleted and moves memberships to terminal `trip_deleted`;
- revokes every session, claim link and join link;
- deletes stored Calendar credentials, links and weather leases;
- fails in-flight AI requests and disables disruption checks;
- clears last-selected preferences for the trip;
- appends one `deleted` audit event;
- issues the owner a session on their next trip, inheriting the same authentication ceiling.

**Retained:** events, expenses, repayments, approvals, audit, AI history and pictures, feedback, Calendar receipts and creation-quota rows. The daily creation cap is not refunded. **Not removed:** copies in members' Google Calendars, already-published sanitized feedback issues, backups, prompts already sent to a provider and offline snapshots saved on other members' devices, which stay until a later successful load replaces them or the member signs out.

**Blocked:** a user's only trip, because with public signup off they could not create another without an invitation. The dialog offers **Create a new trip** instead. Other members with no remaining trip see the existing sign-in message asking for an invitation.

There is no in-app undo. The operator procedure is in [restoring a deleted trip](DATABASE.md#restoring-a-deleted-trip).

## Removing a member safely

The exact preview/digest includes posted repayment accounting links and unapproved payment counts. Every affected posted accounting leg requires an explicit active same-trip replacement; actual sender/recipient and payment facts stay immutable and earlier revisions remain. Equal replacement legs are neutral bookkeeping, not a deleted/refunded transfer. Pending/rejected payments involving a departing participant or recorder become permanently void. New payment history is explicitly visible to its participants/assignees/recorder and owners; this never unlocks underlying private expenses. See [repayment removal](MEMBER_PAYMENTS.md#safe-member-removal).

The owner first opens **Remove**. `GET /api/trips/{tripId}/members/{memberId}` returns an owner-only, private/no-store impact preview: membership revision, a digest of current links, event/viewer/proposal/chat counts and authorized financial details. Private expenses the owner cannot view are reported only as a count.

Removal requires explicit confirmation of this exact preview. For an active expense, the owner must explicitly choose an eligible replacement payer if the member paid, and a recipient for that member's share if they participated. These choices transfer recorded reimbursement claims/obligations; they are **not** evidence of a real payment or settlement. There is no default selection, automatic equal split, debt erasure, currency conversion or change to the expense total. All other participants keep their exact minor-unit shares. A private expense without an authorized resolution path must be resolved by an involved person before removal; deletion cannot reveal it or expand its audience.

`DELETE /api/trips/{tripId}/members/{memberId}` accepts `confirmation:true`, `expectedRevision`, `previewDigest`, and optional explicit `expenseReassignments`. Stale previews, missing choices, invalid recipients and last-owner removal fail with no partial changes. Valid financial changes, revisions, audience-link cleanup, access revocation and audits commit together. Never exercise this operation on real travelers merely to test it.

The removed membership remains a non-login historical tombstone. It disappears from the active roster and event viewers; active expenses no longer assign its payer/share roles. Original event creators, immutable revisions/audits, approved history, void-expense historical attribution, AI requests/chats/pictures and the global account are retained. Private events are not reassigned to an owner or made public; a removed creator's private event with no remaining viewers remains inaccessible history. Other trips and the account's manually saved AI instructions are not deleted. Instructions belong to the immutable app user, not the mutable member slot; a replacement identity inherits none.

Trip sessions, assigned invites and stored Calendar credentials/links are revoked/removed; active AI work is interrupted and its conversations are identity-revoked. The preview also counts still-active reusable invitations issued by that member; confirming removal revokes those exact links, and a remaining owner can issue a replacement. Links issued by other owners are unaffected. An in-flight AI or Calendar completion rechecks current membership before storing results. Existing copies in Google Calendar are not remotely deleted. A removed identity cannot use an old reusable invitation to bypass removal.

Pending/rejected proposals that depend on the removed member receive a permanent `member_removed` invalidation marker. Their original patch/status/attribution remains in authorized approval history, but they disappear from actionable pending timelines/counts and cannot be edited, approved or rejected. Create a fresh proposal with current members if the change is still wanted.

Structured dependency checks include custom `splitAmounts[].memberId` references, even when a sparse expense update omits unchanged participant IDs or targets retained void history. A UUID mentioned only in prose is not a financial dependency. This invalidation does not rewrite the original bill, shares or proposal payload.

## Readable approvals

Pending work appears first. Non-invalidated pending event/expense requests precede reviewed and invalidated history across all 25-row pages; each group keeps newest-first creation time and UUID tie-breaking. Pending repayment review also appears before request history, with other repayment review records below. Review/reset starts at the top and Load more preserves grouping. This remains a live view: refresh after another reviewer's changes; an old pre-update cursor requires refresh.

**Approvals** displays event cards with dates/times, transport endpoints, places, privacy, notes and optional linked expense, or expense cards with total, payer and exact shares. It renders the submitted patch combined with its immutable base revision, not today's canonical private target. Removed-member labels resolve through scoped historical memberships. Unsafe or incomplete legacy snapshots show an explicit unavailable notice, never a JSON fallback or blind approval.

Pending requests can be approved/rejected; rejected requests can be approved later after revalidation. Approved/superseded history has no destructive review actions. Invalidated requests have no actions. Existing privacy filtering, stable pagination, selected-language text, private/no-store delivery and owner-only review remain in force.

AI can edit an authorized pending event in place without creating another request. An AI-edited draft requires explicit owner review even if it originally came from the owner's manual editor. All browser review actions submit the displayed `proposalRevision`; stale cards fail without approving an unseen edit. The UI refreshes and asks for a new decision. These changes preserve removal invalidation, private audiences and owner-only review; see [AI pending edits](AI_PENDING_EVENT_EDITS.md).

## Verification and operational limits

Synthetic unit and disposable-PostgreSQL tests cover public onboarding, single-use/replay/rate limits, co-owner/last-owner protection, stale sessions/revisions, removal FK/audit/chat retention, exact financial reassignment and private audience restrictions. The full repository gate is `pnpm check` against a guarded disposable test database, never the traveler database.

Migrations 0036 (onboarding and AI entitlement) and 0037 (member-removal invalidation) carry these guards. Keep the removal/entitlement guards when rolling code back: older code does not enforce public-trip funding or removal invalidation and is not a safe public runtime. Do not drop migrations to recover code. Backup, restore and migration rules are in [database](DATABASE.md); deploy and recover with [deployment](DEPLOYMENT.md) or [self-hosting](SELF_HOSTING.md).

Google OAuth verification, public billing, abuse/storage budgets, retention/deletion policy and a public-launch security review remain separate work.
