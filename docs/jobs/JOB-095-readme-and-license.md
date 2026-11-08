---
id: JOB-095
title: README story and features, English screenshots, phone install, and the Apache 2.0 license
status: done
priority: P2
depends_on: [JOB-093, JOB-094]
claimant: Claude
branch: agent/JOB-093-ai-tab
started: 2026-11-08T07:45Z
---

## Outcome

On 8 November 2026 the owner asked the README to say why the app exists, what it does and how to install it on a phone, that the public instance runs on Google Cloud for anyone to try while the owner's $300 credit lasts, where to send feedback, and that keys are encrypted; to replace the screenshots with five English ones; and to relicense under Apache 2.0 (D-107).

## Scope

- **In:**
  - README sections for the story, key features, phone install, hosting and feedback;
  - five English screenshots from a local build with synthetic data: overview, an itinerary with a changed flight time, an AI proposal, a three-stop day map and the API keys section;
  - the Apache License 2.0 text, a NOTICE file and every license reference.
- **Out:**
  - changes to third-party data licenses, which stay CC BY 4.0 (GeoNames) and MIT (mwgg/Airports).

## Delivered

1. **README:** a one-line pitch, **Why I built this** in the owner's words, **What it does** (routine checks that warn about surprises, events from a photo, events from a pasted email or text, expenses, the shared itinerary, usage, free or own keys with encryption, twelve languages), **Install it on your phone**, and **Try it and tell me what you think** (Google Cloud, the $300 credit, issues in this repository or the in-app feedback button). The navigation table and development steps are unchanged.
2. **Screenshots:** `overview.png`, `itinerary-flight-changed.png`, `ai-proposal.png`, `day-map.png` and `api-keys.png` replace the JOB-076 set; `today.png`, `itinerary-cantonese.png` and `expenses.png` were removed.
3. **License:** the canonical Apache License 2.0 text in `LICENSE` (byte for byte, so GitHub detects it), a `NOTICE` with the copyright and bundled data attributions, `"license": "Apache-2.0"` in `package.json`, and the README, privacy notice and GeoNames attribution updated. The sole copyright holder relicensed; earlier commits remain available under MIT.

## How the screenshots were made

All synthetic, on a loopback server; the helpers stay in the session scratchpad, not the repository.

1. Build the branch (`pnpm build`), then run `.next/standalone/server.js` on `http://127.0.0.1:3214` against a disposable PostgreSQL 17 database with guest mode on (no Turnstile, placeholder Google values, a random encryption key).
2. Seed through the app's own API as a guest: a three-day Tokyo trip with today as day 2, four members (the guest one-member guard is lifted only for these inserts, in the throwaway database), events including two flights with flight numbers, three day-2 stops that the day map can pin (明治神宮, Shibuya Sky, Tokyo Tower), bills and a repayment.
3. Capture the day map before any pending proposal exists, so it shows exactly three numbered stops.
4. Add the AI proposal through the app's AI proposal function (`createAiCreateRequestsWithClient`, source `ai`), because the free gateway was rate-limiting the address. Apply the flight change through `runDueFlightStatusChecks` with a scripted, source-backed 40-minute delay, so the event gets a real revision, audit entry and **Changed** badge.
5. For the API keys shot, add a key row of random bytes with a fake last-four hint and routine checks turned on; listing keys never decrypts.
6. Capture at 390×844, device scale 2, light theme, in headless Edge over CDP with the guest banner hidden; compress to palette PNGs with sharp. Stop the server and drop the database afterwards.

## Verification and documentation impact

- Viewed every screenshot; checked README and documentation links, the license hash (`cfc7749b…`) and that no screenshot shows real data.
- Documents: README, NOTICE, LICENSE, D-107, privacy notice, documentation index and policy (screenshot method now points here), roadmap (JOB-058 notes the relicense), changelog and the jobs list.
