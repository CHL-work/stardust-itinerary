output "cluster_name" {
  value = google_container_cluster.autopilot.name
}

output "image_repository" {
  description = "Push images here: <repository>/stardust-itinerary:<tag>."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "backup_bucket" {
  value = google_storage_bucket.backups.name
}

output "build_sources_bucket" {
  value = google_storage_bucket.build_sources.name
}

output "github_workload_identity_provider" {
  description = "Value for google-github-actions/auth workload_identity_provider."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_builder_service_account" {
  value = google_service_account.builder.email
}

output "github_deployer_service_account" {
  value = google_service_account.deployer.email
}

output "credential_kms_key" {
  description = "CREDENTIAL_KMS_KEY for stardust-credential-env (JOB-069)."
  value       = google_kms_crypto_key.ai_credentials.id
}

output "credential_kms_service_account" {
  description = "CREDENTIAL_KMS_SERVICE_ACCOUNT for stardust-credential-env (JOB-069)."
  value       = google_service_account.credentials.email
}
