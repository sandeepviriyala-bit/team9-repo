# Setup — Hybrid Gemini AI

This app converts Salesforce CRM Analytics Recipe JSON to BigQuery SQL. The core
converter (`src/engine.ts`) is fully deterministic. An **optional** hybrid AI pass
(`POST /api/convert` with `useAI: true`) runs the engine first, then asks Gemini to
fix unsupported recipe nodes and add optimization notes.

- **Deterministic mode** — runs entirely in the browser, no backend, no cloud.
- **AI mode** — calls the Express backend, which calls Gemini via **Vertex AI**
  (recommended, no API key) or an AI Studio API key. Falls back to the
  deterministic engine if the backend or model is unavailable.

---

## Architecture

```
React UI ──/api/convert──▶ Express (server/index.ts)
                              │
                              ├─ RecipeToSQLEngine  (deterministic, always)
                              └─ enhanceWithGemini  (Vertex AI Gemini, when useAI)
```

---

## GCP resources (project: `idc-hackathon-509702`)

| # | Resource | Purpose |
|---|----------|---------|
| 1 | Vertex AI API | Gemini model inference |
| 2 | Cloud Run, Cloud Build, Artifact Registry APIs | Build + host the container |
| 3 | Secret Manager API | Only if using the API-key path |
| 4 | `roles/aiplatform.user` on the runtime SA | SA can call Gemini |
| 5 | `roles/iam.serviceAccountTokenCreator` (you → SA) | Impersonate the SA locally |
| 6 | `roles/iam.serviceAccountUser` (you → SA) | Deploy Cloud Run *as* the SA |

Service account: `pattern-team09-sa@idc-hackathon-509702.iam.gserviceaccount.com`

### One-time IAM / API setup

```bash
export PROJECT=idc-hackathon-509702
export SA=pattern-team09-sa@idc-hackathon-509702.iam.gserviceaccount.com
export YOUR_USER=sandeep.viriyala@egen.ai
export REGION=us-central1

gcloud config set project $PROJECT

gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

# SA can call Gemini/Vertex
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" \
  --role="roles/aiplatform.user"

# You can impersonate the SA (local dev)
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member="user:$YOUR_USER" \
  --role="roles/iam.serviceAccountTokenCreator"

# You can deploy Cloud Run as the SA
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member="user:$YOUR_USER" \
  --role="roles/iam.serviceAccountUser"
```

---

## Local development

### Vertex AI via impersonation (recommended — no API key)

```bash
# ADC that impersonates the SA; the @google/genai Vertex client picks this up
gcloud auth application-default login \
  --impersonate-service-account=$SA
```

Create `.env.local`:

```bash
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=idc-hackathon-509702
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
```

Run both processes:

```bash
npm install
npm run server   # terminal 1 — Express backend on :8080
npm run dev      # terminal 2 — Vite UI on :3000 (proxies /api to :8080)
```

Open http://localhost:3000 and tick **"enhance with gemini ai"** before converting.

### Alternative: AI Studio API key (simplest, less governed)

```bash
# .env.local
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
```

---

## Deploy to Cloud Run

The service runs *as* `pattern-team09-sa` — no impersonation and no key at
runtime; ADC is automatic on Cloud Run.

Deployment is two steps: **build the image** (Cloud Build → Artifact Registry),
then **apply the infra** (Terraform creates/updates the Cloud Run service).

```bash
# 1. Build & push a versioned image (bump the tag each build)
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/idc-hackathon-509702/egen-apps/recipe-to-sql:v1 \
  --timeout=1200s .

# 2. Apply the Terraform (see terraform/README.md for first-time import steps)
cd terraform
GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) terraform apply
```

The `Dockerfile` uses **Node 22** (deps require Node ≥ 20) and `npm install`
(not `npm ci`) so the correct musl native binaries for `@tailwindcss/oxide` and
`esbuild` are resolved on Alpine. It serves the built frontend **and** the
`/api` backend as one service.

Live service: <https://recipe-to-sql-dhkt3dxhuq-uc.a.run.app>

---

## Team access — letting a teammate build & deploy

Building and deploying needs roles the team group does **not** have by default
(`idc-ideathon@egen.ai` only has `aiplatform.user`, `serviceAccountTokenCreator`,
`serviceAccountUser`, `viewer`). Someone with `projectIamAdmin` grants the group
once so every teammate can build and deploy:

```bash
for R in roles/serviceusage.serviceUsageConsumer roles/cloudbuild.builds.editor \
         roles/artifactregistry.writer roles/run.admin roles/storage.admin; do
  gcloud projects add-iam-policy-binding idc-hackathon-509702 \
    --member="group:idc-ideathon@egen.ai" --role="$R" --condition=None
done
```

A teammate then: `gcloud auth login`, then the two deploy steps above. To run
AI mode locally instead, they use ADC impersonation (see **Local development**).

---

## Verify

```bash
curl -s http://localhost:8080/api/health
# {"status":"ok","ai_configured":true}   ← true once Vertex/key is configured

curl -s -X POST http://localhost:8080/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"useAI":true,"recipe":{"nodes":{"Load_Account":{"action":"load","parameters":{"dataset":{"name":"salesforce.account"}},"sources":[]}}}}'
```

---

## Notes

- **Model availability:** `gemini-2.5-flash` is available on Vertex AI in
  `us-central1`. If the project's allowlist differs, change `GEMINI_MODEL`
  (e.g. `gemini-2.0-flash`).
- **Graceful degradation:** if Gemini is unconfigured or fails, the API returns
  the deterministic engine output with an explanatory `ai_notes` entry —
  the app never hard-fails on AI.
- **Agentspace (optional, later):** to expose this as a team-facing enterprise
  agent, build an agent in Gemini Enterprise and register the deployed
  `/api/convert` endpoint as a tool. Agentspace is an agent layer on top; it is
  not the inference API the app calls.
