# Deployment on GKE Autopilot

How the public instance runs, and how to run your own the same way. For a single machine, see [self-hosting](SELF_HOSTING.md).

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Web server | `stardust-web` Deployment, autoscaled 1–3 replicas | Stateless; probes on `/api/health` |
| PostgreSQL 17 | `stardust-db` StatefulSet, 10 GiB `pd-balanced` disk | Only application pods may connect (NetworkPolicy) |
| Public access | `stardust-tunnel` (cloudflared) | Outbound-only Cloudflare Tunnel; no load balancer or public IP |
| Background work | CronJobs `stardust-disruption` (every 5 min), `stardust-feedback` (hourly), `stardust-backup` (daily) | Each run is a short pod |
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
   | `stardust-app-env` | dotenv with `APP_BASE_URL`, `APP_ALLOWED_ORIGINS`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_GOOGLE_EMAIL`, `PUBLIC_SIGNUP_ENABLED`, `DEFAULT_LOCALE`, `AUTH_TRIP_GRACE_DAYS`, `STARDUST_FEEDBACK_TRIAGE_ENABLED` and `DATABASE_URL=postgresql://stardust_app:<64 hex>@stardust-db:5432/stardust` |
   | `stardust-ai-env` | dotenv with `OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`, `STARDUST_GEMINI_API_KEY` (plus `STARDUST_GEMINI_VERTEX_PROJECT`/`_LOCATION` for a Vertex AI key) |
   | `stardust-tunnel-credentials` | the tunnel credentials JSON from step 4 |

   ```bash
   gcloud secrets versions add stardust-app-env --data-file=app.env --project=<project-id>
   ```

   The migration job creates the `stardust_app` runtime role from `DATABASE_URL` and grants it only data access.

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

The [`deploy` workflow](../.github/workflows/deploy.yml) builds and pushes the image, tagged with the commit SHA, on every push to `main`. Deploying is a separate, deliberate step:

1. Start the workflow manually (**Actions → Deploy → Run workflow**), optionally with a revision.
2. The deploy job waits for approval in the protected `production` environment.
3. It runs [`deploy/deploy.sh`](../deploy/deploy.sh): shared objects and the database first, then a pre-migration backup, the migration job (which must succeed), the web rollout, and a health check through the public URL.

Through Workload Identity Federation, only `main` can push images and only the `production` environment can obtain cluster credentials.

**Rollback:** run the workflow (or `deploy/deploy.sh`) with an earlier SHA. Migrations are forward-only; an older release must still work with the newer schema. See [database](DATABASE.md).

## Operations

- **Logs:** `kubectl -n stardust logs deploy/stardust-web` (also in Cloud Logging). For CronJob runs, `kubectl -n stardust get jobs` and `kubectl logs job/<name>`.
- **Scaling:** change `minReplicas`/`maxReplicas` in `deploy/k8s/base/web.yaml`, or the pod `resources`; Autopilot provides the capacity. Autopilot bills pod requests, not nodes.
- **Secrets:** add a new version, then `kubectl -n stardust rollout restart deploy/stardust-web`; CronJob pods pick it up on their next run. Destroy old versions you no longer need.
- **Manual backup:** `kubectl -n stardust create job backup-now --from=cronjob/stardust-backup`.
- **Restore:**
  1. Download the object and its `.json` manifest.
  2. Decrypt with the age identity: `age -d -i <key> -o db.dump <object>.dump.age`.
  3. `kubectl -n stardust port-forward svc/stardust-db 15432:5432`.
  4. `pg_restore --clean --if-exists -d postgresql://postgres:<admin>@127.0.0.1:15432/stardust db.dump`.
  5. Run the migration job.
- **Costs:** the cluster fee for one Autopilot cluster is covered by GKE's free tier. The instance requests about 1 vCPU and 3 GiB in total (about USD 35–45 a month at Tokyo list prices). The budget alert in `infra/` emails at 50/90/100% of the configured amount.

## Moving an existing instance

To move a running instance without losing writes:

1. Stop the old instance's web server and workers.
2. Take a final `pg_dump -Fc`.
3. Restore it into the new database as above.
4. Run the migration job; checksums that differ only in line endings are accepted.
5. Set `APP_BASE_URL` to the public hostname.
6. Route the hostname to the new tunnel: `cloudflared tunnel route dns --overwrite-dns stardust-gke <hostname>`.

Keep the same `AUTH_SECRET` and Google OAuth client, so sessions, invitations and encrypted Calendar connections keep working.
