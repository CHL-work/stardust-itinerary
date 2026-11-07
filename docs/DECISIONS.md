# Decisions, Tradeoffs and Pushbacks

Current decisions are summarized here; accepted direction does not imply implementation or current permission to act. [IMPLEMENTATION](IMPLEMENTATION.md) describes shipped scope; hosting is in [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md). Superseded detail remains in Git history; do not follow historical rollout commands.

## D-098: Free AI is an explicit option for every account (accepted November 7, 2026)

The user requested free models for signed-in users as well as guests, after reviewing `Ebony-Vinyl/dsh-our-free-model` (JOB-086). This extends D-086; local implementation does not authorize deployment.

- **Funding:** an explicit free choice is resolved before keys. It is the default only without paid funding; unsupported explicit paid choices are refused, not silently changed. The historical `guest-free` request ID remains, but cannot be a trip default or keyed model. Trip AI off and suspension still refuse access.
- **Legitimate endpoint only:** Kilo documents anonymous free-model access. No upstream client impersonation, private relay, copied credentials or custom gateway. A catalog no older than five minutes must confirm free status, every price zero and structured output support. NVIDIA, automatic/opaque routes and personal/confidential-data-restricted trials are excluded. Defaults are dots.3 note and Liquid LFM-3; availability is not promised.
- **Minimized, not anonymous:** omit private events, existing expenses, notes, URLs, saved instructions and paid-model memory. Free history stays separate from paid summaries/draft sources. Use member aliases unless the requester supplied their names. The UI warns that free providers may retain or train on inputs.
- **Bounded:** text planning only, no images/search/research/background work. Default 10 requests/account/UTC day, 60 requests/rolling hour and 500/UTC day per instance. Actual upstream attempts, including retries and fallback, also use the instance caps under a shared database lock; no lock is held during network work. Free requests do not consume paid trip quotas. Rate limits stop fallback, and no failure charges a key.
- **Review:** all free creates and edits, including owners', remain proposals. Existing permissions, exact money, identity, revision checks and audit still apply.
- **Configuration:** `FREE_AI_*` overrides matching legacy `GUEST_FREE_AI_*`. An old enabled flag now has all-account scope; set `FREE_AI_ENABLED=false` to disable it explicitly. No migration is needed beyond the existing free-funding schema.

## D-097: The browser gets only the selected language (accepted November 7, 2026)

The owner asked to load only the selected language, and to always show English at the top of the language menus (JOB-085).

- **Packs:** the server bundles every language pack; browser code bundles none.
  - A `turbopack.resolveAlias` entry gives client builds an empty pack store.
  - Each page sends only its own language's pack, which `LocalePackScope` installs before the page renders.
  - Catalog records built when a module loads read the added languages when used, so they show the installed pack.
- **Create trip:** the page carries only the selected language's copy and its time zone and currency choices. Choosing another language in the form reloads them and keeps what was typed.
- **Menus:** both language menus list English first, then the other languages in a fixed order.
- **Guard:** the smoke test fails the build if any pack's text appears in browser code.

## D-096: Eight more interface languages, kept as translation packs (accepted November 7, 2026)

The owner asked for Simplified Chinese, Traditional Chinese and six more of the languages most used on the internet, and for the README to call the Cantonese interface just "Cantonese" (JOB-084).

