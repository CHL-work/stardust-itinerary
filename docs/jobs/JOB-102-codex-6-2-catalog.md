---
id: JOB-102
title: Codex SDK with a bundled GPT 6.2 catalog
status: proposed
priority: P1
depends_on: [JOB-101]
claimant: none
branch: none
---

## Outcome

Use the known-model Codex transport metadata for GPT 6.2 without weakening the tool lockdown or dependency supply-chain policy. JOB-101's model refresh can ship on 0.165.0 before the release-age cutoff; that CLI recognizes the supplied model ID but uses fallback metadata and offers `request_user_input`, which application validation rejects.

## Scope and acceptance

- Choose the newest exact `@openai/codex-sdk` version at least one day old whose bundled catalog contains both 6.2 IDs. Version 0.169.1 was published November 17, 2026 at 22:27 UTC; do not bypass the gate or add `minimumReleaseAgeExclude`.
- Update the SDK dependency/lockfile, `pinnedCodexVersion` in the destination provider and current source/implementation/destination docs.
- Run the real CLI feature-report lockdown test; review and disable any new capability, retaining the code-mode host as transport only. Review web-search item parsing.
- Capture Sol/low and Astra/medium requests with a dummy key and loopback Responses endpoint, search on/off. Check known-model metadata, tool restrictions and structured output; no provider quota is required for this.
- Run `pnpm check` against fresh disposable PostgreSQL 17. A real smoke requires available credits and explicit authority; never write real trip records.

Funding, model selection, database schema and other providers are out of scope. Deployment still requires current owner authority; this record does not grant it.

## References and rollback

[AI boundaries](../AI_AND_AGENTS.md), [implementation](../IMPLEMENTATION.md), [deployment](../DEPLOYMENT.md), [documentation policy](../DOCUMENTATION_POLICY.md). Restore the prior exact SDK/lockfile and matching binary pin together if verification fails. Keep the 6.2 registry and migration compatibility from JOB-101.

## Verification and documentation impact

Not implemented. Update the changelog and affected current contracts with the verified SDK/version and any observed limitations.
