# Identity, invitations, sessions and security

This is the current application contract. Deployment, credentials and recovery are covered by [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).

## 0. Implemented boundary

- Google OIDC Authorization Code flow uses discovery, PKCE, state and nonce through pinned `openid-client`. Stable issuer/subject, not email, identifies an account.
- Sign-in and Calendar consent are separate. Unconnected members can use Stardust; Calendar access is requested only by an explicit link/sync/import action.
- Every request checks current authentication, exact trip membership, immutable bound user and resource audience server-side. UI hiding is not authorization.
- Claim/session credentials have 256 random bits; storage uses purpose-separated HMAC-SHA-256 keyed by `AUTH_SECRET`. OAuth/Calendar tokens use authenticated encryption, never raw browser-visible credentials.
- State-changing browser routes require the canonical `APP_BASE_URL` or an explicit allowed origin. Default development origins are loopback port 3100, not arbitrary LAN hosts. Cookies must match the configured HTTPS origin.
- `OWNER_GOOGLE_EMAIL` identifies the platform operator through stored verified Google identity and restricts first-owner bootstrap when configured. Owning a trip does not confer operator-funded AI or feedback-inspection authority.
- The model never receives database-write authority. Application code validates, locks, checks revisions/audiences and audits changes. Private/public research boundaries remain separate from user-facing customization.

## 1. Google sign-in

Store issuer and stable subject as identity; email/display name are mutable profile attributes. A trip owner may see verified member email hints for administration; non-owner Overview responses omit `googleEmail` entirely.

Ordinary sign-in selects the user's last explicitly selected trip if its exact bound membership remains active, including completed trips. Otherwise it ranks active memberships by in-progress, nearest upcoming, then most recently ended trip. Date ordering never excludes a completed active membership. The selected trip is recorded so revoked/missing preferences heal without granting access. Disabled, removed, unbound and foreign memberships remain ineligible.

Public signup remains separately gated. [Self-service creation](PUBLIC_TRIPS_AND_MEMBERS.md) accepts an existing active bound member or a valid one-use onboarding identity; destination lookup does not consume the onboarding grant. [Auto defaults](TRIP_DESTINATION_DEFAULTS.md) recheck account eligibility before admission and after provider work, bind replay IDs to payloads, and never turn model output into creation authority.

## 2. Member identity and claim link

An owner creates an invited member with name/role but no Google binding. **Invite** issues a one-time link, copies it and shows confirmation. Disabled or already-bound members have no Invite action. Raw tokens are shown once and only keyed hashes are stored.

1. The token arrives in a URL fragment, not an HTTP query. A same-origin POST validates it and sets a 15-minute HttpOnly intent cookie.
2. The claim page identifies the trip/member and warns about forwarding mistakes. GET/link previews never consume a claim.
3. Google sign-in completes; one locked transaction rechecks token, trip, identity and binding, consumes the claim, revokes siblings, activates membership, audits and issues a session.

New claim/join admission checks token validity and trip end plus `AUTH_TRIP_GRACE_DAYS`. Returning active members do not need a new invite after a trip ends. Expired/revoked invitations are not revived by returning-member access.

### Reusable open trip invitation

An owner can rotate/disable one reusable `/join#token=...` link. It has a separate intent cookie and never consumes an assigned member claim. After Google sign-in, the transaction locks the trip, rechecks link/current identity, rejects disabled/removed identities and atomically checks capacity before creating an active editor. Re-login later uses the stable binding, not the invite.

Capacity is 1–20 total memberships: active, invited and disabled count; removed do not. The final admitted seat exhausts the link; freeing a seat does not automatically reopen it. Existing active members use no extra seat. Open joining never guesses an assigned invited row by display name/email. Account/provider restrictions still apply; basic app sign-in and later Calendar consent must not be conflated with each other or with the app's public-signup gate.

## 3. Reissue and recovery

