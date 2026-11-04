---
id: JOB-065
title: Public-launch security and privacy review
status: in_progress
priority: P1
depends_on: [JOB-061, JOB-063, JOB-064]
claimant: CHL-work
branch: main
started: 2026-11-04T07:00Z
---

## Outcome

Before strangers can use the public instance (public sign-up or guest mode), its threats are written down with their mitigations, independent security reviews have been run and their findings fixed, and a privacy notice exists for the owner to publish.

## In scope

1. [Threat model](../THREAT_MODEL.md), including the launch gates.
2. An independent security review of each new public surface, with fixes:
   - **Bring-your-own keys:** done in JOB-061.
   - **Key sharing and guest accounts:** done. One high and five medium findings were fixed in migration 0057 and the code; the details are in JOB-063 and JOB-064.
3. A [privacy notice](../PRIVACY.md) draft describing what the software stores and shares, for the owner to review and publish.
4. **Credential follow-ups from the JOB-061 review:**
   - an encryption-key ring with re-encryption (rotation);
   - an explicit credential context for operator-funded calls in the web server.

## Out of scope

- Turning on `PUBLIC_SIGNUP_ENABLED` or `GUEST_MODE_ENABLED` on the public instance. Those are owner decisions after this job.
- Google OAuth verification, which is a separate owner decision.
- Terms of service text, which needs the owner's own terms.

## Acceptance

- The threat model matches the code, and every launch gate is either done or listed as an owner action.
- Review findings rated medium or above are fixed, or recorded with the reason they are accepted.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:db` pass.
