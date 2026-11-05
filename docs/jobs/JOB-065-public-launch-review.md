---
id: JOB-065
title: Public-launch security and privacy review
status: done
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
3. A [privacy notice](../PRIVACY.md) describing what the software stores and shares.
4. **Credential follow-ups from the JOB-061 review:**
   - an encryption-key ring with re-encryption (rotation);
   - an explicit credential context for operator-funded calls in the web server.

## Results (4 November 2026)

- **Privacy notice:** finished and published. The sign-in page links it through `PRIVACY_NOTICE_URL`. It also says how the public instance may be used, in place of separate terms.
- **Key ring:** `CREDENTIAL_ENCRYPTION_KEY_VERSION` and `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` (read-only older keys). `credential-reencrypt` re-seals every stored key under the current version, then the old key is removed ([procedure](../DEPLOYMENT.md#rotating-the-encryption-key)). The public instance's key was rotated to version 2 this way.
- **Explicit funding context:** the code that decides who pays enters `withOperatorAiCredential` or `withUserAiCredential`. Provider adapters throw outside one, and the operator-funded destination lookup refuses a user's context.
- **Launch gates:** the owner asked for guest mode on 4 November 2026. Turnstile keys and `GUEST_MODE_ENABLED=true` were added, and the guest purge was fixed to reach DNS on GKE. The owner turned public sign-up on the same day (`PUBLIC_SIGNUP_ENABLED=true`, D-080). Google OAuth verification is still open.

## Out of scope

- Turning on `PUBLIC_SIGNUP_ENABLED` or `GUEST_MODE_ENABLED` on the public instance. Those are owner decisions; the owner turned both on.
- Google OAuth verification, which is a separate owner decision.
- Terms of service text, which needs the owner's own terms.

## Acceptance

- The threat model matches the code, and every launch gate is either done or listed as an owner action.
- Review findings rated medium or above are fixed, or recorded with the reason they are accepted.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:db` pass.
