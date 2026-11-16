---
id: JOB-099
title: Free AI that works again, with models that can plan and a schema dialect free providers compile
status: review
priority: P1
depends_on: [JOB-092]
claimant: CHL-work
branch: agent/JOB-099-free-ai-models
started: 2026-11-16T04:55Z
---

## Outcome

On 16 November 2026 the owner reported that Free AI, the keyless option for guests and for accounts without a key, appeared broken: every free model the app tried failed at the gateway, even for one dinner on a one-destination trip (D-111). They asked for a diagnosis and a fix that keeps D-098 and D-104's privacy, zero-price, quota and no-paid-fallback rules, and authorized deploying.

## Diagnosis

The opt-in smoke (`scripts/test-free-ai.ts`) failed with `AI_PROVIDER_OUTPUT_INVALID` after two upstream attempts, in 7 seconds. Replaying the planner's real request to each eligible model in each output mode found four separate causes ([evidence](../SOURCES.md#november-16-2026-free-model-check)):

1. **dots.3 note**, the first default: its provider answers short prompts but refuses any prompt above about 7,000 input tokens with an opaque 400, in every output mode. A planning request is about 12,400.
2. **Liquid LFM3**, the second default: its provider compiles schemas with xgrammar, which refuses zod's `format` + `pattern` pairs (dates, times, IDs) and a `format` with a length (map links). With one constraint per string the grammar compiles, but the 1.7B model then spends all 8,192 output tokens reasoning and answers nothing. It is also often rate-limited upstream.
3. **Reflection Beam**: its provider checks schemas with OpenAI-style strict rules, so the patches' optional fields (and `exclusiveMinimum`) are refused, even with `strict: false`. Given the same schema as JSON-object instructions, it planned correctly every time.
4. **ERNIE 5.5 Flash and Particle-1**, newer in the catalog, accepted the request as it was.

The other `anyOf` constructs (nullable fields and the proposal variants) were accepted by every provider that took the request; only the string-constraint pairs and the strict-rule validator mattered. The nested `$schema` that `researchRequests` carried is dropped as well.

## Scope

- **In:** the default models (code and GKE overlay), a provider schema dialect, a same-model JSON-object retry after a schema refusal, an amount hint, room for reasoning in free trip-setup lookups, labels, tests and documentation.
- **Out:**
  - a shorter planner prompt for small-context models such as dots.3 note;
  - reasoning settings for LFM3;
  - any change to validation, privacy, price checks, quotas, review or funding.

## Delivered

1. **Defaults:** `FREE_AI_MODELS` defaults to Reflection Beam, ERNIE 5.5 Flash, then Particle-1, in `free-model.ts` and the GKE overlay. On the dinner-and-bill request Beam was right 6 times out of 6 and fastest (7–14 s through JSON-object mode), ERNIE 6 of 8 (14–30 s), and Particle-1 5 of 7 (8–20 s). The picker still lists every eligible model.
2. **Dialect:** `freeProviderSchema` sends every free schema without nested `$schema` and with one string constraint per subschema (`format`, else `pattern`, else lengths), natively and inside JSON-object or prompt instructions. Property names, enums and required lists are kept as data, shared subschemas are fine, and cycles or absurd nesting are refused before any request. The application parser still checks the full contract, patterns and lengths included.
3. **Same-model retry:** when a native request is refused because of its schema (a 400, or an error inside a 200 reply, that names the schema, response format or grammar), the same model gets the same schema as JSON-object instructions in one more reserved attempt. Each server process remembers the refusal for an hour, so Beam costs one refused attempt an hour rather than one per request. Any other 400 moves to the next automatic model or fails an explicit choice, 401–403 and 429 still stop, and the refusal text is only classified, never kept or shown.
4. **Amounts:** every amount in the free schema says yen has no minor unit, after ERNIE saved 4,200 yen as 420,000 in one smoke run.
5. **Trip setup:** the free destination lookup allows 4,096 output tokens instead of 2,048. Beam reasons for 650–1,300 tokens on it and once ran past 2,048, which sent the lookup to the next model.
6. **Labels:** ERNIE 5.5 Flash, Particle-1 and Ling 3.2 Flash get readable names.

## Verification and documentation impact

- **Tests (synthetic):**
  - the dialect on zod-derived schemas, with the application contract still rejecting what the dialect no longer states;
  - the request bodies in native and JSON-object modes;
  - the retry after a strict-rule 400 and after a grammar error in a 200 reply, no retry for other 400s or non-native requests, at most one retry, rate limits during the retry, and the one-hour memory on the real gateway;
  - the planner's real free schema, which has the refused pairs before the dialect and none after it, while still accepting a dinner with a linked bill;
  - the amount hint, the default order and labels, the GKE overlay, and the trip-setup output budget.
- **Smoke (keyless, synthetic trips, fresh loopback databases):**
  - before the fix: failed as reported;
  - on the new defaults: passed both cases (dinner with a linked JPY 4,200 bill split two ways, and a guest's dinner) in 26 s with 3 attempts: Beam's native request was refused, JSON-object answered, and the guest request went straight to JSON-object;
  - pinned to ERNIE, it once left out the one-hour end time; pinned to Particle-1, it once left out the bill. Both stayed safe pending proposals; that is why Beam goes first.
- **Trip setup:** free lookups for Tokyo, Kyoto, Osaka, Lisbon and Salt Lake City returned the right zone and currency. At the old 2,048-token cap Beam failed 4 of 12 lookups (one confirmed as running out of tokens) and they fell back to ERNIE; at 4,096 all 4 finished on Beam.
- **Full check:** `pnpm check` passed on a disposable PostgreSQL 17 cluster: lint, typecheck, 281 files / 6,347 unit tests, the database migration and integration suite, the production build and the standalone smoke.
- **Production:** pending.
- **Documents:** D-111 (and notes in D-098 and D-104); the free AI contract, provider failures, architecture, implementation, case study, threat model, the AI tab's trip setup and `.env.example`; the dated evidence in sources; the changelog, the roadmap and the jobs list. The free AI contract no longer mentions a refresh button, which D-109 removed. Reviewed and unchanged: the README, the documentation index, AGENTS and CLAUDE, deployment and self-hosting (no model names), privacy (the same providers' retention notice applies), localization (no copy changed) and the database (no migration).

## Rollback

Revert the commit. The defaults return to dots.3 note and Liquid LFM3, which fail today. There is no migration or stored data to undo.
