# Localization, product names and voice

Cross-feature rules belong here; feature docs own their detailed labels and behavior.

## 0. Product names

- English/technical: **Stardust Itinerary**.
- Cantonese: **星塵遠征軍**.
- Japanese: **スターダスト・イティネラリー**.

## 1. Locales

| Route | Meaning |
| --- | --- |
| `en` | English; documentation/source copy |
| `zh-HK` | Clear Hong Kong Cantonese |
| `zh-HK-lihkg` | Cantonese tone pack, displayed as **廣東話(辛辣)** |
| `ja-JP` | Japanese |

`zh-HK-lihkg` is an internal tone identifier, not a standard locale tag. The root route defaults to it unless a valid `DEFAULT_LOCALE` overrides it. Date/number formatting uses the underlying valid locale; HTML language is `zh-HK` for the tone variant. A selected language changes display, not the trip's IANA time zone, money or access rules.

### Current implementation

Use the existing catalog/helper for each surface, with tests for all four choices. Both Cantonese variants share neutral copy for money, identity, consent, privacy, errors, reliability, safety and review actions.

| Surface | Required behavior and detailed contract |
| --- | --- |
| Trip creation/settings | Localized zone/currency choices; Auto/detected/manual and failed-lookup states; explicit old/new trip-date confirmation. Allowlisted country/zone labels, not arbitrary model text. [Defaults](TRIP_DESTINATION_DEFAULTS.md) |
| Navigation/layout | Short phone labels, localized full accessible day names, `Intl` dates, script-aware fonts. Overview has no previous/next text buttons; chips, date selection and swipe change the day. [Layouts](UI_LAYOUTS.md) |
| Events/approvals | Neutral short Edit/Approve/Reject labels stay on one horizontal row. Transport endpoints, optional end/duration, Now, cancelled status and review conflicts remain explicit. [Cards](MOBILE_CARDS.md) |
| Expenses/repayments | Personal portion versus whole bill/payer must stay distinct. Equal/custom shares, exact allocation errors, pending status and recorded-not-transferred payments use neutral language and readable amounts. [Expenses](TRIP_EXPENSES.md), [payments](MEMBER_PAYMENTS.md) |
| AI/history | The validated route locale controls new generated answers/reasons. Recovery has distinct processing, reconnecting, failed and quota states. Saved replies remain in their original language; opening history never calls a model to translate. [Recovery](AI_REQUEST_RECOVERY.md) |
| Instructions/history | Settings explains manual Save/Clear, next-request timing, account scope and owner-audit implications. Retired preference chats say read-only and cannot resume. [Instructions](AI_CUSTOM_INSTRUCTIONS.md) |
| Research | Distinguish source-backed results, unverified information, genuine conflicts and completion failure. Unknown opening hours use informational wording, not a closure warning. Preserve useful venue spelling, dates, currency/units, uncertainty and safe public links. [Hours](AI_VENUE_HOURS.md), [prices](AI_BOOKING_PRICES.md) |
| Calendar | Source titles/places stay authored. All-day source dates and timed trip-zone dates stay distinct. Explicit actions show progress/error/outcome; automatic reads do not show syncing prose or passive failures. [Imports](CALENDAR_IMPORT.md) |
| Map/weather/offline | Short Directions links; visible icons/times with localized accessible mode/distance labels. State unresolved locations and approximate weather honestly. Offline/privacy/recovery notices remain neutral. [Map](DAILY_MAP.md) |
| Disruptions | Translate bodies as well as labels from observation-bound `en`/`zh-HK`/`ja-JP` text. Spicy Cantonese uses neutral safety text. Missing translations show a neutral fallback plus original; viewing cannot regenerate evidence or trigger repeat notifications. [Localization](DISRUPTION_LOCALIZATION.md) |
| Feedback/activity | Ten-minute diagnostics, always-on review notice and operator states are localized. Submitted feedback remains authored; developer issue templates use English with attributed excerpts. [Feedback](FEEDBACK.md), [Activity](ACTIVITY.md) |

Original trip/event/venue/member names, addresses, notes, account email hints and submitted instructions are preserved. Locale selection does not silently translate canonical traveler data; an explicit canonical-content translation is a separately audited maintenance change, not general behavior. General on-demand content translation, saved account locale preferences and complete owner-operational surface localization are not implied by this contract.

Reservation-expense clarification is a neutral money surface. Missing essential dates/amounts or ambiguous members ask for clarification. A tentative requester payer is allowed only with disclosed assumptions, never described as confirmed payment. Natural answers may complete an exact-identity, unexpired application-owned draft; ordinary history, pure lookup or a fulfilled/expired draft cannot authorize a mutation. See [bounded clarification drafts](AI_AND_AGENTS.md#bounded-clarification-drafts).

## 2. Engineering rules

- Keep English keys/code identifiers and parameterized messages; do not concatenate translated sentence fragments.
- Format dates, times, numbers and currency with locale-aware helpers, preserving exact integer monetary values. Language selection cannot change an allocation.
- Store IANA time zones, not translated labels. Transport endpoint timing and optional unknown ends must not become guessed travel/departure estimates.
- Preserve user names/content unless an explicit authorized change follows normal revision/audit rules.
- Test placeholder parity, missing keys, narrow phone/CJK wrapping, 44px targets and 16px form inputs. Accessible names must contain visible labels and include necessary context.
- Verify Traditional Chinese/Japanese font coverage and first-paint language behavior. Do not convey financial/status meaning through color alone.
- Future Discord or other notification templates should reuse locale catalogs; those planned integrations are not current delivery channels.

## 3. Tone policy

The selectable LIHKG tone is deliberately sarcastic on eligible casual surfaces. It may mock a situation or the group's disorganization, but not a person's protected characteristics, disability, medical needs, finances, private preferences or other vulnerability. No threats, sexual explicitness, hateful content or slang that hides the required action.

Always use clear neutral Cantonese for:

- login, invitations, identity, permissions and security;
- money, allocations, repayment, refunds, approvals and destructive confirmations;
- safety, weather, closure, missed transport, accessibility and medical information;
- privacy, consent, export/deletion, errors and reliability guidance.

Trip deletion copy (`src/lib/app/trip-deletion-i18n.ts`) follows this rule: both Cantonese modes share one neutral text. So do AI key, billing and key-sharing copy (`src/lib/ai/keys-i18n.ts`) and guest-account deletion copy (`src/lib/app/guest-i18n.ts`).

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
4. Review the critical path and test all four locales, placeholders, lengths and phone layouts.
5. Keep any explicit canonical-content translation revisioned, audited and scoped; preserve original evidence rather than overwriting it as a side effect of viewing.

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
