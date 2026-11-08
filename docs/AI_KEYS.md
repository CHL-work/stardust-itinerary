# Account-owned AI keys

Users paste OpenAI, Anthropic or Gemini API keys in **Settings → AI keys**. A key belongs to the immutable app account and provider, not an email, trip or owner role. Saving it makes that provider's models available across the user's trips. Free AI remains selectable without a key. No server keys are imported and no sharing is enabled by saving a key; existing explicit sharing grants still apply.

## Storage (JOB-087, D-099)

Secret Manager is enabled for new account-key saves on the public instance; its cleanup runs every 15 minutes. Other deployments opt in through the [deployment steps](DEPLOYMENT.md#account-owned-keys-in-secret-manager). Code deployment alone does not configure this backend. [Activation evidence](jobs/JOB-087-user-secret-manager.md#release-evidence-2026-11-08-utc).

| Configuration | New keys | Existing keys |
| --- | --- | --- |
| `CREDENTIAL_SECRET_MANAGER_PROJECT` plus valid KMS settings | KMS ciphertext in an account/provider-bound Secret Manager resource; PostgreSQL stores the pinned version, last-four hint and metadata only | Local-ring and KMS database ciphertexts remain readable |
| KMS only | KMS ciphertext in PostgreSQL | Existing supported ciphertexts remain readable |
| Local ring only | AES-256-GCM ciphertext in PostgreSQL | Requires the corresponding ring versions |

`CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT` optionally selects the web-only workload identity impersonation account. Secret Manager cannot silently fall back to database storage if configuration or a cloud call fails. It never accepts `latest`, arbitrary URLs or another account/provider's resource. Payload CRC32C, the returned resource/version and guest expiry are verified. KMS authenticated data also binds the account/provider, so changing a database reference cannot transfer a key.

The existing KMS deny policy remains intact. Secret Manager stores **already-encrypted** payloads, so its administrators do not gain plaintext access. The web server necessarily decrypts a key in memory to send an authorized request: it is not honest to promise that an operator who changes the running server can never reach a key. Provider keys, cloud tokens and payloads are never returned to browsers or copied into prompts, GitHub, logs or audit metadata.

## Save, replace, remove

1. Recheck the current session, account and trip membership; validate the key with its provider.
2. Seal with KMS and register a fresh, opaque cloud resource in `ai_credential_secret_resources` before creating it. There are no cloud calls while holding trip/account locks.
3. Create the secret, add and read back a pinned version; only verified ciphertext can replace the database pointer.
4. Recheck access, the ten-minute staging lease and the previous credential revision. Concurrent replacement/removal makes a stale save fail, leaving the previous state intact. Audit records the provider only.
5. Removing a key deletes the account's pointer immediately. In-flight requests already holding the key may finish; revoke it at the provider to stop those too.

An hourly-or-faster **delete-only** worker removes unreferenced resources after the staging lease. It checks references again under a row lock, and a foreign key protects active references. Failed saves, replaced keys, deleted accounts and guest purges use the same registry; cloud errors retry later without secret-bearing logs. Guest secrets additionally expire at the account's original expiry, never 24 hours after the latest save; near-expiry saves are refused. The privileged guest-purge procedure is unchanged.

The worker receives neither provider keys nor KMS access. Web can create and add/access only its user-key namespace; cleanup can delete only that namespace. Google authorizes secret creation on the parent project, so its create-only permission cannot be restricted by a secret-name prefix; it grants no access to unrelated secrets.

## Migration, recovery and costs

- Migration `0064` is additive. Existing keys are not bulk-read or copied automatically. Re-entering/replacing a key moves it to the configured store. `credential-reencrypt` remains for legacy database ciphertexts; it does not migrate Secret Manager references.
- Keep Secret Manager and KMS read access after any keys are stored there. Rolling back to a pre-0064 app or removing those settings makes those keys unavailable; it does not recover a database ciphertext. Prefer a forward fix.
- Database backups include references, not Secret Manager payloads. Restoring a backup whose referenced secret was later removed requires the user to re-enter the key. Do not resurrect deleted keys or automatically prune cloud resources from a stale database restore.
- Cleanup must be healthy before enabling writes. Monitor failed cleanup counts and registry growth; pause cleanup during a restore investigation. Do not run two database copies as writers/cleanup sources for one secret namespace.
- Google lists six active versions and 10,000 accesses/month free per billing account; additional active versions are about **USD 0.06/month each**, and accesses **USD 0.03/10,000**. KMS and worker compute are separate. Each request reads one pinned version; replacement creates a fresh resource and cleanup removes the retired one. There is no plaintext key cache across requests. [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing).

Tests use disposable PostgreSQL and fake Google/provider endpoints. Cloud IAM and real Secret Manager access require a separately authorized rollout verification; local mocks do not prove deployed permissions.