- **Languages:** Simplified Chinese (`zh-CN`), Traditional Chinese as used in Taiwan (`zh-TW`), Spanish (`es`), Brazilian Portuguese (`pt-BR`), French (`fr`), German (`de`), Russian (`ru`) and Indonesian (`id`). The six are among the most used online, by people and by web content, besides the English and Japanese the app had. Arabic, also among them, is left out: the layout is left-to-right only.
- **Packs, not code:** each added language is one JSON pack of every catalog's text, in `src/lib/locale-packs/`. Code reads a catalog through `localizedCatalog`, which lays the pack over the English catalog, so a gap shows English, never a blank. Tests keep every pack complete: the same keys, lists and placeholders as English, and no English sentence left.
- **Translation:** AI drafted the packs from the English copy, with the Japanese and Cantonese text for context; a native speaker's review is welcome. Chinese and Indonesian use one form for every count. Russian writes counted words as "label: number", since the app only picks between one and other.
- **Unchanged:**
  - Outside Chinese the app keeps its English name; it is 星尘远征军 in Simplified and 星塵遠征軍 in Traditional Chinese.
  - Disruption details are written in English, Cantonese and Japanese, so the added languages show the English one.
  - AI answers follow the selected language, as before. The spicy Cantonese mode is unchanged.
- **Cost:** superseded by D-097: the browser now gets only the selected language's pack.

## D-095: The server checks flights before departure and updates them (accepted November 7, 2026)

The owner asked for routine checks on the day of a flight: 24 hours before departure, then 12, 6, 5, 4, 3, 2 and 1 hours before. A time change or delay updates the event with a changed badge that says what changed; a cancellation keeps the event, marked cancelled with a red warning; a new gate or terminal just updates them; and the checks follow a changed departure (JOB-083).

- **Scope:** trip-visible, planned flights with a flight number, in operator-sponsored trips with background checks on, on the operator's keys. Private flights are never looked up.
- **The model reports, code decides:** a time change of at least 15 minutes or a cancellation needs high confidence, a terminal or gate at least medium, and every change a public https source for this exact flight and date. Unknown details never clear known ones.
- **Automatic writes:** this is the first automatic canonical edit. It is a revision with `changed_by_source = 'flight_status'`, an audit event with no actor and a `flight_status_changes` row, so it is visible, auditable and reversible. It supersedes, for flights only, the rule that background checks never edit events; disruption warnings still never do.
- **Not included:** phone notifications, unsponsored and guest trips, and flights without a flight number.

## D-094: Flights carry structured details, and cards show the most specific known spot (accepted November 7, 2026)

The owner asked the trip AI to look up a flight's terminal, and said a gate or terminal may not be findable: without a gate, show the terminal; without either, show the airline (JOB-082).

- **Details:** a transport event may carry `flight` details: the flight number, required, and the airline, departure terminal, departure gate and arrival terminal when known. They are one validated JSON object on the event, replaced whole by an edit.
- **Display:** cards show the departure airport followed by the gate with its terminal, else the terminal, else the airline; the arrival airport is followed by its terminal. The stored airport names stay as they are, so maps and directions still find the airports.
- **AI:** the trip AI sets the flight number and airline, and looks up the terminals for the flight's date by direct search or isolated `travel` research. It sets a terminal only from the request or a source, and a gate only when a source states one; unknown details stay empty. A private flight's number never goes to research.

## D-093: One layout; the classic layout and its toggle are retired (accepted November 7, 2026)

The owner asked to remove the classic UI. The new layout had been the default since October 11, 2026, with the original dark classic layout kept behind a toggle in the header and a **Screen layout** card in Settings (JOB-081).

- **One layout:** the server renders `<html data-ui="new">`, light by default and dark with the system. There is no toggle, Settings card or stored layout preference; a leftover `stardust.ui-mode.v1` value is never read.
- **Removed with it:** the classic phone bottom bar, the Overview date selector and swipe hint, the sidebar's placeholder progress bar, and the classic-only styles for them.
- **Kept:** `globals.css` stays the base stylesheet the layout overrides, and layout rules stay scoped to `:root[data-ui="new"]`, so their specificity is unchanged. Behavior, data and permissions are unchanged. This supersedes the October 11, 2026 layout decision below.

## D-092: AI expenses are split between everyone unless the request says otherwise (accepted November 7, 2026)

The owner asked that the trip AI use the parts a request gives, and otherwise split an expense between everyone. When nobody said who shares, the AI charged the requester alone, so a group dinner the requester paid for became their personal cost (JOB-080).

