#!/usr/bin/env bash
# Applies the saved Terraform plan as the logged-in user (not the impersonated SA).
# Regenerate the plan first if it is stale:
#   cd terraform && GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) terraform plan -out=tfplan
set -euo pipefail
cd /mnt/c/Users/Sandeep_V/Documents/Documents-mar-2026/team9-repo/terraform
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform apply tfplan
