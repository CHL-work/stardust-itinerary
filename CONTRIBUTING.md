# Contributing

Thanks for your interest. Issues and pull requests are welcome.

## Before you start

- Read [AGENTS.md](AGENTS.md); the rules there apply to humans and coding agents alike. The [design](docs/DESIGN.md) and [decisions](docs/DECISIONS.md) explain why things are the way they are.
- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Never include real trip data, receipts, API keys or personal information in issues, commits, tests or screenshots. Use synthetic data.

## Development setup

You need Node.js 24, pnpm 11 and PostgreSQL 17.

```bash
pnpm install
cp .env.example .env.local    # AUTH_SECRET, a Google OAuth client and a local database
pnpm db:migrate
pnpm dev                      # http://127.0.0.1:3100
```

## Checks

`pnpm check` runs everything CI runs: lint, types, unit tests, the database suite, the production build and a smoke test. The database suite needs a disposable database it may destroy:

```bash
export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/stardust_test
export TEST_DATABASE_CONFIRM_DESTROY=stardust_test
pnpm check
```

## Pull requests

- Keep one change per pull request, with tests for new behavior.
- Update the documentation the change affects, plus `CHANGELOG.md` under **Unreleased** ([documentation policy](docs/DOCUMENTATION_POLICY.md)).
- UI text needs English, both Cantonese tones and Japanese ([localization](docs/LOCALIZATION.md)).
- Database changes are new forward-only migrations; never edit an applied one.
