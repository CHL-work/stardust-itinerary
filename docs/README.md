# Documentation index

Every document in this repository, by area, with one line each. The [README](../README.md) is the overview; this page is the map. Feature documents are contracts for current behavior; plans are in the [roadmap](ROADMAP.md).

## Start here

- [README](../README.md): what Stardust is, with screenshots.
- [AGENTS.md](../AGENTS.md): rules for every human and AI contributor. [CLAUDE.md](../CLAUDE.md) points there.
- [Contributing](../CONTRIBUTING.md): setup, checks and pull requests.
- [Case study](CASE_STUDY.md): the engineering choices, in one page.
- [Roadmap](ROADMAP.md): status and plans; one record per job in [jobs](jobs/README.md).
- [Changelog](../CHANGELOG.md): what changed, newest first.

## Product and design

- [Design](DESIGN.md): product behavior, roles and the main user journeys.
- [Decisions](DECISIONS.md): accepted decisions (D-numbers), trade-offs and pushbacks.
- [Screen layout](UI_LAYOUTS.md): the one layout, its phone and desktop rules and its CSS.
- [Mobile cards](MOBILE_CARDS.md): lightweight event icons, event and expense cards on phones, and cancelled-event removal.
- [Localization](LOCALIZATION.md): English, two Cantonese tones, Japanese and the eight languages kept as translation packs; voice and brief UI copy.

## Architecture and code

- [Architecture](ARCHITECTURE.md): runtime, code boundaries and data consistency.
- [Implementation](IMPLEMENTATION.md): shipped scope, stack, source map, routes and how to verify a change.
- [Database](DATABASE.md): schema, transactions, migrations and restore.
- [Job system](JOB_SYSTEM.md): how work is proposed, claimed, checked and handed off.

## Features

- [Trips and members](PUBLIC_TRIPS_AND_MEMBERS.md): accounts, member removal, approvals and who pays for AI.
- [Destination defaults](TRIP_DESTINATION_DEFAULTS.md): time zone and currency suggestions on Create Trip.
- [Trip expenses](TRIP_EXPENSES.md): bills, shares and per-person summaries.
- [Member repayments](MEMBER_PAYMENTS.md): records of money already paid between members.
- [Day map](DAILY_MAP.md): numbered OpenStreetMap day maps, place lookup and travel times.
- [Disruption warnings](DISRUPTION_CONFIDENCE.md): which official notices qualify as a warning.
- [Flight status checks](FLIGHT_STATUS.md): how flights are checked before departure and what an update changes.
- [Disruption languages](DISRUPTION_LOCALIZATION.md): warning details in the selected language.
- [Calendar import](CALENDAR_IMPORT.md): adding events from a personal Google Calendar.
- [Calendar conflicts](CALENDAR_CONFLICTS.md): when a Calendar event counts as a clash with the itinerary.
- [Notifications](COMMUNICATIONS.md): what the app sends today, and what it does not.
- [Activity](ACTIVITY.md): the Settings audit view.
- [Feedback](FEEDBACK.md): private reports and their daily review into issues.

## AI

- [AI and agents](AI_AND_AGENTS.md): how requests flow, proposals instead of direct writes, and trust boundaries. Start here.
- [Account-owned AI keys](AI_KEYS.md): user-bound Secret Manager storage, legacy encryption, cleanup and recovery.
- [Automatic research](AI_AUTOMATIC_RESEARCH.md): public facts looked up without being asked.
- [Booking prices](AI_BOOKING_PRICES.md): ordinary prices backed by sources.
- [Venue hours](AI_VENUE_HOURS.md): opening-hours checks for proposed visits.
- [Picture imports](AI_IMAGE_INPUTS.md): pictures sent to the AI, such as bookings and tickets.
- [Pending event edits](AI_PENDING_EVENT_EDITS.md): AI edits to events still awaiting approval.
- [Conversation history](AI_CONVERSATION_HISTORY.md): private, browsable AI chats.
- [Request recovery](AI_REQUEST_RECOVERY.md): requests that survive a phone going to sleep.
- [Provider failures](AI_PROVIDER_FAILURES.md): what users see when a provider fails.
- [Personal instructions](AI_CUSTOM_INSTRUCTIONS.md): the one free-text instruction field.
- [Retired preference chats](AI_PREFERENCE_CONVERSATIONS.md): history only; do not revive.

## Security and privacy

- [Identity and security](IDENTITY_AND_SECURITY.md): sign-in, invitations, sessions and authorization.
- [Threat model](THREAT_MODEL.md): risks on the public instance and what stops them.
- [Privacy notice](PRIVACY.md): the public instance's notice.
- [Security policy](../SECURITY.md): how to report a vulnerability.

## Hosting

- [Self-hosting](SELF_HOSTING.md): Docker Compose on one machine.
- [Deployment](DEPLOYMENT.md): GKE Autopilot, the way the public instance runs.

## Policy and evidence

- [Documentation policy](DOCUMENTATION_POLICY.md): what every change must keep accurate, including this index.
- [Sources](SOURCES.md): dated research bibliography.
- [Screenshots](screenshots/): the README's phone screenshots, synthetic data only ([how they were made](jobs/JOB-076-readme-screenshots.md#how-the-screenshots-were-made)).
