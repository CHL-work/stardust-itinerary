# Private AI conversation history

Active preference mode and its manager have been removed. The immutable historical `purpose=preferences` marker remains only to make those archived chats permanently read-only: no create, resume or submission can activate that capability. Ordinary trip chats still use bounded history/checkpoints. Settings [personal AI instructions](AI_CUSTOM_INSTRUCTIONS.md) are loaded fresh for the next request, including continued trip chats; saved history is not rewritten. Old saved response envelopes remain decodable, but removed preference receipts/counts are not displayed. Identity isolation, revocation, pagination, quota and one-user concurrency are unchanged.

Failed messages may include a safe provider category and estimated reset time, rendered using the same localized formatter as live/recovered replies. Existing trip/member/user/identity fences apply before reading exact-request failure metadata; no raw event or SDK diagnostic is exposed. Old generic failures remain generic. See [provider feedback](AI_PROVIDER_FAILURES.md).

Quick replies and history render as escaped paragraph blocks with 16px body text, 17px on phones, 1.75 line height and long-token wrapping. Composer/source controls are phone-sized. This presentation does not affect storage, context budget, Markdown handling or request behavior.

An explicit follow-up may [edit a current pending event](AI_PENDING_EVENT_EDITS.md) discussed in the selected chat. History resolves the referent; current authorized pending request IDs/revisions authorize the edit. A consumed create draft is not replayed, and switching to another trip/user still cannot reuse the old target.

Deleting a trip retains its requests, conversations and pictures and fails requests still in flight, but members can no longer open them.

Membership removal retains request, conversation, picture and actor records while permanently revoking that membership's conversations with `member_removed`. The same person's other trips and account AI instructions remain unchanged. Removed histories cannot be resumed or transferred to a replacement member. Owner audit access remains its existing separate, scoped boundary. See [retention and removal](PUBLIC_TRIPS_AND_MEMBERS.md#removing-a-member-safely).

Conversations can include [private picture attachments](AI_IMAGE_INPUTS.md). Message DTOs include IDs/dimensions only; no-store endpoints enforce self-only revocation-aware access. Safe extracted facts enter bounded memory/drafts; original prompts stay unchanged and old picture bytes are not replayed.

## User workflow

The **AI** tab is available to owners and members on desktop and phones. It lists only the signed-in person's conversations in the selected trip. Opening a conversation loads saved prompt/reply pairs; **Load older messages** prepends another page without moving the message currently being read. The latest-message action returns to the bottom. Stored answers retain their original language; navigation, progress and errors follow the selected UI language.

Browsing a previous conversation does not switch the live request, cancel it or call a provider. **Continue conversation** explicitly makes that conversation current and uses its existing token-budgeted tail/checkpoint for subsequent questions. **New conversation** archives the current conversation and starts with fresh context. These actions clear the unsent composer text; neither deletes audit history. Conversation changes wait for the same user's running request to finish, including work in another trip. Other users remain independent.

The Overview/Itinerary AI card remains a quick composer with a link to the full history; on phones, the bottom-right **Ask the trip AI** button opens it as a sheet on Today, Itinerary and Expenses. The quick composer hides an answer once it is ten minutes old and nothing is running, and the next quick question first starts a new conversation, as **New conversation** does (D-082). The earlier conversation stays in history, and the AI tab's composer is unaffected. AI history stays online-only: no prompts or answers are stored in localStorage, IndexedDB, service-worker caches or the offline itinerary snapshot.

## Persistence and security

Migration 0034 distinguishes ordinary user archives from permanently invalidated identity history. Legacy history is admitted only when its immutable identity and recorded closure provenance are sufficient; unprovable old audit-only requests are not assigned to the current user. An identity unbind/replacement invalidates earlier archives as well as the current conversation. Restoring the same Google account later does not revive that invalidated context.

Every list, message page and continuation revalidates the exact active trip/member/app-user binding. An owner has no cross-user bypass on these endpoints. The separate existing owner audit view is unchanged. Message DTOs include submitted text, saved assistant answers, model, timestamps and safe delivery status, never raw provider diagnostics, hidden reasoning, patches or other members' conversations. Pages are fixed-size and keyset ordered with scope-bound validated cursors; responses are private and `no-store`.

The one-current-conversation and one-in-flight-request rules use the same short transactional locks as request recovery. Web submissions include the conversation selected by the composer; a stale tab cannot silently append its prompt to a different conversation activated elsewhere. The client request digest also binds that selected conversation. Merely browsing or continuing history consumes no prompt quota and triggers no search or model work.

Reopening is not permission to replay fulfilled changes. Current canonical context, authorization, clarification-draft root expiry/consumption and owner approval still apply. Reading the entire saved transcript does not enlarge the 6,000-token recent-context budget or send the entire history to the model.

## API

- `GET /api/trips/:tripId/ai/conversations?cursor=…`: private conversation summaries, current ID and next page cursor.
- `GET /api/trips/:tripId/ai/conversations/:conversationId/messages?cursor=…`: safe prompt/reply pairs, chronological within each newest-first page; prepend older pages.
- `POST /api/trips/:tripId/ai/conversation`: `{action:"new"}` or `{action:"resume",conversationId}`. Returns the current conversation ID. The older empty-body new-conversation call remains supported.
- `POST /api/trips/:tripId/ai`: required `conversationId`; explicit `null` means the browser observed no current conversation. Older tabs omitting selection must reload before submitting; direct internal planner callers retain their legacy optional argument.

## Operations and rollback

Full PostgreSQL backups include history metadata and the request/checkpoint tables. History needs no separate export, cloud service, credential or background model task. Phone [delivery recovery](AI_REQUEST_RECOVERY.md) works independently of transcript selection.

Migration 0034's close-state constraint makes an unmodified old lifecycle writer unsafe. Retain its compatible prepare/reset/identity-close layer when reverting UI/history APIs. Do not drop permanent-revocation guards, delete history or make completed request IDs reusable. Legacy requests without provable conversation attribution remain in the restricted audit view, not guessed into personal chats. Backup, restore and migration rules are in [database](DATABASE.md); deployment is covered in [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).
