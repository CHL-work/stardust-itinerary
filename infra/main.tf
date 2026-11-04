data "google_project" "this" {
  project_id = var.project_id
}

locals {
  project_number = data.google_project.this.number
  # Workload Identity Federation for GKE: each Kubernetes service account is its own principal.
  ksa_principal = "principal://iam.googleapis.com/projects/${local.project_number}/locations/global/workloadIdentityPools/${var.project_id}.svc.id.goog/subject/ns/${var.namespace}/sa"

  # Secret Manager secret -> Kubernetes service accounts allowed to mount it. Only the web server
  # decrypts users' stored AI keys, so only it mounts CREDENTIAL_ENCRYPTION_KEY. Only the feedback
  # worker holds the GitHub token for the private feedback repository.
  secrets = {
    "stardust-app-env"            = ["stardust-web", "stardust-worker", "stardust-feedback", "stardust-migrate"]
    "stardust-ai-env"             = ["stardust-web", "stardust-worker", "stardust-feedback"]
    "stardust-credential-env"     = ["stardust-web"]
    "stardust-feedback-env"       = ["stardust-feedback"]
    "stardust-db-admin-password"  = ["stardust-db", "stardust-migrate", "stardust-backup", "stardust-guest-purge"]
    "stardust-tunnel-credentials" = ["stardust-tunnel"]
  }
  secret_grants = merge([
    for secret, accounts in local.secrets : {
      for account in accounts : "${secret}/${account}" => { secret = secret, account = account }
    }
  ]...)
}

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "sts.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------------------------
# Network and cluster
# ---------------------------------------------------------------------------------------------

resource "google_compute_network" "main" {
  name                    = "stardust"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name                     = "stardust-${var.region}"
  region                   = var.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = "10.20.0.0/20"
  private_ip_google_access = true
}

# Nodes run as a dedicated identity: the organization disables automatic grants to the default one.
resource "google_service_account" "nodes" {
  account_id   = "gke-nodes"
  display_name = "GKE Autopilot nodes"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "nodes_default_role" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

resource "google_container_cluster" "autopilot" {
  name                = "stardust"
  location            = var.region
  enable_autopilot    = true
  network             = google_compute_network.main.id
  subnetwork          = google_compute_subnetwork.main.id
  deletion_protection = true

  release_channel {
    channel = "REGULAR"
  }

  ip_allocation_policy {}

  secret_manager_config {
    enabled = true
  }

  cluster_autoscaling {
    auto_provisioning_defaults {
      service_account = google_service_account.nodes.email
      oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    }
  }

  depends_on = [google_project_iam_member.nodes_default_role]
}

# ---------------------------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "stardust"
  format        = "DOCKER"
  description   = "Stardust Itinerary container images"

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent-releases"
    action = "KEEP"
    most_recent_versions {
      keep_count = 4
    }
  }
  cleanup_policies {
    id     = "delete-older-than-a-week"
    action = "DELETE"
    condition {
      older_than = "604800s"
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_artifact_registry_repository_iam_member" "nodes_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.nodes.email}"
}

# ---------------------------------------------------------------------------------------------
# Secrets: Terraform creates the containers only. Values are added out of band
# (gcloud secrets versions add), so they never pass through Git or Terraform state.
# ---------------------------------------------------------------------------------------------

resource "google_secret_manager_secret" "app" {
  for_each  = local.secrets
  secret_id = each.key
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "workloads" {
  for_each   = local.secret_grants
  secret_id  = google_secret_manager_secret.app[each.value.secret].id
  role       = "roles/secretmanager.secretAccessor"
  member     = "${local.ksa_principal}/${each.value.account}"
  depends_on = [google_container_cluster.autopilot]
}

# ---------------------------------------------------------------------------------------------
# Encrypted backups (age-encrypted before upload; the bucket only ever sees ciphertext)
# ---------------------------------------------------------------------------------------------

resource "google_storage_bucket" "backups" {
  name                        = "${var.project_id}-backups"
  location                    = var.backup_location
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  lifecycle_rule {
    condition {
      age = var.backup_retention_days
    }
    action {
      type = "Delete"
    }
  }
  depends_on = [google_project_service.apis]
}

# Create-only: the backup job can add objects but not read, overwrite or delete them.
resource "google_storage_bucket_iam_member" "backup_writer" {
  bucket     = google_storage_bucket.backups.name
  role       = "roles/storage.objectCreator"
  member     = "${local.ksa_principal}/stardust-backup"
  depends_on = [google_container_cluster.autopilot]
}

# ---------------------------------------------------------------------------------------------
# Image builds from this machine or CI (Cloud Build)
# ---------------------------------------------------------------------------------------------

resource "google_service_account" "builder" {
  account_id   = "image-builder"
  display_name = "Container image builds"
  depends_on   = [google_project_service.apis]
}

resource "google_storage_bucket" "build_sources" {
  name                        = "${var.project_id}-build-sources"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "builder_sources" {
  bucket = google_storage_bucket.build_sources.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.builder.email}"
}

resource "google_artifact_registry_repository_iam_member" "builder_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.builder.email}"
}

resource "google_project_iam_member" "builder_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.builder.email}"
}

# ---------------------------------------------------------------------------------------------
# GitHub Actions: keyless authentication (no service account keys exist anywhere)
# ---------------------------------------------------------------------------------------------

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "stardust-itinerary"
  display_name                       = "stardust-itinerary"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.environment"         = "assertion.environment"
  }
  # Only workflows in this repository, owned by this account, can exchange tokens at all.
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.repository_owner_id == '${var.github_repository_owner_id}'"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  github_pool = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}"
}

# Pushes images: any workflow run on the main branch.
resource "google_service_account_iam_member" "github_builds_on_main" {
  service_account_id = google_service_account.builder.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.github_pool}/attribute.ref/refs/heads/main"
}

# Deploys: only jobs that run in the protected "production" GitHub environment.
resource "google_service_account" "deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions production deploys"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "deployer_gke" {
  project = var.project_id
  role    = "roles/container.developer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "github_deploys_from_production" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.github_pool}/attribute.environment/production"
}

# ---------------------------------------------------------------------------------------------
# Cost guard
# ---------------------------------------------------------------------------------------------

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "${var.project_id} monthly"

  budget_filter {
    projects               = ["projects/${local.project_number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  depends_on = [google_project_service.apis]
}
