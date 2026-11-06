---
id: JOB-074
title: Codex web search again, with the code-mode host on
status: done
priority: P1
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-06T22:00Z
---

## Outcome

On 6 November 2026 the disruption monitor started checking a trip that is now within its window. Every run failed, recorded as `DISRUPTION_PROVIDER_AUTH`, so the trip got no disruption warnings. The owner asked for a fix.

The provider sign-in was never the problem. The operator's OpenAI key lists models and answers the monitor's model from the cluster. The cause was the Codex CLI:

- Since Codex 0.147, every tool, web search included, runs through the CLI's code-mode host, `codex-code-mode-host`.
- The shared lockdown turned `code_mode_host` off, so each session failed closed: every turn began with an `error` item saying code mode was unavailable, and the model could not search.
- The monitor's check for disallowed turn items rejected that `error` item as a "forbidden tool". Its error classifier then matched the word "forbidden" and reported a sign-in failure.

The same lockdown runs every OpenAI-model planning turn, so those failed too. They were reported as an unusable answer.

Decision: [D-089](../DECISIONS.md#d-089-the-codex-code-mode-host-stays-on-as-the-tool-transport-accepted-november-6-2026).

## Delivered

1. **The lockdown** (`src/lib/ai/codex-lockdown.ts`) no longer turns `code_mode_host` off, and turns `code_mode` and `code_mode_only` off explicitly. Every other disabled feature stays off, and the test of the installed CLI's own feature report now accepts the host.
2. **The disruption monitor** has its own `DisruptionProviderToolError` for a turn that used anything beyond reasoning, its answer and web search. That error is recorded as `DISRUPTION_PROVIDER_TOOL`, never as a sign-in failure.
3. **Docs:** [decisions](../DECISIONS.md), the [threat model](../THREAT_MODEL.md), the changelog and the roadmap.

## Verification

- **Unit tests:**
  - the lockdown's code-mode settings, with the installed CLI's feature report;
  - a turn with a command, or with Codex's code-mode error notice, failing with the tool error;
  - the classifier keeping a real 403 as a sign-in failure and the tool error as its own code.
- **In the production web pod, before the change**, on synthetic prompts with the monitor's model:
  - **host off, as shipped:** every turn began with the code-mode `error` item, and the model answered that web search was unavailable;
  - **host on, with everything else locked down:** the turn searched the web, and the only items were the model's messages and the search;
  - **file access:** asked to read a random canary file in `/tmp`, the model answered that it had no access, with the host off and on.

## Rollback

Revert the commit. There is no migration. Without the host, Codex turns cannot use tools, so the monitor and OpenAI-model planning would fail again.
