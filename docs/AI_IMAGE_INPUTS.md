# Private AI picture imports

Free AI is text-only (JOB-086). Selecting it disables adding pictures but keeps retained drafts removable. Explicit free submissions are rejected before image decoding; default-free submissions are also rejected at admission before storage or a provider call. It never silently uses a paid model to process them. The paid-provider contract below is unchanged.

Preference conversations and their picture/text composers have been removed. Legacy preference-only conversations remain read-only history and cannot be resumed or accept attachments. Ordinary trip-planning picture selection, extraction, history and unsent-picture switch confirmation remain. Personal AI instructions are explicitly edited in Settings, never collected from pictures or chats. The admitted request's instruction snapshot enters only the planning phases; image extraction receives no saved instruction text and cannot alter it. See [personal instructions](AI_CUSTOM_INSTRUCTIONS.md).

Extraction keeps each booking/menu row's branch, service, duration, date/time and labeled price together. Unknown is not zero and a published tariff is not a receipt total. Eligible public price research happens only in the separate bounded researcher, never image extraction; the existing private-context gates remain. The planner receives the count of new attachments, reuses selected earlier facts and must not claim an upload failed solely because none arrived. See [booking prices](AI_BOOKING_PRICES.md).

The shared image-request work budget is 225 seconds, with extraction capped at 45 seconds. The browser allows up to 245 seconds for POST delivery, with a 300-second route ceiling and a ten-minute in-flight fence; provider-free recovery remains independently available. Later public research/final-answer feedback uses the same bounded workflow as text; this does not widen image-derived search permissions, attachment access, storage or approval rules. Old picture conversations are not replayed or rewritten.

Typed provider failures from the initial Claude extraction phase are preserved, so the user sees a rate-limit/setup reason rather than a generic image error. Picture bytes, raw SDK messages and account details are not attached to safe failure metadata. Storage, extraction budgets, identity fences and approval are unaffected; see [provider feedback](AI_PROVIDER_FAILURES.md).

An explicit follow-up can edit an existing authorized pending event through the shared pending-edit operation; it need not create another event or resend a picture. This edits event fields only and preserves existing linked expenses. The pending context contains no picture bytes or linked-expense amounts. Image storage, extraction, identity access and mandatory owner review are unaffected; see [pending edits](AI_PENDING_EVENT_EDITS.md).

Trip-member removal preserves picture bytes and immutable request identity while permanently revoking the removed membership's conversation access. There is no reassignment or owner image-read bypass; other-trip images remain independent. See [retained history](PUBLIC_TRIPS_AND_MEMBERS.md#removing-a-member-safely).

## Use

In the AI tab or quick composer, choose **Add pictures**, select up to three JPEG/PNG/WebP pictures, and write what to create. For example: “Create this hotel stay and expense. DDB paid; split with Pat.” Review previews and send. Selecting a picture alone never submits anything. Both composers support every locale; HEIC/PDF need conversion first.

Pictures can contain bookings, tickets, menus or receipts. Crop irrelevant parts and hide credentials/card details first. AI may misread or ask for missing information. All image-derived changes await owner review, including owner-submitted updates; expense math and canonical writes remain deterministic. Model choice follows the trip's [AI funding rules](PUBLIC_TRIPS_AND_MEMBERS.md#ai-funding-is-not-a-trip-role): only the platform operator acting as a trip owner can select a model; everyone else uses Sol with the trip's daily limit. A submission counts once despite separate extraction/planning calls.

## Input and execution

