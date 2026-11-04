# Deployment on GKE Autopilot

How the public instance runs, and how to run your own the same way. For a single machine, see [self-hosting](SELF_HOSTING.md).

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Web server | `stardust-web` Deployment, autoscaled 1–2 replicas | Stateless; probes on `/api/health` |
| PostgreSQL 17 | `stardust-db` StatefulSet, 10 GiB `pd-balanced` disk | Only application pods may connect (NetworkPolicy) |
| Public access | `stardust-tunnel` (cloudflared) | Outbound-only Cloudflare Tunnel; no load balancer or public IP |
| Background work | CronJobs `stardust-disruption` (every 5 min), `stardust-feedback` (hourly), `stardust-guest-purge` (hourly), `stardust-backup` (daily) | Each run is a short pod. The guest purge has its own service account and only the database administrator password, and reaches only the database. The feedback job has its own service account, the only one that can read the feedback repository token |
| Migrations | `stardust-migrate`, a suspended CronJob used as a template | Started once per release by the deploy script |
| Secrets | Google Secret Manager, mounted as files by the GKE Secret Manager add-on | Each Kubernetes service account may read only its own secrets |
| Backups | `gs://<project>-backups`, age-encrypted, 30-day lifecycle | The backup job can create objects but not read or delete them |
| Images | Artifact Registry `<region>-docker.pkg.dev/<project>/stardust` | Keeps the 4 newest images; older ones are deleted after a week |

Everything in Google Cloud is declared in [`infra/`](../infra) (OpenTofu); everything in the cluster in [`deploy/k8s`](../deploy/k8s) (Kustomize base plus the `gke` overlay). No service-account keys exist: nodes, workloads and GitHub Actions all use Workload Identity.

Application pods run as non-root with read-only root filesystems and no Kubernetes API token. A NetworkPolicy blocks their HTTP access to the cloud metadata server. AI provider subprocesses get only the allowlisted environment.

## One-time setup

You need `gcloud`, OpenTofu 1.8+, `kubectl` with `gke-gcloud-auth-plugin`, `cloudflared`, a Google billing account and a domain on Cloudflare.

1. **Project and state bucket:**

   ```bash
   infra/bootstrap.sh <project-id> <billing-account-id> [organization-id]
   ```

2. **Infrastructure.** Copy `infra/live.tfvars` with your values, then:

   ```bash
   cd infra
   tofu init -backend-config=bucket=<project-id>-tofu-state
   tofu apply -var-file=live.tfvars
   ```

   This creates the network, Autopilot cluster, registry, empty secrets, backup bucket, GitHub Actions identities and a budget alert. Creating the cluster takes about ten minutes.

