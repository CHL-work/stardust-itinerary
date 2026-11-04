#!/usr/bin/env bash
# One-time setup before the first `tofu apply`: a project linked to billing, and a private,
# versioned bucket for OpenTofu state. Safe to re-run.
#   ./bootstrap.sh <project-id> <billing-account-id> [organization-id]
set -euo pipefail
project="${1:?project id}"
billing="${2:?billing account id}"
organization="${3:-}"

if ! gcloud projects describe "$project" >/dev/null 2>&1; then
  if [[ -n $organization ]]; then
    gcloud projects create "$project" --name="Stardust Itinerary" --organization="$organization"
  else
    gcloud projects create "$project" --name="Stardust Itinerary"
  fi
fi
gcloud billing projects link "$project" --billing-account="$billing" >/dev/null
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com storage.googleapis.com \
  cloudbilling.googleapis.com --project="$project"

state_bucket="gs://${project}-tofu-state"
if ! gcloud storage buckets describe "$state_bucket" >/dev/null 2>&1; then
  gcloud storage buckets create "$state_bucket" --project="$project" --location=us-central1 \
    --uniform-bucket-level-access --public-access-prevention
fi
gcloud storage buckets update "$state_bucket" --versioning >/dev/null
echo "State bucket ready: $state_bucket"
echo "Next: cd infra && tofu init -backend-config=bucket=${project}-tofu-state && tofu apply -var-file=live.tfvars"
