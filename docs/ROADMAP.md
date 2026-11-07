# Roadmap

Where the project is going, in job-sized steps. Each job gets a file in [`jobs/`](jobs/) when work starts; see the [job system](JOB_SYSTEM.md). Entries below are plans unless marked done; the code and the feature contracts are the source of truth for what exists.

## Goals

- **A public instance anyone can try:** sign in with Google or try a guest account deleted within a day; use the optional free AI or bring your own key.
- **Easy self-hosting:** one `docker compose up`, or the same Kubernetes manifests the public instance uses.
- **Visible engineering:** infrastructure as code, a reproducible deploy pipeline, and a security model that is documented and tested.

## Status

| Job | What | Status |
| --- | --- | --- |
| JOB-086 | Free AI for signed-in users and guests | In review: explicit keyless choice, fresh zero-price catalog checks, minimized context and exact request/attempt caps (D-098). Local only; not deployed |
| JOB-058 | Public repository with fresh history (MIT); one container image for web, workers, migrations and backups; Docker Compose self-hosting | Done |
| JOB-059 | GKE Autopilot in OpenTofu (`infra/`), Kustomize manifests (`deploy/k8s`), Secret Manager mounts, encrypted backups, deploy script and the `deploy` workflow with an approval step | Done |
| JOB-060 | Move the public instance from its earlier single VM to GKE without losing writes | Done: cut over on November 4, 2026 after a staging rehearsal. The old services are disabled; the VM stays as a rollback for now |
| JOB-061 | Bring-your-own API keys | In review: Settings → AI keys, encrypted storage, per-request isolation, own-key funding, AI on in every trip, and fixes from a security review. Usage display moves to JOB-066 |
| JOB-062 | Gemini models (`gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`) with Google Search grounding | Done |
| JOB-063 | Trip-owner key sharing | In review: invite and join-link checkboxes, per-member switches, shared-key funding with the trip model and daily limit |
| JOB-064 | Guest mode and public sign-up | In review: guest accounts with the 24-hour purge, behind `GUEST_MODE_ENABLED`, and public sign-up behind `PUBLIC_SIGNUP_ENABLED`; both are on for the public instance. Self-service account deletion is still to come |
| JOB-065 | Public-launch security and privacy review | Done: [threat model](THREAT_MODEL.md), the published [privacy notice](PRIVACY.md), reviews of each public surface, encryption-key rotation and explicit funding contexts. Guest mode and public sign-up are on |
| JOB-066 | Showcase documentation, a private feedback repository, own-key and shared-key usage in Settings | Done: the [case study](CASE_STUDY.md), key usage in Settings, and feedback issues filed in a private repository |
| JOB-067 | Phone AI button, quick answers that expire, and day-map fixes | Done: Ask AI on phones, ten-minute quick answers, day maps that load when opened and include private places (D-081, D-082) |
| JOB-068 | Daily off-site copy of the database in Neon | Done: a dated, row-count-verified copy each day in a Neon free-plan project, outside Google Cloud (D-083) |
| JOB-085 | Load only the selected language, with English first in the language menus | Done: browser code carries no language pack; each page sends its own, and the create-trip page only its language's choices (D-097) |
| JOB-084 | Eight more languages, and "Cantonese" in the README | Done: Simplified and Traditional Chinese, Spanish, Brazilian Portuguese, French, German, Russian and Indonesian as translation packs (D-096) |
| JOB-083 | Flight status checks before departure | Done: checks 24 and 12 hours, then hourly from 6 hours, before departure; time changes, cancellations and terminal or gate changes update the flight (D-095) |
| JOB-082 | Flight details on transport events, and the AI looks up terminals | Done: flight number, airline, terminals and gate on flights; cards show the gate, else the terminal, else the airline (D-094) |
| JOB-081 | Retire the classic layout and the layout toggle | Done: one layout, light or dark with the system; no toggle, Settings card or stored preference (D-093) |
| JOB-080 | AI expenses are split between everyone unless the request says otherwise | Done: unnamed sharers mean everyone who can see the expense, parts the request gives become exact shares, and several payers become one expense each (D-092) |
| JOB-079 | AI-created events are trip-wide unless clearly solo | Done: the trip AI adds events for the whole trip unless the user asks for privacy, names who may see them, or the event or its expense is clearly just for them (D-091) |
| JOB-078 | Both of the owner's Google accounts act as the platform operator | Done: `OWNER_GOOGLE_EMAIL` may list several of the operator's accounts, and each runs AI on the server's keys (D-090) |
| JOB-077 | A one-line guest notice, singular counts, and line breaks in free-model replies | Done: the guest notice mentions the AI key only when free guest AI is off, English says "1 expense", and free-model replies show line breaks instead of `<br/>` tags (D-088) |
| JOB-076 | A brief README with phone screenshots, and a documentation index | Done: five phone screenshots, a **Find your way** table and a [documentation index](README.md); the diagram moved to [deployment](DEPLOYMENT.md) |
| JOB-075 | Expense summary notes behind its "?" help, and the copy JOB-073 missed | Done: the expense summary shows only its figures and their "?"; trip creation, guest sign-in and the operator's feedback panel are brief too (D-088) |
| JOB-074 | Codex web search again, with the code-mode host on | Done: disruption checks and OpenAI-model planning search again; the host stays on with code mode off (D-089) |
| JOB-073 | Brief UI copy, with a few "?" buttons for details | Done: shorter notes, warnings and errors in every language, and details behind three "?" buttons (D-088) |
| JOB-072 | The operator's own AI requests follow the own-key rules, pictures included | Done: the operator's requests on the server's keys read links, take any topic and add new items at once, from pictures too (D-087) |
| JOB-071 | Free guest AI on keyless free models | Done: guests without a key get a few planning requests a day on a free 2026 model through Kilo's AI Gateway, without search (D-086) |
| JOB-070 | Own-key AI requests that read links, take any topic and add new items directly | Done: on the requester's own key the AI reads pasted public links, answers anything, and adds new events and expenses they could add by hand (D-085) |
| JOB-069 | Admin page, account suspension, a daily sign-up cap, and users' keys sealed by Cloud KMS | Done: the operator sees accounts and counts, never content, can suspend accounts and cap sign-ups; only the web server may use the KMS key that seals users' keys (D-084) |

