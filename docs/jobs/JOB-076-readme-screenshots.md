---
id: JOB-076
title: A brief README with phone screenshots, and a documentation index
status: done
priority: P3
depends_on: []
claimant: CHL-work
branch: main
started: 2026-11-07T00:10Z
---

## Outcome

On 6 November 2026 the owner asked for phone screenshots in the README and a brief README. Design and implementation details belong in other documents, with the README pointing to them so that people and AI agents can find what they need.

## Scope

- **In:** the README, five screenshots, a documentation index, moving the README's diagram and stack summary into existing documents, and the rules that keep them current.
- **Out:** application code and other documents' content. Three app issues seen while taking the screenshots are left for a separate job: the guest notice still says AI needs your own key, "1 repayments" and "1 expenses" in the expense day headers, and raw `<br/>` tags shown in a free-model reply.

## Delivered

1. **README:** what Stardust is, how to try it, five screenshots, six highlights, a **Find your way** table, the quick start and the license. It also corrects the live-instance line: sign-up and guest mode are on.
2. **Screenshots** in `docs/screenshots/`: Today, the itinerary in Cantonese, a day map, expenses, and an AI proposal awaiting approval.
3. **[Documentation index](../README.md):** every document by area, one line each.
4. **Moved, not lost:** the README's diagram is in [deployment](../DEPLOYMENT.md#what-runs-where), and its stack summary in [architecture](../ARCHITECTURE.md#at-a-glance).
5. **Rules:** [AGENTS.md](../../AGENTS.md) points to the index, and the [documentation policy](../DOCUMENTATION_POLICY.md) says to keep it and the screenshots current.

## How the screenshots were made

- **Build:** the production build of commit `767b8e8`, run locally on a disposable PostgreSQL 17 database, in headless Edge at 390 × 844 CSS pixels and twice the pixel density, with the light theme and the new layout.
- **Data:** synthetic only, starting from a guest demo trip:
  - moved two days earlier, so today is day 2;
  - four made-up members, Ada, Ben, Chloe and Dan, added directly in that database because guest trips cannot invite people;
  - synthetic events and bills in yen, one repayment, and one request to the free guest AI;
  - venue names the day map can pin, and one place saved as a coordinate link.
- **Hidden:** the guest notice, which signed-in accounts never see.
- **Map:** tiles © OpenStreetMap contributors, places from Photon, routes from FOSSGIS OSRM.
- **Files:** compressed to palette PNG, about 550 KB in all.

To refresh a screenshot, repeat this with synthetic data only, and replace the file under the same name.

## Verification

- Every relative link and anchor in the changed documents resolves.
- The documentation index lists every file in `docs/`.
- The screenshots, captions and alt text contain no real names, addresses, emails or keys.
- The README renders on GitHub with the five screenshots in one row.

## Rollback

Revert the commit. There is no migration.
