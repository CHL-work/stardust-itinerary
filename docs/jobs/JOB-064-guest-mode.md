---
id: JOB-064
title: Guest accounts and public sign-up readiness
status: review
priority: P1
depends_on: [JOB-061]
claimant: CHL-work
branch: main
started: 2026-11-04T07:00Z
---

## Outcome

Anyone can try the public instance without an account: **Try as guest** gives a 24-hour guest account with a synthetic demo trip, AI only on the guest's own API key, and permanent deletion afterwards. Guests never mix with real trips. Decision: [D-077](../DECISIONS.md#d-077-guest-accounts-for-trying-the-public-instance-accepted-november-4-2026); contract: [guest accounts](../PUBLIC_TRIPS_AND_MEMBERS.md#guest-accounts).

The owner asked for this on November 4, 2026: a guest option without Google sign-in, with guest data deleted within a day, and AI only with the guest's own key.

## Delivered

1. **Migration 0056:**
   - `app_users.guest_expires_at` and `trips.guest_expires_at`.
   - Isolation triggers on accounts, trips, members, join links, claim links and feedback reports.
   - `app_purge_expired_guest(uuid)`, a `SECURITY DEFINER` function with a fixed `search_path`, revoked from `PUBLIC`. It:
     1. checks isolation;
     2. deletes the guest's rows from every table with `trip_id`, plus the guest's account rows, with triggers suspended for those deletes only;
     3. turns triggers back on and proves no foreign key still references the deleted trips or account, or rolls back.
2. **Creation:** `createGuestSession` in `src/lib/app/guest.ts` creates, in one transaction:
   - the guest with an identity under `urn:stardust:guest`;
   - a one-member Tokyo trip with AI on and unsponsored, Calendar off and disruption checks off;
   - three days of seven demo events in the browser's language, through `createChangeRequestWithClient` and `applyPermittedChangeRequestWithClient`;
   - a session ending with the account.

   Creation is serialized behind an advisory lock and capped by `GUEST_ACTIVE_LIMIT`.
3. **Route:** `POST /api/auth/guest` returns:
   - `404` unless `GUEST_MODE_ENABLED=true`;
   - `400` for unknown fields;
   - `429` beyond three an hour per browser address;
   - `403` when a configured Turnstile check fails;
   - `503` at capacity;
   - `201` with the session cookie on success.
4. **Restrictions:** `assertNotGuest` refuses adding members, join links, new trips, feedback and destination lookups. Guest members are created without Calendar sync, and the database refuses invitations.
5. **Purge job:**
   - `scripts/run-guest-purge.ts` and the `guest-purge` entrypoint mode, also run hourly by the Compose scheduler.
   - CronJob `stardust-guest-purge`, with only `app-env` and a NetworkPolicy allowing only the database and DNS.
   - It prints only counts, and exits 1 when it refused a guest.
6. **UI:**
   - **Try as guest** on the sign-in page, with an explicit-render Turnstile widget when `TURNSTILE_SITE_KEY` is set.
   - A guest banner with the deletion time, the AI-key hint and a sign-in link.
   - Invite controls are hidden for guests.
   - Copy for the in-app parts in all four languages. The sign-in page itself is English, like the rest of that page.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:db` pass; the production build and smoke test pass.
- `tests/database/guest-accounts.mjs` covers:
  - creation: the session issuer and lifetime, overview fields, seven demo events, unsponsored AI and own-key funding;
  - refused members, trips and join links;
  - the database triggers for mixing, invitations and turning an account into or out of a guest;
  - the capacity cap;
  - purge eligibility: no purge before expiry, and never for a real account;
  - a refused, leaky guest that changes nothing;
  - complete deletion across every `trip_id` table, plus account, identity, keys and sessions;
  - an untouched real trip, and a later purge after the leak is repaired.
- Unit tests cover the route (404, rate limit and Turnstile order, 403, 429, 400, cookie), the Turnstile verifier (redirects refused, fails closed), locale mapping, the sign-in button gating and the banner in all locales.

## Not in this job

- **Self-service account deletion** for Google accounts needs its own design, because D-073 keeps trip records. It is a follow-up job.
- **Turning on guest mode or public sign-up on the public instance:** owner decisions after the JOB-065 review.
  - Guest mode needs `GUEST_MODE_ENABLED=true` and Turnstile keys in `stardust-app-env`.
  - Public sign-up needs `PUBLIC_SIGNUP_ENABLED=true`.
- **Feedback for guests:** the in-app feedback widget still appears for them. Submitting is refused with a clear message.

## Rollback

Migration 0056 is additive, and no existing row trips its triggers. An older build never creates guests. After a rollback, existing guests wait for a build with the purge job.
