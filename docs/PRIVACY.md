# Privacy notice (draft)

**Status:** a draft for the operator of the public instance to review before guest mode or public sign-up is turned on (JOB-065). It describes what the software does. A self-hosted instance's operator should adapt it to their own hosting and contact details.

## What is stored

- **Your account:**
  - Your Google account's subject identifier, email address and display name, used to sign you in.
  - A guest account has none of these: only a random identifier.
- **Trips you take part in:** events, places, times, notes, expenses, repayments, approvals and their history.
  - Trip history is kept even when a trip is deleted for its members, so that money and changes stay traceable.
  - Guest trips are the exception: they are permanently deleted after 24 hours.
- **AI use:**
  - Your prompts, the replies and pictures you attach, the model used, and which key paid.
- **Your own AI keys:**
  - Encrypted, and never shown again after you save them; only the last four characters are.
  - You can remove a key at any time in Settings → AI keys.
- **Google Calendar**, if you connect it: encrypted tokens, and which of your calendar entries were imported.
- **Feedback you send:** the report and, if you agree, recent diagnostic context. If the operator enables issue filing, a reviewed, de-identified summary may become an issue in a GitHub repository. The public instance does not file issues today, and JOB-066 moves filing to a private repository.
- **Security records:** sign-in sessions, and rate-limit counters keyed by a hash of your network address and browser.

## Who receives it

- **Other members of a trip** see that trip's shared content, as permitted by their role. Private events are visible only to the people they are shared with.
- **AI providers** (OpenAI, Anthropic or Google) receive the prompt and trip context for each AI request, under the key that pays for it:
  - your own key;
  - a trip owner's key shared with you;
  - or the operator's key in a trip the operator sponsors.

  Their own terms apply to what they keep.
- **Google** receives what is needed for sign-in and, if you connect it, Calendar.
- **Cloudflare** carries the connection to the instance and, for guests, runs the Turnstile check.
- **The operator** can access the database to run and recover the service. Backups are encrypted and kept for 30 days.

## Your choices

- Leave a trip, ask an owner to remove you, or, as an owner, delete a trip (its records are kept as described above).
- Remove your AI keys and disconnect Calendar at any time.
- Guest accounts need no personal details and are deleted automatically after 24 hours.
- Deleting a whole Google-linked account is not self-service yet; ask the operator.

## Contact

The operator of the public instance: see the repository's [security policy](../SECURITY.md) for how to reach them privately.
