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

Every signed-in user can store their own OpenAI, Anthropic or Gemini API key and use AI with it, in any trip they are a member of. The server operator's keys keep funding exactly what they fund today (operator-sponsored trips). Keys are never shown again after saving, never reach the browser or logs, and are isolated per request.

## Done in this job so far

- Model calls authenticate with API keys instead of interactive subscription logins (migration 0053).
- Provider subprocesses get an explicit environment allowlist.
- In-app Codex turns run with `lockedDownCodexConfig`: no shell, exec, apps, agents, hooks, memories, image viewer, MCP or history.

## Remaining scope

1. **Storage (migration):** `user_ai_credentials`, with these columns:
   - `user_id`;
   - `provider` (`openai`, `anthropic` or `google`);
   - the ciphertext, nonce and key-version columns;
   - `last4`, `created_at`, `updated_at`, `validated_at`.

   There is one row per user and provider, deleted with the account. Encryption is AES-256-GCM under `CREDENTIAL_ENCRYPTION_KEY` (32 random bytes, base64, a new secret). The key version allows rotation; the provider name and user ID are bound as additional authenticated data.
2. **API:**
   - `GET /api/account/ai-keys` returns providers with `last4` and `validatedAt` only.
   - `PUT /api/account/ai-keys/{provider}` validates the key with a cheap model-list call (5 s timeout), then stores it.
   - `DELETE /api/account/ai-keys/{provider}`.

   All of them require same-origin, use the authenticated account session, are rate limited, and write an audit event without the key.
3. **Resolution:** `getAiPolicy` returns a credential source along with the model:
   - `own`: the requester has a key for the chosen model's provider. Any registered model of that provider can be used, and the daily limit does not apply.
   - `shared`: JOB-063.
   - `operator`: today's rules, unchanged.
   - Otherwise the request is denied with a new `ai_key_required` reason that the UI can explain.
4. **Plumbing:** the resolved key is carried in an `AsyncLocalStorage` credential context for the request. Inside that context:
   - `providerEnvironment()` and `geminiEndpoint()` drop the operator's keys and use the context's;
   - `CODEX_HOME` and `CLAUDE_CONFIG_DIR` point at a fresh per-request temporary directory, removed afterwards.

   Background workers keep the operator context.
5. **UI:** Settings → AI keys, with add, replace and delete per provider and a masked display. A member's model picker offers models from the providers they hold keys for. Copy is in all four languages. The AI tab explains how to add a key when AI is unavailable for that reason.
6. **Usage:** `ai_requests` records the credential source. Settings shows the requester their own usage per provider.
7. **Docs:** IDENTITY_AND_SECURITY, AI_AND_AGENTS, PUBLIC_TRIPS_AND_MEMBERS (funding), DATABASE (migration), LOCALIZATION, SELF_HOSTING/DEPLOYMENT (the new secret).

## Acceptance

- A user with only their own key can plan in an unsponsored trip, and nobody else's key is used.
- Keys are rejected if the provider rejects them, and are never returned by any API. Tests prove they never appear in logs, audit payloads, provider error text stored in the database, or the browser bundle.
- Two concurrent requests from different users never see each other's key or provider state directory (test with a fake provider).
- `pnpm check` passes, and the security-review checklist in JOB-065 is updated for credentials.
