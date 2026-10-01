# Resource Summary — Recipe-to-SQL Deployment

Everything created / configured for the hybrid Gemini deployment.

- **Project:** `idc-hackathon-509702`
- **Region:** `us-central1`
- **Runtime service account:** `pattern-team09-sa@idc-hackathon-509702.iam.gserviceaccount.com`
- **Live URL:** <https://recipe-to-sql-dhkt3dxhuq-uc.a.run.app>

---

## GCP infrastructure resources

| Resource | Name / ID | Notes |
|---|---|---|
| Artifact Registry (Docker) | `egen-apps` | Holds the app image |
| Container image | `us-central1-docker.pkg.dev/idc-hackathon-509702/egen-apps/recipe-to-sql:v1` | Built by Cloud Build (Node 22) |
| Cloud Run service | `recipe-to-sql` | Runs as `pattern-team09-sa`; scales to zero |
| Cloud Build | build `df016ab5…` | Built & pushed the image |
| APIs (pre-enabled by org) | aiplatform, run, cloudbuild, artifactregistry | Not created by us |
| Vertex AI model | `gemini-2.5-flash` | Called by the backend; not a provisioned resource |

---

## IAM changes

| Member | Role | Why |
|---|---|---|
| `pattern-team09-sa` (SA) | `roles/aiplatform.user` | App can call Gemini |
| `allUsers` | `roles/run.invoker` (on the service) | Public access to the URL |
| `sandeep.viriyala@egen.ai` | `roles/run.admin` | Deploy Cloud Run |
| `sandeep.viriyala@egen.ai` | `roles/cloudbuild.builds.editor` | Run Cloud Build |
| `sandeep.viriyala@egen.ai` | `roles/artifactregistry.admin` | Create/push to AR |
| `sandeep.viriyala@egen.ai` | `roles/storage.admin` | Cloud Build source staging |
| `sandeep.viriyala@egen.ai` | `roles/serviceusage.serviceUsageConsumer` | Use Cloud Build service |

Pre-existing (not changed by us):
- `sandeep.viriyala@egen.ai`: `roles/resourcemanager.projectIamAdmin`
- group `idc-ideathon@egen.ai`: `aiplatform.user`, `serviceAccountTokenCreator`, `serviceAccountUser`, `viewer`

---

## Terraform-managed resources (`terraform/`)

| Terraform resource | Maps to |
|---|---|
| `google_artifact_registry_repository.egen_apps` | AR repo `egen-apps` |
| `google_cloud_run_v2_service.app` | Cloud Run service `recipe-to-sql` |
| `google_cloud_run_v2_service_iam_member.invoker` | `allUsers` → `run.invoker` |
| `google_project_iam_member.sa_aiplatform` | SA → `aiplatform.user` |

State is **local** (`terraform/terraform.tfstate`, gitignored). A GCS backend is
documented in `terraform/versions.tf` for team use.

---

## Repository artifacts (branch `feature/appcode`, PR #1)

| Path | Purpose |
|---|---|
| `server/index.ts` | Express backend: `/api/convert`, `/api/health` |
| `server/gemini.ts` | Hybrid AI pass (Vertex AI / Gemini) |
| `src/App.tsx` | "enhance with gemini ai" toggle |
| `terraform/` | IaC (above) |
| `Dockerfile` | Node 22 image: builds frontend + serves `/api` |
| `SETUP.md` | GCP setup, IAM, deploy, team access |
| `README.md` | Updated for AI mode / deploy |

---

## Local-only (this machine, not in git)

- `.env` / `.env.local` — Vertex config (gitignored)
- Impersonated **ADC** at `~/.config/gcloud/application_default_credentials.json`

---

## Cost & teardown

- Cloud Run `min_instance_count = 0` → **no idle cost** when unused.
- Tear everything down with:
  ```bash
  cd terraform && terraform destroy
  ```
  (Removes the Cloud Run service, invoker binding, AR repo, and SA IAM binding
  that Terraform manages. Images in AR and the bootstrap user-role grants are
  not removed by destroy.)