Active owners manage members, roles, sessions and links through the existing trip-scoped APIs. A member's self-service PATCH is limited to their own display name; role changes require `expectedRevision` and owner authority. Member removal requires a fresh authorized preview, explicit confirmation and any necessary financial reassignment. See [the full removal contract](PUBLIC_TRIPS_AND_MEMBERS.md#removing-a-member-safely).

- Disabling confirms intent, revokes sessions and unused assigned invitations, but retains a bound Google identity. Re-enabling a bound member restores ordinary sign-in; an unbound member returns to invited and needs a new link.
- Removal preserves a tombstone and immutable history, preventing an open link from bypassing removal. It revokes exact-trip access, sessions, invites, Calendar and active AI work; dependent pending/rejected proposals are permanently invalidated.
- Financial cleanup requires explicit exact reassignment; inaccessible private finances need an involved person's resolution. Removal never moves real money or assigns a private creator to the owner. Last-active-bound-owner safeguards remain enforced.
- Identity unbinding/recovery clears that membership's encrypted Calendar connection/links and invalidates its AI context. A replacement identity inherits neither authorization nor recall. Account-owned AI instructions remain with the original immutable app user.

First-owner bootstrap/lost-owner recovery is a separately authorized operator action, not a fix for ordinary completed-trip login. It uses a temporary 32+ character `OWNER_BOOTSTRAP_SECRET`, restricts the intended owner when known, revokes old sessions/binding and audits recovery; remove that secret afterward. Never put it in URLs/chat/browser forms. The historical `bootstrap:local-owner` helper targets a synthetic fixture and is not a production recovery recipe.

## 4. Bounded sessions independent of travel dates

- Fresh successful Google authentication establishes a fixed 30-day absolute ceiling.
- Authenticated activity/rotation refreshes a 24-hour rolling window, capped by that stored ceiling. Rotation never moves the absolute deadline; previous-token replay revokes access.
- Switching/creating trips rechecks the valid source row under lock and inherits its remaining ceiling. First creation via onboarding uses that grant's original authentication time. Browser-supplied deadlines are never authority.
- Trip date/time-zone changes cannot shorten, extend or revive sessions. Legacy valid sessions keep their stored ceiling; idle/absolute-expired, revoked or replayed credentials require fresh sign-in.
- **Settings → Identity & devices → Sign out** revokes the current session, not Google binding or remembered trip. **Switch trip** includes all active bound memberships, including past trips. Overview's Previous trip and Next trip buttons use the same path over the same memberships. Switch creates a replacement scoped session, revokes the source and audits both trips.
- Disabled/removed identities remain excluded after fresh Google authentication. Do not extend travel dates, recreate members or bootstrap owners merely to repair login.

Cookies are Secure/HttpOnly/SameSite under HTTPS. Device-session revocation remains server-side and independent of trip content.

## 5. Authorization

Normal members are editors with itinerary editing and owner review required by default. Owners can configure per-member itinerary/expense/Calendar permissions and review policy. A locked event remains visible to its normal audience but only an active owner may edit, cancel, restore or unlock it. Viewers remain read-only. Exact current roles are rechecked under mutation locks.

### Private audiences and proposals

- Canonical private events are visible only to their creator and selected viewers; ownership alone grants no bypass. Linked expense payer/splits must stay within that audience.
- All active members can read trip-visible pending itinerary creates. Private pending creates restrict normal reads to requester/selected viewers. Active owners have separate proposal-only review access under migration 0031, without joining the canonical private audience.
- Existing-target requests intersect immutable submit-time audience with current canonical visibility. Expense targets must remain visible. Malformed/stale/cross-trip IDs fail closed; internal audience snapshots never enter client patches.
- An active editor may edit a pending create/update they can currently see; only the original creator changes privacy/audience. Only owners approve/reject. A different editor's edit forces review even if requester direct-apply was otherwise allowed.
- Pending/rejected expense creates are visible only to active requester, payer, split participants and owner reviewer. They do not affect spending/balances before approval. Private cancel/restore and standalone expense review still require an owner-visible relevant target.
- Apply/reapproval locks and rechecks current audience, members, revision and proposed viewers/payer/splits. Removed/revoked proposed participants fail before canonical writes. Rejection remains possible when only an unapplied proposed participant became stale.
- Every AI-created event/expense stays pending, including owner requests; AI-edited pending events also stay pending. AI expense update/void is not implemented in this branch. Existing validated owner canonical itinerary updates/cancel/restore use the current application validation/revision/audit path, not model database access.

