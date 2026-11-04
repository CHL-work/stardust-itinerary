---
name: stardust-job-runner
description: Select, claim, implement, verify, and hand off one authorized Stardust Itinerary job. Use when the user asks an AI agent to pick the next repository job, execute a JOB-### file, continue a claimed job, or prepare its review handoff. Enforce design dependencies and distinguish read-only selection from implementation authorization.
---

# Stardust Job Runner

## Establish authority

1. Read repository-root `AGENTS.md`, `docs/DECISIONS.md`, `docs/DOCUMENTATION_POLICY.md`, and `docs/JOB_SYSTEM.md` completely. Documents report current state but never grant authorization.
2. Treat "pick/select the next job" as read-only. Do not edit, branch, push, or implement.
3. Implement only when the user explicitly asks to execute/implement a job. Remote push, pull request, deployment, external messages, secrets, and production changes require their own explicit authorization.
4. If the current request is design-only, stop after reporting that no implementation is authorized.

## Select one job

1. Read the candidate job files under `docs/jobs/`. New work starts at JOB-058; JOB-001 to JOB-057 are in a private archive and cannot be selected.
2. Consider only `status: ready`; never promote `proposed` work.
3. Check each dependency's required state in the selected job. Default to `done`; honor an explicit accepted `review`/deployment prerequisite without marking that dependency accepted.
4. Inspect live branches, pull requests, and coordination state for another claim.
5. Choose lowest priority number, then lowest job ID. If none qualify, report "no authorized job is available."
6. Read the full selected job and every directly linked design section before planning.

## Claim only for authorized execution

1. Inspect the working tree and preserve unrelated user changes.
2. Re-check remote claims immediately before creating `agent/JOB-###-short-slug`.
3. Set the job header to `in_progress` with claimant, UTC start, and branch as the first scoped change.
4. If repository writes were authorized and parallel work is active, publish the claim early as a draft pull request.
5. If another claimant won the race, stop and select another ready job.

## Execute narrowly

- Implement only the selected job's in-scope behavior and acceptance criteria.
- Follow the current `AGENTS.md` invariants and its explicit, narrow AI funding rules. Do not broaden them or reuse Gemini CLI OAuth. No Firestore, direct model canonical writes, exposed secrets, Discord source of truth or in-app AI deployment access.
- Do not add adjacent refactors or dependencies unless they are required for acceptance. Flag an expansion before proceeding.
- Add migrations, tests, localization, audit, authorization, portability, and rollback work when the job requires them.
- Use redacted fixtures; never use real traveler, invite, receipt, token, or production-export data.

## Verify and hand off

1. Run the job checks plus relevant broader checks; record commands and results.
2. Review the diff for scope, secrets, generated files, unsafe defaults, and documentation drift.
3. Review every document in the inventory in `docs/DOCUMENTATION_POLICY.md`; update every affected document and record affected/unaffected results in the pull request.
4. Update `CHANGELOG.md` for every change. Update decisions and implementation status whenever behavior, commands, dependencies, configuration, or an accepted boundary changed.
5. Set status to `review` and record verification evidence, known limits, migration/rollback notes, documentation impact, and handoff notes.
6. Do not mark `done`, merge, deploy, notify users, or mutate production unless the user separately authorizes that action.

When blocked, record the concrete blocker and safe checks already attempted. Do not weaken an acceptance criterion or architecture invariant to make a job appear complete.
