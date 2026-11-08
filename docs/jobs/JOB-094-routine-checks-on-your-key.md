---
id: JOB-094
title: Routine checks on your own key, effort settings, and trip setup on your key or a free model
status: in_progress
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

## Verification and documentation impact

Pending implementation.
