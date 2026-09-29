# Terraform — Recipe-to-SQL infra

Manages the Cloud Run deployment infra for the hybrid Gemini app on
`idc-hackathon-509702`.

## Resources

| Resource | Purpose |
|----------|---------|
| `google_artifact_registry_repository.egen_apps` | Docker repo `egen-apps` (us-central1) |
| `google_project_iam_member.sa_aiplatform` | Runtime SA → `roles/aiplatform.user` (call Gemini) |
| `google_cloud_run_v2_service.app` | The Cloud Run service, running as `pattern-team09-sa` |
| `google_cloud_run_v2_service_iam_member.invoker` | Public access (`allUsers`), if org policy allows |

State is local by default. For team use, uncomment the GCS backend in `versions.tf`.

## Prerequisites (one-time, outside Terraform)

Terraform does **not** build the app image or enable APIs (org policy on this
project blocks `serviceusage.services.enable`; the needed APIs are already on).

1. **Deploy roles** on your user (you have `projectIamAdmin` to grant these):
   `run.admin`, `cloudbuild.builds.editor`, `artifactregistry.admin`,
   `storage.admin`, and `serviceusage.serviceUsageConsumer`.

2. **Build & push the image** (needs `serviceusage.serviceUsageConsumer`):
   ```bash
   gcloud builds submit \
     --tag us-central1-docker.pkg.dev/idc-hackathon-509702/egen-apps/recipe-to-sql:v1 \
     ../
   ```

## Usage

```bash
terraform init

# The repo + SA binding may already exist — import them so Terraform adopts them:
terraform import google_artifact_registry_repository.egen_apps \
  projects/idc-hackathon-509702/locations/us-central1/repositories/egen-apps
terraform import 'google_project_iam_member.sa_aiplatform[0]' \
  "idc-hackathon-509702 roles/aiplatform.user serviceAccount:pattern-team09-sa@idc-hackathon-509702.iam.gserviceaccount.com"

terraform plan
terraform apply
```

After apply, the service URL is printed as the `service_url` output.

## Notes

- The runtime SA uses **Application Default Credentials on Cloud Run** (it *is*
  the SA), so no keys or impersonation are needed in production.
- If `allow_unauthenticated = true` fails on `allUsers`, an org policy
  (domain-restricted sharing) forbids public access. Set it to `false` and reach
  the service with an identity token, or add your team group as invoker.
