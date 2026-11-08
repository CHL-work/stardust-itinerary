# Account-owned AI keys (JOB-087). The app stores KMS ciphertext in these secrets, not plaintext.
# No secret values pass through OpenTofu. Existing KMS access and its deny policy stay unchanged.
locals {
  user_credential_secret_prefix = "stardust-user-key-"
  user_credential_secret_scope  = join(" || ", [
    "resource.name.startsWith(\"projects/${local.project_number}/secrets/${local.user_credential_secret_prefix}\")",
    "resource.name.startsWith(\"projects/${var.project_id}/secrets/${local.user_credential_secret_prefix}\")",
  ])
}

# Create is checked on the parent project, so a secret-name condition cannot restrict it. Keep
# this separate from every access permission; it cannot read, change or delete existing secrets.
resource "google_project_iam_custom_role" "user_credential_secret_creator" {
  project     = var.project_id
  role_id     = "stardustUserSecretCreator"
  title       = "Stardust user-secret creation"
  description = "Create empty Secret Manager resources for account-owned provider keys."
  permissions = ["secretmanager.secrets.create"]
}

resource "google_project_iam_member" "credentials_create_secrets" {
  project = var.project_id
  role    = google_project_iam_custom_role.user_credential_secret_creator.name
  member  = "serviceAccount:${google_service_account.credentials.email}"
}

resource "google_project_iam_custom_role" "user_credential_secret_payload" {
  project     = var.project_id
  role_id     = "stardustUserSecretPayload"
  title       = "Stardust user-secret payloads"
  description = "Add and read KMS-sealed provider-key payloads, without IAM or deletion rights."
  permissions = ["secretmanager.versions.add", "secretmanager.versions.access"]
}

resource "google_project_iam_member" "credentials_use_secret_payload" {
  project = var.project_id
  role    = google_project_iam_custom_role.user_credential_secret_payload.name
  member  = "serviceAccount:${google_service_account.credentials.email}"
  condition {
    title       = "stardust_user_keys_only"
    description = "Never access the application's unrelated configuration secrets."
    expression  = local.user_credential_secret_scope
  }
}

resource "google_project_iam_custom_role" "user_credential_secret_cleanup" {
  project     = var.project_id
  role_id     = "stardustUserSecretCleanup"
  title       = "Stardust retired user-secret cleanup"
  description = "Delete unreferenced user-key resources; cannot read keys or change IAM."
  permissions = ["secretmanager.secrets.delete"]
}

resource "google_project_iam_member" "cleanup_user_secrets" {
  project = var.project_id
  role    = google_project_iam_custom_role.user_credential_secret_cleanup.name
  member  = "${local.ksa_principal}/stardust-credential-cleanup"
  condition {
    title       = "stardust_user_keys_only"
    description = "Cleanup cannot delete app, database, tunnel or operator-provider secrets."
    expression  = local.user_credential_secret_scope
  }
  depends_on = [google_container_cluster.autopilot]
}

# Log data access as well as the management operations Google always records. Payload contents
# are not included in Secret Manager audit logs.
resource "google_project_iam_audit_config" "user_credential_secrets" {
  project = var.project_id
  service = "secretmanager.googleapis.com"
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

output "credential_secret_manager_project" {
  description = "CREDENTIAL_SECRET_MANAGER_PROJECT for web and credential-cleanup dotenv files."
  value       = var.project_id
}

output "credential_secret_manager_service_account" {
  description = "CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT for the web server only."
  value       = google_service_account.credentials.email
}