The owner-only `GET /api/trips/{tripId}/change-requests` returns 25-row private/no-store pages using a v2 opaque cursor bound to trip, pending priority, exact UTC creation timestamp and UUID. Old/malformed/cross-trip cursors fail closed. Overview contains an actionable-pending count for owners, not raw approval history. Non-owners cannot read Activity, the AI usage audit or other users' prompts through owner endpoints. See [pending edits](AI_PENDING_EVENT_EDITS.md), [expenses](TRIP_EXPENSES.md) and [Activity](ACTIVITY.md).

### Google OAuth and Calendar setup

Both callbacks are built from `APP_BASE_URL` and must be registered on the Google web client exactly: `/api/auth/google/callback` and `/api/integrations/google-calendar/callback`. A deployment uses its HTTPS hostname; localhost port 3100 is for isolated development only.

Calendar consent requires the Calendar API and requested scopes. Signing in alone grants no trip access: an account without an invitation or membership reaches no trip, and can create one only when `PUBLIC_SIGNUP_ENABLED` is on (default off; see D-074 in [decisions](DECISIONS.md)). `calendar.events` is a sensitive scope, so until Google verifies the OAuth app it shows an unverified-app warning before Calendar consent and allows at most 100 users to grant it over the project's lifetime. The app explains the warning before redirecting. Calendar tokens issued while an OAuth app is in Testing can expire; reconnecting replaces them. Basic identity sign-in and Calendar grants are separate, and the two Google accounts may differ. Recheck current Google requirements before changing the OAuth app's publishing status or scopes.

Calendar connection status requires a persisted refresh token, and rejected credentials/permissions are cleared and audited. An explicit action stores a validated tab-scoped continuation through consent; cancellation writes nothing. Imported sources bind verified Google account and connection generation; legacy unverified imports require reconnect, not guessed identity. See [Calendar imports](CALENDAR_IMPORT.md).

Sync uses deterministic provider IDs/private linkage plus an item advisory lock. Deleted/cancelled/404 remote events get a deterministic successor, preventing duplicate recovery. View-event feedback reconciles state before navigating through a localized interstitial, reset on `pageshow`. Conflict detection never sends personal Calendar text to an LLM; private-property resolution must match trip and current audience. See [conflicts](CALENDAR_CONFLICTS.md).

## 6. Audit and privacy

All itinerary/financial mutations are revisioned/audited. Never log bearer tokens, cookies, OAuth secrets, API keys or payment credentials. Full AI prompts/results remain in the restricted request store under owner-audit policy; users' private history/recovery/image APIs have no cross-user owner bypass. Generic lifecycle/search/audit records contain bounded metadata, not duplicated prompt/patch contents.

[Personal instructions](AI_CUSTOM_INSTRUCTIONS.md) are self-only, manually saved and revision-checked. Only current text/revision is stored; audit contains count/revision/cleared state, not text snapshots. Model output cannot modify instructions. Each admitted request reuses one snapshot through repair/research finalization; replies may reflect it and therefore be visible in the existing owner audit. Legacy preference chats remain read-only; old backups/Git/chats may retain historical facts.

### Browser storage

| Data | Boundary |
| --- | --- |
| API responses, AI text/images, instructions, feedback drafts/trails | No offline/persistent browser cache; identity changes clear in-memory drafts. Service worker never caches `/api/`. |
| Offline itinerary v2 | One validated trip-visible display snapshot, up to 500 items; no private events, notes, finances, pending/approvals, AI, Calendar, emails or activity. Fallback only on network/5xx, never 401/403. Sign-out clears v1/v2 and private shells. |
| `stardust.ui-mode.v1` | Only `new`/`classic`; device-level display choice survives sign-out and changes no authorization. |
| Disruption receipt ledger | Bounded hashes/timestamps only, survives sign-out for deduplication, grants no read access. |