- **Default:** an equal split between everyone who can see the expense: every member for a trip-wide event or a standalone expense, the creator and selected viewers for a private event.
- **Narrower when the request says so:** people it excludes (for example someone who did not come) are left out, sharing with named people uses just them, and an expense clearly the requester's own is theirs alone.
- **Exact parts:** when the request gives each person's part, those amounts become the shares. Who paid is never taken as a person's part, and several payers of one bill become one expense each, split by the same rules.
- **Review notice:** the "confirm the payer and split members" notice no longer appears for the default split between everyone, and sharers nobody named are not checked for duplicate names. It still appears when the payer is assumed or the split leaves some members out without naming the rest.
- **Unchanged:** the server's money checks and the tentative payer (the requester when nobody says). This supersedes the expense note in D-091.

## D-091: AI-created events are for the whole trip unless clearly solo (accepted November 6, 2026)

The owner reported that the trip AI tended to create events as private. A reservation rule told it to keep a "personal reservation" private when nobody said otherwise, and nothing set a trip-wide default, so hotels, paid meals and flights often became private. Production showed 40 of 67 AI-created events private, most from requests that never asked for privacy (JOB-079).

- **Default:** a new AI-created event is for the whole trip (`visibility` trip, no viewers), even when one person booked, paid for or is named on it.
- **Private only when:** the user asks for privacy, shares the event only with named people (private with those viewers), or the event or its expense is clearly for the requester alone. Paying for an event, or an expense split only to the requester by default, does not make it solo. The reply says when the AI chose private unasked.
- **Unchanged:** who shares an expense keeps its defaults (the requester plus named companions, until D-092), calendar imports stay private by default, and the server still validates every audience. The server never widens a private proposal to the trip; the creator can change an event's audience in its editor.

## D-090: The platform operator may use several Google accounts (accepted November 6, 2026)

The owner signs in with two Google accounts and wants AI to run on their own OpenAI, Anthropic and Gemini keys from both. Only one account was the operator, so the AI in trips the other created would ask for a personal key (JOB-078).

- **Setting:** `OWNER_GOOGLE_EMAIL` lists one email or several, comma-separated. Each listed account, matched to a stored verified Google identity, is the platform operator for everything the operator does:
  - the server's keys pay for trips it creates;
  - its own requests count as paid by the requester (D-087);
  - the admin page, feedback review and the operator's quota exemptions.
- **One person only:** list only accounts of the person who runs the instance and pays for its keys. Every listed account can open the admin page, and none can suspend another.
- **Trip roles still apply:** in a trip someone else owns, a listed account follows that trip's AI rules like any member: the trip's model and daily limit, on the server's keys only if that trip is sponsored.
- **Fails closed:** a list with an entry that is not an email names nobody, and sign-in reports the configuration as invalid, as a single invalid email did before.

## D-089: The Codex code-mode host stays on as the tool transport (accepted November 6, 2026)

Since Codex 0.147 the CLI runs every tool, web search included, through its code-mode host. The lockdown had turned the host off, so each session failed closed: no Codex turn could search, and the disruption monitor and OpenAI-model planning failed (JOB-074).

- **Host on, code mode off:** `code_mode_host` stays at its default, on. `code_mode` and `code_mode_only` are off, and so is every other disabled feature: shell, exec, browsers, computer use, connectors, plugins, skills, agents, hooks, memories, images and history.
- **Why it is acceptable:** the host runs model-written JavaScript in a bare V8 isolate with no file, network, process or environment API, so it reaches only the tools left on. On the production image the model could search the web but could not read a canary file.
- **Residual risk:** the host is a separate process outside Codex's OS sandbox, and it inherits Codex's environment, which holds the provider key. An escape from the V8 isolate could therefore use that key. Secrets are not otherwise in that environment: `providerEnvironment` passes only runtime variables and the provider's own key.
- **Not chosen:** calling the Responses API directly would avoid the host, but it would replace the Codex transport the planner, research and the monitor share. Re-check this when the CLI changes; the lockdown test reads the installed CLI's own feature report.

