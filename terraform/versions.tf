terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Local state for the hackathon. For team use, switch to a remote GCS backend:
  # backend "gcs" {
  #   bucket = "idc-hackathon-509702-tfstate"
  #   prefix = "team9/recipe-to-sql"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
