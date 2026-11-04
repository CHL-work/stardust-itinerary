---
id: JOB-061
title: Bring-your-own AI provider keys
status: review
priority: P1
depends_on: [JOB-058, JOB-062]
claimant: CHL-work
branch: main
---

## Outcome

Every signed-in user can store their own OpenAI, Anthropic or Gemini API key and use AI with it, in any trip they are a member of. The server operator's keys keep funding exactly what they funded before (operator-sponsored trips). Keys are never shown again after saving, never reach the browser or logs, and are isolated per request. Decision: [D-075](../DECISIONS.md#d-075-users-can-bring-their-own-ai-provider-keys-accepted-november-4-2026).

## Delivered

1. **Transport (migration 0053):** model calls authenticate with API keys instead of subscription logins. Provider subprocesses get an explicit environment allowlist. Every in-app Codex call uses `lockedDownCodexConfig`.
2. **Storage (migration 0054):**
   - `user_ai_credentials` holds one row per user and provider, deleted with the account. It stores:
     - the AES-256-GCM ciphertext, nonce and key version;
     - a four-character hint;
     - the optional Vertex AI project and location;
     - timestamps.
   - The user and provider are bound as additional authenticated data.
   - `ai_requests.credential_source` records whose key paid.
3. **API:** `GET|PUT|DELETE /api/trips/{tripId}/ai/keys`. The path is under the trip because sessions are trip-scoped; the keys belong to the account.
   - Responses are `private, no-store` and carry only summaries.
   - Writes require same-origin.
   - PUT checks the key with the provider's cheapest read-only call (8 s timeout, no redirects) before storing it. It is limited to 10 checks an hour per account and 30 per address.
   - Audit events record only the provider.
4. **Resolution:** `getAiPolicy` returns a credential source along with the model. The shared helper `ownKeyModel` in `src/lib/ai/own-key-model.ts` is used by both the server and the model picker.
   - `own`: the requester holds a key for the chosen model's provider, or the trip is unsponsored and they hold any key. No trip quota applies, but there is a ceiling of 100 requests per account per UTC day.
   - `operator`: the earlier rules, in sponsored trips only. Own-key requests no longer count against this quota.
   - Otherwise the request is denied with `ai_key_required`.
5. **AI on/off:** `trip_ai_settings.enabled` now only records whether the owners allow AI.
   - New trips start with AI on, and owners of unsponsored trips can switch it.
   - Migration 0054 turns it on for unsponsored trips no owner turned off.
6. **Plumbing:** an `AsyncLocalStorage` credential context, entered by the planner and location search.
   - Inside it, `providerEnvironment()` and `geminiEndpoint()` drop the operator's keys and use the user's.
   - `HOME`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` point at a private per-request directory. It is removed afterwards and swept if left behind; a failed removal never fails the request.
   - Background workers never enter a user context.
7. **UI:**
   - Settings → AI keys: add, replace or remove per provider, with a masked display, in all four languages.
   - The overview tells the browser only which providers have a key.
   - The AI composer opens once a key is saved and offers a per-request model picker for the user's providers. In sponsored trips its default stays the free trip AI.
   - The AI tab and Settings explain `ai_key_required` and own-key use.
8. **Deployment:** on GKE the encryption key is the separate `stardust-credential-env` secret, which only `stardust-web` can read (`infra/main.tf`) and mount. Compose blanks it for the migrate and scheduler services.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (all unit tests) and `pnpm test:db` (disposable PostgreSQL 17) pass.
- Unit tests cover:
  - encryption: round trip, fresh nonces, AAD binding, tampering, the exact key format, and refusing `AUTH_SECRET` reuse;
  - the context: concurrent users, cleanup and stale-directory sweeps;
  - environments: the operator's keys never reach a user's environment;
  - the key route: rate limits, 429 with Retry-After, and no key in any response;
  - validation requests: their hosts and `redirect: "error"`;
  - the AI tab: own-key choices and copy in all locales.
- Database tests cover:
  - rejected keys are never stored;
  - only ciphertext is stored, and the audit holds no key material;
  - another user's key is never read, and a copied ciphertext does not open;
  - own-key funding and the overview fields;
  - the daily ceiling, and that own-key requests leave a sponsored trip's quota alone;
  - the 0054 data change.
- An independent security review of the first commit found no cross-user, browser, log or funding leak. Its medium findings (the encryption key reaching every workload, unlimited key checks) and its low findings (own-key ceiling, key format, cleanup, redirects, Codex tools in research and image calls) are fixed here.

## Known limits

- **Rotation:** no encryption-key rotation yet. `key_version` is reserved, and changing the key means users add their keys again. Planned for JOB-065, along with making a missing credential context an error in the web server.
- **Usage:** per-provider usage for the key's owner is not shown in Settings yet (JOB-066).
- **Sharing:** sharing an owner's key with members is JOB-063.

## Rollback

- Migration 0054 is additive, and its data change is rollback-compatible: older builds still require sponsorship for AI.
- An older build ignores saved keys.
- The `stardust-credential-env` secret can stay in place.
