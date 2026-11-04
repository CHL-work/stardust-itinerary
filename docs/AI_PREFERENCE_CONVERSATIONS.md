# Retired preference chats: read-only history

Structured preference profiles, media catalogs, extraction/import tooling and preference-chat execution were removed by migration `0049_custom_ai_instructions.sql`. Do not re-enable their old APIs, tables or planner mode. Current customization is the manually saved **Settings → AI instructions** field; see [personal AI instructions](AI_CUSTOM_INSTRUCTIONS.md).

## Retained history

- Existing preference-only conversations remain readable by their authorized original user, under the ordinary history identity checks.
- Their immutable `purpose` marker prevents reopening, new submissions and treating old preference text as trip-change authority. They cannot be resumed as planning conversations.
- Ordinary trip conversations, images, requests, checkpoints and audit history remain. Historical response decoders may recognize then discard obsolete preference receipts; they do not recreate profiles.
- Removed facts may still occur in old chats, audit records, Git history and retained database backups. Removal of the active schema was not a promise of total historical erasure.

## Verification and rollback

Tests must prove read-only legacy chats, rejected creation/resumption/stale submission, normal trip-chat continuity and no replacement-identity access. Never run a pre-0049 preference-dependent app against a migrated database or rewrite applied migration checksums. Backup, restore and migration rules are in [database](DATABASE.md); deployment is covered in [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).
