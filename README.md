<p align="center">
  <img src="frontend/src/assets/deseq2-applogo.svg" width="64" alt="DESeq2 ExploreR logo" />
  &nbsp;
  <img src="frontend/src/assets/trex-applogo.svg" width="64" alt="TREx logo" />
</p>

<h1 align="center">DESeq2 ExploreR</h1>

<p align="center">
  A web-based differential expression analysis platform for RNA-seq data, powered by DESeq2.<br/>
  Upload a count matrix, define experimental contrasts, and explore results through interactive visualizations — all in the browser, no R installation required.
</p>

<p align="center">
  <strong>Built by <a href="https://github.com/bixBeta">@bixBeta</a></strong>
</p>

<p align="center">
  <a href="https://github.com/bixBeta/deseq2-explorer/actions/workflows/docker-build.yml">
    <img src="https://github.com/bixBeta/deseq2-explorer/actions/workflows/docker-build.yml/badge.svg" alt="Docker Build" />
  </a>
  <a href="https://hub.docker.com/r/bixbeta/deseq2-explorer">
    <img src="https://img.shields.io/docker/image-size/bixbeta/deseq2-explorer/latest?label=Docker%20Hub" alt="Docker Image Size" />
  </a>
  <a href="https://hub.docker.com/r/bixbeta/deseq2-explorer">
    <img src="https://img.shields.io/docker/pulls/bixbeta/deseq2-explorer" alt="Docker Pulls" />
  </a>
  <img src="https://img.shields.io/badge/R-4.4-276DC3?logo=r" alt="R 4.4" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## Features

- **Full DESeq2 pipeline** — `varianceStabilizingTransformation()` normalization, multiple contrasts in a single run, parallel execution via `mirai`
- **Interactive visualizations** — PCA, MA plots, heatmaps (Z-scored VST counts), UpSet plots, violin plots
- **Gene annotation** — g:Profiler (client-side), Ensembl REST API + BioMart fallback, NCBI E-utilities for RefSeq / numeric gene IDs (bacteria, fungi, archaea, any organism), GTF/GFF upload
- **Multi-contrast Compare panel** — Toggle individual contrasts on/off across all plots; heatmaps with custom annotation color pickers and on-demand generation
- **GSEA & pathway analysis** — clusterProfiler GSEA with MSigDB gene sets; mountain plots, dot, ridge, heat, network plots; pathway heatmap with leading-edge genes
- **STAR count file support** — Auto-detects `ReadsPerGene.out.tab` format; strandedness picker with column-sum suggestion
- **Session persistence** — SQLite-backed sessions with email + PIN authentication; results survive server restarts
- **Email notifications** — Zero-config for end users; delivered via Cloudflare Worker relay (credentials never on user machines)
- **Export** — Download plots as PNG; email results summary on analysis completion
- **No local R required** — Fully containerized via Docker; self-updating launcher scripts for macOS, Linux, and Windows

---

## Input Format

### Option A — RDS file (recommended)

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

### Option B — Build an RDS with the Data Prep Tool