## D-088: Brief UI copy, with details behind a few help buttons (accepted November 6, 2026)

The owner found the UI wordy and its warnings unread (JOB-073).

- **Notes:** one short line or none. Do not describe internal mechanics, such as tokens, transactions or audit entries.
- **Errors and confirmations:** say what happened and what to do, in one or two short sentences. Keep a fact the person needs to decide, such as the old and new dates of a change.
- **Details on request:** an explanation someone may want, about privacy or money, goes behind one "?" button (`InfoTip`), at most one per section. The complete detail stays in the [privacy notice](PRIVACY.md) and the docs.
- **Why not delete every disclosure:** a short privacy fact still belongs next to the action it concerns, such as what loading the map sends. A button keeps it one tap away without making everyone read it.

## D-087: The operator's own AI requests count as paid by the requester (accepted November 6, 2026)

JOB-070 loosened the AI only on a user's own key. The owner runs this server and plans on its keys, so their own requests kept every limit and the link they pasted went unread (JOB-072).

- **Who pays:** the requester pays when a request runs on their own key, or on the server's keys when the requester is the platform operator, who pays for those keys. Other owners and members on the server's keys, and shared-key and free requests, keep every limit.
- **Pictures:** on a request the requester pays for, items from pictures are added at once, and an owner's picture-based edits apply directly. D-085 kept pictures in review. But the requester supplied the picture and could add the same items by hand, and they asked not to approve their own requests. Other requests keep picture review.
- **What stays:** privacy for other members, validation, review of edits to pending items and of deletions, and review for members who need approval.

## D-086: Free guest AI on keyless free models (accepted November 6, 2026)

**Extended and tightened by D-098:** the guest-only restriction and original model selection below are historical; use the all-account contract above.

The owner wanted guests to use the AI for free, with a model from 2026 that is not too weak, and pointed at an open-source project that gets free tokens (JOB-071).

- **Not that project's main method:** it gets free tokens by posing as another app's command-line tool to use that app's keyless free tier, by farming accounts on consumer coding apps (with automatic check-ins and solved captchas), and through a relay holding a shared key. Those break the services' terms, so a public site cannot rely on them.
- **Its one clean method:** Kilo's AI Gateway documents unauthenticated access to its `:free` models, 200 requests an hour per address. Stardust uses that, identifying itself honestly. On 6 November 2026 the free models were 2026 releases, led by NVIDIA Nemotron 3.5 Super, which supports JSON schema output.
- **Considered instead:**
  - OpenAI's free tokens for sharing data: the best model, but data is used for training and Hong Kong is unsupported.
  - The Gemini free tier: Hong Kong is unsupported, the caps are small, and data is reviewed.
  - Z.ai's free GLM-4.7-Flash and Cloudflare Workers AI: either would need a new account or token.
- **Bounded:**
  - only guests use it;
  - planning only, with no search or research;
  - 10 requests per guest a day, and 60 an hour and 500 a day for the instance;
  - a separate keyless credential context that no keyed adapter accepts;
  - a note to guests that free models may keep what they send.

## D-085: Own-key AI requests read links, take any topic and add new items (accepted November 6, 2026)

The owner pasted an event link and the AI could not read it, then would only draft the event for approval. Because users pay with their own keys, the owner asked for the guardrails to loosen (JOB-070).

- **Whose limits:** the topic gate and the always-review rule for AI creates protect the operator's or a sponsor's money and the group's plan. On the requester's own key, the requester decides: any topic, and new items they could add by hand are added at once, owners through the ordinary review. Shared-key and operator-funded requests keep every limit.
- **What stays:**
  - privacy for other members, the output schema, the funding rules and validation;
  - review for pictures, edits of pending items and deletions;
  - review for members who need approval.

  An owner's text-only edits already applied directly and still do.
