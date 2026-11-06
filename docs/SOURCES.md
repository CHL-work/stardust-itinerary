# Research Sources

This is a **dated evidence bibliography**, not setup instructions or current provider eligibility/pricing. Superseded alternatives (retired preference storage, earlier hosting plans) are not deployed or authorized. Follow [current architecture](ARCHITECTURE.md) and the relevant feature contract; hosting is in [self-hosting](SELF_HOSTING.md) and [deployment](DEPLOYMENT.md). Recheck volatile primary sources when a new task depends on them; these external pages were not re-verified when this list was last edited.

## November 6, 2026 admin page and Cloud KMS

Retrieved on 6 November 2026 for JOB-069 (D-084):

- [Workload Identity Federation for GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/workload-identity): with a strict network policy, allow `169.254.169.252/32` on port 988, and on GKE Dataplane V2 also `169.254.169.254/32` on port 80.
- [Identity federation: supported products](https://docs.cloud.google.com/iam/docs/federated-identity-supported-services): Cloud KMS has no known limitations with federated principals.
- [Cloud KMS audit logging](https://docs.cloud.google.com/kms/docs/audit-logging): Encrypt and Decrypt need `DATA_READ` permissions, so they appear only in Data Access logs.
- [Cloud KMS permissions and roles](https://docs.cloud.google.com/kms/docs/reference/permissions-and-roles): the basic roles "do not separate the ability to manage keys from the ability to use the keys", which is why the deny policy is needed.
- [Permissions supported in deny policies](https://docs.cloud.google.com/iam/docs/deny-permissions-support): includes `cloudkms.googleapis.com/cryptoKeyVersions.useToDecrypt` and `useToEncrypt`.
- [Principal identifiers](https://docs.cloud.google.com/iam/docs/principal-identifiers): GKE workload identities appear only among allow-policy principals, which is why a service account stands in for the web server.
- A live check against the instance's key: a synthetic secret sealed and opened, binding to another account was refused, and after the deny policy the project owner was refused.

## November 5, 2026 off-site copy

- [Neon plans](https://neon.com/docs/introduction/plans) (page updated 4 November 2026) and [the 1 GB free-plan announcement](https://neon.com/blog/neon-free-plan-1-gb-per-project) (2 October 2026): per project, 1 GB of storage, 100 CU-hours a month, 5 GB of public network transfer, a 6-hour restore window, scale to zero after 5 minutes; usage over a limit suspends the compute or fails writes, and deletes nothing. These are dated planning figures, not promises.
- [PostgreSQL `pg_export_snapshot` and snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION) and [`pg_dump --snapshot`](https://www.postgresql.org/docs/current/app-pgdump.html): the dump and the row counts read the same snapshot.
- [libpq `sslrootcert=system`](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLROOTCERT): certificate checks against the system's trusted roots.

## October 28, 2026 destination defaults review

- [Official Codex SDK](https://developers.openai.com/codex/sdk/) and [authentication](https://developers.openai.com/codex/auth/): reviewed the documented SDK authentication used by the destination lookup. The implementation is pinned to SDK 0.165.0 and passes the lookup subprocess no API-key or base-URL overrides. This is a narrow lookup, not a new auth product or connector.
- [Unicode CLDR currencyData pinned revision](https://github.com/unicode-org/cldr-json/blob/a198dbf17e1d2314a76b84b30904b87a5f8618bb/cldr-json/cldr-core/supplemental/currencyData.json): pinned country/territory currency facts used for validation, never an expansion of ledger currency precision. SIX ISO4217 amendment180 confirms Bulgaria's EUR transition on January1,2026; archived/non-tender codes are not suggestions. See source comments/tests in `region-currencies.ts`.
- Runtime ICU supplies recognized IANA zones and localized labels; the database integration suite checks every selectable zone against PostgreSQL's zone catalog. No paid geocoding, exchange-rate conversion or live web search is introduced.
- [Official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference): instruction overrides, project document bounds and MCP enablement. Empty MCP tables merge with, rather than disable, inherited entries, so the implementation explicitly disables and verifies them without executing servers or making a model call during that check.

## Manual AI instructions (October 7, 2026)

[OpenAI agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety) recommends keeping untrusted user values out of trusted developer messages and validating structured boundaries. The planner therefore treats Settings instructions as lower-trust user customization inside the planner context, not an application-policy replacement. Self-only deterministic APIs, schema validation, approval checks and isolated public-helper inputs remain authoritative; no provider-owned memory is introduced. See [implementation contract](AI_CUSTOM_INSTRUCTIONS.md).

## Selected MapLibre/OSM implementation (October 7, 2026)

Checked [MapLibre raster sources](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [Photon public demo policy](https://github.com/komoot/photon#demo-server) and [FOSSGIS OSRM usage](https://routing.openstreetmap.de/about.html). Modest public requests, attribution, identifying headers, caching and one request/second/provider limits are implemented; no bulk/offline use, SLA or Japan transit source is claimed. FOSSGIS's linked German policy page was blocked by an access challenge; its operator's English excerpt was readable. Google remains a keyless Directions link, not a scraped data source. See [current contract](DAILY_MAP.md).

## Minimal map overlays and provider choice (September 29, 2026)

Checked [MapLibre custom HTML markers](https://maplibre.org/maplibre-gl-js/docs/examples/custom-marker-icons/), [PMTiles concepts](https://docs.protomaps.com/pmtiles/), [Google polyline arrows](https://developers.google.com/maps/documentation/javascript/examples/overlay-symbol-arrow) and [custom overlays](https://developers.google.com/maps/documentation/javascript/customoverlays). Both renderers can support application-owned icon/time labels; routing data is a separate service. [Google Maps billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing) and [Routes billing](https://developers.google.com/maps/documentation/routes/usage-and-billing) are separate. The [Google FAQ](https://developers.google.com/maps/faq#transit_directions_countries) excludes Japan transit from Routes API; its [Static image restriction](https://developers.google.com/maps/faq#tos_staticmaps_reuse) requires direct image delivery, so the retained proxy must not be activated without redesign/review. Self-hosting OSM-derived data is a recommendation, not a configured service or claim of zero infrastructure cost.

## Map-only follow-up (September 28, 2026)

Checked [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) for keyless explicit-endpoint directions with optional travel mode; [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) and [public Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) for community-service restrictions. These references are not authorization for unlimited free production use. No community provider or self-hosted data stack was activated. The numeric callout contract is presentation-only until a real permitted source/cache is configured; see [current limits](DAILY_MAP.md).

## Daily Google map (September 27, 2026)

Checked Google's [Maps Static overview](https://developers.google.com/maps/documentation/maps-static/overview), [Places Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [API security guidance](https://developers.google.com/maps/api-security-best-practices) and [Static URL signing](https://developers.google.com/maps/documentation/maps-static/digital-signature). Server-only credentials, explicit private opt-in and conservative no-cache/no-shortlink-fetch behavior are application decisions. Billing/key setup, public terms/privacy and attribution requirements remain operator prerequisites. See [map contract](DAILY_MAP.md).

## Daily issue-only feedback review (September 20, 2026 UTC)

Inspected the installed Codex SDK and current official [SDK](https://developers.openai.com/codex/sdk/), [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra) and [GitHub issue creation](https://docs.github.com/en/rest/issues/issues#create-an-issue) documentation. The reviewer uses a structured, no-tool operation; the separate publisher reads the configured repository's metadata to confirm it is private, then uses its Issues endpoint with minimum Issues permissions. Consent, redaction, UTC daily admission, duplicate linkage, immutable delivery markers and conservative uncertain-POST reconciliation are application safety decisions, not provider guarantees. No coding-agent execution or live synthetic GitHub issue is used for verification. See [feedback contract](FEEDBACK.md).

## Structured preference operations (September 20, 2026 UTC)

Checked [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), including strict schemas and the need to handle refusals and semantic mistakes. A strict operation envelope plus independently validated bounded generic values fits the existing provider-neutral adapters; schema correctness is not authorization or a guarantee of accurate preference interpretation. Immutable purpose, private current-state/revision checks, no-search/no-trip-write execution and user correction controls are application rules. No provider/model/authentication migration is introduced. See [preference design](AI_PREFERENCE_CONVERSATIONS.md).

## Personal Calendar import (September 16, 2026)

Checked Google's [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events) and [Events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list): date-only/exclusive ends, per-instance event identity and expanded recurring instances inform deterministic imports. Official [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) and [security documentation](https://learn.chatgpt.com/docs/security), alongside installed SDK types and existing isolated adapters, inform tool-restricted public venue lookup. Schema conformity/search evidence do not guarantee an accurate address; the human reviews the proposed place/source/Maps link. Remaining limits are in [Calendar import](CALENDAR_IMPORT.md).

## Booking-price evidence (September 14, 2026)

The contract follows [OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) on explicit missing-input handling, schema consistency and remaining model errors, and [function-calling guidance](https://developers.openai.com/api/docs/guides/function-calling) on precise tool inputs and code-owned checks. Source-bound tariff validation does not independently prove the model read a page correctly or establish a final charge. No model migration; verification uses synthetic fixtures and a separately opt-in ordinary public target. See [contract](AI_BOOKING_PRICES.md).

Primary references checked for this design through 2026-09-12. Product terms, prices, model names, venue details, and free tiers can change; implementation jobs must verify them again.

## Exact expense proposal contract (September 12, 2026)

Rechecked [OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs), including its warning that structured outputs can still contain mistakes and its recommendation to avoid schema/type divergence. The app extends its existing schema-derived contract, then deterministically validates exact member sets and integer totals before saving proposals. Equal defaults, custom shares, zero responsibility and owner approval are Stardust product rules, not provider guarantees. No model, SDK, authentication or search change, or live provider call, was needed for this feature.

## Bounded research completion (September 12, 2026)

Rechecked [OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) and [retrieval/grounding guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5). These support explicit staged output contracts and source-backed completion, not a model migration or a guarantee that a well-formed reply is factually correct. The installed official Claude Agent SDK `Query` declaration documents `close()` as disposing its underlying process, pending requests and transports; the application's abort-aware lifecycle uses that method and tests stalled iteration, exactly-once close and primary-error preservation without provider calls. The 180/225-second overall work budget, 90-second research cap, 60-second composition reserve and independent cleanup audit are Stardust application decisions. Synthetic full-pipeline evaluation design is not evidence of live success. The dated venue/source evidence below remains a historical record.

## Reused venue-hours evidence (September 10, 2026)

Rechecked [OpenAI retrieval/grounding guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5), [web-search execution and citations](https://developers.openai.com/api/docs/guides/tools-web-search), and [strict structured-output requirements](https://developers.openai.com/api/docs/guides/structured-outputs). These informed bounded reuse, explicit missing evidence and required wire fields, not a model migration. The [official THEキャラ campaign article](https://www.the-chara.com/blog/?p=119155), published September 1, lists a September 4–29 campaign at the 5F shop and weekday 11:00–20:00 hours, distinct from a separate kiosk. This supports the synthetic September 10 afternoon fixture and preserving the exact public article ID; no venue hours are hardcoded or actual admission guaranteed.

## AI provider failures (September 9, 2026)

Provider-failure handling was checked September 9 against installed official Claude Agent SDK 0.3.240 declarations (`SDKAssistantMessageError`, `SDKRateLimitEvent`, `SDKResultMessage`) and synthetic tool-free SDK results, including terminal `success` plus `is_error: true`. The [official Claude Agent SDK plan-usage guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) and [official Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk) informed supported connection checks. No real prompt/booking was replayed. The installed declarations and observed typed events, not free-text matching, are the error-classification authority.

## Disruption qualification (September 9, 2026)

Rechecked the [OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) on September 9, 2026: schema-conforming responses can still contain mistakes. This informed explicit impact facts, application-side eligibility checks and synthetic failure/positive cases. High confidence is not a calibrated probability; the 30-minute minimum and direct-impact suppression rules are local product policy. See [disruption qualification](DISRUPTION_CONFIDENCE.md).

## Venue-hours verification (September 7, 2026)

Venue-hours references checked on September 7, 2026: [OpenAI grounding/retrieval budgets](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5), [web-search evidence/citations](https://developers.openai.com/api/docs/guides/tools-web-search), [Claude pre-tool hooks](https://code.claude.com/docs/en/agent-sdk/hooks), and [venue-confirmed 丸五 hours](https://www.gltjp.com/ja/directory/item/17058/). These informed isolated search, explicit uncertainty and a live public closure fixture; no restaurant schedule or model migration is hardcoded. See [evidence limits](AI_VENUE_HOURS.md).

## Anthropic

- [Claude Agent SDK usage with a Claude plan — June 15 update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Claude Code and Agent SDK authentication](https://code.claude.com/docs/en/authentication)
- [Paid Claude plans and API/Console billing are separate](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console)
- [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)
- [Claude model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Messages API TypeScript reference and usage fields](https://platform.claude.com/docs/en/api/typescript/messages)
- [Claude Code routines](https://platform.claude.com/docs/en/api/claude-code/routines-fire)
- [Anthropic context compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [Anthropic memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)

## OpenAI and Google model access

- [OpenAI Codex authentication: ChatGPT subscription or API key](https://learn.chatgpt.com/docs/auth)
- [OpenAI Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [OpenAI Codex pricing and plan access](https://learn.chatgpt.com/docs/pricing)
- [OpenAI GPT-6 Astra model identifier and supported reasoning efforts](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [OpenAI GPT-6.1 Sol model and supported Web search tool](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [model catalog](https://developers.openai.com/api/docs/models) and [Codex models](https://learn.chatgpt.com/docs/models), reviewed 2026-10-31
- [OpenAI conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI structured outputs: handling mistakes and avoiding schema divergence](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI prompt engineering guidance](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [OpenAI long-running conversation and compaction guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5)
- [OpenAI Responses compact operation](https://developers.openai.com/api/reference/java/resources/responses/methods/compact)
- [Claude Agent SDK research-agent example using only `WebSearch`](https://platform.claude.com/cookbook/claude-agent-sdk-00-the-one-liner-research-agent)
- [Gemini CLI authentication](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx)
- [Gemini CLI terms and third-party OAuth restriction](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)
- [Gemini CLI FAQ: third-party tools and OAuth](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md)

## Automatic planning research guidance

- [OpenAI Docs research-over-assumptions guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2) informs the automatic missing-fact lookup and evaluations, not a model migration.
- [OpenAI web-search evidence and citations](https://developers.openai.com/api/docs/guides/tools-web-search) distinguishes observed execution from supported claims; the SDK transport and its documented evidence limits remain unchanged.

## Comparative implementation research

The [OpenAI structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs) was rechecked on 2026-09-07 for pending-event edits. Its shared-schema and semantic-validation guidance informs the pending-event operation contract; schema adherence alone does not prove correct target selection or authorization. The separate pending request identity, revision checks, bounded audience projection and atomic owner-review gate are Stardust application decisions. No provider transport or model policy changed.

The OpenAI conversation-state guide was rechecked on 2026-09-05 for multi-turn clarification. It explains supplying preceding messages to a stateless request and budgeting the context window. Stardust's separate, bounded, identity-bound create draft, root-anchored expiry, and atomic consumption are application design decisions; the guide does not guarantee model memory, semantic correctness, or mutation authorization. The existing Codex and Claude transports are unchanged.

The structured-output and prompt-engineering guides were rechecked on 2026-09-04 for the reservation harness. They support using a shared schema and explicit instructions while retaining application validation; they do not establish semantic correctness, safe financial inference, or permission to execute a booking. Stardust's timestamp-only correction budget and no-tools/unchanged-fields guards are application decisions, not a provider guarantee.

- [OpenCode provider/authentication documentation](https://opencode.ai/docs/providers/)
- [sub2api source and provider-terms warning](https://github.com/Wei-Shaw/sub2api)

OpenCode and sub2api were inspected only for portable adapter, model-routing, refresh-lifecycle, and normalized usage-accounting ideas. Their private endpoint, token relay, or pooled-account techniques are not approved for this application.

## Discord, Telegram, and Signal

- [Discord OAuth2 and permissions](https://docs.discord.com/developers/platform/oauth2-and-permissions)
- [Discord webhooks](https://docs.discord.com/developers/platform/webhooks)
- [Discord server and channel management](https://docs.discord.com/developers/platform/server-and-channel-management)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [signal-cli — unofficial Signal command-line/client interface](https://github.com/AsamK/signal-cli)

## PostgreSQL backups

- [PostgreSQL `pg_dump` custom-format documentation](https://www.postgresql.org/docs/current/app-pgdump.html)
- [PostgreSQL `pg_restore` listing and restore documentation](https://www.postgresql.org/docs/current/app-pgrestore.html)
- [PostgreSQL `pg_isready` connection-status documentation](https://www.postgresql.org/docs/current/app-pg-isready.html)
- [GitHub file limits and large SQL-file guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

## Application runtime

- [Node.js release and LTS schedule](https://nodejs.org/en/about/previous-releases)
- [Next.js installation and requirements](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js deployment options](https://nextjs.org/docs/app/getting-started/deploying)
- [Next.js standalone output and file tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [pnpm workspace settings and `nodeLinker`](https://pnpm.io/settings)
- [Vitest getting started](https://vitest.dev/guide/)
- [GitHub Actions checkout](https://github.com/actions/checkout)
- [GitHub Actions Node.js setup](https://github.com/actions/setup-node)
- [pnpm action setup](https://github.com/pnpm/action-setup)
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [MDN guide to using service workers for offline behavior](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
- [MDN offline and background PWA restrictions](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [MDN `ServiceWorkerRegistration.showNotification()`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification)
- [MDN Background Synchronization API compatibility limitations](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)

## Weather

- [Open-Meteo Weather Forecast API and hourly variables](https://open-meteo.com/en/docs)
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
- [Open-Meteo licence and required CC BY 4.0 attribution](https://open-meteo.com/en/license)
- [Open-Meteo pricing and public/customer endpoint distinction](https://open-meteo.com/en/pricing)

## Identity implementation

- [Google OpenID Connect API reference](https://developers.google.com/identity/openid-connect/reference)
- [Google Auth Platform audience and test-user behavior](https://support.google.com/cloud/answer/15549945)
- [`openid-client` official repository and supported runtime/security policy](https://github.com/panva/openid-client)
- [`openid-client` Authorization Code + PKCE example](https://github.com/panva/openid-client/blob/main/examples/oauth.ts)

## Google Calendar integration

- [Google Calendar Events resource: transparency, self-attendance, event types, private properties, and exclusive ends](https://developers.google.com/workspace/calendar/api/v3/reference/events) — checked 2026-09-05; deterministic lodging/import exclusions are separate Stardust policy.
- [Google Calendar API authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google OAuth web-server offline access and incremental authorization](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Calendar private extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties)
- [Google Calendar events list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Google Calendar API error and duplicate-ID behavior](https://developers.google.com/workspace/calendar/api/guides/errors)

## Google Maps and local Tokyo demo venue verification

- [Google Maps URL search actions and recommended `PLACE_NAME, ADDRESS` format](https://developers.google.com/maps/documentation/urls/get-started)
- [Hotel Metropolitan Tokyo Ikebukuro official location](https://tokyo-ikebukuro.hotel-metropolitan.com/access/index.html)
- [Hotel Gracery Shinjuku official address](https://shinjuku.gracery.com/contact-us/)
- [Sunshine Aquarium on the official GO TOKYO guide](https://www.gotokyo.org/en/spot/32/index.html)
- [Hirokiya Shinjuku official store information](https://hirokiya-group.com/shinjuku/ja)
- [Yakiniku Reimen Daiju official store information](https://yonson.jp/)
- [Ningyocho Imahan Ikebukuro Tobu official store information](https://restaurant.imahan.com/ikebukuro-tobu/)
- [Ginza Katsukami official access information](https://katsukami.com/ginza-katsukami_jp_01.html)
- [Pelican Cafe official company and location information](https://www.pelicancafe.jp/company.html)
- [bills Japan official restaurant locations](https://www.billsjapan.com/)

## Secrets and integration credentials

- [GitHub Actions secrets](https://docs.github.com/en/actions/concepts/security/secrets)
- [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [Anthropic authentication and API keys](https://platform.claude.com/docs/en/manage-claude/authentication)
- [Google OAuth web clients](https://support.google.com/cloud/answer/15549257)
- [Google Workload Identity Federation for deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [Discord bot credentials](https://docs.discord.com/developers/quick-start/getting-started)
- [Telegram BotFather and bot tokens](https://core.telegram.org/bots/features#botfather)

## Source-use rules for implementation

September 6, 2026 picture-input implementation: [official Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex image inputs](https://learn.chatgpt.com/docs/image-inputs), [Claude Agent SDK streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), and [sharp input bounds](https://sharp.pixelplumbing.com/api-constructor/) inform the interfaces. Installed types and synthetic checks establish actual app behavior; cleanup is not proof of upstream erasure. See [image inputs](AI_IMAGE_INPUTS.md).

September 5, 2026 search-follow-up verification: [official Codex search configuration](https://learn.chatgpt.com/docs/config-file/config-basic#web-search-mode) distinguishes live from disabled search, and [the official Codex SDK guide](https://learn.chatgpt.com/docs/codex-sdk) documents server-side local-agent integration. Installed SDK types and synthetic provider evaluations establish the application's actual selected-model behavior; configuration alone is not proof that a search executed.

- Prefer official documentation and specifications.
- Record the retrieval date for volatile prices, quotas, models, OAuth scopes, and API fields.
- Do not copy a free-tier figure into code; use configuration and budget dashboards.
- When a provider fact affects safety, billing, or authentication, link the exact source in the relevant architecture decision or pull request.

