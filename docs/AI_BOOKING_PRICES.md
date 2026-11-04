# Source-backed booking prices

A dedicated `price` subject extends the provider-neutral isolated researcher. It supports ordinary travel purchases and non-sexual wellness/massage tariffs. It does not book, pay, retrieve private confirmations or provide targeted sexual-service pricing.

## User workflow

Ask for the published price of a named public business/branch or attach an ordinary booking and ask for its cost. The AI preserves each booking's service, duration and date/time separately. An image with no amount remains a usable booking with an unknown price, not a zero-price booking. A short follow-up can reuse sanitized facts from the selected unfulfilled draft; a new attachment is not required merely to answer a missing detail.

The planner is instructed to request public tariff research before asking the user to find an eligible public price. Group all service/duration tiers for one branch into one target. The default `date=null` requests currently applicable published tariffs, not the user's appointment date. Exact branch/course/duration, unit and conditions must match before presenting a booking estimate. Unsupported bookings remain individually unknown; a known tier is never scaled to invent another duration. Lookup alone authorizes no event or expense.

In the selected language, show the service/duration, published currency/unit, material fees or unknowns and source link. All financial language remains neutral in both Cantonese tones. New responses may improve; saved old conversations are not rewritten.

## Evidence contract

`PublicResearchFact.priceQuotes` carries up to 12 source-backed rows for one exact `price` target. Each row contains:

- Public service label, optional duration in minutes, supported ISO currency and nonnegative exact integer `baseFeeMinor`.
- Price unit (`per_person`, `per_group`, `per_item`, `per_night`, `per_hour`, `per_session`, `package`, or `unknown`) and tax status.
- Up to eight mandatory/optional/unknown fee components, each with a known integer amount or explicit null plus conditions.
- Applicability conditions, exact accepted source link and optional validity dates.

The strict provider wire schema requires `priceQuotes` on every fact (`[]` for other kinds); legacy facts without it still parse. A price fact without usable structured quotes is unverified. Existing exact target/subject/date identity, observed per-target search and public HTTPS source gates apply. Quote links must belong to that fact's accepted sources; safe integer, currency, date and duplicate checks run in code. Non-price facts cannot smuggle quotes into final planning. Current-date applicability uses the research request's UTC reference date when no date was requested.

These checks validate evidence structure and provenance associations, not independent truth: the same selected model still extracts the pages. The bounded search can miss a page or fail to establish a tariff. No hallucination-free, exhaustive or final-charge guarantee is made.

Price-currency precision is deliberately limited to whole-unit JPY/KRW and ISO currencies with two fraction digits, matching the existing supported amount representation. Other precision regimes (for example three-digit KWD or zero-digit VND) remain unverified rather than being divided by the wrong factor. Invalid/stale tiers do not hide independently valid ones; conflicting duplicate tiers are not arbitrarily selected. Price-fact prose cannot revive a rejected tier: accepted structured quotes are the price evidence.

## Money and privacy boundaries

Quotes are published estimates, not receipts or final liabilities. Unknown/excluded tax, unknown mandatory fees, unspecified quantities, conditional promotions or from-prices cannot establish an all-in charge. Neither the researcher nor deterministic assessor computes a bill, interpolates duration, selects add-ons or performs currency conversion. Explicitly free may be displayed, but the positive-amount ledger cannot receive a zero expense.

The planner must use the user's confirmed paid/owed total, including an explicit clarification of an open create draft, before proposing a charge. That amount wins over public menu prices. If a combined event-plus-expense request still lacks a confirmed amount, ask one focused clarification and hold the affected create; do not silently drop its expense. Event-only creation remains possible when explicitly requested. All normal schema, exact member/split, draft expiry/replay, privacy and owner-approval checks still apply. The distinction between an estimate and the user's confirmation is prompt-guided interpretation; there is no ledger estimate field or deterministic natural-language payment classifier.

Private-context/no-search gates are unchanged. Only the already-approved latest currency-pair exception can pass the privacy-limited gate; `price` cannot. Public targets exclude member names, identifiers, known private event labels, booking links and images. A separate public-only lookup may be needed when an import contains private identifiers or explicitly private context. No real traveler booking is used as a source-code fixture or provider smoke input. Narrow explicit unsupported-service text checks are defense in depth, not a complete semantic classifier.

`TRIP_CONTEXT_JSON.currentRequest.imageCount` records only the number of new attachments received. Zero is not evidence of an upload/network failure. The model must reuse available text/draft facts and ask only for genuinely absent new input, without diagnosing a lost upload. This does not change the browser upload implementation or recover unsent images after a reload.

## Limits, audit and operation

The existing three-target, one-round research policy, 90-second research ceiling, final-answer reserve, model registry, per-user concurrency and one-prompt quota accounting remain. A price lookup does not also create structured venue hours; ordinary hours checks retain their own eligibility/budget. Price quote counts are added to the existing research completion receipt; public queries/sources and final selected-language answers remain in existing audit/history. Raw image retention/access is unchanged.

Verification uses synthetic multi-booking/duration, missing/free prices, fee/source/date/privacy and all-model mocked planner fixtures. The opt-in database-free `scripts/test-ai-service-prices.ts` probes one fixed public ordinary attraction through the live researcher, consuming provider quota, and reports source-backed versus unverified evidence; it never calls the application planner or writes itinerary/expense records. Report its actual result, not inferred success.

This feature adds no schema or infrastructure. Use the guarded test gate with synthetic inputs. Deploy and recover with [deployment](DEPLOYMENT.md) or [self-hosting](SELF_HOSTING.md), retaining all financial/privacy/recovery history.

## Guidance

OpenAI Docs informed explicit unknown values, schema-derived outputs and separating extraction/research/planning; [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) still require application validation. [Function-calling guidance](https://developers.openai.com/api/docs/guides/function-calling) informed precise lookup inputs and code-owned checks. These are implementation choices, not a model migration or a provider accuracy guarantee.
