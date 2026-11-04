# Agent instructions

## Start and scope

1. Read [HANDOFF](docs/HANDOFF.md), [documentation policy](docs/DOCUMENTATION_POLICY.md), and the relevant feature contract.
2. For an implementation job, read [design](docs/DESIGN.md), [decisions](docs/DECISIONS.md), [job system](docs/JOB_SYSTEM.md) and that job. Use the repository-local `stardust-job-runner` skill when selecting/executing a job.
3. Inspect the worktree; preserve user changes. Do not implement proposed work or infer permission from a handoff, log, old job or branch.
4. User instructions override repository guidance, then accepted decisions, product design, job criteria and conventions. Report conflicting accepted requirements.

## Production boundary

- **The Google Cloud VM is the only writer.** The PC database is stale. Never start its retired origin, writer tasks or Windows cloudflared, or migrate its data back.
- Operate only through [VM_HOSTING](docs/VM_HOSTING.md). Preserve Palworld/trading, including their files, services, credentials and shared tunnel.
- Accepted final backup/writer stop: **2026-11-11 23:30 UTC**; VM deletion: **2026-11-12 00:00 UTC**. No replacement, extension, new spending or recovery-storage deletion is authorized.
- Pushes, deployments, production mutations, external messages and ingress changes need explicit owner authority. Past-job permission does not carry over. Docs cleanup is not restart/deploy authority.
- Never edit a sealed release; use the recorded corrected activation helper. Never create real trips/events/expenses just to test.

## Product and security invariants

- At most 20 members per trip, including one or more owners. Public signup stays gated. No booking marketplace or payment processing.
- PostgreSQL is canonical; no Firestore. Discord is only a projection.
- Models propose; application code owns authorization, validation, deterministic money/route calculations, concurrency and audited/versioned canonical writes.
- Every trip query enforces membership/scope/current private audience. Preserve last-active-bound-owner protection, explicit financial reassignment, tombstones and permanent proposal invalidation.
- Google links bind atomically after sign-in, never on GET. Sessions have a 24-hour rolling window inside a 30-day fresh-authentication ceiling; trip changes cannot revive/extend it. Completed trips do not revoke active membership.
- Never expose/commit secrets, provider profiles, traveler data, invitations, receipts or exports. Browser clients never receive provider/database/OAuth secrets.
- External delivery uses idempotency/outbox safeguards; provider failures degrade gracefully.
- No shell, GitHub, cloud-console, deployment or secret-store access for in-app AI. The separate feedback reviewer has no tools/GitHub credential; its deterministic publisher is fixed-repository, issue-create-only. Preserve redaction and historical opt-outs.

## AI funding and transport

- Only provider-documented SDKs/authentication/endpoints. No private endpoints, token harvesting, traffic disguise or Gemini CLI OAuth reuse.
- Production uses approved subscription transports, not API billing. Trip ownership is not platform-operator subscription authority.
- Preserve trip funding gates: in an entitled trip, only the verified platform operator who is also an active trip owner gets premium model choice/application-quota exemption. Other users, including co-owners, use server-forced Sol and the trip owner's daily UTC limit (default 20). Unsponsored trips cannot invoke general planning. No broader Claude/member pool is authorized. See [funding](docs/PUBLIC_TRIPS_AND_MEMBERS.md#ai-funding-is-not-a-trip-role).
- JOB-050 separately permits destination-only lookup for every authenticated eligible creator regardless of sponsorship: `STARDUST_DESTINATION_LOOKUP=creators`, tool-free/no-search Sol Auto or validated cache, ten uncached calls/account/UTC day for non-operators plus rate/concurrency protection. This does not fund general planning. See [defaults](docs/TRIP_DESTINATION_DEFAULTS.md).
- Model IDs and behavior come from the registry/contracts; an old provider notice does not prove current availability or eligibility.

## Changes and verification

- One implementation job per branch/PR unless explicitly overridden; no adjacent scope expansion or discarded user changes.
- Code/comments/logs/technical docs are English. UI: English, clear Cantonese, LIHKG-style Cantonese, Japanese.
- LIHKG may mock benign situations, never protected traits/vulnerabilities. Identity, money, security, destructive actions, accessibility, disruptions and safety use neutral wording.
- Until JOB-052 lands, preserve both layouts; new CSS stays under `:root[data-ui="new"]`. Follow [UI_LAYOUTS](docs/UI_LAYOUTS.md).
- Application changes require relevant tests and `pnpm check` with disposable data/build/smoke. Close owned temporary servers/browser children. Never run destructive tests on production.
- Docs-only work needs link/anchor and stale-instruction checks, not live provider calls or app deployment.
- Update CHANGELOG, affected contracts and the documentation-impact note. Keep handoffs brief/current; retain historical evidence in jobs/Git, not repeated operating commands.