The bundled **Data Prep Tool** (accessible at `/prep` or as a [standalone web app](https://github.com/bixBeta/deseq2-prep)) builds the RDS entirely in the browser via WebR — no R installation required.

Supported input formats:

| Format | Detection | Notes |
|--------|-----------|-------|
| Full matrix (TSV/CSV) | Any tab/comma-separated file | First column = gene IDs; remaining columns = samples |
| Per-sample count files | Multiple files dropped together | One file per sample; gene union is computed automatically |
| **STAR** `ReadsPerGene.out.tab` | Auto-detected (4 columns + `N_unmapped` rows) | Strandedness picker shown automatically; column-sum suggestion highlights the best option |
| featureCounts, HTSeq-count | Auto-detected by suffix stripping | Treated as standard per-sample count files |

---

## Quick Start

### Option A — Desktop (recommended for most users)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Download or clone this repository
3. Run the launcher:

**macOS / Linux:**
```bash
bash launch.sh
```
**Windows:** double-click `launch.bat`

The launcher will pull the pre-built image (~1 GB, one-time), start the app, and open your browser to **http://localhost:3000** automatically.

To stop the app: `bash stop.sh` (or `stop.bat` on Windows).

---

### Option B — Self-hosted / server

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### 1. Clone the repository

```bash
git clone https://github.com/bixBeta/deseq2-explorer.git
cd deseq2-explorer
```

### 2. Configure environment variables (optional)

Email notifications are delivered via a Cloudflare Worker relay — credentials are baked into the pre-built image and never stored on user machines. Desktop users need no `.env` at all.

If you are **building the image yourself** (not using the pre-built Docker Hub image), create a `.env` file:

```bash
cp .env.example .env
```

```env
NOTIFY_URL=https://deseq2-notify.YOUR_SUBDOMAIN.workers.dev/send
NOTIFY_TOKEN=your-relay-token
APP_URL=http://your-server-address
```

See [`relay/README.md`](relay/README.md) for one-time Cloudflare Worker setup instructions.

### 3. Run

```bash
docker compose up -d
```

The app will be available at **http://localhost**.

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
| 7 | **Annotate** | Map gene IDs to symbols via g:Profiler, BioMart, NCBI, or GTF/GFF |

---

## Panels

### Results
- **PCA** — Interactive 2D/3D scatter; color by any metadata column; select which PCs to plot
- **MA Plot** — log2FC vs mean expression; highlight significant genes; download PNG
- **Count Distributions** — Raw log2 and `varianceStabilizingTransformation()`-normalized violin plots per sample
- **DE Table** — Sortable, filterable results table with gene symbols, LFC, p-values, padj

### Compare
Requires 2+ contrasts (or exactly 1 for the Heatmap). Active contrasts can be toggled per session — all others are preserved and can be re-added.

- **Heatmap** — Z-scored `varianceStabilizingTransformation()` counts for top N DEGs; configurable clustering (Pearson, Spearman, Kendall, Euclidean, Manhattan)
- **UpSet Plot** — Overlap of significant DEGs across active contrasts
- **Gene Explorer** — Per-gene multi-group violin with Kruskal-Wallis + pairwise Wilcoxon tests
- **Table Explorer** — Wide-format pivot table (all contrasts × LFC/pval/padj); CSV export

### Annotation
Map gene IDs to symbols and descriptions. Three methods available:

| Method | Best for |
|--------|----------|
| **g:Profiler** | Ensembl IDs, well-supported organisms; runs client-side |
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
| `lfcThreshold` | 0 | Minimum \|log2FC\| for hypothesis testing |
| `minCount` | 1 | Minimum count for pre-filtering |
| `minSamples` | 2 | Samples in which gene must reach `minCount` |
| `fitType` | `parametric` | Dispersion estimation method |
| `independentFiltering` | TRUE | Automatic low-count filtering |
| `cooksCutoff` | TRUE | Outlier detection via Cook's distance |

---

## Methods

A detailed description of all statistical methods used — including DESeq2 model fitting, PCA, heatmap clustering, and gene-level tests — is available in [methods.md](methods.md).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 5, Tailwind CSS 3, Plotly.js |
| Backend | R 4.4, Plumber, DESeq2, clusterProfiler, mirai, heatmaply, UpSetR, ggpubr |
| Database | SQLite (via RSQLite) |
| Proxy | nginx (reverse proxy, SPA routing, 512 MB upload limit) |
| Process mgmt | supervisord |
| Container | Docker (multi-stage build), Docker Compose |
| CI/CD | GitHub Actions — auto-build and push to Docker Hub + GHCR on every push to `main` |
| Email relay | Cloudflare Worker + Resend — zero-config notifications; SMTP credentials never on user machines |

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
| `POST /api/maplot` | Render MA plot → base64 PNG |
| `POST /api/geneplot` | Single-gene violin plot (two-group, Wilcoxon) |
| `POST /api/geneplot/compare` | Multi-group violin (Kruskal-Wallis + pairwise Wilcoxon) |
| `POST /api/heatmap` | Interactive heatmap (Plotly JSON) |
| `POST /api/upset` | UpSet plot → base64 PNG |
| `POST /api/annotate/biomart` | Ensembl REST + BioMart annotation |
| `POST /api/annotate/ncbi` | NCBI E-utilities annotation (gene IDs + RefSeq) |

> **Note:** g:Profiler annotation is called directly from the browser to the g:Profiler public API — it does not go through the backend.

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
| `NOTIFY_URL` | *(baked into image)* | Cloudflare Worker relay endpoint |
| `NOTIFY_TOKEN` | *(baked into image)* | Bearer token for relay authentication |
| `APP_URL` | `http://localhost:3000` | Base URL used in email notification links |
| `DB_PATH` | `/data/sessions.db` | SQLite database path |
| `UPLOAD_DIR` | `/data/uploads` | Uploaded RDS file directory |
| `RESULTS_DIR` | `/data/results` | Cached DESeq2 result directory |

> `NOTIFY_URL` and `NOTIFY_TOKEN` are injected at image build time via GitHub Actions secrets. Desktop users who pull `bixbeta/deseq2-explorer:latest` never need to set these manually.

---

## License

MIT

---

## Acknowledgements

- [DESeq2](https://bioconductor.org/packages/DESeq2/) — Love et al., *Genome Biology* 2014
- [clusterProfiler](https://bioconductor.org/packages/clusterProfiler/) — Yu et al., *OMICS* 2012
- [msigdbr](https://cran.r-project.org/package=msigdbr) — MSigDB gene sets in R
- [heatmaply](https://github.com/talgalili/heatmaply) — Interactive heatmaps
- [UpSetR](https://github.com/hms-dbmi/UpSetR) — UpSet visualizations
- [ggpubr](https://github.com/kassambara/ggpubr) — Publication-ready plots and statistical annotations
- [Plumber](https://www.rplumber.io/) — R REST API framework
- [Plotly.js](https://plotly.com/javascript/) — Interactive charts
- [Resend](https://resend.com) — Transactional email delivery
- [Cloudflare Workers](https://workers.cloudflare.com) — Serverless notification relay
