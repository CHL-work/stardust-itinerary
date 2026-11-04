---
id: JOB-063
title: Trip-owner AI key sharing
status: in_progress
priority: P1
depends_on: [JOB-061]
claimant: CHL-work
branch: main
started: 2026-11-04T06:00Z
---

## Outcome

A trip owner can let chosen members use the owner's own AI keys (JOB-061) in that trip. The owner opts in per member: with a checkbox when adding a member or creating the trip's join link, and with an on/off switch on each member afterwards. Members using a shared key never see it, use the trip's one model, and stay within the trip's daily prompt limit.

The owner asked for this on November 4, 2026: invite people to a trip, with a checkbox to let the member use the owner's API keys, and an option to turn that off and on again.

## In scope

1. **Storage (migration 0055):**
   - `trip_ai_key_grants(trip_id, member_id, sponsor_member_id, created_at)`, with one grant per member. It names the owner whose keys pay, and is deleted with either membership.
   - `trip_join_links.shares_ai_keys`: whether people joining through the link receive a grant from the owner who created it.
   - `ai_requests.credential_sponsor_member_id`, set exactly when `credential_source = 'shared'`.
2. **Granting:**
   - `POST /members` and `POST /join-links` accept `shareAiKeys`.
   - `PUT /members/{memberId}/ai-key-grant` with `{shared}` turns a member's grant on, sponsored by the acting owner, or off.

   Only active owners can grant, and never to themselves. Every change is audited without key material.
3. **Resolution:** `getAiPolicy` tries, in order:
   1. the requester's own key;
   2. a usable grant, which is `shared`;
   3. operator sponsorship;
   4. `ai_key_required`.

   A grant is usable only while its sponsor is an active owner of the trip and holds a key. Shared requests:
   - use the trip's default model if the sponsor holds its provider's key, or else the sponsor's first provider's default model;
   - ignore a member's model choice;
   - count against `member_daily_limit`.

   Own-key requests count toward no trip quota.
4. **Plumbing:** the planner and location search run shared requests in the credential context with the sponsor's key. The member never receives it.
5. **UI:**
   - A checkbox on the add-member form and on join-link creation.
   - Per-member share switches in the members list, visible to owners.
   - The AI tab tells a member whose key is in use, which model runs and how many prompts are left.
   - Owners of an unsponsored trip can choose the trip's model from their own providers' models.
   - Copy in all four languages.
6. **Docs:** PUBLIC_TRIPS_AND_MEMBERS, DECISIONS (D-076), AGENTS funding rules, DATABASE, IDENTITY_AND_SECURITY, CHANGELOG, ROADMAP.

## Out of scope

- Cost caps and per-provider spend tracking. The daily prompt limit is the only cap.
- Sharing keys across trips, or with guests (JOB-064).
- Letting a member see or export the sponsor's key, or choose a different model on it.

## Acceptance

- A member with a grant can plan in an unsponsored trip on the sponsor's key, within the daily limit, and the request records `shared` and the sponsor.
- Turning the switch off, demoting or removing the sponsor, or the sponsor deleting their key stops shared use at the next request.
- Grants cannot be created by non-owners, for oneself, or across trips. Join-link grants apply only to members who joined through that link while its creator was an active owner.
- No API response, audit payload or browser state contains the sponsor's key.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:db` pass.
