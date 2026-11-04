# Self-hosting with Docker Compose

Runs everything on one machine: PostgreSQL 17, the web app and a scheduler for background checks. You need:
- Docker with Compose v2;
- a Google account for the sign-in client;
- an API key for at least one AI provider (OpenAI, Anthropic or Google Gemini), unless every user adds their own in Settings → AI keys.

Kubernetes is covered in [deployment](DEPLOYMENT.md).

## 1. Get the code and configure it

```bash
git clone https://github.com/CHL-work/stardust-itinerary.git
cd stardust-itinerary
cp .env.example .env
```

Edit `.env`:

| Setting | Value |
| --- | --- |
| `AUTH_SECRET` | output of `openssl rand -base64 32` |
| `CREDENTIAL_ENCRYPTION_KEY` | another, different `openssl rand -base64 32`. It encrypts the API keys users save in Settings, and Compose gives it only to the web service. Keep a copy: without it, saved keys cannot be decrypted |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 24` (hex keeps it URL-safe) |
| `OWNER_GOOGLE_EMAIL` | your Google email; you become the platform operator |
| `PUBLIC_SIGNUP_ENABLED` | `true`, so you can create your own account (see step 2 for who can sign in) |
| `OPENAI_API_KEY` and `CODEX_API_KEY` | the same OpenAI key, if you use OpenAI models |
| `ANTHROPIC_API_KEY` | if you use Claude models |
| `STARDUST_GEMINI_API_KEY` | if you use Gemini models; for a Vertex AI key, also `STARDUST_GEMINI_VERTEX_PROJECT` and `STARDUST_GEMINI_VERTEX_LOCATION` |
| `DEFAULT_LOCALE` | `en`, `zh-HK`, `zh-HK-lihkg` or `ja-JP` |
| `GUEST_MODE_ENABLED` | optional, `true` adds **Try as guest**: a demo trip deleted after 24 hours. On an internet-facing instance, also set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` from Cloudflare Turnstile. The scheduler purges expired guests every hour |

## 2. Create the Google sign-in client

1. In the [Google Cloud console](https://console.cloud.google.com/), create or pick a project.
2. **Google Auth Platform → Branding/Audience:** an *External* app in **Testing** mode, with yourself (and anyone else allowed in) as test users. Only test users can sign in, which keeps a private instance private.
3. **Clients → Create client → Web application**, with these authorized redirect URIs:
   - `http://localhost:3100/api/auth/google/callback`
   - `http://localhost:3100/api/integrations/google-calendar/callback`
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Optional, for Calendar import: enable the **Google Calendar API** in the same project.

## 3. Start it

```bash
docker compose up -d --build
```

The first build takes a few minutes. The `migrate` service creates the schema and exits; `web` and `scheduler` start after it. Open <http://localhost:3100>, sign in with Google and create a trip.

## Updating

```bash
git pull
docker compose up -d --build
```

Migrations run automatically before the new web container starts. They are forward-only, so take a backup first.

## Backups

A plain dump and restore:

```bash
docker compose exec -T db pg_dump -U stardust -Fc stardust > stardust-$(date +%Y%m%d).dump
docker compose exec -T db pg_restore -U stardust -d stardust --clean --if-exists < stardust-20260101.dump
```

Or an [age](https://age-encryption.org/)-encrypted, verified dump written to `./backups`:

```bash
mkdir -p backups && chmod 777 backups
docker compose run --rm -v "$PWD/backups:/var/backups/stardust" \
  -e STARDUST_BACKUP_AGE_RECIPIENT=age1... migrate backup --label=manual
```

Keep the matching age private key somewhere other than this machine. [Database](DATABASE.md) describes restore rules.

## Putting it on the internet

Put an HTTPS reverse proxy or a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) in front of port 3100. Then:

- set `APP_BASE_URL` and `APP_ALLOWED_ORIGINS` to the public `https://` URL;
- add the two redirect URIs for that URL to the Google client;
- review `PUBLIC_SIGNUP_ENABLED` and the client's publishing status (Testing or In production) before letting other people in.

## Troubleshooting

- **Sign-in fails immediately:** a required identity setting is blank (`AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), or the redirect URI does not match `APP_BASE_URL` exactly.
- **"Access blocked" from Google:** your account is not a test user of the OAuth app.
- **AI requests fail:** check the provider key, and that the model you picked belongs to a provider whose key is set. `docker compose logs web` shows the error code.
- **Logs:** `docker compose logs -f web scheduler`.
