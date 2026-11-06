# Privacy notice

This notice covers the public instance at <https://stardust-itinerary.chl-work.com>, which the project's maintainer runs as a personal project (the operator). It describes what the software stores and shares. Last updated 6 November 2026.

If you run your own instance, adapt this notice to your hosting and contact details, and link it with `PRIVACY_NOTICE_URL` (see [deployment](DEPLOYMENT.md)).

## Where it runs

- **Google Cloud,** in Tokyo (`asia-northeast1`), hosts the service, its database and its encrypted backups.
- **Neon,** a PostgreSQL service, keeps a daily copy of the database in Singapore, outside Google Cloud, so the service can be recovered if Google Cloud is unavailable.
- **Cloudflare** carries every connection to the instance. For guests, it also runs the Turnstile check.

## What is stored

- **Your account:**
  - Your Google account's subject identifier, email address and display name, used to sign you in.
  - A guest account has none of these. It has a random identifier, plus a keyed hash of the network address that created it, used to limit guests per address.
- **Trips you take part in:** events, places, times, notes, expenses, repayments, approvals and their history.
  - Trip history is kept even when a trip is deleted for its members, so that money and changes stay traceable.
  - Guest trips are the exception: they are permanently deleted after 24 hours.
- **AI use:** your prompts, the replies, any pictures you attach, the model used, and which key paid.
- **Your own AI keys:**
  - Encrypted with a Google Cloud KMS key. No one can read or copy that key, including the operator.
  - Only this site's server may use the KMS key, an access rule that binds the operator too, and Google logs every use.
  - The server decrypts your key only to send your own requests, and members' requests if you share the key with them. Whoever runs a server could change it, so use a key made for Stardust with a spending limit at your provider.
  - Never shown again after you save it; only the last four characters are.
  - You can remove a key at any time in Settings → AI keys.
- **Google Calendar**, if you connect it: encrypted tokens, and which of your calendar entries were imported.
- **Feedback you send:**
  - the report itself, and, if you agree, recent diagnostic context;
  - a reviewed, de-identified summary may become an issue in the operator's **private** GitHub repository. Issues are never filed in the public source repository.
- **Security records:**
  - sign-in sessions, with the type of device;
  - rate-limit counters, keyed by a keyed hash of your network address and browser, or of your account. Counters older than two days are deleted;
  - daily counts of attempts the service refused, such as rate-limited requests, with your account when the attempt had one;
  - whether the operator suspended your account, and when.

## Who receives it

- **Other members of a trip** see that trip's shared content, as permitted by their role. Private events are visible only to the people they are shared with.
- **Free guest AI:** a guest without a key who uses AI sends the prompt and the demo trip's details to Kilo Code's AI Gateway, and through it to the free model's provider, for example NVIDIA. Free models may keep what they receive and use it to improve their models, so guests are told not to include personal details.
- **Websites you link** in an AI request on your own key (or, for the operator, on the server's keys): the server fetches those public pages, so each site sees a request from this service (not your browser), and the page text goes to your AI provider with your prompt.
- **AI providers** (OpenAI, Anthropic or Google) receive the prompt and trip context for each AI request, under the key that pays for it:
  - your own key;
  - a trip owner's key shared with you, in which case the request also appears in that owner's provider account;
  - or the operator's key, in a trip the operator sponsors.

  Their own terms apply to what they keep.
- **Google** receives what is needed for sign-in and, if you connect it, Calendar.
- **Map services,** when you open a day map:
  - the Photon place lookup (run by Komoot) receives the place names of that day's stops, and the FOSSGIS route service the coordinates between them. Private places are included unless you turn them off on the map. Event titles, notes and people are never sent;
  - your browser loads the map images from OpenStreetMap, which sees the area you view.
- **Open-Meteo** receives the coordinates of trip places for weather forecasts; for private events, only the trip's destination.
- **GitHub** stores the private feedback issues described above.
- **The operator** can access the database to run and recover the service. An admin page that only the operator can open shows:
  - each account's name, email, sign-up date and last activity;
  - how many trips it owns or joined;
  - which AI providers it has a key saved for, but not the key;
  - daily counts of its AI requests, which key paid for them, and refused attempts;
  - its sessions' device types, and the size and age of its trips, without trip names.

  The page never shows trip contents, prompts, replies or keys.

## How long it is kept

- **Guest accounts and their trips:** permanently deleted 24 hours after they start.
- **Sessions:** expire after 24 hours without use, and after 30 days at most.
- **Backups:** encrypted, and kept for 30 days.
- **Daily copies at Neon:** the three newest are kept, so data deleted here is gone from them within four days.
- **Daily activity counts:** kept for 90 days.
- **Everything else** stays until you or a trip owner remove it, or the operator deletes it on request.

## Your choices

- Leave a trip, ask an owner to remove you, or, as an owner, delete a trip. Its records are kept as described above.
- Remove your AI keys and disconnect Calendar at any time.
- Use a guest account, which needs no personal details and is deleted automatically after 24 hours.
- Ask the operator to delete your Google-linked account; this is not self-service yet.

## Using the public instance

- It is a personal project. It comes with no guarantee of availability, and may change or stop.
- Requests on your own AI key are billed to your provider account, under your provider's terms.
- Do not use it to attack the service or other people. The operator may suspend accounts that abuse it, pause new sign-ups or turn off guest mode. A suspended account cannot sign in until the operator restores it, and keys it shared stop working for others.
- The software is open source under the MIT license.

## Contact

- **Signed-in users** can write to the operator through the in-app feedback form. Reports are private to the operator.
- **Anyone** can reach the operator privately through GitHub's private vulnerability reporting on the [repository](https://github.com/CHL-work/stardust-itinerary). See the [security policy](../SECURITY.md).
