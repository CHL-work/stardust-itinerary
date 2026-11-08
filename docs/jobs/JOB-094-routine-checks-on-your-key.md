---
id: JOB-094
title: Routine checks on your own key, effort settings, and trip setup on your key or a free model
status: review
priority: P2
depends_on: [JOB-083, JOB-087, JOB-093]
claimant: Claude
branch: agent/JOB-093-ai-tab
started: 2026-11-08T07:45Z
---

## Outcome

On 8 November 2026 the owner asked that routine flight and event checks run for anyone who saves an API key that can search the web, with a model and effort they choose and a "?" that explains the checks; a chat effort setting with sensible defaults; and the create-trip AI on the user's own key, or on a free model without one (D-106).

## Scope

- **In:**
  - account AI preferences: chat effort, and routine checks on/off with model and effort;
  - a one-time web search check of the chosen model on the user's key before routine checks turn on;
  - flight status and disruption checks paid by a trip member's own key, run by the web server, the only workload allowed to decrypt users' keys;
  - effort applied to OpenAI, Anthropic and Gemini requests on the user's key;
  - the create-trip destination lookup on the user's key, else a free model;
  - every language, tests and documents.
- **Out:**
  - closed-app push notifications;
  - routine checks on a shared key, or on free models, which cannot search.

## Delivered

1. **Preferences:** `account_ai_preferences` (migration 0068) and `GET`/`PATCH /api/trips/{tripId}/ai/preferences` (`src/lib/ai/preferences.ts`) with revision checks and audit. Turning routine checks on, or choosing another model, runs `verifyRoutineWebSearch` on the user's key first (rate limited); the database clock stamps the verification so a key saved again must pass again.
2. **Providers:** `src/lib/ai/routine-check-provider.ts` runs the existing flight and disruption prompts on OpenAI (Codex, parametrized model and effort), Claude (Agent SDK with only `WebSearch` and the structured answer behind a pre-tool gate) or Gemini (Google Search grounding and `thinkingLevel`).
3. **Funding and runs:** `src/lib/routine-checks/funding.ts` chooses one payer per unsponsored trip (active, unsuspended, opted in, current key verified; owners first). `runDueFlightStatusChecks` and `runDueDisruptionMonitors` gained a member-funded mode that records `credential_source = 'own'`, `credential_member_id`, the model and `web_search_count`. `src/instrumentation.ts` starts a five-minute loop in the web server when `ROUTINE_CHECKS_ENABLED=true` (GKE web overlay and Compose).
4. **Effort:** chat effort applies to requests the requester pays for (Codex `modelReasoningEffort`, Claude `effort`, Gemini `thinkingLevel`); Default keeps the registry effort.
5. **Trip setup:** `src/lib/ai/trip-destination-models.ts` and the service choose the operator's pinned Codex lookup for the platform operator, else the requester's own key's lightest model, else a free model (instance cap 200 a day), else the operator; `account_ai_lookups` records who paid. Older schemas keep the operator path.

## Verification and documentation impact

- Unit tests: the web search gate, Gemini routing and its query privacy gate, payer rules, request columns, the scheduler's bounds and overlap guard, effort defaults, lookup funding choices and the own-key lookup environment. Database test at migration head: constraints, the gate, member-funded flight and disruption checks with scripted providers, owner priority, key replacement and suspension.
- Documents: D-106 (and notes in D-071, D-075, D-095); AGENTS funding rules; AI tab, flight status, AI and agents, key storage, members and funding, destination defaults, threat model, privacy notice, architecture, deployment, self-hosting, notifications, Activity, `.env.example` and Compose.
