terraform {
  required_version = ">= 1.8"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.30, < 8.0"
    }
  }

  # State lives in a private, versioned bucket created by bootstrap.sh. Pass the bucket name with
  #   tofu init -backend-config="bucket=<project>-tofu-state"
  backend "gcs" {
    prefix = "stardust/live"
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}
