---
id: JOB-063
title: Trip-owner AI key sharing
status: review
priority: P1
depends_on: [JOB-061]
claimant: CHL-work
branch: main
started: 2026-11-04T06:00Z
---

## Outcome

A trip owner can let chosen members use the owner's own AI keys (JOB-061) in that trip. The owner opts in per member: with a checkbox when adding a member or creating the trip's join link, and with an on/off switch on each member afterwards. Members using a shared key never see it, use the trip's one model, and stay within the trip's daily prompt limit. Decision: [D-076](../DECISIONS.md#d-076-trip-owners-can-share-their-own-ai-keys-with-chosen-members-accepted-november-4-2026); contract: [sharing your keys](../PUBLIC_TRIPS_AND_MEMBERS.md#sharing-your-keys-with-members).

The owner asked for this on November 4, 2026: invite people to a trip, with a checkbox to let the member use the owner's API keys, and an option to turn that off and on again.

## Delivered

1. **Migration 0055:**
   - `trip_ai_key_grants(trip_id, member_id, sponsor_member_id, created_at)`: one grant per member, with self-grants refused by a check.
   - `trip_join_links.shares_ai_keys`.
   - `ai_requests.credential_sponsor_member_id`, tied by a check to `credential_source = 'shared'`.
2. **Granting:**
   - `setAiKeyGrant` (`PUT /members/{memberId}/ai-key-grant` with `{shared}`), plus `shareAiKeys` on `createTripMember` (`POST /members`) and on `issueJoinLink` (`POST /join-links`).
   - `consumeJoinLink` grants to people who join through a sharing link while its creator is an active owner.
   - Only active owners can grant, never to themselves, and only with a key of their own. Changes are audited as `ai_keys_shared` and `ai_keys_unshared`.
3. **Resolution:** `getAiPolicy` tries the requester's own key, then a usable grant (`shared`, with `sponsor`), then operator sponsorship, then `ai_key_required`. `usableAiKeyGrant` requires the sponsor to be an active owner holding a key. Shared requests:
   - run the trip model through `ownKeyModel`, and ignore the member's model choice;
   - count against `member_daily_limit` under the same serialization as sponsored requests.
4. **Plumbing:** the planner and location search read the sponsor's key server-side, run in the per-request credential context with source `shared`, and record the sponsor.
5. **Trip model:** owners of an unsponsored trip may set the trip's model. In sponsored trips that remains the operator's choice.
6. **UI:**
   - Checkboxes on the add-member form and the join-link panel, disabled with a hint when the owner holds no key.
   - Share and stop-sharing switches on members, with "Uses {owner}'s AI keys".
   - In the AI tab and Settings: whose key and which model run, and the prompts left.
   - A "model for members who use your keys" picker for owners.
   - Copy in all four languages.
7. **Overview:** owners get `members[].aiKeyGrant`; the viewer gets `ai.sharedKey` (sponsor name and model). `ai.enabled` and `ai.keyRequired` account for shared keys.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:db` pass. The production build and the smoke test pass against a disposable database.
- `tests/database/ai-key-sharing.mjs` covers:
  - migration 0055;
  - who may grant, and the not-found case;
  - funding with the sponsor's provider default and with the trip model;
  - the member holding no copy of the key, and the per-member scope;
  - overview fields for owners and members, with no key in any payload;
  - the sponsor check constraint and the daily limit;
  - turning sharing off, the sponsor deleting and re-adding the key, and the sponsor's demotion;
  - the add-member checkbox, including that a refusal adds nobody;
  - sharing and non-sharing join links;
  - audit without key material.
- Unit tests cover the policy order, model fallback, limit, disabled AI and quota serialization (`src/lib/app/ai-policy.test.ts`). They also cover join-link body validation, and the AI tab's shared-key copy in all locales, default choice and owner-only switch.

## Known limits

- No monthly cost cap: it would need per-model prices. The daily prompt limit is the only cap.
- A sponsor demoted and later promoted again resumes sharing with the members they shared with; owners can turn it off on each member.
- The sponsor sees how many requests members made on the shared key per provider, but not per member.

## Rollback

Migration 0055 is additive. Older builds ignore grants and the sponsor column, and write only `operator` or `own` sources, which the new check accepts.