- **Reading links, safely:** the server, not the model, fetches the linked public pages and passes them as untrusted data. The fetcher reaches only public addresses on ports 80 and 443, pinned against DNS rebinding and re-checked on every redirect, so a pasted link cannot reach the metadata server or the cluster.
- **Prompt injection:** a page could try to steer the model. It is marked as untrusted data, kept in its own escaped section, and cannot change members, privacy, approval or the schema. Direct adds are limited to new items the requester could add anyway.

## D-084: An admin page, suspension, a sign-up cap, and keys sealed by Cloud KMS (accepted November 6, 2026)

The owner wanted to see who uses the public instance and how, to deal with spam, and ideally not to be able to read users' AI keys, since being able to would be a bad look (JOB-069).

- **Metadata, not content:** the admin page shows accounts, activity counts and refused attempts. It never shows trip names or contents, prompts, replies or keys, even to the operator. The operator could already query the database; the page does not widen that access, and the [privacy notice](PRIVACY.md) says what it shows.
- **Suspension, not deletion:** a suspended account loses its sessions, sign-in and shared-key funding at once, and keeps its data. Restoring it is one click. Deleting an account stays an operator task on request.
- **A daily cap on public sign-ups** (50 by default; 0 pauses them). Invitations and existing accounts are never refused.
- **Cloud KMS for users' keys:** the server still decrypts a key for each request it sends, so whoever runs the server can never be made completely unable to reach keys. What changed:
  - the encryption key can no longer be read or copied by anyone;
  - only the web server's service account may use it, enforced by a deny policy that also binds project owners;
  - every use is logged;
  - changing any of this leaves a record in the audit logs or in this public repository.

  Settings says so plainly and advises a dedicated, spend-limited key. Going further, keeping keys only in the user's browser, was declined because it would end key sharing and need the key on every device.
- **Cost:** a software KMS key costs about USD 0.06 a month per key version, and operations cost USD 0.03 per 10,000.

## D-083: A daily off-site copy in Neon (accepted November 5, 2026)

The owner asked for the database to be backed up in Neon, within its free plan. The daily backups were age-encrypted dumps in a bucket of the same Google Cloud project, so losing the project, for example after an unpaid free trial, would lose them too (JOB-068).

- **What:** a daily job restores one consistent snapshot into a dedicated Neon free-plan project as a dated database, checks every table's row count against the snapshot, and keeps the newest three verified copies. A failed run never drops the newest verified copy.
- **A database, not a file:** each run proves that the dump restores, and the copy can be used directly. Unlike the encrypted backups, it is readable by whoever holds its connection string or the operator's Neon login. It holds sessions only as hashes, and users' AI keys and Calendar tokens only as ciphertext under keys it never receives.
- **Free plan:** the compute is fixed at 0.25 CU, which a daily run keeps awake for a few minutes, and the job keeps all copies within 500 MB of the plan's 1 GB per project.
- **Least privilege:** the connection string is its own secret, mounted only by the copy job. That job reaches only the database, DNS and PostgreSQL's port on public addresses, over TLS with certificates checked.
- The encrypted Cloud Storage backups are unchanged. The [privacy notice](PRIVACY.md) now lists Neon.

## D-082: Phone AI button and quick answers that expire (accepted November 4, 2026)

The owner asked for the phone's bottom-right plus button to open AI instead, and for the AI's last answer to go away after ten minutes and start a new chat (JOB-067).

- **Phone button:** on Today, Itinerary and Expenses, the bottom-right button opens the quick AI composer as a sheet. It is hidden when the trip's owners turned AI off. Add event and Add expense stay at the top of their pages.
- **Ten minutes:** the quick composer (the AI card and the sheet) hides an answer once it is ten minutes old and nothing is running. The next quick question first starts a new conversation, as **New conversation** does; the earlier one stays in AI history. The AI tab, where a conversation is chosen explicitly, is unchanged.

