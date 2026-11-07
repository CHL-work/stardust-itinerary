---
id: JOB-077
title: A one-line guest notice, singular counts, and line breaks in free-model replies
status: done
priority: P2
depends_on: [JOB-071, JOB-073]
claimant: CHL-work
branch: main
started: 2026-11-07T02:40Z
---

## Outcome

Three issues seen on 6–7 November 2026 while taking the README screenshots for [JOB-076](JOB-076-readme-screenshots.md) on a local build with a guest demo trip:

1. **Guest notice:** three sentences, one of them saying AI needs your own key. Since JOB-071, guests without a key may have free AI. JOB-075 fixed the same claim on the guest sign-in line but missed this notice.
2. **Counts:** the expense day headers said "1 repayments" and "1 expenses".
3. **Free-model replies:** a planning reply from a free model contained `<br/>` tags, which the AI conversation showed as text.

Decision: [D-088](../DECISIONS.md#d-088-brief-ui-copy-with-details-behind-a-few-help-buttons-accepted-november-6-2026); no new decision.

## Delivered

1. **Guest notice:** one short line in every language, with the deletion time and **Sign in to keep trips**. It says "AI needs your own API key" only when AI there needs one: free guest AI is off and the guest has no key.
   - The browser gets only the overview's existing `ai.keyRequired` flag, which the server works out from `guestFreeAiSettings` and the guest's keys. No free-AI setting reaches it.
   - Both Cantonese tones share the neutral line, as deletion copy must.
2. **Counts:** English counts have a singular form, chosen by one shared `countLabel` in `src/lib/i18n.ts`:
   - expense day headers: "1 expense", "1 pending expense" (was "1 Pending expenses") and "1 repayment";
   - repayment history: "1 record";
   - trip settings: "1 place currently reserved", which every new trip showed;
   - member AI limits: "1 prompt remaining", "1 prompt per UTC day", and the shared-key line;
   - advanced settings: "1 output token" and "1 recent log entry";
   - member removal: "1 private expense" and "2 private expenses" instead of "expense(s)".

   Checked and left as they are: counts shown only above one (the AI batch notice, the Calendar bulk sync, "next 3 of N events"), fractions such as "7/20 prompts left", and the unused personal Calendar count.
3. **Line breaks in free-model replies:** `<br>`, `<br/>`, `<br />` and `</br>`, in any case, become newlines in a free model's message and proposal reasons before the reply is stored or shown (`freeOutputAsPlannerJson` in `src/lib/ai/planner.ts`).
   - Replies are still shown as escaped text, never as HTML.
   - Only the free-model path changes. No shared normalization runs for every provider, and a reply on another provider may discuss HTML itself.
   - Patches keep their text as written, for validation to judge.
   - Free-model replies stored earlier keep their tags until the guest purge deletes them within a day.
4. **Rule:** [localization](../LOCALIZATION.md#2-engineering-rules) now says every English count needs a singular form.

## Verification

- **Unit tests:**
  - the guest notice in every language, with and without the key;
  - the expense day headers for one and for several;
  - every singular count in each catalog, with the same placeholders as its plural;
  - the line-break conversion, and a free guest request whose returned and stored reply has newlines.
- **Database test:** a guest's overview asks for a key while free guest AI is off and not while it is on, and carries no gateway address.
- **Full check** on a disposable PostgreSQL 17: lint, types, unit and database tests, the production build and the smoke test.
- **README screenshots:** none shows the changed text, so none was replaced.

## Rollback

Revert the commit. There is no migration.
