# Egen Recipe-to-SQL Engine

Enterprise-grade converter that transforms **Salesforce CRM Analytics Recipe JSON** into optimized **BigQuery SQL** — complete with CTE breakdown, table/column mapping, validation reports, and QA queries.

A deterministic engine handles the core translation; an **optional hybrid AI pass** (Gemini via Vertex AI) fills the gaps the rules can't — unsupported recipe actions, complex formulas, and extra optimization suggestions.

**Live demo:** <https://recipe-to-sql-dhkt3dxhuq-uc.a.run.app>

## Overview

### The problem
Teams on **Salesforce CRM Analytics** build data transformations as visual
"recipes," stored as JSON — a graph of steps (load, filter, aggregate, join,
compute). Migrating that analytics to **Google BigQuery** means rewriting every
recipe as SQL by hand: slow, error-prone, and requiring expertise in both worlds.

### What this app does
Paste or upload a recipe JSON (optionally your BigQuery schema) and it produces
ready-to-run BigQuery SQL, plus a CTE breakdown, auto field/table mapping, a
validation report, QA queries, and optimization notes. Internally it
topologically sorts the recipe's node graph and translates each node into a
named SQL CTE.

### How AI is used (hybrid)
The core translation is **deterministic** (`src/engine.ts`) — fast, free, and
predictable, but it only knows five actions (`load`, `filter`, `aggregate`,
`join`, `computeExpression`). AI fills the gaps rather than replacing the engine:

1. The **engine runs first** and flags anything it can't handle (e.g. an
   `unsupported action: pivot`).
2. When AI mode is on, the backend sends **Gemini (via Vertex AI)** the recipe,
   the engine's SQL, the flagged issues, and the metadata, and asks it to
   translate the unsupported nodes, add optimizations, and explain its changes.
3. Results are **merged** — deterministic SQL for known parts, Gemini's SQL for
   the gaps — returned with an `ai_enhanced` flag and `ai_notes`.

**Why hybrid:** guaranteed-correct output for the common cases (no LLM
variability), AI only where rules fall short, and **graceful degradation** to the
deterministic result if AI is unconfigured or unavailable — it never hard-fails.

```
React UI ──/api/convert──▶ Express backend
                              ├─ RecipeToSQLEngine   (deterministic, always)
                              └─ Gemini via Vertex AI (fills gaps, when enabled)
```

On Cloud Run the backend runs as a service account and calls Vertex AI through
that identity — **no API keys**, governed access, and audit logging (the
enterprise-appropriate choice over a raw API key).

## Features

- **Recipe JSON Parsing** — paste or upload Salesforce recipe JSON; the engine topologically sorts the DAG of transformation nodes
- **Node Translation** — supports `load`, `filter`, `aggregate`, `join`, and `computeExpression` actions
- **BigQuery DDL Generation** — outputs `CREATE OR REPLACE TABLE/VIEW` with fully qualified project.dataset.table paths
- **Metadata-Driven Auto-Mapping** — upload a BigQuery schema (CSV or JSON) and the engine auto-maps source tables/columns to target tables/columns using keyword matching
- **Review & Confirm Workflow** — edit auto-generated mappings before applying; re-map anytime from metadata
- **Multi-Tab Output** — SQL, CTE breakdown, field mapping lineage, validation report, QA queries
- **Copy & Export** — one-click copy to clipboard or download as `.sql` file
- **Optimization Notes** — partition pruning, safe casting, and filter push-down suggestions
- **Hybrid AI Mode (optional)** — toggle "enhance with gemini ai"; the backend runs the engine, then asks **Gemini (Vertex AI)** to translate unsupported nodes and add optimizations. Degrades gracefully to the deterministic output if AI is unconfigured or unavailable.

## Tech Stack

| Layer       | Technology                                      |
| ----------- | ----------------------------------------------- |
| Frontend    | React 19, TypeScript, Tailwind CSS v4           |
| Build       | Vite 6                                          |
| Backend     | Express (`/api/convert`), Node 22               |
| AI          | Gemini via Vertex AI (`@google/genai`)          |
| Infra       | Cloud Run, Cloud Build, Artifact Registry       |
| IaC         | Terraform (`terraform/`)                        |
| Animations  | Framer Motion (motion)                          |
| Icons       | Lucide React                                    |
| Font        | Space Grotesk (Google Fonts)                    |

## Prerequisites

- **Node.js** >= 18.x (LTS recommended)
- **npm** >= 9.x

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/karthik-egen/egen-recipe-to-sql-engine.git
cd egen-recipe-to-sql-engine

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The app will be available at **http://localhost:3000**

## All Commands

| Command           | Description                                |
| ----------------- | ------------------------------------------ |
| `npm run dev`     | Start Vite dev server with HMR (port 3000) |
| `npm run server`  | Start Express backend for AI mode (port 8080) |
| `npm run start`   | Run the backend serving built app + `/api` |
| `npm run build`   | Create production build in `dist/`         |
| `npm run preview` | Serve production build locally (port 4173) |
| `npm run lint`    | TypeScript type checking (no emit)         |
| `npm run clean`   | Remove `dist/` directory                   |

## Project Structure