## D-081: The day map loads when opened and includes private places (accepted November 4, 2026)

The owner asked for **Show day map** to show the map without another click, and for private places to be included unless the viewer turns them off. A private hotel with an address but no saved coordinates could not appear on the map at all (JOB-067).

- **Loading:** opening a day map requests it at once. Opening a date alone still requests nothing.
- **Private places:** included by default; the browser remembers a viewer's choice to turn them off. An included private stop uses its saved coordinates, or else its place text alone goes to the place lookup, and legs touching it are routed. Titles, dates, notes and people are never sent, and these lookups are never written to the shared cache.
- **Matching version 4:** saved "venue, street, city, region postcode" text matches when the whole venue name before the first comma equals the result's name and the result's postcode, or its city and state, appear as later parts.
- This replaces the explicit-load and private-place rules of the October 7, 2026 MapLibre/OSM decision. The [privacy notice](PRIVACY.md) now lists the map and weather services.

## D-080: Public sign-up on the public instance (accepted November 4, 2026)

After the JOB-065 review, and with guest mode already on, the owner turned on public sign-up (`PUBLIC_SIGNUP_ENABLED=true`).

- **Who can join:** anyone with a Google account can sign in and create their own trips. Signing in still opens no one else's trip without an invitation.
- **Who pays:** new accounts use AI with their own keys (D-075). Operator keys pay only in trips the operator sponsors, and for the destination lookup when creating a trip, at most ten a day per account. `STARDUST_DESTINATION_LOOKUP=operator` would keep that lookup for the operator alone.
- **Unchanged:**
  - The Google OAuth app stays unverified (D-074). Calendar consent shows Google's warning, and at most 100 users can grant Calendar access.
  - Account deletion is not self-service yet; the [privacy notice](PRIVACY.md) says to ask the operator.

## D-079: Feedback issues only in a verified private repository (accepted November 4, 2026)

Reviewed feedback summaries quote what users reported, so they are never filed in the public source repository.

- **Configured target:** `STARDUST_FEEDBACK_REPOSITORY` names the repository instead of a constant in code. Migration 0058 removes the public repository from the receipt checks.
- **Checked every run:** before the first delivery, the publisher asks GitHub whether the repository is private, not archived and taking issues. Otherwise it refuses, and queued issues wait.
- **Least privilege:** a fine-grained token for that repository only (Issues: read and write), in its own secret that only the publishing job's service account can read. The job that runs the reviewer model never holds it.

## D-078: Continuous deployment for the public instance (accepted November 4, 2026)

The owner chose to deploy every push to `main` without an approval step, since this is a personal app and a broken deploy is acceptable.

- **Trigger:** when CI passes for a push to `main`, the `deploy` workflow builds the image and runs `deploy/deploy.sh`.
- **What still guards it:**
  - The `production` environment has no required reviewers, but accepts only `main`.
  - Workload Identity still gives cluster credentials only to that environment.
  - Only CI runs for pushes to this repository deploy, never a pull request, even from a fork branch named `main`.
  - A manual run deploys only commits on `main`.
- **Other instances** can add reviewers to their own environment.

## D-077: Guest accounts for trying the public instance (accepted November 4, 2026)

The owner wants people to try the public instance without signing in, with guest data deleted within a day, and AI only with the guest's own key.

- **What a guest gets:**
  - **Try as guest** creates a guest account, a synthetic Tokyo demo trip (written through the normal audited change path), and a session that ends after 24 hours.
  - The guest's identity uses its own issuer, `urn:stardust:guest`, which no Google sign-in can match.
  - AI is on but never sponsored, so only the guest's own key pays.
- **Never mixed with real trips:**
  - A guest belongs only to its own guest trip.
  - Nobody else can join it, and it has no invitations, Calendar, feedback, new trips or operator-funded destination lookups.
  - Database triggers enforce the membership and invitation rules even if application code is wrong.
