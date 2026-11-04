# Personal AI instructions

One explicitly user-edited Settings field replaces the former structured preference profiles, media catalogs and preference conversations. This is personal customization, not permission to replace the application's security instructions.

## User workflow

Every active signed-in member, including viewers, can open **Settings → AI instructions**, enter their preferences or planning requirements, and Save. Clear removes the saved text. The field starts empty; old profiles are not converted automatically. Examples include preferred pace, budgets expressed as planning guidance, favorite fictional works, meal preferences or how the assistant should explain recommendations. Do not enter passwords, booking PINs or other secrets.

The text belongs to the signed-in account and follows it across trips. Updates apply to the next admitted planning request, including an existing trip conversation and a change of model. A request already processing keeps its original snapshot. Saving does not invoke a model or consume a prompt. AI cannot modify this field and there is no automatic preference extraction, inferred-profile confirmation workflow or catalog import.

The 8,000-character bound is enforced in the UI, API and database. Saves require the last-read revision; a competing device change returns 409 instead of silently overwriting it. Clear is the same explicit revision-checked operation with an empty value. Failed saves keep the local draft; an identity change aborts old loads/saves and cannot populate the next account's field. Nothing is persisted to browser storage or the offline itinerary cache.

## Persistence and authorization

`app_users.ai_instructions` stores only the current manually entered text. `ai_instructions_revision` is a positive optimistic concurrency counter, not a history of old instruction content. There are no preference entities, aliases, inferred facts, profile revisions, catalogs or embeddings.

- `GET /api/trips/:tripId/ai/instructions` returns `{instructions, revision}` for the authenticated account only.
- `PATCH` accepts exactly `{instructions, expectedRevision}`. The server derives user/member identity from the session, validates same-origin mutation and rechecks the active binding and current role under a short transaction. No owner bypass or supplied user ID is supported.
- Responses, including failures, are private/no-store. These routes are separate from owner-only trip model/quota configuration.
- Save auditing stores only revision, character count and whether cleared, never the instruction text or a before/after content snapshot. Other members cannot read the field. The existing owner-restricted prompt/result audit remains; generated replies may reflect instructions, so this is not secrecy from the trip's AI auditor.

## Planner boundary

The admitted planning request loads the current account's text once. Both providers receive the same bounded JSON-delimited user customization, subordinate to application permissions, proposal validation, private audiences, current-request authorization and approval rules. Repeated repair/finalization phases reuse that snapshot. Current explicit requests can clarify or override soft personal preferences; no instruction can approve changes, expose another user's data, choose an unauthorized model or give the LLM database-write tools.

Nonempty instructions disable direct search tools on the full-context planner. Isolated public research still accepts validated minimal public subjects; public interests can guide recommendations without sending the raw instruction block. Sensitive identifier/booking-secret/private-context checks also consider instructions. Research helpers, image extraction, Calendar venue lookup, disruption and feedback workers do not load personal instruction text. This reduces leakage but cannot perfectly classify arbitrary free text; users should not put secrets in this field.

Ordinary PostgreSQL-owned conversation tails, summaries, draft continuation and saved-answer recovery remain. No provider thread IDs or new automatic memory system is introduced. The model no longer produces durable preference candidates or preference mutation receipts.

This separation follows [OpenAI's guidance on untrusted input and instruction authority](https://developers.openai.com/api/docs/guides/agent-builder-safety): user customization is data supplied to the application-controlled planner, not trusted application policy. Deterministic authorization remains necessary regardless of model output.

## Removal and historical data

Migration `0049_custom_ai_instructions.sql` removed 13 preference-only tables and eight dedicated functions explicitly, without CASCADE, including structured profiles, revision snapshots and catalog/import evidence. Applied migrations 0001, 0014–0017 and 0043 remain immutable history. The current migration inventory is in [database](DATABASE.md). Do not reuse or renumber applied migrations.

Legacy preference-only conversations are closed and permanently read-only. Their immutable purpose marker remains only to prevent old preference text being resumed as trip-change authority; it is not an active preference schema or save capability. New preference conversations, reopening and stale submissions are rejected in code and database. Ordinary trip chats/checkpoints, AI audit/history, request images, trip selection, itinerary, expenses, repayments and membership are preserved.

Removed facts may still occur in historical chat text, audit records, previous Git history or database backups. This is removal of the active structured preference system, not a claim of total historical erasure. Do not delete ordinary chats or rewrite backups/Git history under this migration. Backup retention is unaffected.

## Verification and operations

Use synthetic fixtures only: upgrade a populated pre-0049 schema, verify exact table/function absence and unrelated-record preservation, deliberately add an unexpected dependency to prove the no-CASCADE migration aborts atomically, test read-only legacy chats, test self-only/CAS/concurrent/clear saves, both-provider instruction inclusion, isolated public research, identity races and four-locale phone controls. `pnpm check` must pass against an exact fresh disposable database; no real traveler replay or paid model evaluation is needed.

Migration 0049 is destructive. Never run a preference-dependent build against a database that has applied it. Before applying future migrations or restoring, take a fresh backup, confirm it restores and review the exact target database; never automatically restore an old database over later user writes. Backup, restore and migration rules are in [database](DATABASE.md); deployment is covered in [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).
