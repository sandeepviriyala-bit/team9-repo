# ── Artifact Registry ────────────────────────────────────────────────────────
resource "google_artifact_registry_repository" "egen_apps" {
  location      = var.region
  repository_id = var.repo_name
  format        = "DOCKER"
  description   = "Egen hackathon app images"
}

# ── Runtime SA can call Vertex AI Gemini ─────────────────────────────────────
# The Cloud Run service runs as this SA; it needs aiplatform.user to invoke Gemini.
resource "google_project_iam_member" "sa_aiplatform" {
  count   = var.manage_sa_iam ? 1 : 0
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${var.runtime_service_account}"
}

# ── Cloud Run service ────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "app" {
  name     = var.service_name
  location = var.region

  # Allow `terraform destroy` to remove the service during the hackathon.
  deletion_protection = false

  template {
    service_account = var.runtime_service_account

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "true"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }
      env {
        name  = "GEMINI_MODEL"
        value = var.gemini_model
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  depends_on = [
    google_artifact_registry_repository.egen_apps,
    google_project_iam_member.sa_aiplatform,
  ]
}

# ── Public access (optional; org policy may forbid allUsers) ──────────────────
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
