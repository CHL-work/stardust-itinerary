# The AI tab: usage, routine checks, effort, keys and instructions

The AI tab collects everything about a person's AI use on one page (JOB-093, JOB-094, [D-105](DECISIONS.md), [D-106](DECISIONS.md)). Every section is a native disclosure that collapses, and the browser remembers which sections are open (`stardust.ai-tab.sections` in local storage; no trip or account data).

| Section | Open at first | What it holds |
| --- | --- | --- |
| Chat | yes | The selected conversation, the composer, and the chat effort picker for requests on your own key. |
| Usage | no | 30 days of tokens by service, the estimated cost on your keys, and tables by service and by model. Loads when opened. |
| Routine checks | no | On or off, the model and effort for automatic checks, and a "?" with what the checks do. |
| API keys | no | The [account-owned keys](AI_KEYS.md) editor, moved from Settings. |
| AI instructions | no | The [personal instructions](AI_CUSTOM_INSTRUCTIONS.md) editor, moved from Settings. Leaving the AI tab with unsaved text asks first. |
| Conversations | yes | [Past conversations](AI_CONVERSATION_HISTORY.md). Choosing one opens it in Chat. |

Settings keeps trip-level AI controls for owners under Advanced: AI access (trip model, shared-key model, member limit) and the trip's AI log.

## Usage and estimated cost

`GET /api/trips/{tripId}/ai/usage` returns the signed-in account's last 30 UTC days (`src/lib/ai/usage-summary.ts`):
- requests the account made, with any funding;
- requests members made on a key it shares with them;
- routine checks its own key paid for (system requests that name the paying member);
- create-trip destination lookups it made.

| Service | Request features |
| --- | --- |
| Chat | `planning`, `off_topic`, `policy_denial` |
| Routine checks | `flight_status`, `disruption_monitor` |
| Trip setup | destination lookups (`account_ai_lookups`) |
| Other | anything else, such as Calendar place search |

Tokens are input plus output; Anthropic cache reads are added because Anthropic reports them apart from input. Only requests the account's own keys paid for carry a cost. Free models, a key someone shares with you and the site's own AI show tokens and "—".