- **Deleted for good:** an hourly job calls `app_purge_expired_guest`, which deletes the expired guest and every row of its trip. This is deliberately unlike D-073, which keeps a deleted trip's records.
  - It refuses anything not provably guest-only.
  - It suspends triggers only for its own deletes, then proves no reference to the deleted rows remains, or rolls back.
- **Abuse limits:**
  - Off unless `GUEST_MODE_ENABLED=true`.
  - Cloudflare Turnstile when configured.
  - Three new guests an hour per browser address.
  - A cap on active guests (default 200).

**Hardened after an independent review** (migration 0057):
- The purge runs with the caller's rights, and only the purge job (as database administrator) may call it; the web server's role cannot.
- Guest status is fixed for life.
- Turnstile is required unless explicitly waived.
- Limits use Cloudflare's client address.
- Guests get smaller allowances and no pictures.

Public sign-up with Google exists behind `PUBLIC_SIGNUP_ENABLED`. After the JOB-065 review the owner turned both modes on for the public instance (D-080).

## D-076: Trip owners can share their own AI keys with chosen members (accepted November 4, 2026)

The owner asked that a trip owner can let invited members use the owner's API keys: a checkbox when inviting, and a way to turn it off and on again.

- **Per member, opt in:**
  - "Let this member use my AI keys" on the add-member form, and "People who join with this link can use my AI keys" when creating the trip's join link, both off by default.
  - An on/off switch on each member in Settings.
  - Turning sharing on always shares the acting owner's keys. Any owner can turn it off.
- **Who pays:** after the requester's own key and before operator sponsorship. A grant works only while its owner is an active owner of the trip who holds a key, and stops at the next request when that changes.
- **Limits:**
  - Shared requests run the trip's one model, which any owner of an unsponsored trip may choose (falling back to the sponsor's provider default).
  - The member's own model choice is ignored.
  - Shared requests count against the trip's daily prompt limit (default 20).
  - No cost cap.
- **Privacy:** members never receive the key. Owners see who uses whose keys; members see only whose key and model they use. Grants and their changes are audited without key material, and each shared request records its sponsor.

## D-075: Users can bring their own AI provider keys (accepted November 4, 2026)

The owner wants a public instance that anyone can sign in to and use with their own API key, and that the owner also uses as a real travel assistant. Any signed-in user can store an OpenAI, Anthropic or Gemini key in **Settings → AI keys**.

- **Who pays:**
  1. The requester's own key, when they choose one of its provider's models, or in a trip the operator does not sponsor. The trip's daily prompt cap does not apply.
  2. Otherwise the operator's keys, under D-030, in sponsored trips only.
  3. Otherwise nothing: the request is refused with `ai_key_required`.

  With no explicit model choice, a sponsored trip keeps its sponsorship, so adding a key never silently starts charging a member.
- **AI on/off:** `trip_ai_settings.enabled` now records only whether a trip's owners allow AI; who pays is decided per request.
  - New trips start with AI on.
  - Migration 0054 turns AI on for unsponsored trips that no owner turned off, because before this change their owners could not turn it on.
- **Safety:**
  - Keys are checked with the provider before saving and stored with AES-256-GCM under a dedicated `CREDENTIAL_ENCRYPTION_KEY`.
  - A key is never returned after saving.
  - A key is used only inside its owner's own requests, with a private provider state directory.
  - Background workers never use a user's key.

Sharing an owner's key with trip members is D-076.

## D-074: Google sign-in in production, unverified, signup still gated (accepted November 4, 2026)

The public instance's Google OAuth app is published from Testing to In production. Invitees no longer have to be registered as test users, and new Calendar tokens are not subject to the Testing-mode 7-day expiry. Public sign-up was decided separately (D-080).

The app stays unverified. Calendar consent shows Google's warning, and sensitive-scope grants are capped at 100 users until Google verification, which needs a separate decision. Stardust's own invitation and membership gates are unchanged. Self-hosted deployments make their own OAuth publishing choice.

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

