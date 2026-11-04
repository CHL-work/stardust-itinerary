# Create Trip destination defaults

## Contract

Create Trip starts in **Auto** time-zone mode. Committing a public destination with blur/Enter, or explicitly choosing **Find defaults**, requests a narrow Sol lookup through the Codex SDK. Countries also use the model; a validated 30-day cache entry can avoid another provider call. Opening the form and typing each character do not invoke AI.

Every authenticated account currently eligible to create a trip may use this lookup, including active members of unsponsored trips and a valid pre-trip onboarding identity. Creating a trip grants ownership of that new trip, but does not grant the platform operator's general AI funding privileges. Public signup remains off. Only existing owner-authorized trip-setting paths can change an existing trip; this feature does not add a member settings bypass or a currency migration.

`STARDUST_DESTINATION_LOOKUP` is `creators` by default. `operator` restricts this feature to the verified platform operator; `off` disables model lookup while retaining manual creation. Non-operators have ten uncached admitted requests per account per UTC day. Operators bypass that daily cap, not the thirty-per-hour throttle, one-in-flight protection, provider limits or timeout. Failed admitted provider attempts consume an attempt; cache/replay reads do not invoke the provider again.

## Form and validation

- Auto shows a detected zone instead of requiring a normal-case time-zone choice. **Change time zone** exposes an immediate manual fallback.
- Currency is suggested but remains editable. Manual zone/currency choices are not overwritten by destination changes or late provider replies. The form distinguishes suggested values from manual choices.
- Unknown, ambiguous, unsupported or unavailable results ask for an explicit supported choice. An unsupported local currency is never silently rounded into the ledger's existing currency set.
- Stale replies are discarded when destination or request generation changes. Replies contain labels for all four locales; switching language renders the current locale without another costly lookup or stale-language prose. A lookup never submits the form or creates a trip. The final explicit Create action is still required.
- The creation API requires explicit validated `timeZone` and `defaultCurrency`. Strict IANA validation rejects abbreviations/offsets such as `EST` and `GMT+9`, preserves recognized IANA aliases, and is scoped to creation rather than silently changing old Settings semantics.
- All four UI languages use neutral transactional wording. The classic layout remains functional; its retirement is planned separately (see [screen layouts](UI_LAYOUTS.md)).

## Trust, privacy and accounting

The provider receives only a short public destination and locale, never account identity, trip content, personal AI instructions, contacts, receipts or secrets. Obvious credential/booking/private prose is rejected. Destination text and model JSON are untrusted data. Country, zone and currency are checked against pinned/recognized sets, with a fixed country resolver/table used for validation rather than an Auto shortcut.

The pinned Codex SDK runs Sol at low effort, without tools or web search, in a temporary read-only workspace with a 20-second end-to-end deadline and bounded output. Its narrow environment forwards only the operator's OpenAI API key (`CODEX_API_KEY`/`OPENAI_API_KEY`) and runtime settings, never base-URL overrides or application, database or Google secrets, and the Codex configuration forces API-key login. The provider resolves the release's exact native CLI, performs bounded metadata-only MCP inventory, explicitly disables every inherited entry and verifies zero enabled servers before inference; an empty `mcp_servers={}` alone does not disable inherited servers in the pinned CLI (0.165.0). It also suppresses inherited instructions/skills/plugins/hooks and uses a fixed public instruction file in its temporary workspace; no authentication file is copied or global configuration changed. There is no fallback to another provider, retry loop, canonical write tool or provider thread memory.

Migration `0050_account_ai_lookups.sql` stores account-scoped admission/outcome/usage records and a versioned 30-day cache. Admission metadata is immutable. Admission and completion recheck the authenticated principal; database transactions and account locks are not held during model execution. Removed/revoked identities do not receive a late completion. Unknown usage stays unknown, not zero and not an invented monetary price. These records are operator-visible operational data, not another trip owner's conversation history.

An optional `destinationLookupId` in explicit trip creation links only an authorized matching lookup to the creation audit. Suggested values never override submitted manual choices or grant authority to create. Existing create quotas, membership limits and approval policies remain unchanged.

## Navigation and upgrade

The live Overview has no previous/next-date text buttons in any locale or layout. The classic date selector, new-layout day chips, phone swipe and offline day navigation remain.

Migration 0050 is additive. Take a backup before applying it; if the application connects with a separate runtime database role, re-apply that role's grants afterwards. Backup, restore and migration rules are in [database](DATABASE.md); deployment is covered in [deployment](DEPLOYMENT.md) and [self-hosting](SELF_HOSTING.md).
