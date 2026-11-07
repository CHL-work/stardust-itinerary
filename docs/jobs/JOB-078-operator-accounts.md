---
id: JOB-078
title: Both of the owner's Google accounts act as the platform operator
status: done
priority: P1
depends_on: [JOB-072]
claimant: CHL-work
branch: main
started: 2026-11-07T02:40Z
---

## Outcome

On 6 November 2026 the owner asked that the AI run on their own OpenAI, Anthropic and Gemini keys whichever of their two Google accounts they sign in with. `OWNER_GOOGLE_EMAIL` named one account. A trip the other account created would not have been sponsored, so its AI would have asked for a personal key. In a trip it joined, it already ran on the server's keys, with the member limits.

## Scope

- **In:** `OWNER_GOOGLE_EMAIL` lists one email or several, comma-separated, and every listed account is the platform operator (D-090). That covers:
  - the server's keys paying for trips it creates;
  - its own requests counting as paid by the requester (D-087);
  - the admin page, feedback review, and the map and destination quota exemptions;
  - the owner-invitation check.
- **Out:**
  - Trip roles: in a trip someone else owns, a listed account follows that trip's AI rules like any member.
  - Own-key, shared-key and free funding.
  - Schema: there is no migration.

## Delivered

1. **One parser** (`src/lib/auth/operator-access.ts`): `parseOperatorEmails` trims, lower-cases and removes duplicates. Blank means no operator, and a list with an entry that is not an email names nobody.
2. **Operator check:** `isPlatformOperator` matches any listed email against the account's stored verified Google identity, never a trip role.
3. **Sign-in configuration:** `ownerGoogleEmails` replaces the single email. An owner invitation accepts any listed account, and an invalid list is refused like an invalid email before.
4. **Admin page:** every listed account is marked as the operator and cannot be suspended.
5. **Documents:** [self-hosting](../SELF_HOSTING.md), [identity and security](../IDENTITY_AND_SECURITY.md), [design](../DESIGN.md), [architecture](../ARCHITECTURE.md), [feedback](../FEEDBACK.md), `.env.example` and [D-090](../DECISIONS.md).

## Verification

- **Unit tests:** case, spaces, duplicates, blanks and entries that are not emails; `isPlatformOperator` with two accounts; the sign-in configuration with one, two and invalid entries.
- **Database tests:**
  - an owner invitation accepts an account from a two-email list;
  - on the admin page, a second listed account can open it, is marked as the operator, and cannot be suspended.
- **Production before the change:** both of the owner's accounts had verified Google identities, and only one was the operator. The server's OpenAI, Anthropic and Gemini keys each reached every selectable model, through free model lookups and Gemini token counts.

## Rollback

Set `OWNER_GOOGLE_EMAIL` back to one email and restart the web server, or revert the commit. There is no migration.
