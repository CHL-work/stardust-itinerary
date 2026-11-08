# JOB-087: Account-owned keys in Google Secret Manager

- Status: done
- Priority: P1
- Dependencies: JOB-061, JOB-069 (implemented credential and account protections)
- Claimant: Codex
- Started: 2026-11-07 UTC
- Branch: `agent/JOB-087-user-secret-manager`
- Integrated branch: `agent/account-keys-and-icons-review` (merged to `main` with JOB-088 and final safety fixes)

## Outcome and scope

Users paste provider keys in Settings. On a configured Google Cloud deployment, key material lives in Secret Manager, bound to the immutable account and provider; PostgreSQL retains only references and display metadata. Existing credentials keep working during migration. Preserve KMS protection, explicit sharing, paid-model visibility and all current authorization checks. No operator-key import, guest sponsorship or MCP implementation. The user subsequently authorized the push, GKE release and required Secret Manager activation.

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

Accepted, merged, deployed and activated on November 8, 2026 UTC. New account-key saves use Secret Manager; existing encrypted database keys remain supported. Cleanup runs every 15 minutes. No provider keys were read or imported, and CI permissions were not broadened. Future changes follow the [deployment procedure](../DEPLOYMENT.md#account-owned-keys-in-secret-manager) and require their own authority.

### Release evidence (2026-11-08 UTC)

- Authorized fast-forward push put `cacf021` on `main`. [CI](https://github.com/CHL-work/stardust-itinerary/actions/runs/42441663915) and [GKE deployment](https://github.com/CHL-work/stardust-itinerary/actions/runs/42441828012) succeeded, including backup, migration 0064, rollout, free/guest configuration checks and public health. A separate read-only health check reported the database ready.
- Correction to the initial access report: the project picker was filtered to no organization. Opening the production project directly with the already signed-in operator account worked; no new project access grant was needed.
- Applied the reviewed OpenTofu plan against the existing state: nine additions, no changes or deletions. Existing KMS deny/WIF grants were untouched. The dedicated cleanup configuration contains only the runtime database connection and project setting; secret values were transferred between tools without display.
- Manual cleanup completed with zero failed resources. A synthetic, ten-minute-expiring secret passed KMS/Secret Manager roundtrip, wrong-account/AAD rejection, web delete denial, cleanup payload-read denial and cleanup deletion. Web access then confirmed 404; the temporary pod was removed. No real account, trip or provider key was used.
- The documentation-only follow-up CI exposed an existing 999 ms real-clock route-test flake. The release follow-up rechecks early timer wakes and uses deterministic clock tests without reducing the required one-second spacing.
- Activation release `152964a`: [CI](https://github.com/CHL-work/stardust-itinerary/actions/runs/42444324538) and [GKE deployment](https://github.com/CHL-work/stardust-itinerary/actions/runs/42444527448) passed. The enabled cleanup template completed another manual run with zero failures. Added the two Secret Manager settings to the web-only credential configuration without removing KMS/legacy settings, then performed a successful web rollout restart.
- Post-restart verification reported `secret_manager`, public health/database ready, and cleanup unsuspended on its 15-minute schedule. Actual provider-key save/remove in Settings awaits a key pasted by its user; cloud storage and identity isolation were verified with synthetic data, not a real provider key.

## Verification

- Disposable PostgreSQL full migration/integration suite passed, including Secret Manager save/read/remove, wrong-owner/provider references, cloud failures, stale concurrent saves/deletes, revoked sessions/members, suspension and guest expiry/purge cleanup.
- Lint and types passed (one pre-existing warning in an ignored local screenshot helper).
- Final combined gate: **250 unit files / 5,917 tests passed**, disposable PostgreSQL suite, lint/types, production build and smoke passed. The migration inventory was updated for 0064. Final regression coverage also proves account/session lock ordering during revocation and that cleanup retry backoff never extends a save's fixed publication deadline.
- Relative documentation links and diff checks passed. JOB-088's full-app synthetic phone screenshots were refreshed and inspected. Temporary app/browser processes and the owned disposable PostgreSQL server were stopped after checks.
- Live Secret Manager/IAM checks and activation passed as recorded above. Push, GKE deployment and the scoped activation were authorized; future unrelated production changes still require separate authority.
- Activation follow-up gate: **250 unit files / 5,919 tests**, full disposable PostgreSQL integration suite, lint/types, production build and smoke all passed. The existing ignored screenshot-helper lint warning is unchanged. The map tests now verify early timer wake/cancellation deterministically; the cleanup manifest test expects the explicitly enabled public schedule.

## Documentation impact

Updated: entry points/rules/history, design decisions, roadmap/job indexes, architecture/source map, database compatibility, AI key contract, security/privacy/threat model, member funding cross-reference, case study, self-hosting/deployment, environment template and documentation inventory. Settings protection/help copy is updated in all locales. No schema or user-facing data enters Git.

Release follow-up updates CHANGELOG, roadmap/job indexes, key contract/decision, deployment guidance, the cleanup manifest/contract test and this handoff with verified cloud evidence. The focused route-rate repair preserves its existing public-provider contract; its source/tests and publication-fence test fixture changed. Remaining feature contracts are unchanged.

Reviewed but unaffected: CLAUDE/CONTRIBUTING/security reporting entry points; core product journeys and money semantics; destination defaults; instructions/retired preferences; activity and feedback; pending edits, venue hours, research, booking prices, image inputs, recovery, provider failures and conversation history; communications, Calendar, maps, weather/disruption/flight logic; expense/repayment/mobile-card/layout contracts; localization architecture; CI workflow, Dockerfile/Compose, sources bibliography and job-runner policy. New source links live with the key contract. JOB-088 separately owns icon/screenshots changes.

## Recovery / limitations

Migration 0064 preserves legacy ciphertexts and adds reference-only storage behind explicit configuration. Keep compatible code and Secret Manager/KMS read access after saving references; no automatic bulk migration or downgrade. Deleted secrets cannot be recovered from a database dump; re-enter keys. A delete of an already absent key does not cancel its first in-flight save (the UI only offers Remove for saved keys); revoking its session still prevents that save. Existing-key concurrent deletion is covered.
