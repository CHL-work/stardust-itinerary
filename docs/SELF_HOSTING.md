# Self-hosting with Docker Compose

Runs everything on one machine: PostgreSQL 17, the web app and a scheduler for background checks. You need:
- Docker with Compose v2;
- a Google account for the sign-in client;
- for AI, either enable the optional keyless free service below, configure a provider API key (OpenAI, Anthropic or Google Gemini), or let users add their own in Settings → AI keys. Manual planning needs no AI key.

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
| `CREDENTIAL_ENCRYPTION_KEY` | another, different `openssl rand -base64 32`. It encrypts the API keys users save in Settings, and Compose gives it only to the web service. Keep a copy: without it, saved keys cannot be decrypted. To rotate it, see [rotation](DEPLOYMENT.md#rotating-the-encryption-key); with Compose, run the re-encryption with `docker compose exec web /app/deploy/container/entrypoint.sh credential-reencrypt` |
| `FREE_AI_ENABLED` | optional: `true` offers signed-in users and guests keyless, text-only planning through Kilo's AI Gateway. No search or background work. Free models may retain/train on prompts; see [privacy](PRIVACY.md). Request and upstream-attempt caps are in `.env.example`. Canonical `FREE_AI_*` settings override legacy `GUEST_FREE_AI_*`; an old enabled flag now also covers signed-in users |
| `CREDENTIAL_KMS_KEY`, `CREDENTIAL_KMS_SERVICE_ACCOUNT` | optional, on a Google Cloud machine: seal saved keys with a Cloud KMS key instead, so no encryption key sits on the host ([keys in Cloud KMS](DEPLOYMENT.md#users-keys-in-cloud-kms)). Settings tells users which protection applies. Elsewhere leave them empty |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 24` (hex keeps it URL-safe) |
| `OWNER_GOOGLE_EMAIL` | your Google email; you become the platform operator. For several of your own accounts, separate them with commas |
| `PUBLIC_SIGNUP_ENABLED` | `true`, so you can create your own account (see step 2 for who can sign in) |
| `OPENAI_API_KEY` and `CODEX_API_KEY` | the same OpenAI key, if you use OpenAI models |
| `ANTHROPIC_API_KEY` | if you use Claude models |
| `STARDUST_GEMINI_API_KEY` | if you use Gemini models; for a Vertex AI key, also `STARDUST_GEMINI_VERTEX_PROJECT` and `STARDUST_GEMINI_VERTEX_LOCATION` |
| `DEFAULT_LOCALE` | `en`, `zh-HK`, `zh-HK-lihkg`, `ja-JP`, `zh-CN`, `zh-TW`, `es`, `pt-BR`, `fr`, `de`, `ru` or `id` |
| `GUEST_MODE_ENABLED` | optional, `true` adds **Try as guest**: a demo trip deleted after 24 hours. It also needs `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` from Cloudflare Turnstile. On a private instance, `GUEST_ALLOW_WITHOUT_TURNSTILE=true` waives the check. Per-address limits use Cloudflare's `CF-Connecting-IP`, or a reverse proxy's `X-Real-IP`. The scheduler purges expired guests every hour |
| `PRIVACY_NOTICE_URL` | optional, an https link to your privacy notice, shown on the sign-in page. Adapt [the public instance's](PRIVACY.md) to your hosting |
| `STARDUST_AI_MAX_CONCURRENT` | optional, AI requests the web server runs at once (default 4). Each starts provider processes, so size it to the memory you give the web service |
| `STARDUST_FEEDBACK_REPOSITORY` and `STARDUST_FEEDBACK_GITHUB_TOKEN` | optional, to file reviewed feedback as issues: a **private** repository as `owner/name`, and a fine-grained token for it with **Issues: read and write**. The publisher refuses a repository that is not private ([feedback](FEEDBACK.md)) |

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

An off-site copy restores the database into a second PostgreSQL server every time it runs, checks every table's row count and keeps the newest three copies (a free plan is enough for a small instance). Put `STARDUST_OFFSITE_DATABASE_URL=postgresql://...` (a direct URL whose role can create databases) in a private `offsite.env` file, then run this from a daily timer:

```bash
set -a; . ./offsite.env; set +a
docker compose run --rm -e STARDUST_OFFSITE_DATABASE_URL migrate offsite-copy
```

[Deployment](DEPLOYMENT.md#operations) describes its log lines and settings.

## Putting it on the internet

Put an HTTPS reverse proxy or a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) in front of port 3100. Then:

- set `APP_BASE_URL` and `APP_ALLOWED_ORIGINS` to the public `https://` URL;
- add the two redirect URIs for that URL to the Google client;
- review `PUBLIC_SIGNUP_ENABLED` and the client's publishing status (Testing or In production) before letting other people in.

## Troubleshooting

- **Sign-in fails immediately:** a required identity setting is blank (`AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), or the redirect URI does not match `APP_BASE_URL` exactly.
- **"Access blocked" from Google:** your account is not a test user of the OAuth app.
- **AI requests fail:** for a paid model, check that its provider key is set. Free AI requires an eligible zero-price model in the current gateway catalog and remaining account/instance quota; it never charges a key on failure. `docker compose logs web` shows the error code.
- **Logs:** `docker compose logs -f web scheduler`.
