# Localization, product names and voice

Cross-feature rules belong here; feature docs own their detailed labels and behavior.

## 0. Product names

- English/technical: **Stardust Itinerary**.
- Cantonese: **星塵遠征軍**.
- Japanese: **スターダスト・イティネラリー**.
- Simplified Chinese: **星尘远征军**; Traditional Chinese: **星塵遠征軍**.
- The other added languages keep **Stardust Itinerary** (D-096).

## 1. Locales

| Route | Meaning |
| --- | --- |
| `en` | English; documentation/source copy |
| `zh-HK` | Clear Hong Kong Cantonese |
| `zh-HK-lihkg` | Cantonese tone pack, displayed as **廣東話(辛辣)** |
| `ja-JP` | Japanese |
| `zh-CN` | Simplified Chinese (mainland China) |
| `zh-TW` | Traditional Chinese (Taiwan), written standard Mandarin, not Cantonese |
| `es` | Spanish (neutral, tú) |
| `pt-BR` | Brazilian Portuguese |
| `fr` | French |
| `de` | German |
| `ru` | Russian |
| `id` | Indonesian |

`zh-HK-lihkg` is an internal tone identifier, not a standard locale tag. English is the initial default; `DEFAULT_LOCALE` no longer overrides it. Explicit language selections persist in a browser cookie and, for authenticated trip/onboarding identities, the account's `preferred_locale`. The root resolves account choice, then browser choice, then English. Google sign-in restores the Google account's choice (English if unset), never adopting a guest's preference. Visiting a localized URL does not itself save a preference. Date/number formatting uses the underlying valid locale; HTML language is `zh-HK` for the tone variant. A selected language changes display, not the trip's IANA time zone, money or access rules.

### Current implementation

Use the existing catalog/helper for each surface, with tests for every choice. Both Cantonese variants share neutral copy for money, identity, consent, privacy, errors, reliability, safety and review actions.

| Surface | Required behavior and detailed contract |
| --- | --- |
| Trip creation/settings | Localized zone/currency choices; Auto/detected/manual and failed-lookup states; explicit old/new trip-date confirmation. Allowlisted country/zone labels, not arbitrary model text. [Defaults](TRIP_DESTINATION_DEFAULTS.md) |
| Navigation/layout | Short phone labels, localized full accessible day names, `Intl` dates, script-aware fonts. Overview has no previous/next text buttons; chips and swipe change the day. [Layout](UI_LAYOUTS.md) |
| Events/approvals | Neutral short Edit/Approve/Reject labels stay on one horizontal row. Transport endpoints, optional end/duration, Now, cancelled status and review conflicts remain explicit. [Cards](MOBILE_CARDS.md) |
| Expenses/repayments | Personal portion versus whole bill/payer must stay distinct. Equal/custom shares, exact allocation errors, pending status and recorded-not-transferred payments use neutral language and readable amounts. [Expenses](TRIP_EXPENSES.md), [payments](MEMBER_PAYMENTS.md) |
| AI/history | The validated route locale controls new generated answers/reasons. Recovery has distinct processing, reconnecting, failed and quota states. Saved replies remain in their original language; opening history never calls a model to translate. [Recovery](AI_REQUEST_RECOVERY.md) |
| Instructions/history | Settings says in one line that instructions are private but owners can see AI request logs, beside manual Save/Clear. Retired preference chats say read-only and cannot resume. [Instructions](AI_CUSTOM_INSTRUCTIONS.md) |
| Research | Distinguish source-backed results, unverified information, genuine conflicts and completion failure. Unknown opening hours use informational wording, not a closure warning. Preserve useful venue spelling, dates, currency/units, uncertainty and safe public links. [Hours](AI_VENUE_HOURS.md), [prices](AI_BOOKING_PRICES.md) |
| Calendar | Source titles/places stay authored. All-day source dates and timed trip-zone dates stay distinct. Explicit actions show progress/error/outcome; automatic reads do not show syncing prose or passive failures. [Imports](CALENDAR_IMPORT.md) |
| Map/weather/offline | Short Directions links; visible icons/times with localized accessible mode/distance labels. State unresolved locations and approximate weather honestly. Offline/privacy/recovery notices remain neutral. [Map](DAILY_MAP.md) |
| Disruptions | Translate bodies as well as labels from observation-bound `en`/`zh-HK`/`ja-JP` text. Spicy Cantonese uses neutral safety text. Missing translations show a neutral fallback plus original; viewing cannot regenerate evidence or trigger repeat notifications. [Localization](DISRUPTION_LOCALIZATION.md) |
| Feedback/activity | Ten-minute diagnostics, the review notice behind the form's "?" button, and operator states are localized. Submitted feedback remains authored; developer issue templates use English with attributed excerpts. [Feedback](FEEDBACK.md), [Activity](ACTIVITY.md) |

