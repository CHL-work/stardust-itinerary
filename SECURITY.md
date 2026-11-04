# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue, and do not include real trip data, keys or other people's information in a report.

Expect an acknowledgement within a week. Fixes are deployed to the public instance as soon as they are reviewed.

## Scope

In scope: this code and the public instance at <https://stardust-itinerary.chl-work.com>. Please test only with your own account and synthetic data, never other people's trips, and do not run load tests or automated scanners against the public instance.

Particularly interesting:

- authorization between trips and members, including private events and expenses;
- session, invitation and Google account binding;
- prompt injection that makes a model reach data or tools it should not;
- leakage of provider keys, OAuth secrets or database credentials.

## Design notes

The security model is documented in [identity and security](docs/IDENTITY_AND_SECURITY.md), [AI boundaries](docs/AI_AND_AGENTS.md) and [deployment](docs/DEPLOYMENT.md).
