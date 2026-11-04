variable "project_id" {
  description = "Google Cloud project that hosts the instance (created by bootstrap.sh)."
  type        = string
}

variable "region" {
  description = "Region for the Autopilot cluster, registry and secrets."
  type        = string
  default     = "asia-northeast1"
}

variable "backup_location" {
  description = "Bucket location for encrypted database backups. US regions fall inside the Cloud Storage free tier."
  type        = string
  default     = "US-CENTRAL1"
}

variable "backup_retention_days" {
  description = "Days an encrypted backup object is kept before lifecycle deletion."
  type        = number
  default     = 30
}

variable "billing_account" {
  description = "Billing account ID used for the monthly budget alert."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Gross monthly cost (before credits) that triggers budget alert emails at 50/90/100%."
  type        = number
  default     = 60
}

variable "github_repository" {
  description = "owner/name of the GitHub repository whose Actions may build and deploy."
  type        = string
}

variable "github_repository_owner_id" {
  description = "Numeric GitHub ID of the repository owner; pins the trust to that account even if names change."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace of the application."
  type        = string
  default     = "stardust"
}
