---
id: JOB-070
title: Own-key AI requests that read links, take any topic and add new items directly
status: done
priority: P1
depends_on: [JOB-061]
claimant: CHL-work
branch: main
started: 2026-11-06T11:20Z
---

## Outcome

On 6 November 2026 the owner pasted a Luma event link into the trip AI. The AI answered that it could not see the link's content and would only draft an event for approval once given the name, time and place. The owner asked to "fix the AI feature", noting that users bring their own keys, so the guardrails should loosen and the AI should not refuse what the user wants.

There were three causes:

- The models had no page-reading tool.
- The isolated research step never sends URLs to search, which is deliberate, to protect privacy.
- Every AI-created item waited in Approvals, even for the owner.

The owner chose that, on their own key, new events and expenses they could add by hand are added at once. Edits keep their existing rules: an owner's text-only edits already applied directly.

Decision: [D-085](../DECISIONS.md#d-085-own-key-ai-requests-read-links-take-any-topic-and-add-new-items-accepted-november-6-2026).

## Delivered

Only for requests paid by the requester's own key; shared-key and operator-funded requests are unchanged. [JOB-072](JOB-072-operator-own-ai.md) later applied the same rules to the platform operator's own requests on the server's keys, and to new items from pictures.

1. **Linked pages** (`src/lib/ai/linked-pages.ts`). Up to three http(s) links in the request are read by the server and given to the model as untrusted `LINKED_PAGES_JSON`: title, description, structured event or place data from JSON-LD, and readable text. The guards:
   - ports 80 and 443 only;
   - every resolved address must be public, for IPv4 and IPv6, with mapped and NAT64 forms judged by their IPv4 address;
   - the connection uses exactly the checked address, so DNS rebinding cannot redirect it;
   - at most three redirects, each checked again;
   - 8 seconds, 1.5 MB, and HTML or text only.

   Links that the reservation-secret inspector treats as private stay redacted and unread. An `ai_request_events` row records how many links were read and the error kinds, never URLs or content.
2. **Any topic:** the deterministic off-topic reply is skipped, and the prompt tells the model to help with anything, answering non-trip questions in message without proposals.
3. **New items added directly** (`applyOwnKeyAiCreateWithClient`). A validated AI create from the request is added at once when the requester could add it by hand:
   - **Owners:** always, through the ordinary owner review.
   - **Members:** with direct itinerary or expense permission and no required approval, including for a linked expense; the action is audited as `own_key_ai`.
   - **Kept for review:** requests with pictures, edits, deletions and other members' requests.
   - **The model's instructions** say so, so its reply says the item was added. The reply is marked applied only when every change applied.
4. **Settings:** the own-key AI note now says it can help with anything, reads pasted links and adds new items straight away.

## Verification

- **Unit tests:**
  - link extraction;
  - public-address rules for 24 addresses;
  - the DNS answer filter, including a name that resolves to a public and a metadata address;
  - blocked targets with no request sent;
  - a redirect to the metadata server being refused;
  - the redirect limit, not-text, HTTP error, oversize and unreachable cases;
  - event-page extraction.
- **Prompt tests:** the review wording stays for other funding; for own-key requests, the direct-add wording, the any-topic rule, and linked pages escaped so that a page cannot close its own section.
- **Planner tests:**
  - an off-topic own-key request reaches the model;
  - own-key creates are applied and reported as applied;
  - operator-funded creates stay pending.
- **Database tests** (`tests/database/own-key-ai.mjs`):
  - the direct-add scope per role and permission;
  - an owner's and a permitted member's creates added and audited;
  - a linked expense needing approval stays pending;
  - a member needing approval, another member's request, a manual request and a second apply all stay pending.
- **Live, from a workstation:**
  - A real Luma event page gave its name, start and end with UTC offset, venue, address and organizer, after following lu.ma's redirect to luma.com.
  - The metadata server, loopback, private ranges, an IPv4-mapped metadata address, a non-standard port and `metadata.google.internal` were all refused.

## Rollback

Revert the commits. Nothing in the schema changed. Items already added stay as ordinary approved changes with their audit records.
