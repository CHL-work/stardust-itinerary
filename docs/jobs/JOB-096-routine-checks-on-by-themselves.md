---
id: JOB-096
title: Routine checks that turn on by themselves, capable default models, and Chat inside Conversations
status: done
priority: P2
depends_on: [JOB-093, JOB-094]
claimant: Claude
branch: agent/JOB-096-routine-defaults
started: 2026-11-08T15:20Z
---

## Outcome

On 8 November 2026 the owner asked for three changes (D-108):
- routine checks turn on automatically when an OpenAI, Claude or Gemini (or Vertex) key is entered and passes the check;
- they default to GPT-6 Astra, Claude Opus 5.5 or Gemini 4 Argon at medium effort;
- the AI tab's Chat section merges into Conversations at the bottom.

## Scope

- **In:**
  - the web search check starting by itself after a key is saved, with progress in the AI tab;
  - remembering that a member turned checks off;
  - per-provider defaults;
  - one Conversations section holding the chat and past conversations;
  - copy in every language, and documentation.
- **Out:** who pays, the gate itself, rate limits, the routine schedule and trip setup's models, which stay as in JOB-094.

## Delivered

1. **Migration 0069:** `routine_opted_out` and the latest automatic check (`routine_check_model`, `routine_check_at`, `routine_check_result`) on `account_ai_preferences`.
2. **Rules:** `src/lib/ai/routine-auto-check.ts` decides when a check is due, running or failed:
   - a newly saved key is tested with its provider's default;
   - a key saved again while checks run on it is tested with the chosen model;
   - each key is tested once until it is saved again, and only the most recently saved key is tried by itself;
   - turning checks off is kept;
   - removing the key checks run on hands them to the newest remaining key once it passes.
3. **Claim and run:** `claimRoutineAutoCheck` locks the account's row, so two web servers never test one key twice. `runRoutineAutoCheck` turns checks on when the test passes, unless the member turned them off meanwhile, the key was saved again, or another check replaced this one. An automatic turn-on is audited with `automatic: true`.
4. **Routes:**
   - `PUT /ai/keys` starts the test after responding (`after()`) and says so (`routineCheck`), and the key stays saved whatever happens to the test;
   - `POST /ai/preferences` starts it for keys saved before this change;
   - the AI tab reads progress every three seconds while a test runs, and the Routine checks header says **Checking…**.
5. **Defaults:** `gpt-6-astra`, `claude-opus-5-5` and `gemini-4-argon` at medium effort. A model already chosen for the same provider is kept.
6. **Removed keys:** checks whose key was removed show as off, and saving only the chat effort no longer fails for them. That save used to demand the removed key.
7. **Conversations:** one section, open at first for everyone (new stored id), holds the chat (new conversation, transcript, composer and effort) above the past conversations. The Chat section and its copy are gone.
8. **Copy:**
   - new: "Checking…" in the section header, and a key-saved notice that says checks turn on once the key passes;
   - rewritten: the no-key line and the "?" text.

   This covers English, Cantonese and Japanese and the eight language packs.

## Verification and documentation impact

- **Unit tests:** the decision rules, both routes (`after()` scheduling, limits, origin checks) and the AI tab states.
- **Database test:** at migration head with a synthetic key ring, it covers:
  - a single claim, and a pass that turns checks on;
  - a re-test after the key is saved again, and a failure that is not retried;
  - a key saved during a test;
  - the off choice kept through a later key, then a manual turn-on;
  - key removal, and a chat effort save afterwards.
- **Full check:** `pnpm check` passed (lint, typecheck, unit and database tests, build, smoke).
- **Local build:** a local production build at phone width showed the new section order, Conversations holding the chat above past conversations. With a synthetic key row, the automatic check started by itself on opening the AI tab ("Checking…", testing `gpt-6-astra`), then showed its failure, and a reload did not retry it.
- **Production:** `fa61b55` deployed on GKE on 8 November 2026:
  - the pre-deploy backup and migration jobs completed, and migration 0069 is applied with its four columns;
  - the web pod runs the new image with `ROUTINE_CHECKS_ENABLED=true` and no errors in its logs;
  - `/api/health` is OK, and the preferences `GET` and new `POST` answer 401 when signed out;
  - the one existing routine setting (Claude Opus 5.5 at medium, on) is unchanged.
- **Documents:**
  - the AI tab contract;
  - D-108, plus notes on D-105 and D-106;
  - flight status, privacy, threat model, keys, members, self-hosting, architecture, implementation, design, conversation history and database docs;
  - AGENTS.md, the README, the changelog, the roadmap and the jobs list.
- **Screenshots:** none changed. The API keys shot shows Usage, Routine checks and API keys, which look the same.