3. **Secret values.** Add one version to each secret. Each is a file, never a command-line argument.

   | Secret | Content |
   | --- | --- |
   | `stardust-db-admin-password` | 64 hex characters (`openssl rand -hex 32`), no newline |
   | `stardust-app-env` | dotenv with `APP_BASE_URL`, `APP_ALLOWED_ORIGINS`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_GOOGLE_EMAIL`, `PUBLIC_SIGNUP_ENABLED`, `DEFAULT_LOCALE`, `AUTH_TRIP_GRACE_DAYS`, `STARDUST_FEEDBACK_TRIAGE_ENABLED` and `DATABASE_URL=postgresql://stardust_app:<64 hex>@stardust-db:5432/stardust`. For guest mode also `GUEST_MODE_ENABLED=true`, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. `PRIVACY_NOTICE_URL` (https) links your privacy notice from the sign-in page |
   | `stardust-ai-env` | dotenv with `OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`, `STARDUST_GEMINI_API_KEY` (plus `STARDUST_GEMINI_VERTEX_PROJECT`/`_LOCATION` for a Vertex AI key) |
   | `stardust-credential-env` | dotenv with `CREDENTIAL_ENCRYPTION_KEY=` 32 random bytes in base64 (`openssl rand -base64 32`), and after a rotation `CREDENTIAL_ENCRYPTION_KEY_VERSION` and `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` (see [rotation](#rotating-the-encryption-key)). Only the web server mounts it. Keep a copy with your recovery materials: without it, users' saved AI keys cannot be decrypted and they must add them again |
| `stardust-feedback-env` | dotenv with `STARDUST_FEEDBACK_REPOSITORY=<owner>/<private repository>` and `STARDUST_FEEDBACK_GITHUB_TOKEN`, a fine-grained token for that repository only with **Issues: read and write**. Only the feedback job mounts it. Without the token, issues stay queued; the publisher refuses a repository GitHub does not report as private ([feedback](FEEDBACK.md)) |
   | `stardust-tunnel-credentials` | the tunnel credentials JSON from step 4 |

   ```bash
   gcloud secrets versions add stardust-app-env --data-file=app.env --project=<project-id>
   ```

   The migration job creates the `stardust_app` runtime role from `DATABASE_URL` and grants it only data access. The guest purge function suspends triggers for its own deletes, so only a superuser can run it. The runtime role is never granted it; the purge job connects as the administrator. On a managed database without a superuser, leave guest mode off.

4. **Tunnel:**

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create stardust-gke
   cloudflared tunnel route dns stardust-gke <hostname>
   gcloud secrets versions add stardust-tunnel-credentials --data-file=<path-printed-by-create>.json --project=<project-id>
   ```

   Put the tunnel ID and your hostnames in `deploy/k8s/overlays/gke/tunnel-config.yaml`, and the project, region, bucket and age recipient in that overlay's `kustomization.yaml` and `secret-provider-classes.yaml`.

5. **Image:** export a clean tree and build it on Cloud Build. The `deploy` workflow does the same in CI.

   ```bash
   git archive --format=tar HEAD | (mkdir -p /tmp/src && tar -x -C /tmp/src)
   gcloud builds submit /tmp/src --config=deploy/cloudbuild.yaml --substitutions=_REVISION=$(git rev-parse HEAD) \
     --service-account=projects/<project-id>/serviceAccounts/image-builder@<project-id>.iam.gserviceaccount.com \
     --gcs-source-staging-dir=gs://<project-id>-build-sources/source
   ```

6. **First deploy:**

   ```bash
   gcloud container clusters get-credentials stardust --region=<region> --project=<project-id>
   deploy/deploy.sh $(git rev-parse HEAD) --skip-backup
   ```

## Releases

Every push to `main` deploys once CI passes. When CI succeeds for a push to `main`, the [`deploy` workflow](../.github/workflows/deploy.yml):

1. builds and pushes the image, tagged with the commit SHA, unless that image already exists;
2. runs [`deploy/deploy.sh`](../deploy/deploy.sh) in the `production` environment: shared objects and the database first, then a pre-migration backup, the migration job (which must succeed), the web rollout, and a health check through the public URL.

Through Workload Identity Federation, only `main` can push images and only the `production` environment can obtain cluster credentials. The `production` environment accepts only `main`, and the workflow deploys only CI runs for pushes to `main` of this repository, never a pull request, even one whose branch is named `main`. Deploys run one at a time; a newer one waits for the running one.

To redeploy, run the workflow manually (**Actions → Deploy → Run workflow** on `main`), optionally with a revision. The revision must be a commit on `main`.

**Rollback:** run the workflow (or `deploy/deploy.sh`) with an earlier SHA. Migrations are forward-only; an older release must still work with the newer schema. See [database](DATABASE.md).

On your own instance, add required reviewers to the `production` environment if you want to approve each deploy; the public instance deploys without approval by the owner's choice.

## Operations

- **Logs:** `kubectl -n stardust logs deploy/stardust-web` (also in Cloud Logging). For CronJob runs, `kubectl -n stardust get jobs` and `kubectl logs job/<name>`.
- **Scaling:** change `minReplicas`/`maxReplicas` in `deploy/k8s/base/web.yaml`, or the pod `resources`; Autopilot provides the capacity. Autopilot bills pod requests, not nodes.
- **Secrets:** add a new version, then `kubectl -n stardust rollout restart deploy/stardust-web`; CronJob pods pick it up on their next run. Destroy old versions you no longer need.
- **Manual backup:** `kubectl -n stardust create job backup-now --from=cronjob/stardust-backup`.
- **Feedback token:** create a fine-grained token (**Settings → Developer settings → Fine-grained tokens**) with **Only select repositories** set to the private feedback repository and **Issues: read and write**, copy it, and add a `stardust-feedback-env` version that keeps the repository line. The next hourly run publishes queued issues; a run that refuses the repository exits non-zero and logs `publishing: refused` with a reason code.
- **Guest purge:** a failed `stardust-guest-purge` run means the database refused to purge a guest that is not provably isolated. The guest stays in place, and the run logs only counts. Find it with `SELECT id FROM app_users WHERE guest_expires_at <= now()`, investigate, and never delete guest rows by hand.
- **Encryption-key rotation:** see [below](#rotating-the-encryption-key).
- **Restore:**
  1. Download the object and its `.json` manifest.
  2. Decrypt with the age identity: `age -d -i <key> -o db.dump <object>.dump.age`.
  3. `kubectl -n stardust port-forward svc/stardust-db 15432:5432`.
  4. `pg_restore --clean --if-exists -d postgresql://postgres:<admin>@127.0.0.1:15432/stardust db.dump`.
  5. Run the migration job.
- **Costs:** the cluster fee for one Autopilot cluster is covered by GKE's free tier. The always-on pods request about 0.4 vCPU and 1.4 GiB, and each job 0.1 vCPU, so a job fits next to them without a second node (about USD 20–30 a month at Tokyo list prices). Pods may burst above their CPU requests when the node has room. The budget alert in `infra/` emails at 50/90/100% of the configured amount.
- **Free-trial quota:** a Google Cloud free trial allows 250 GB of SSD-backed disk, which fits only two Autopilot nodes (100 GB boot disk each) plus the database disk. Keep requests small enough that the jobs fit on one node. If the autoscaler reports `scale.up.error.quota.exceeded`, it may give up on that pod for good: delete the pending job, and the next scheduled run starts normally.

## Rotating the encryption key

Users' saved AI keys are sealed under a key ring ([identity and security](IDENTITY_AND_SECURITY.md)). To replace the key:

1. Add a `stardust-credential-env` version with a new `CREDENTIAL_ENCRYPTION_KEY`, the next `CREDENTIAL_ENCRYPTION_KEY_VERSION`, and the old key in `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` as `<old version>:<old key>`.
2. `kubectl -n stardust rollout restart deploy/stardust-web`. New keys are now sealed with the new version, and old ones still open.
3. `kubectl -n stardust exec deploy/stardust-web -- /app/deploy/container/entrypoint.sh credential-reencrypt`. It prints counts only, and exits non-zero while any key remains under an older version.
4. Add a version without `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS`, restart the web server again, and disable the old secret versions.

Backups taken before the rotation still hold ciphertexts under the old key. Keep that key with your recovery materials until those backups expire (30 days).

## Moving an existing instance

To move a running instance without losing writes:

1. Stop the old instance's web server and workers.
2. Take a final `pg_dump -Fc`.
3. Restore it into the new database as above.
4. Run the migration job; checksums that differ only in line endings are accepted.
5. Set `APP_BASE_URL` to the public hostname.
6. Route the hostname to the new tunnel: `cloudflared tunnel route dns --overwrite-dns stardust-gke <hostname>`.

Keep the same `AUTH_SECRET` and Google OAuth client, so sessions, invitations and encrypted Calendar connections keep working.