```
egen-recipe-to-sql-engine/
├── index.html              # Entry HTML
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build configuration
├── .env.example            # Environment variable template
├── .gitignore
├── src/
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Main UI component (sidebar + output panels)
│   ├── engine.ts           # Core SQL generation engine
│   ├── types.ts            # TypeScript interfaces
│   ├── index.css           # Tailwind + Egen brand theme
│   └── lib/
│       └── utils.ts        # Utility functions (cn helper)
├── server/
│   ├── index.ts            # Express backend: /api/convert, /api/health
│   └── gemini.ts           # Hybrid AI pass (Vertex AI / Gemini)
├── terraform/              # IaC: Artifact Registry, Cloud Run, IAM
├── Dockerfile              # Node 22 image: builds frontend + serves /api
└── SETUP.md                # GCP setup, IAM, deploy, team access
```

## How It Works

### 1. Recipe Input
Paste or upload a Salesforce CRM Analytics Recipe JSON. The recipe is a DAG of nodes, each with an `action`, `parameters`, and `sources`:

```json
{
  "nodes": {
    "Load_Account": {
      "action": "load",
      "parameters": { "dataset": { "name": "salesforce.account" } },
      "sources": []
    },
    "Agg_By_Industry": {
      "action": "aggregate",
      "parameters": {
        "groupings": ["Industry"],
        "aggregations": [{ "action": "sum", "source": "AnnualRevenue", "name": "Total_Revenue" }]
      },
      "sources": ["Load_Account"]
    }
  }
}
```

### 2. Metadata Upload (Optional)
Upload a BigQuery schema as CSV or JSON to enable auto-mapping.

**CSV format:**
```csv
table_name,column_name,data_type
project.dataset.account,Industry,STRING
project.dataset.account,AnnualRevenue,FLOAT64
```

**JSON format:**
```json
[
  { "table_name": "project.dataset.account", "column_name": "Industry", "data_type": "STRING" },
  { "table_name": "project.dataset.account", "column_name": "AnnualRevenue", "data_type": "FLOAT64" }
]
```

### 3. Review & Confirm Mappings
After metadata upload, the engine auto-maps source tables to target tables. Review the suggested mappings, edit if needed, and confirm to apply.

### 4. Generate SQL
Click **Convert to BigQuery SQL** and choose whether to include DDL wrapping. The output:

```sql
CREATE OR REPLACE TABLE `my-project.my_dataset.my_output_table` AS
WITH
Load_Account AS (
  SELECT * FROM `project.dataset.account`
),
Agg_By_Industry AS (
  SELECT Industry, sum(AnnualRevenue) AS Total_Revenue
  FROM Load_Account GROUP BY Industry
)
SELECT * FROM Agg_By_Industry
```

## Supported Recipe Actions

| Action              | SQL Translation                                         |
| ------------------- | ------------------------------------------------------- |
| `load`              | `SELECT * FROM <table>`                                 |
| `filter`            | `SELECT * FROM <source> WHERE <conditions>`             |
| `aggregate`         | `SELECT <groups>, <agg_functions> GROUP BY <groups>`    |
| `join`              | `SELECT L.*, R.* EXCEPT(...) FROM <left> JOIN <right>`  |
| `computeExpression` | `SELECT *, <formula> AS <name> FROM <source>`           |

## Deployment

Deployed to **Google Cloud Run** on project `idc-hackathon-509702`, running as
the `pattern-team09-sa` service account (Vertex AI via ADC — no keys at runtime).
The root `Dockerfile` (Node 22, multi-stage) builds the frontend and serves it
together with the `/api` backend as one service.

Deployment is two steps — build the image, then apply the Terraform:

```bash
# 1. Build & push a versioned image
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/idc-hackathon-509702/egen-apps/recipe-to-sql:v1 \
  --timeout=1200s .

# 2. Provision / update infra (Cloud Run, Artifact Registry, IAM)
cd terraform && terraform apply
```

See **[`SETUP.md`](./SETUP.md)** for full GCP setup (APIs, IAM, local dev,
team access) and **[`terraform/README.md`](./terraform/README.md)** for the IaC.

The frontend alone (deterministic mode, no AI) is a standard Vite app and can
also be hosted statically on Vercel/Netlify (`npm run build` → `dist/`).

## Environment Variables

Used by the backend (`server/`). Copy `.env.example` to `.env.local` for local
dev; on Cloud Run they are set via Terraform.

| Variable                    | Required | Description                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------ |
| `GOOGLE_GENAI_USE_VERTEXAI` | For AI   | `true` to use Vertex AI (recommended; uses ADC, no key)            |
| `GOOGLE_CLOUD_PROJECT`      | For AI   | GCP project ID for Vertex AI                                       |
| `GOOGLE_CLOUD_LOCATION`     | For AI   | Vertex AI region (e.g. `us-central1`)                              |
| `GEMINI_MODEL`              | No       | Gemini model (default `gemini-2.5-flash`)                          |
| `GEMINI_API_KEY`            | For AI   | Alternative to Vertex: AI Studio API key (simpler, less governed)  |
| `PORT`                      | No       | Backend port (default `8080`; Cloud Run injects this)             |
| `DISABLE_HMR`               | No       | Set to `true` to disable Vite HMR                                  |

AI mode needs **either** the Vertex variables **or** `GEMINI_API_KEY`. Without
either, the app still works in deterministic mode.

## License

MIT