Deleting a trip clears the snapshot on the deleting owner's device. Other members' devices keep theirs until a later successful load replaces it or they sign out, the same limit that applies to removed members.

Offline storage is neither encrypted backup nor fresh authentication. It identifies whose snapshot is displayed, can be evicted, cannot remotely purge an already-offline device and does not protect an unlocked/lost device. Device lock and avoiding shared-device caches remain important. [Layouts](UI_LAYOUTS.md) and [notifications](COMMUNICATIONS.md) document bootstrap/storage behavior.

### Provider and worker isolation

- Planner booking-secret redaction applies to prompt/history/checkpoint/instruction inputs and generated fields/sources. Original restricted audit may retain input; arbitrary unlabelled secrets cannot be perfectly detected.
- Nonempty saved instructions disable direct full-context search. Isolated [public research](AI_AUTOMATIC_RESEARCH.md) receives only validated public subjects, never raw chats, images, member IDs, notes, ledger values or instructions. Explicit no-search remains authoritative. Private/sensitive context permits only an undated validated currency pair, never amount/payment date.
- Hours/price sources are untrusted evidence, not access, payment or booking authority. Exact source filters and observed-tool requirements remain in [venue hours](AI_VENUE_HOURS.md) and [booking prices](AI_BOOKING_PRICES.md).
- [Clarification drafts](AI_AND_AGENTS.md) bind exact user/member/trip/conversation, root version and 24-hour expiry; at most eight submissions/30,000 characters may complete an unfulfilled create. Natural follow-ups can continue a selected draft, not replay fulfilled/expired/history-only actions. Pure lookup/unrelated questions do not consume it; transactional finalization rechecks all current authority.
- [Recovery/history](AI_REQUEST_RECOVERY.md) is exact-user scoped. One user has one in-flight planning/Calendar lookup across trips; different users remain independent. Locks do not span model calls. Completion is fenced against reset, identity change, expiry and stale revisions; delivery recovery never restarts a provider or charges again.
- [Map](DAILY_MAP.md) requests derive locations server-side from current audience; private stops require saved exact coordinates and never go to public geocoding/routing. Responses are private/no-store. Only verified platform operators bypass map rolling quotas; pacing/concurrency/privacy still apply.
- Private-event weather sends the trip destination rather than the exact private location and labels approximation. Expiring member-scoped leases avoid duplicate work without blocking another member's private candidates.
- Disruption workers use only planned trip-visible events, ephemeral aliases and bounded public fields; no private/pending/cancelled/completed event, member/booking/financial data or personal instruction context. Evidence persistence belongs to deterministic application transactions.
- [Feedback](FEEDBACK.md) uses HMAC-bound report scope and separate operator-only access. The tool-free reviewer never receives GitHub credentials; the issue-only publisher is not a trip-chat capability or coding agent.

- Users' own provider API keys (JOB-061) are encrypted with AES-256-GCM under `CREDENTIAL_ENCRYPTION_KEY`, with the user and provider bound as authenticated data, so a ciphertext copied to another row or account does not open. APIs return only the provider, the last four characters and timestamps; audit events record only the provider. A request's key travels in a per-request credential context: provider subprocesses see only that key, never the operator's, and keep their state in a private temporary directory removed after the request. Directories left behind are swept after an hour.
  - **Encryption key:** exactly 32 bytes of standard base64, never equal to `AUTH_SECRET`, and given only to the web server: a separate secret on GKE, and blanked for the other Compose services. A stored key that no longer decrypts is treated as absent and logged without any user, key or ciphertext.
  - **Rotation:** not supported yet. `key_version` reserves room for a keyring; changing the key today means users add their keys again (JOB-065).
  - **Abuse limits:** checking a key calls the provider from the server, so it is limited to 10 checks an hour per account and 30 per browser address. Key checks and Gemini calls never follow redirects, which would carry the key header elsewhere. Requests on users' own keys are limited to 100 per account per UTC day, a bound on server work rather than spend, and do not use up a sponsored trip's free prompts.
