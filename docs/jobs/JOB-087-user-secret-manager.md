# JOB-087: Account-owned keys in Google Secret Manager

- Status: review
- Priority: P1
- Dependencies: JOB-061, JOB-069 (implemented credential and account protections)
- Claimant: Codex
- Started: 2026-11-07 UTC
- Branch: `agent/JOB-087-user-secret-manager`
- Integrated review branch: `agent/account-keys-and-icons-review` (includes JOB-088 and final safety fixes; continue there)

## Outcome and scope

Users paste provider keys in Settings. On a configured Google Cloud deployment, key material lives in Secret Manager, bound to the immutable account and provider; PostgreSQL retains only references and display metadata. Existing credentials keep working during migration. Preserve KMS protection, explicit sharing, paid-model visibility and all current authorization checks. No operator-key import, guest sponsorship, MCP implementation or production changes.

## Acceptance and verification

- Validate before saving; never expose keys, secret payloads or tokens in responses/logs.
- Fail closed on unavailable/misconfigured storage; never silently change funding.
- Cover account/provider binding, concurrent replacement, removal, guest cleanup and legacy reads with synthetic tests.
- Use workload identity and least privilege, with no static cloud keys.
- Document setup, lifecycle, costs, rollback and the required separately authorized infrastructure rollout.
- Run targeted tests and the full check against disposable data; record results before review.

## References

[AI contract](../AI_AND_AGENTS.md), [identity](../IDENTITY_AND_SECURITY.md), [database](../DATABASE.md), [deployment](../DEPLOYMENT.md), [documentation policy](../DOCUMENTATION_POLICY.md).

## Handoff

Implementation and combined verification complete. No keys read or imported; no cloud resources changed. Separate source job branches are retained; the integrated review branch contains both completed changes.

## Verification

- Disposable PostgreSQL full migration/integration suite passed, including Secret Manager save/read/remove, wrong-owner/provider references, cloud failures, stale concurrent saves/deletes, revoked sessions/members, suspension and guest expiry/purge cleanup.
- Lint and types passed (one pre-existing warning in an ignored local screenshot helper).
- Final combined gate: **250 unit files / 5,917 tests passed**, disposable PostgreSQL suite, lint/types, production build and smoke passed. The migration inventory was updated for 0064. Final regression coverage also proves account/session lock ordering during revocation and that cleanup retry backoff never extends a save's fixed publication deadline.
- Relative documentation links and diff checks passed. JOB-088's full-app synthetic phone screenshots were refreshed and inspected. Temporary app/browser processes and the owned disposable PostgreSQL server were stopped after checks.
- No live Secret Manager/IAM validation: cloud tooling and credentials were not acquired. The cleanup CronJob is suspended and new web configuration remains unset. Production activation and any push require separate authority.

## Documentation impact

Updated: entry points/rules/history, design decisions, roadmap/job indexes, architecture/source map, database compatibility, AI key contract, security/privacy/threat model, member funding cross-reference, case study, self-hosting/deployment, environment template and documentation inventory. Settings protection/help copy is updated in all locales. No schema or user-facing data enters Git.

Reviewed but unaffected: CLAUDE/CONTRIBUTING/security reporting entry points; core product journeys and money semantics; destination defaults; instructions/retired preferences; activity and feedback; pending edits, venue hours, research, booking prices, image inputs, recovery, provider failures and conversation history; communications, Calendar, maps, weather/disruption/flight logic; expense/repayment/mobile-card/layout contracts; localization architecture; CI workflow, Dockerfile/Compose, sources bibliography and job-runner policy. New source links live with the key contract. JOB-088 separately owns icon/screenshots changes.

## Recovery / limitations

Migration 0064 preserves legacy ciphertexts and adds reference-only storage behind explicit configuration. Keep compatible code and Secret Manager/KMS read access after saving references; no automatic bulk migration or downgrade. Deleted secrets cannot be recovered from a database dump; re-enter keys. A delete of an already absent key does not cancel its first in-flight save (the UI only offers Remove for saved keys); revoking its session still prevents that save. Existing-key concurrent deletion is covered.
