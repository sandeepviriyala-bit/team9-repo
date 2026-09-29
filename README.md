# Egen Recipe-to-SQL Engine

Enterprise-grade converter that transforms **Salesforce CRM Analytics Recipe JSON** into optimized **BigQuery SQL** — complete with CTE breakdown, table/column mapping, validation reports, and QA queries.

## Features

- **Recipe JSON Parsing** — paste or upload Salesforce recipe JSON; the engine topologically sorts the DAG of transformation nodes
- **Node Translation** — supports `load`, `filter`, `aggregate`, `join`, and `computeExpression` actions
- **BigQuery DDL Generation** — outputs `CREATE OR REPLACE TABLE/VIEW` with fully qualified project.dataset.table paths
- **Metadata-Driven Auto-Mapping** — upload a BigQuery schema (CSV or JSON) and the engine auto-maps source tables/columns to target tables/columns using keyword matching
- **Review & Confirm Workflow** — edit auto-generated mappings before applying; re-map anytime from metadata
- **Multi-Tab Output** — SQL, CTE breakdown, field mapping lineage, validation report, QA queries
- **Copy & Export** — one-click copy to clipboard or download as `.sql` file
- **Optimization Notes** — partition pruning, safe casting, and filter push-down suggestions

## Tech Stack

| Layer       | Technology                                      |
| ----------- | ----------------------------------------------- |
| Frontend    | React 19, TypeScript, Tailwind CSS v4           |
| Build       | Vite 6                                          |
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

### Docker

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```bash
docker build -t egen-recipe-to-sql-engine .
docker run -p 8080:80 egen-recipe-to-sql-engine
```

### Google Cloud Run

```bash
# Build and push to Artifact Registry
gcloud builds submit --tag gcr.io/YOUR_PROJECT/egen-recipe-to-sql-engine

# Deploy to Cloud Run
gcloud run deploy egen-recipe-to-sql-engine \
  --image gcr.io/YOUR_PROJECT/egen-recipe-to-sql-engine \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Vercel / Netlify

The project is a standard Vite app — deploy directly:

- **Vercel**: `npx vercel --prod`
- **Netlify**: Set build command to `npm run build` and publish directory to `dist`

## Environment Variables

| Variable         | Required | Description                          |
| ---------------- | -------- | ------------------------------------ |
| `GEMINI_API_KEY` | No       | Google Gemini API key (future use)   |
| `DISABLE_HMR`    | No       | Set to `true` to disable Vite HMR   |

Copy `.env.example` to `.env.local` and fill in values as needed.

## License

MIT