**Superseded by D-093 (November 7, 2026):** the classic layout and its toggle are retired. The original decision follows.

New UI defaults on phone/desktop; classic remains reachable through the shared toggle and Settings until its planned retirement is separately implemented. Choice is device-local `stardust.ui-mode.v1`, applied before paint; missing storage means new. It stores no identity/trip data and is not purged on sign-out.

New-only selectors stay scoped to `:root[data-ui="new"]`; presentational components reuse existing state/permissions without new APIs or diagnostics. Both layouts retain readable personal amounts, today-first disclosures, horizontal pending review actions, endpoint weather, 44px touch targets and 16px phone inputs. Overview previous/next text buttons were later removed (D-071); chips/date selection/swipe remain.

## October 7, 2026: Manual AI instructions replace preferences

Forward migration 0049 removes structured profiles, catalog/import schema and automatic collection. Each user explicitly saves/clears private account instructions (8,000 characters, revisioned); the next planning request gets a lower-trust snapshot, including in existing conversations. No model writes this setting. Legacy preference chats are permanently read-only; Git/backups/history are not silently erased. Pre-0049 builds are incompatible rollback targets. [Instructions](AI_CUSTOM_INSTRUCTIONS.md).

## October 7, 2026: Feedback is a page control, not a floating overlay

The document-top-right report launcher scrolls away; no sticky/global toolbar replacement. Keep safe-area spacing, accessible modal, touch sizing and offline-header clearance. New reports optionally include ten minutes of allowlisted actions and always disclose sanitized issue-review eligibility. Historical publication opt-outs and exact old retry hashes remain honored. [Feedback](FEEDBACK.md).

## October 7, 2026: MapLibre/OSM selected

MapLibre with OpenStreetMap raster supersedes the Google-default/setup-blocked design. Explicit-load public Photon/FOSSGIS geocoding/routing is bounded/cached best-effort with no API credits; compact icons/times appear on arrowed connections beside Directions links. No duplicate stop list is needed. Private places are not publicly queried/routed; unknown pins/times remain unknown and connectors are not road geometry. No LLM or silent metered fallback. D-081 later made the map load when opened and included private places by default.

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
| D-023 | Original owner-only connector rule is narrowed by D-030, D-071 and D-075: provider credentials stay server-side and restricted; explicit bounded member/creator mediation does not grant general provider access. |
| D-024 | No copied sub2api/private endpoints/OAuth clients/token relay. Gemini CLI token reuse is unsupported; Gemini runs over the documented Gemini API or Vertex AI with an API key (JOB-062). |
| D-025 | Ordered plain SQL via pg, SHA-256 checked; never edit an applied migration. |
| D-026 | Git stores schema/rebuild materials, never real dumps/secrets. Backups are encrypted; their storage target is a deployment choice ([database](DATABASE.md#4-dump-and-restore-contract)). |
| D-027 | **Hosting mechanics superseded:** preserve recoverability/retention; old paid-database/dormancy plans are not active. |
| D-028 | Future reminders use due-time work/coarse reconciliation; no claim of a delivered serverless reminder queue. |
| D-029 | Google Authorization Code + PKCE/state/nonce; opaque purpose-hashed claim/session tokens, replay/revocation and independent authentication-age expiry. |
| D-030 | Current general funding: verified platform operator **and active owner** may select registered premium models and avoid app prompt caps. Other entitled members/co-owners are Sol-only and quota-bound; provider limits still apply. Astra is opt-in, not fallback. This governs the operator's keys in sponsored trips; users' own keys follow D-075. |
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

Open questions for planned work (an external MCP connector) belong with those jobs and the [roadmap](ROADMAP.md), not with obsolete global questions about regions, editor defaults or map providers already decided. Future route/reminder/communication providers require explicit cost, privacy and current terms review; existing optional infrastructure does not authorize activation.
