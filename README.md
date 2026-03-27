# DESeq2 ExploreR

A web-based differential expression analysis platform for RNA-seq data, powered by DESeq2. Upload a count matrix, define experimental contrasts, and explore results through interactive visualizations — all in the browser, no R installation required.

> **Built by [@bixBeta](https://github.com/bixBeta)**

---

## Features

- **Full DESeq2 pipeline** — VST normalization, multiple contrasts in a single run, parallel execution via `mirai`
- **Interactive visualizations** — PCA, MA plots, heatmaps (log2FC or Z-scored counts), UpSet plots, violin plots
- **Gene annotation** — Ensembl REST API + BioMart fallback; NCBI E-utilities for RefSeq / numeric gene IDs (bacteria, fungi, archaea, any organism)
- **Multi-contrast Compare panel** — Toggle individual contrasts on/off across all plots; all contrasts preserved in session
- **Session persistence** — SQLite-backed sessions with email + PIN authentication; results survive server restarts
- **Export** — Download plots as PNG/PDF; email results summary on completion
- **No local R required** — Fully containerized via Docker

---

## Input Format

The app expects a single **RDS file** containing a named R list with two elements:

```r
saveRDS(list(
  counts   = counts_matrix,   # numeric matrix: rows = genes, cols = samples
  metadata = sample_metadata  # data.frame: rows = samples (matching colnames of counts)
), "my_data.rds")
```

- `counts` — raw integer count matrix (genes × samples)
- `metadata` — sample sheet with at least one grouping column (e.g. `condition`, `treatment`)

> Column names of `counts` must match row names of `metadata`.

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### 1. Clone the repository

```bash
git clone https://github.com/bixBeta/deseq2-explorer.git
cd deseq2-explorer
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your SMTP credentials (required for email notifications and PIN delivery):

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourapp@gmail.com
SMTP_PASS=your-app-password
FROM_EMAIL=yourapp@gmail.com
APP_URL=http://localhost
```

> Email is used to deliver session PINs and optional results notifications. For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833).

### 3. Build and run

```bash
docker compose up --build
```

The app will be available at **http://localhost**.

To run in the background:

```bash
docker compose up --build -d
```

### 4. Try the example session

Click **Load Example Data** on the login page — no account needed. This loads a pre-computed human RNA-seq dataset so you can explore all features immediately.

---

## Workflow

```
Upload RDS → Edit Metadata → Design Contrasts → Run DESeq2 → Explore Results → Annotate Genes
```

| Step | Panel | Description |
|------|-------|-------------|
| 1 | **Upload** | Drag-drop your `.rds` file |
| 2 | **Metadata** | Review samples, edit groups, add covariates |
| 3 | **Design** | Define treatment vs reference contrasts, set DESeq2 parameters |
| 4 | *(auto)* | DESeq2 runs in parallel; progress shown in real time |
| 5 | **Results** | PCA, MA plot, count distributions, DE table |
| 6 | **Compare** | Heatmap, UpSet plot, Table Explorer across all contrasts |
| 7 | **Annotate** | Map gene IDs to symbols via Ensembl, BioMart, or NCBI |

---

## Panels

### Results
- **PCA** — Interactive 2D/3D scatter; color by any metadata column; select which PCs to plot
- **MA Plot** — log2FC vs mean expression; highlight significant genes; download PNG/PDF
- **Count Distributions** — Raw log2 and VST-transformed violin plots per sample
- **DE Table** — Sortable, filterable results table with gene symbols, LFC, p-values, padj

### Compare
Requires 2+ contrasts (or exactly 1 for the Heatmap). Active contrasts can be toggled per session — all others are preserved and can be re-added.

- **Heatmap** — log2FC across contrasts or Z-scored normalized counts; configurable clustering (Pearson, Spearman, Kendall, Euclidean)
- **UpSet Plot** — Overlap of significant DEGs across active contrasts
- **Gene Explorer** — Per-gene multi-group violin with Kruskal-Wallis + pairwise Wilcoxon tests
- **Table Explorer** — Wide-format pivot table (all contrasts × LFC/pval/padj); CSV export

### Annotation
Map gene IDs to symbols and descriptions. Three methods available:

| Method | Best for |
|--------|----------|
| **g:Profiler** | Ensembl IDs, well-supported organisms |
| **BioMart** *(experimental)* | Ensembl IDs, non-model organisms, orthologs |
| **GTF / GFF** | Custom genomes, bacterial/viral/organellar data |

NCBI E-utilities are used automatically for:
- **Numeric NCBI gene IDs** — any organism including bacteria, archaea, fungi
- **RefSeq accessions** (NM_, NR_, XM_, XR_…) — resolved via nuccore → gene pipeline

---

## DESeq2 Parameters

