---
id: JOB-072
title: The operator's own AI requests follow the own-key rules, pictures included
status: done
priority: P1
depends_on: [JOB-070]
claimant: CHL-work
branch: main
started: 2026-11-06T20:00Z
---

## Outcome

After JOB-070 shipped, the owner pasted the same event link and got the same answer: the AI could not read the page and would only prepare a proposal for approval. The owner then added the event from a screenshot and still had to approve it by hand.

Production showed why:

- Both requests ran on the server's keys (`credential_source = 'operator'`). The owner is the platform operator and has no saved key, and JOB-070 applied only to `credential_source = 'own'`.
- No `links.read` event was recorded. The model asked the isolated research step about the link instead, and that step never sends URLs.
- The fetcher itself works from the cluster: run in the web pod, it read the linked page's JSON-LD event, with its name, start and end with offsets, and venue.

The operator pays for the server's keys, so their own requests are as much theirs as a user's requests on their own key. The owner had also asked that the AI not hold back what they ask for, and pictures still went to review.

Decision: [D-087](../DECISIONS.md#d-087-the-operators-own-ai-requests-count-as-paid-by-the-requester-accepted-november-6-2026).

## Delivered

1. **Who pays:** the requester pays for a request on their own key, or on the server's keys when the requester is the platform operator (`isPlatformOperator`, the configured owner's Google identity). Shared-key and free requests, and other owners and members on the server's keys, are unchanged.
2. **The own-key rules (JOB-070):** such a request may be about any topic, has linked public pages read by the guarded fetcher, and adds at once the new items the requester could add by hand.
3. **Pictures:** on a request the requester pays for, new items from pictures are added at once too, and an owner's picture-based edits apply directly like text-only ones. Other requests keep picture review.
4. **AI card:** the operator sees one line saying that their AI reads links and adds what they ask for right away, instead of the owner note saying AI-created events wait for approval.
5. **Docs:** [decisions](../DECISIONS.md), [AI](../AI_AND_AGENTS.md), [privacy notice](../PRIVACY.md), [threat model](../THREAT_MODEL.md), the agent guide, the roadmap and the changelog.

## Verification

- **Unit tests:**
  - The operator's own request on the server's keys:
    - adds new items directly;
    - reads a link into `LINKED_PAGES_JSON` and records `links.read`;
    - answers an off-topic question;
    - is still recorded as `credential_source = 'operator'`.
  - Another owner on the server's keys reads no link.
  - New items from pictures on the requester's own key are added directly.
  - The operator's picture-based edit applies directly.
  - The prompt wording, and the AI card note in every locale.
- **Production before the change:** the web pod read the linked event page: HTTP 200, with a JSON-LD event giving name, start, end and location.

## Rollback

Revert the commit. There is no migration.
