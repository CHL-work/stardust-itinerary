---
id: JOB-080
title: AI expenses are split between everyone unless the request says otherwise
status: done
priority: P1
depends_on: [JOB-079]
claimant: CHL-work
branch: main
started: 2026-11-07T06:05Z
---

## Outcome

On 7 November 2026 the owner asked that the trip AI use the parts a request gives, and otherwise split an expense between everyone. When nobody said who shares, the AI charged the requester alone, so a group dinner the requester paid for became their personal cost.

## Scope

- **In:** the expense sharing rules in the planner prompt (`src/lib/ai/prompt.ts`) and the reservation rules (`src/lib/ai/reservation-instructions.ts`); the participant evidence check (`src/lib/ai/reservation-assumptions.ts`); their tests; the AI contract and D-092.
- **Out:**
  - the expense data model, which keeps one payer per expense;
  - the server's money checks;
  - whether a request asks to record an expense at all (a pasted price alone still does not);
  - the manual forms;
  - expenses created before the change.

## Delivered

1. **Default:** an expense with no sharers named is split equally between everyone who can see it: every member for a trip-wide event or a standalone expense, the creator and selected viewers for a private event (D-092).
2. **Narrower when the request says so:** people it excludes are left out, sharing with named people uses just them, and an expense clearly the requester's own is theirs alone.
3. **Exact parts:** parts the request gives become `splitAmounts`. Who paid is never taken as a person's part, and several payers of one bill become one expense each, split by the same rules.
4. **Quieter review notice:** an even split between every eligible member, with no private viewers, needs no evidence for its sharers. The "confirm the payer and split members" notice no longer appears for it, and unnamed sharers are not checked for duplicate names. An assumed payer, or a split that leaves some members out without naming the rest, still adds the notice.
5. **Documents:** the [AI contract](../AI_AND_AGENTS.md#reservation-extraction-and-bounded-validation-repair), [D-092](../DECISIONS.md) and the expense note in D-091.

## Verification

- **Unit tests:** the prompt and reservation-instruction tests check the new rules. The evidence tests cover:
  - the default split, with and without payer evidence;
  - duplicate names among unnamed sharers;
  - a named payer with a duplicate name;
  - an exclusion;
  - private viewers.
- **Model evaluation:** the real planner prompt for ten synthetic expense requests in a synthetic four-member trip went to gpt-6.1-sol and claude-sonnet-5-5, with the old and new rules otherwise byte-identical. Nothing was written to the database.

  | Request | Expected | Before (GPT / Claude) | After (GPT / Claude) |
  | --- | --- | --- | --- |
  | Dinner, "I paid" | everyone | requester / everyone | everyone / everyone |
  | Taxi, another member paid | everyone | requester / everyone | everyone / everyone |
  | Tickets, no payer named | everyone | requester / requester | everyone / everyone |
  | Lunch with each person's part | exact parts | exact / exact | exact / exact |
  | Dinner split with one member | the two | the two / the two | the two / the two |
  | Private dinner with one member | the two | the two / the two | the two / the two |
  | Gifts for myself | requester | requester / requester | requester / requester |
  | Karaoke, one member did not come | the other three | three / three | three / three |
  | Hotel, two payers | one expense per payer, everyone | none / two with equal parts listed | two, everyone / two, everyone |
  | "My own ramen" | requester | requester / requester | requester / requester |

  Before, 6 and 8 of 10 matched; after, 10 of 10 for both. Two calls timed out under load and passed on retry.
- **Documents reviewed and unaffected:** README, design, architecture, implementation, identity and security, privacy notice, expenses, member payments, picture imports, pending edits and database.

## Rollback

Revert the commit. There is no migration, configuration or data change, and existing expenses keep their shares.
