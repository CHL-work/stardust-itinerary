# AI-Agent Job System

## 1. Purpose

Jobs make implementation work small, reviewable, and safe for Codex, Claude, or a human contributor. They are proposals only until a maintainer changes a job to `ready` or explicitly authorizes that job in conversation.

The job system does not grant production, deployment, messaging, or secret access.

Job records live under `docs/jobs/`, one file per job named `JOB-###-short-slug.md`. Historical jobs JOB-001 to JOB-057 and their verification evidence are kept in a private archive and are not part of this repository; their outcomes are summarized in [decisions](DECISIONS.md) and the topic contracts. New work starts at JOB-058. Planned work is listed in the [roadmap](ROADMAP.md).

## 2. Status lifecycle

```text
proposed -> ready -> in_progress -> review -> done
                    |               |
                    +-> blocked <---+
```

- `proposed`: design backlog; agents must not implement it.
- `ready`: scope and dependencies approved; available to claim.
- `in_progress`: one named actor/agent and branch own it.
- `blocked`: cannot meet acceptance criteria; record the blocker.
- `review`: implementation and checks are complete; awaiting review.
- `done`: accepted and merged.

Only a maintainer changes `proposed` to `ready` or `review` to `done`.

## 3. Selection order

An agent asked to choose a job:

1. Reads `AGENTS.md`, `docs/DECISIONS.md`, and this file.
2. Considers only jobs in `docs/jobs/` with `status: ready`.
3. Verifies each dependency meets the selected job's stated prerequisite. Default to `done`; an explicit accepted `review`/deployment prerequisite does not imply maintainer acceptance of that dependency. A dependency on an archived job (JOB-001 to JOB-057) counts as met only where the topic contracts describe that behavior as shipped.
4. Searches current branches/pull requests or the team coordination system for an existing claim.
5. Chooses the lowest priority number (`P0` before `P1`) and then the lowest job ID.
6. Reads the full job and linked design sections before proposing a plan.

If no job is ready, the correct result is “no authorized job is available.” Do not convert a proposed job to ready or invent new work.

## 4. Claim protocol

When the user asks only to **pick** a job, selection is read-only. When the user explicitly asks to **execute/implement** it and authorizes repository writes:

1. Re-check working tree and remote claims.
2. Create `agent/JOB-###-short-slug` from the current default branch.
3. Make the first change update the job header to `in_progress`, with claimant, UTC start, and branch.
4. Push/open a draft pull request early if parallel agents are active, so the claim is visible.
5. Work only inside the job scope.

If another claim appears first, stop and select another ready job. A branch name alone is not permission to deploy or merge.

## 5. Required job format

Every job contains:

- ID, title, status, priority, dependencies, claimant, branch;
- outcome stated as observable behavior;
- in-scope and out-of-scope lists;
- relevant design links;
- acceptance criteria;
- verification commands/checks to be filled in when the stack exists;
- risks, migration/rollback notes, and handoff notes where relevant.

Keep a job small enough for one focused pull request. Split it when it touches unrelated domains or cannot be reviewed safely as one unit. Job records are public: keep private identifiers, secrets and real traveler data out of them.

## 6. Completion and handoff

Before moving to `review`, the agent:

- runs the job’s checks and relevant broader checks;
- reviews its diff for secrets and unrelated changes;
- updates design/decision docs if behavior changed;
- updates `CHANGELOG.md` and completes `docs/DOCUMENTATION_POLICY.md` impact review;
- adds migrations and rollback notes where needed;
- records known limitations and any unverified conditions;
- updates the job’s status, verification evidence, and handoff section.

Only reviewers merge. Production deployment is a separate, explicitly authorized operation ([deployment](DEPLOYMENT.md)).

## 7. Urgent trip-time changes

Do not bypass the job and review model simply because a trip is active. Prefer configuration or itinerary changes inside the web app. For a software defect:

- create a narrowly scoped hotfix job;
- preserve a rollback target;
- test against redacted fixtures;
- require explicit maintainer authorization to deploy;
- do not let in-app AI modify source or infrastructure.