Configurable from the Design panel before each run:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `alpha` | 0.05 | FDR significance threshold |
| `lfcThreshold` | 0 | Minimum |log2FC| for hypothesis testing |
| `minCount` | 1 | Minimum count for pre-filtering |
| `minSamples` | 2 | Samples in which gene must reach `minCount` |
| `fitType` | `parametric` | Dispersion estimation method |
| `independentFiltering` | TRUE | Automatic low-count filtering |
| `cooksCutoff` | TRUE | Outlier detection via Cook's distance |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 5, Tailwind CSS 3, Plotly.js |
| Backend | R 4.4, Plumber, DESeq2, mirai, heatmaply, UpSetR |
| Database | SQLite (via RSQLite) |
| Proxy | nginx (reverse proxy, SPA routing, 512 MB upload limit) |
| Process mgmt | supervisord |
| Container | Docker (multi-stage build), Docker Compose |

---

## Architecture

The application is packaged as a **single Docker container** running two processes via supervisord:

```
┌─────────────────────────────────────┐
│  Docker Container (:80)             │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │  nginx   │───▶│   Plumber R   │  │
│  │  :80     │    │   :8000       │  │
│  │  (SPA +  │    │  (DESeq2 API) │  │
│  │  proxy)  │    │               │  │
│  └──────────┘    └───────────────┘  │
│                                     │
│  /data  (SQLite + uploads + results)│
└─────────────────────────────────────┘
```

All persistent data lives in the `/data` Docker volume:
- `sessions.db` — SQLite session database
- `uploads/` — uploaded RDS files
- `results/` — cached DESeq2 result RDS files

---

## API Endpoints

All endpoints accept and return JSON. Base path: `/api/`

| Endpoint | Description |
|----------|-------------|
| `POST /api/session/auth` | Authenticate with email + PIN |
| `POST /api/session/create` | Create new session |
| `POST /api/session/load` | Load session (metadata, design, results) |
| `GET /api/session/example` | Load example data |
| `POST /api/session/save` | Persist edits and annotations |
| `POST /api/session/delete` | Delete session |
| `POST /api/parse` | Parse uploaded RDS, extract metadata |
| `POST /api/deseq2` | Run DESeq2 analysis |
| `POST /api/maplot` | Render MA plot → base64 PNG/PDF |
| `POST /api/geneplot` | Single-gene violin plot |
| `POST /api/geneplot/compare` | Multi-group violin with Wilcoxon tests |
| `POST /api/heatmap` | Interactive heatmap (Plotly JSON) |
| `POST /api/upset` | UpSet plot → base64 PNG |
| `POST /api/annotate/biomart` | Ensembl REST + BioMart annotation |
| `POST /api/annotate/ncbi` | NCBI E-utilities annotation (gene IDs + RefSeq) |

---

## Session Management

- **Authentication** — Email address + numeric PIN (4–8 digits); PIN is SHA256-hashed before storage
- **Session limit** — 5 sessions per user (oldest session can be deleted to make room)
- **Persistence** — Metadata edits, sample selection, gene annotations, and DESeq2 results are all saved to the server; sessions survive container restarts
- **Session ID** — Shareable alphanumeric ID; anyone with the ID and PIN can load the session

---

## Resource Requirements

DESeq2 is memory-intensive. Recommended server specs:

| Dataset size | RAM | CPU |
|---|---|---|
| < 20 samples, < 20k genes | 2 GB | 2 cores |
| 20–50 samples | 4 GB | 2–4 cores |
| 50–100+ samples | 8 GB+ | 4+ cores |

The free **Oracle Cloud Always Free** tier (4 OCPU ARM, 24 GB RAM) is sufficient for most research datasets.

> AWS/GCP/Azure free tiers (1 GB RAM) are **not** sufficient for real RNA-seq data.

---

## Development

### Run locally (without Docker)

**Backend:**
```bash
cd backend
Rscript run.R
# Plumber API starts on :8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Vite dev server on :5173 — proxies /api/ to :8000
```

### Build frontend only

```bash
cd frontend
npm run build
# Output: frontend/dist/
```

### Rebuild Docker image

```bash
docker compose down
docker compose up --build
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server host |
| `SMTP_PORT` | `587` | SMTP port (STARTTLS) |
| `SMTP_USER` | — | SMTP username / sender address |
| `SMTP_PASS` | — | SMTP password or app password |
| `FROM_EMAIL` | — | From address in sent emails |
| `APP_URL` | `http://localhost` | Base URL used in email links |

---

## License

MIT

---

## Acknowledgements

- [DESeq2](https://bioconductor.org/packages/DESeq2/) — Love et al., *Genome Biology* 2014
- [heatmaply](https://github.com/talgalili/heatmaply) — Interactive heatmaps
- [UpSetR](https://github.com/hms-dbmi/UpSetR) — UpSet visualizations
- [Plumber](https://www.rplumber.io/) — R REST API framework
- [Plotly.js](https://plotly.com/javascript/) — Interactive charts