- Browser originals: at most 20 MiB, 40 million pixels and 16,384 pixels per edge. In-memory normalization produces JPEG, longest edge 2048, at most 2 MiB each. Previews/retry drafts are memory-only; confirmed delivery, conversation/identity/trip changes and sign-out clear them. Reloading loses unsent drafts.
- Authenticated same-origin POST: incrementally bounded 9 MiB JSON, strict image fields, canonical base64, decoded format/pixel/page checks, no SVG/GIF/PDF/animation or URL fetch. Pinned direct sharp dependency re-encodes and strips metadata. No uploaded filename becomes a path or database field.
- Admission: existing bound-user lock, conversation fence, quota and client key precede storage/provider work. Ordered normalized-image SHA-256 digests bind idempotency. Identical uncertain retries return the original request; changed attachments cannot reuse its key.
- Vision: one tool-restricted same-policy-model extraction with a 45-second abort budget. Raw pictures are not given to hosted search. Only bounded visible facts/uncertainties enter the planner; depicted instructions are untrusted data. Detected booking secrets/private management links are redacted, and such image turns cannot enable direct full-context planner search. [Automatic research](AI_AUTOMATIC_RESEARCH.md) may separately look up only a validated latest currency pair under that privacy gate, never image bytes, receipt amounts/dates or traveler details.
- Planning: sanitized facts accompany the explicit typed request. Existing schema/privacy/member/date/math guards apply. Image submissions have a 225-second total work budget, 300-second route ceiling and 245-second initial browser wait; text has 180 seconds of work and a 200-second initial wait. The one eligible public-research round is capped at 90 seconds with a 60-second final-answer reserve from remaining time. Phone recovery never automatically re-POSTs.

Aborts are cooperative, not a durable queue or upstream timing guarantee. Failed requests create no canonical event/expense. Metadata-only extraction events record count, model, text length and reported tokens. Successful extraction/planning usage is summed; unknown failed usage stays null. Image bytes and extracted secrets never enter ordinary logs.

Claude's built-in StructuredOutput serializer is allowed only for schema-valid result data, never filesystem/search actions. SDK metadata is excluded, empty optional hints are dropped and uncertainty text is bounded. Facts and secrets are not silently truncated. Effective-model reporting selects the requested model from SDK accounting rather than an auxiliary model listed first. SDK restrictions are defense-in-depth, not an OS-level isolation guarantee.

## Database, history and retention

Migration 0035 adds immutable normalized JPEG rows linked to an admitted request and write-once bounded image_context_text. Original prompt text stays unchanged. Safe facts enter existing token-budgeted memory/checkpoints and unfulfilled-create drafts: “DDB paid” can reuse a receipt without reuploading or replaying fulfilled changes. Old image bytes are never automatically resubmitted.

GET /api/trips/:tripId/ai/images/:imageId revalidates the exact active member/user and non-revoked conversation, including ordinary archives. Other members and owners browsing another person's chat cannot read it. Responses are private/no-store JPEG with MIME sniffing disabled. Transcript DTOs contain only IDs/dimensions; images load lazily via this endpoint. The service worker bypasses API routes; offline snapshots/localStorage/IndexedDB never contain pictures.

Pictures persist with private audit history, including failed admitted requests. There is no automatic image expiry or delete UI. Database and backup administrators retain administrative access. Full PostgreSQL backups include image bytes and grow accordingly. Per-upload limits are not an aggregate storage quota; monitor database storage and backup size. See [database](DATABASE.md).

Generated extraction temporary directories have bounded cleanup. Claude extraction disables SDK session persistence. The installed Codex SDK has no exposed ephemeral-run option and may retain local rollout/session artifacts in its user profile despite temporary-file cleanup. Provider processing/retention also applies. This feature neither erases upstream records nor prevents the vision provider from seeing secrets left visible in a picture. It uses no additional cloud service, storage bucket, credential or OCR vendor.

## Verification and rollback

Synthetic tests cover bounds/metadata, adapters, storage/history/revocation, retries, draft reuse, token totals and pending approval. Run `pnpm check` against a guarded disposable PostgreSQL database, never a traveler database.

Migration 0035 is additive. On rollback, retain its schema and history; do not delete pictures or disable identity-revocation guards. Any data-deleting retention or rollback needs separate review. Backup, restore and migration rules are in [database](DATABASE.md); deployment is covered in [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).