Costs come from `src/lib/ai/model-prices.ts`: each registered model's standard input, cached-input and output price per million tokens, with dated windows where a provider announced a change, plus search fees (OpenAI and Anthropic $10 per thousand searches; Google $14 per thousand grounded requests, whose monthly free allowance the estimate ignores). Prices were checked on November 8, 2026 against the providers' pricing pages ([sources](SOURCES.md#november-8-2026-model-prices-and-effort)). The page calls the figure an estimate: the provider's bill is final. Search counts are recorded from migration 0068 on (`ai_requests.web_search_count`), so earlier requests show token costs only.

The chart is a hand-written SVG: 30 stacked daily bars in four validated categorical colors (separately stepped for dark mode), a legend, a tap or hover readout, and the two tables as its accessible equivalent.

## Routine checks on your own key

Routine checks are the [flight status checks](FLIGHT_STATUS.md) and the [disruption monitor](DISRUPTION_CONFIDENCE.md). The operator's keys pay for them only in operator-sponsored trips, from the background worker. In every other trip, a member who turns routine checks on pays with their own key.

**Turning them on.** The section needs a saved key; without one it shows one line asking for a key that can search the web. Choosing the switch runs one live web search on that key with the chosen model and effort (a tiny "today's UTC date" question costing one search and a few hundred tokens). Checks turn on only when the model really searched and answered with today's date. An organization that disabled web search, a key without access to the model, or a refused key leaves them off with a brief reason. The check is rate limited (10 an hour per account; guests 3 a day). A key saved again later must pass the check again before it pays (`account_ai_preferences.routine_verified_at` must not precede the key's `updated_at`).

**Defaults.** Each provider's routine default is a capable, low-cost model at medium effort: `gpt-6.1-terra` (OpenAI), `claude-haiku-5-5` (Anthropic) and `gemini-3.8-flash` (Google). The user may pick any model of a provider they hold a key for, and low, medium or high effort.

**What runs.** With `ROUTINE_CHECKS_ENABLED=true` (on in the public web overlay and in Compose), each web server process starts a loop from `src/instrumentation.ts` that wakes every five minutes and runs a small batch: at most 4 flight checks and 2 trips of disruption checks, finishing within four minutes. Database claims (a flight slot row, the per-trip disruption lock) stop two replicas from checking the same thing twice. Logs carry counts only.

**Who pays.** For each unsponsored trip, one payer: an active member whose account is not suspended, who turned routine checks on, whose saved key matches the model's provider and passed the check. Owners come first, then whoever turned checks on earliest. The trip's own background switch governs only the operator's checks; the member's opt-in replaces it. Checks cover the trip's trip-visible events exactly as before: private, pending, cancelled and completed events are never looked up, and prompts carry only public facts.

**Why the web server.** Users' keys are sealed so that only the web server's identity can decrypt them ([key storage](AI_KEYS.md)). The background worker keeps no access to users' keys or KMS; member-funded checks therefore run inside the web server, which decrypts a key in memory per check, exactly as for a chat request.

**Records.** A member-funded check is a system request (`initiator_kind = 'system'`, no actor) with `credential_source = 'own'`, `credential_member_id` naming the paying member, the chosen provider, transport and model, and `web_search_count`. Its effort and funding are in the `request.started` event. Updates, warnings, audit and Calendar staleness behave exactly as for operator-funded checks. Routine checks do not count toward the own-key daily request cap.

**Providers.** OpenAI runs through the locked-down Codex SDK with live web search; Claude through the Agent SDK with only `WebSearch` and the structured answer allowed by a pre-tool gate that refuses any query naming a private identifier; Gemini through `generateContent` with Google Search grounding and `thinkingLevel`. Every answer goes through the same parsers and qualification rules (`src/lib/ai/routine-check-provider.ts`).

## Effort

`account_ai_preferences.chat_effort` (Default, Low, Medium, High) applies to the main chat request when the requester pays: their own key, or the operator's own requests. Default keeps each model's tuned registry effort (`low` for Sol and every Claude model, `medium` for Astra, Terra and Luna, and Gemini's own default). Shared-key, sponsored and free requests keep their defaults. OpenAI receives `modelReasoningEffort`, Claude `effort` and Gemini `thinkingConfig.thinkingLevel`; every registered paid model accepts the three levels ([sources](SOURCES.md#november-8-2026-model-prices-and-effort)).

`GET`/`PATCH /api/trips/{tripId}/ai/preferences` read and save chat effort and routine settings with a revision check; changes are audited without keys (`ai_preferences`, shown in Activity as a system change).

## Trip setup on your key or a free model

The create-trip destination lookup ([destination defaults](TRIP_DESTINATION_DEFAULTS.md)) runs on:
1. the operator's pinned Codex Sol, for the platform operator;
2. otherwise the requester's own key, first of OpenAI, Anthropic and Google, with that provider's lightest model at low effort (`gpt-6.1-terra`, `claude-haiku-5-5`, `gemini-3.5-flash-lite`); the requester pays, so only the hourly throttle applies;
3. otherwise a free model when free AI is on, within the account's ten lookups a day and 200 free lookups a day per instance;
4. otherwise, on instances without free AI, the earlier operator-funded creator lookup.

Every path is tool-free and returns the same validated JSON; `account_ai_lookups` records the model, provider, transport and `credential_source`.

## Limits

- Estimates use published standard prices, not negotiated rates, batch or priority pricing, long-prompt surcharges or free allowances.
- Routine checks cost the paying member's tokens and searches; a busy trip can run several checks an hour on its departure day. Members can turn checks off at any time.
- There are still no closed-app notifications; warnings appear on events and as optional open-page notifications ([notifications](COMMUNICATIONS.md)).
- Free models cannot search, so they never run routine checks.

## Compatibility and rollback

Migration 0068 is additive: a new `account_ai_preferences` table, nullable `credential_member_id` and `web_search_count` columns on `ai_requests`, and relaxed model/provider checks plus `credential_source` on `account_ai_lookups`. Older builds ignore them. Rolling back the code stops member-funded checks and the new tab; recorded rows stay valid. To stop member-funded checks without a rollback, set `ROUTINE_CHECKS_ENABLED=false` on the web server.