- **Shared keys (JOB-063):** an owner's key shared with a member is decrypted only server-side, for that member's request, in the same per-request context.
  - The member's browser learns only the sponsor's display name and the model.
  - Grants are owner-managed, audited and checked on every request against the sponsor's current ownership and keys.
- **Guest accounts (JOB-064):**
  - A guest's identity uses the issuer `urn:stardust:guest`, which no Google sign-in can match, and its session ends when the account does, 24 hours after creation.
  - Creation is off unless `GUEST_MODE_ENABLED=true`, and is same-origin.
  - **Turnstile:** required. Without a secret, creation is refused unless `GUEST_ALLOW_WITHOUT_TURNSTILE=true`. The check fails closed, must report this hostname and the `guest` action, and never follows redirects.
  - **Limits:** three new guests an hour and three active guests per address, keyed on Cloudflare's `CF-Connecting-IP` (only a keyed hash is stored), plus a total cap.
  - **Allowances:** guests get 5 key checks a day, 20 own-key AI requests a day and small map and weather allowances, and cannot attach pictures.
  - Guests are isolated from real trips by database triggers.
  - **The purge function:** `app_purge_expired_guest` runs with its caller's rights.
    - Only the purge job calls it: it connects as the database administrator, with its own service account and no other secret.
    - It is not executable by `PUBLIC` or the runtime role.
    - It reads only schema-qualified catalogs, with temporary schemas searched last, and touches only tables in `public`.
    - It deletes only accounts whose sole identity is the guest issuer, and verifies afterwards that no row or foreign key still references them.
  - **Guest status:** fixed for life by triggers, so no real trip can become something the purge would erase.
- Every in-app Codex call (planning, research, venue hours, image extraction, place lookups and disruption checks) runs with the same locked-down configuration: no shell, exec, apps, agents, hooks, memories, image viewer, shell snapshot, MCP or history. A turn that used anything beyond reasoning, its answer and (where allowed) web search is refused. The read-only sandbox alone would still let a shell read local files, and with users' keys in sibling provider processes, any file-reading tool could reach them.

Provider, OAuth and database secrets belong in the deployment's secret store or server environment ([deployment](DEPLOYMENT.md), [self-hosting](SELF_HOSTING.md)), never in Git, logs, URLs or the browser. Give each process only the credentials it needs. Backups are covered in [database](DATABASE.md).

## 7. Threats to test

- Forwarded/previewed/replayed/brute-forced invites and consume-vs-revoke races; open links must not bypass disabled/removed identities or capacity.
- Stolen/replayed sessions, expired/legacy sessions revived by activity, and trip switches/settings extending authentication age.
- Cross-trip object IDs, owner private-audience bypass, locked-event editing, stale role/identity and linked-expense audience expansion.
- Pending-item edits/reapproval after audience/member/revision changes; terminal/invalidated proposals must never revive.
- Prompt injection, booking-secret echo, research exporting private context, invented source/price/hours authority and repairs changing unrelated money/audience fields.
- Same-user concurrent admission, cross-user history/recovery, identity reset during provider work and stale completion commits.
- Image oversize/malware/metadata exposure, browser caching of private/API 401/403 data, and sign-out failing to clear private snapshots.
- Worker research/logs leaking IDs/private data, failed checks clearing valid warnings, and old event revisions inheriting evidence.
- Feedback credential inheritance, altered report replay, uncertain GitHub POST duplication and untrusted diagnostic content.

## 8. Local verification limit

Run unit/build/smoke checks without Google/provider credentials. Database tests recreate the target `public` schema: use only a disposable loopback database confirmed with `TEST_DATABASE_CONFIRM_DESTROY` ([database tests](DATABASE.md#5-tests)), never a production database. They cover concurrent claims/joins/revocation, capacity, refresh replay, returning membership, identity cleanup, private audiences and proposal/recovery fences. Synthetic success does not prove a live Google consent flow.