Original trip/event/venue/member names, addresses, notes, account email hints and submitted instructions are preserved. Locale selection does not silently translate canonical traveler data; an explicit canonical-content translation is a separately audited maintenance change, not general behavior. General on-demand content translation and complete owner-operational surface localization are not implied by this contract.

Reservation-expense clarification is a neutral money surface. Missing essential dates/amounts or ambiguous members ask for clarification. A tentative requester payer is allowed only with disclosed assumptions, never described as confirmed payment. Natural answers may complete an exact-identity, unexpired application-owned draft; ordinary history, pure lookup or a fulfilled/expired draft cannot authorize a mutation. See [bounded clarification drafts](AI_AND_AGENTS.md#bounded-clarification-drafts).

### Added languages (JOB-084)

The eight languages added in [D-096](DECISIONS.md) are translation packs, not code:

- **Packs:** one JSON file per language in `src/lib/locale-packs/`, keyed by section. Each section translates one English catalog, with the same keys, lists and placeholders.
- **Reading text:** catalog code calls `localizedCatalog(locale, section, { en, "zh-HK": ..., "ja-JP": ... })`. The four original locales get their own catalog; an added language gets the English catalog with its pack laid over it, so a gap shows English.
- **Loading (JOB-085, D-097):** the server bundles every pack (`store.ts`); browser code bundles none.
  - The `turbopack.resolveAlias` entry in `next.config.ts` swaps in the empty `store.browser.ts` for client builds. The alias is Turbopack's, the default build: a webpack build would still work but would bundle every pack, and the smoke test would fail it.
  - A page in an added language passes `localePack(locale)` to `LocalePackScope`, which installs the pack before anything below it renders.
  - A record built when a module loads, such as `messages`, must read the added languages lazily, through `withPackLocales`.
  - A new page that renders localized client components must wrap them in `LocalePackScope`.
  - The smoke test fails the build if a pack's text reaches browser code.
- **Menus:** both language menus list English first (`menuLocales`), then the other languages.
- **The section list:** `catalogs.ts` names every section and its English catalog. The pack tests fail when code reads a section missing there, or when a pack misses a string, changes a placeholder or leaves an English sentence.
- **Adding or changing English copy:** add the same key to every pack; for a new catalog, add its section to `catalogs.ts` and every pack.
- **Terms:** AI is written as each language usually writes it: IA in Spanish, Portuguese and French, KI in German and ИИ in Russian. Chinese and Indonesian keep AI. Product names such as OpenAI stay as they are.
- **What follows the language:** AI answers, map labels, and country, time zone and currency names, which come from `Intl`. Disruption details show in English, since the monitor writes English, Cantonese and Japanese only.

## 2. Engineering rules

- Keep copy brief (D-088). A note is one short line or none, with no internal mechanics. An error or confirmation says what happened and what to do in one or two short sentences. An explanation someone may want, about privacy or money, goes behind one "?" button (`src/components/info-tip.tsx`), at most one per section; the complete detail belongs in the privacy notice and the docs. Review copy wherever it lives, not only in `*i18n.ts` files: `src/lib/expense-copy.ts` and some components keep their own copy objects.
- In English, prefer full forms ("could not", "cannot") to contractions, as the existing copy does.
- Give every English count a singular form: an `…One` message beside the plural, chosen by `countLabel` (`src/lib/i18n.ts`), so one reads "1 expense", never "1 expenses" or "expense(s)". Cantonese, Japanese, both Chinese packs and Indonesian use the same text for both. The app only picks between one and other, so Russian writes counted words as "label: number"; French and Portuguese use the plural for zero.
- Keep English keys/code identifiers and parameterized messages; do not concatenate translated sentence fragments.
- Format dates, times, numbers and currency with locale-aware helpers, preserving exact integer monetary values. Language selection cannot change an allocation.
- Store IANA time zones, not translated labels. Transport endpoint timing and optional unknown ends must not become guessed travel/departure estimates.
- All event clocks use their location/endpoint zone and localized short zone label; show the local date when it differs from the trip date. Unknown zones explicitly use the localized Trip time fallback. Auto, zone controls and DST errors are translated in all twelve locales. [Event-local time contract](EVENT_LOCAL_TIME.md).
- Preserve user names/content unless an explicit authorized change follows normal revision/audit rules.
- Test placeholder parity, missing keys, narrow phone/CJK wrapping, 44px targets and 16px form inputs. Accessible names must contain visible labels and include necessary context.
- Verify Chinese, Japanese and Cyrillic font coverage and first-paint language behavior; Simplified and Taiwanese Chinese have their own font stacks. Do not convey financial/status meaning through color alone.
- Future Discord or other notification templates should reuse locale catalogs; those planned integrations are not current delivery channels.

## 3. Tone policy

The selectable LIHKG tone is deliberately sarcastic on eligible casual surfaces. It may mock a situation or the group's disorganization, but not a person's protected characteristics, disability, medical needs, finances, private preferences or other vulnerability. No threats, sexual explicitness, hateful content or slang that hides the required action.

Always use clear neutral Cantonese for:

- login, invitations, identity, permissions and security;
- money, allocations, repayment, refunds, approvals and destructive confirmations;
- safety, weather, closure, missed transport, accessibility and medical information;
- privacy, consent, export/deletion, errors and reliability guidance.

Trip deletion copy (`src/lib/app/trip-deletion-i18n.ts`) follows this rule: both Cantonese modes share one neutral text. So do AI key, billing and key-sharing copy (`src/lib/ai/keys-i18n.ts`) guest-account deletion copy (`src/lib/app/guest-i18n.ts`) and flight details copy (`src/lib/app/flight-i18n.ts`).

Japanese safety/money copy likewise stays direct and polite. Casual post-save financial acknowledgements are not an exception.

A certainly trip-unrelated ordinary request may receive playful scope guidance only within the deterministic allowed categories. Generic coding stays neutral unless the complete benign request matches the small allowlist; finance/relationship or protected/high-risk contexts stay neutral. Ambiguous requests or concrete travel context proceed to planning rather than an insulting rejection. Provider safety handling remains independent of this tone policy.

### LIHKG voice examples

| Casual situation | Example |
| --- | --- |
| Another plan change | 又改？得啦，幫你執多次，今次真係咪再玩 |
| Empty day | 今日成張白紙，管理員係咪又冇做嘢 |

These are tone examples, not required replacement strings. Approval, money and transport warnings must not borrow them.

## 4. Translation workflow

1. Write concise English source copy with context.
2. Draft clear Cantonese and natural Japanese.
3. Derive spicy variants only for eligible keys; restricted keys must equal neutral Cantonese.
4. Review the critical path and test every locale, placeholders, lengths and phone layouts.
5. For the added languages, translate the new strings in every pack; the pack tests list what is missing.
6. Keep any explicit canonical-content translation revisioned, audited and scoped; preserve original evidence rather than overwriting it as a side effect of viewing.

## 5. Example glossary

| Concept | English guidance | Cantonese | Japanese |
| --- | --- | --- | --- |
| Itinerary | Compact plan labels; phone tab matches Itinerary title | 行程 | 旅程 |
| Planned start | Event start, not a computed departure estimate | 預定時間 | 予定時刻 |
| Starts in | Countdown to stored start | 距離開始 | 開始まで |
| Transport departure | Stored route start | 出發 | 出発 |
| Transport arrival | Stored route end | 到達 | 到着 |
| Trip-area weather estimate | Approximate fallback, not exact venue | 旅程地區概算 | 旅行地域の概算 |
| Possible disruption | Advisory, not certainty | 可能受阻 | 影響の可能性 |
| Offline itinerary | Bounded saved trip-visible display | 離線行程 | オフライン旅程 |
| Owner | Trip administrator, not platform operator | 管理員 | オーナー |
| Admin page | The platform operator's page (JOB-069), not trip ownership | 營運管理 | 運営管理 |
| Share cost | Allocate an expense | 分帳 | 費用を分ける |
| Proposal | Unapplied change request | 建議變更 | 変更案 |

## 6. Content fallback

Follow each catalog's implemented fallback and test missing keys; do not expose raw provider/internal errors as localized copy. User-authored content and saved AI answers remain in their original language. Disruption translation has its own evidence-bound fallback above. Future on-demand AI translations would need source-revision-aware caching and must not be described as already available.
