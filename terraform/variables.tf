variable "project_id" {
  type        = string
  description = "GCP project ID"
  default     = "idc-hackathon-509702"
}

variable "region" {
  type        = string
  description = "GCP region for all resources"
  default     = "us-central1"
}

variable "repo_name" {
  type        = string
  description = "Artifact Registry Docker repository name"
  default     = "egen-apps"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name"
  default     = "recipe-to-sql"
}

variable "runtime_service_account" {
  type        = string
  description = "Service account the Cloud Run service runs as (needs roles/aiplatform.user)"
  default     = "pattern-team09-sa@idc-hackathon-509702.iam.gserviceaccount.com"
}

variable "image" {
  type        = string
  description = "Fully-qualified container image the Cloud Run service deploys"
  default     = "us-central1-docker.pkg.dev/idc-hackathon-509702/egen-apps/recipe-to-sql:v1"
}

variable "gemini_model" {
  type        = string
  description = "Vertex AI Gemini model used by the hybrid AI pass"
  default     = "gemini-2.5-flash"
}

variable "allow_unauthenticated" {
  type        = bool
  description = "Grant roles/run.invoker to allUsers (may be blocked by org policy)"
  default     = true
}

variable "manage_sa_iam" {
  type        = bool
  description = "Whether Terraform manages the runtime SA's aiplatform.user binding"
  default     = true
}