## Planned work in more detail

### JOB-061: bring-your-own API keys

- **Settings → AI keys** for OpenAI, Anthropic and Gemini.
- **Stored safely:** each key is checked with a cheap model-list call before it is saved, encrypted at rest under a dedicated rotatable key, and never shown again after saving; only its last four characters are.
- **One credential resolver** replaces today's operator-funding gates. Each request uses:
  1. the requester's own key for the chosen provider; otherwise
  2. a trip owner's shared key (JOB-063); otherwise
  3. the optional free service when no paid funding is available (JOB-086), else a prompt to add a key. Explicit Free AI never uses a key.
- **Per-request isolation:** keys go to a per-request provider process with a fresh temporary state directory.
- **Usage ledger** per request (provider, model, tokens, estimated cost, whose key), visible to the key's owner.

### JOB-063: trip-owner key sharing

- The invite dialog gets a checkbox, **"Let this member use my AI keys"**, off by default. Owners can switch it on or off per member at any time.
- The grant names the sponsoring owner, and stops working if that owner removes the key, leaves or is removed.
- **Limits:** members using shared keys use one trip-level model the owner chooses, with the trip's daily request limit (default 20). A monthly cost cap is not built; it would need per-model prices.
- All grant changes are audited; copy is in every interface language. Contract: [sharing your keys](PUBLIC_TRIPS_AND_MEMBERS.md#sharing-your-keys-with-members).

### JOB-064: guest mode and public sign-up

- **"Try as guest"** behind Cloudflare Turnstile and rate limits.
- **Seeded demo trip:** each guest starts with a synthetic one.
- **Sandboxed in the database:** guest and real trips never mix. Guests get no invitations or Calendar; AI uses their own key or the optional free service (JOB-071, extended by JOB-086).
- **Purge:** an hourly job hard-deletes guests older than 24 hours through a guarded function that may only touch guest-only rows.
- **Public sign-up** with Google, and self-service account deletion.

### JOB-065: public-launch review

- **Threat model** covering guest flooding, key theft, prompt injection aimed at secrets, storage and cost abuse, and log redaction.
- **Credential follow-ups** from the JOB-061 review:
  - an encryption-key ring with re-encryption, so the key can be rotated (done);
  - an explicit credential context for operator-funded calls (done).
- **Pages:** the [privacy notice](PRIVACY.md), with how the public instance may be used, linked from sign-in, and [security reporting](../SECURITY.md) (done).
- **Optional:** Google OAuth verification, which removes the unverified-app warning for Calendar.

### JOB-066: showcase and operations polish

- **Case study** of the design for readers who want the why.
- **Own-key usage:** in Settings, each key's owner sees their usage per provider (moved from JOB-061).
- **Feedback issues** go to a private repository, never this public one, because reports can contain user text (done: the publisher confirms the repository is private before each run).
- **Usage:** each key owner sees requests per provider, including members using a shared key.

### JOB-067: phone AI button and day-map fixes

Requested by the owner on 4 November 2026 ([job](jobs/JOB-067-phone-ai-and-day-map.md)).

- **Ask the trip AI** on phones: the bottom-right button opens the quick AI composer (D-082).
- **Quick answers expire** after ten idle minutes, and the next quick question starts a new conversation (D-082).
- **Day map:** loads when opened; private places are included unless the viewer turns them off, and saved "venue, street, city" addresses match (D-081).

### JOB-068: off-site copy in Neon

Requested by the owner on 5 November 2026 ([job](jobs/JOB-068-offsite-copy.md)).

- **Daily copy:** the `stardust-offsite-copy` job restores the database into a Neon free-plan project as a dated database, checks every table's row count, and keeps the newest three (D-083).
- **Free plan:** a 0.25 CU compute awake a few minutes a day, and all copies within 500 MB of the 1 GB of storage.

### JOB-086: free AI for every account

Requested by the user on 7 November 2026 ([job](jobs/JOB-086-free-ai-for-everyone.md)).

- **Explicit choice:** any active member can choose keyless Free AI, even with paid funding available. It is the default only without paid funding.
- **Boundaries:** text-only, minimized context, retained/training disclosure, pending changes, fresh zero-price model checks and shared request/attempt quotas. No paid fallback or deployment implied. [Contract](AI_AND_AGENTS.md#free-ai-for-every-account-job-086-d-098).

### JOB-085: only the selected language

Requested by the owner on 7 November 2026 ([job](jobs/JOB-085-load-selected-language.md)).

- **Smaller downloads:** browser code carries no language pack; each page sends only its own language's pack, and the create-trip page only its language's choices (D-097).
- **Menus:** English is always first in the language menus.

### JOB-084: more languages

Requested by the owner on 7 November 2026 ([job](jobs/JOB-084-more-languages.md)).

- **Languages:** Simplified and Traditional Chinese, Spanish, Brazilian Portuguese, French, German, Russian and Indonesian, each a translation pack laid over the English copy (D-096).
- **Later:** a native speaker's review of each pack. Sending the browser only the selected language followed in JOB-085.

### JOB-083: flight status checks

Requested by the owner on 7 November 2026 ([job](jobs/JOB-083-flight-status-checks.md)).

- **Before departure:** eight checks from 24 hours to 1 hour out update a flight's times, cancellation, terminal and gate, with a badge saying what changed; the checks follow a changed departure (D-095).

### JOB-082: flight details

Requested by the owner on 7 November 2026 ([job](jobs/JOB-082-flight-details.md)).

- **Flights:** transport events can carry a flight number, airline, terminals and gate; the trip AI fills them in and looks up the terminals, and cards show the most specific known spot (D-094).

### JOB-081: one layout

Requested by the owner on 7 November 2026 ([job](jobs/JOB-081-retire-classic-layout.md)).

- **Classic retired:** the classic layout, its toggle and the Settings **Screen layout** card are removed; the layout that has been the default since October 2026 is the only one (D-093).

### JOB-080: AI expenses split between everyone

Requested by the owner on 7 November 2026 ([job](jobs/JOB-080-ai-expense-split-default.md)).

- **Everyone by default:** an AI expense with no sharers named is split equally between everyone who can see it; exact parts from the request, exclusions and expenses clearly the requester's own still win (D-092).

### JOB-079: trip-wide AI events

Requested by the owner on 6 November 2026 ([job](jobs/JOB-079-ai-trip-wide-default.md)).

- **Trip-wide by default:** new AI-created events, bookings included, are for the whole trip; they are private only when asked, shared with named people only, or clearly for the requester alone (D-091).

### JOB-078: several operator accounts

Requested by the owner on 6 November 2026 ([job](jobs/JOB-078-operator-accounts.md)).

- **Both accounts:** the owner's two Google accounts are each the platform operator, so the AI runs on the server's OpenAI, Anthropic and Gemini keys from either (D-090).

### JOB-077: guest notice, counts and free-model line breaks

Seen on 6–7 November 2026 while taking the README screenshots ([job](jobs/JOB-077-guest-notice-counts-line-breaks.md)).

- **Guest notice:** one short line; it mentions the AI key only when free guest AI is off (D-088).
- **Counts and line breaks:** English counts have a singular form, and free-model replies show line breaks instead of `<br/>` tags.

### JOB-076: a brief README with screenshots

Requested by the owner on 6 November 2026 ([job](jobs/JOB-076-readme-screenshots.md)).

- **README:** five phone screenshots of a synthetic trip, six highlights and a table that points to the right document.
- **Documentation index:** every document by area, for people and AI agents.

### JOB-075: expense summary notes behind "?"

Requested by the owner on 6 November 2026 ([job](jobs/JOB-075-expense-summary-help.md)).

- **Expense summary:** its notes moved into each figure's "?" help, with no new buttons.
- **Missed copy:** trip creation, guest sign-in and the operator's feedback panel, which JOB-073's review skipped.

### JOB-074: Codex web search again

Requested by the owner on 6 November 2026 ([job](jobs/JOB-074-codex-code-mode-host.md)).

- **Tools through the code-mode host:** the lockdown keeps the host on and code mode off, so Codex turns can search and the disruption monitor runs again (D-089).

### JOB-073: brief UI copy

Requested by the owner on 6 November 2026 ([job](jobs/JOB-073-brief-ui-copy.md)).

- **Brief:** a note is one short line or none; details people may want sit behind a few "?" buttons (D-088).

### JOB-072: the operator's own AI

Requested by the owner on 6 November 2026 ([job](jobs/JOB-072-operator-own-ai.md)).

- **Paid by the requester:** the platform operator's requests on the server's keys follow the own-key rules, and pictures no longer force review on any request the requester pays for (D-087).

### JOB-071: free guest AI

Requested by the owner on 6 November 2026 ([job](jobs/JOB-071-guest-free-ai.md)).

- **Free AI for guests:** keyless `:free` models through Kilo's AI Gateway, planning only, within per-guest and instance-wide caps (D-086).

### JOB-070: own-key AI

Requested by the owner on 6 November 2026 ([job](jobs/JOB-070-own-key-ai.md)).

- **On the requester's own key:** linked public pages are read by a guarded server-side fetcher; any topic is answered; new items the requester could add by hand are added at once (D-085).

### JOB-069: admin page and key protection

Requested by the owner on 6 November 2026 ([job](jobs/JOB-069-admin-and-key-protection.md)).

- **Admin page** for the operator: accounts, activity and refused attempts as metadata and counts; suspension; a daily cap on public sign-ups (D-084).
- **Users' keys** sealed by Cloud KMS. An IAM deny policy leaves the key usable only by the web server's service account, and every use is logged (D-084).
