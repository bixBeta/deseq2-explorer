<p align="center">
  <img src="frontend/src/assets/deseq2-applogo.svg" width="72" alt="DESeq2 ExploreR logo" />
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
    <img src="https://img.shields.io/docker/image-size/bixbeta/deseq2-explorer/latest?label=Docker%20Hub" alt="Image Size" />
  </a>
  <a href="https://hub.docker.com/r/bixbeta/deseq2-explorer">
    <img src="https://img.shields.io/docker/pulls/bixbeta/deseq2-explorer" alt="Docker Pulls" />
  </a>
  <img src="https://img.shields.io/badge/R-4.4-276DC3?logo=r" alt="R 4.4" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## Table of Contents

- [What You Need](#what-you-need-prerequisites)
- [Installation — Windows](#-windows)
- [Installation — macOS](#-macos)
- [Installation — Linux](#-linux)
- [Running the App](#running-the-app)
- [Stopping the App](#stopping-the-app)
- [Updating the App](#updating-to-a-new-version)
- [Preparing Your Data](#preparing-your-data)
- [Workflow Overview](#workflow-overview)
- [Features](#features)
- [DESeq2 Parameters](#deseq2-parameters)
- [Troubleshooting](#troubleshooting)
- [Server / Institutional Deployment](#server--institutional-deployment)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Acknowledgements](#acknowledgements)

---

## What You Need (Prerequisites)

The only thing you need to install is **Docker Desktop**. Docker packages the entire app (R, DESeq2, all dependencies) into a self-contained unit — nothing else needs to be installed on your computer.

| | Windows | macOS | Linux |
|---|---|---|---|
| **OS version** | Windows 10 (64-bit, build 19041+) or Windows 11 | macOS 12 Monterey or later | Ubuntu 20.04+ / Debian 11+ / Fedora 36+ |
| **RAM** | 8 GB minimum | 8 GB minimum | 4 GB minimum |
| **Disk space** | ~5 GB free (for Docker + app image) | ~5 GB free | ~5 GB free |
| **Internet** | Required for first-time setup | Required for first-time setup | Required for first-time setup |

> **Not sure which Windows build you have?** Press `Win + R`, type `winver`, press Enter. The build number is shown in the "About Windows" dialog.

---

## 🪟 Windows

### Step 1 — Check that virtualization is enabled

Docker requires hardware virtualization. Most modern PCs have it, but it may be disabled in the BIOS.

1. Press `Ctrl + Shift + Esc` to open Task Manager
2. Click the **Performance** tab → click **CPU**
3. Look for **Virtualization: Enabled** in the bottom-right panel

If it says **Disabled**, you need to enable it in your BIOS/UEFI settings. Search for your PC or motherboard model + "enable virtualization BIOS" for instructions — this is a one-time step.

### Step 2 — Install WSL 2 (Windows Subsystem for Linux)

Docker Desktop on Windows requires WSL 2. Open **PowerShell as Administrator**:

> Right-click the Start button → "Windows PowerShell (Admin)" or "Terminal (Admin)"

```powershell
wsl --install
```

This installs WSL 2 and Ubuntu. **Restart your computer when prompted.**

After restarting, Ubuntu will open and ask you to create a username and password — this is just for WSL, not your Windows account. You can use anything you like.

> **Already have WSL?** Run `wsl --update` to make sure it's WSL 2.

### Step 3 — Install Docker Desktop

1. Go to [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Click **Download for Windows**
3. Run the installer (`Docker Desktop Installer.exe`)
4. When asked, make sure **"Use WSL 2 instead of Hyper-V"** is checked
5. Restart your computer when the installer finishes

After restarting, Docker Desktop will launch automatically. Look for the **whale icon** 🐳 in your system tray (bottom-right of the taskbar). Wait until it stops animating — that means Docker is ready.

> **First launch tip:** Docker Desktop may take 1–2 minutes to fully start. The whale icon will have a spinning animation while it's starting up.

### Step 4 — Download DESeq2 ExploreR

**Option A — Download as ZIP (no Git required):**
1. Go to [https://github.com/bixBeta/deseq2-explorer](https://github.com/bixBeta/deseq2-explorer)
2. Click the green **Code** button → **Download ZIP**
3. Extract the ZIP to a folder you'll remember, e.g. `C:\Users\YourName\deseq2-explorer`

**Option B — Clone with Git (if you have Git installed):**
```cmd
git clone https://github.com/bixBeta/deseq2-explorer.git
```

### Step 5 — Launch the app

Open the folder where you extracted/cloned the app. Find **`launch.bat`** and **double-click it**.

A Command Prompt window will open and show progress:
```
[1/4] Checking Docker Desktop...        ✓ Docker is ready
[2/4] Pulling latest image...           (first time: ~1 GB download, takes a few minutes)
[3/4] Starting DESeq2 Explorer...       ✓
[4/4] Waiting for app to be ready...    ✓
App is ready! Opening browser...
```

Your browser will open automatically to **http://localhost:3000**

> ⚠️ **Windows Defender / Firewall prompt:** If Windows asks whether to allow Docker to access the network, click **Allow**.

> ⚠️ **"Docker Desktop is not running":** Make sure the whale icon 🐳 is visible in the taskbar and has stopped animating before running `launch.bat`.

---

## 🍎 macOS

### Step 1 — Install Docker Desktop

1. Go to [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Click **Download for Mac**
   - Choose **Apple Chip** if you have an M1/M2/M3/M4 Mac
   - Choose **Intel Chip** if you have an older Intel Mac
   - Not sure? Click the Apple menu → **About This Mac** → look for "Chip" or "Processor"
3. Open the downloaded `.dmg` file and drag Docker to Applications
4. Open Docker from Applications. You'll be prompted to authorise it — click **OK** / enter your password
5. Wait for the whale icon 🐳 in the menu bar to stop animating

### Step 2 — Download DESeq2 ExploreR

**Option A — Download as ZIP:**
1. Go to [https://github.com/bixBeta/deseq2-explorer](https://github.com/bixBeta/deseq2-explorer)
2. Click **Code** → **Download ZIP**
3. Extract it somewhere convenient (e.g. your Desktop or Documents)

**Option B — Clone with Git:**
```bash
git clone https://github.com/bixBeta/deseq2-explorer.git
cd deseq2-explorer
```

### Step 3 — Launch the app

Open **Terminal** (search for it with Spotlight: `Cmd + Space`, type "Terminal").

Navigate to the folder:
```bash
cd ~/Desktop/deseq2-explorer   # adjust path if you extracted elsewhere
```

Run the launcher:
```bash
bash launch.sh
```

Your browser will open automatically to **http://localhost:3000** when the app is ready.

> **Apple Silicon note (M1/M2/M3/M4):** The launcher automatically selects the correct image for your chip. No extra steps needed.

---

## 🐧 Linux

### Step 1 — Install Docker Engine

**Ubuntu / Debian:**
```bash
# Remove any old versions
sudo apt-get remove docker docker-engine docker.io containerd runc 2>/dev/null

# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Add your user to the docker group (so you don't need sudo)
sudo usermod -aG docker $USER

# Apply the group change (or log out and back in)
newgrp docker
```

**Fedora / RHEL / CentOS:**
```bash
sudo dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

Verify Docker is working:
```bash
docker run hello-world
```

### Step 2 — Clone and launch

```bash
git clone https://github.com/bixBeta/deseq2-explorer.git
cd deseq2-explorer
bash launch.sh
```

The app will be available at **http://localhost:3000**

---

## Running the App

Once launched, the app is available at:

**👉 http://localhost:3000**

### First-time use — no account needed

Click **"Load Example Data"** on the login screen to explore a pre-loaded human RNA-seq dataset with all features enabled.

### Creating an account

To save your own analyses:
1. Click **"Create Account"**
2. Enter any email address and a 4–8 digit PIN
3. Your analyses will be saved between sessions

> Your email and data stay on your own computer — nothing is sent to external servers (except optional email notifications if you enable them).

### What to expect on first launch

- **First run:** Docker needs to download the app image (~1 GB). This takes 3–10 minutes depending on your internet speed. Subsequent launches are near-instant.
- **App startup:** After the image is downloaded, the app takes ~30–60 seconds to initialise R and DESeq2 on first use.
- **Analysis time:** DESeq2 analysis typically takes 30 seconds to 5 minutes depending on dataset size.

---

## Stopping the App

**Windows:** Double-click **`stop.bat`** in the app folder.

**macOS / Linux:** In Terminal, from the app folder:
```bash
bash stop.sh
```

> Your data (sessions, uploaded files, results) is preserved in a Docker volume called `deseq2_data` — it persists even after stopping. You can stop and restart the app freely.

---

## Updating to a New Version

The launcher scripts (`launch.bat` / `launch.sh`) automatically pull the latest image every time you run them. To force an update:

**Windows:**
```cmd
docker pull bixbeta/deseq2-explorer:latest
```

**macOS / Linux:**
```bash
docker pull bixbeta/deseq2-explorer:latest
bash launch.sh
```

Your saved sessions and data are not affected by updates.

---

## Preparing Your Data

### Option A — Upload an RDS file directly

The app accepts an RDS file containing a named R list:

```r
# Run this in R to create your input file
saveRDS(list(
  counts   = counts_matrix,   # integer matrix: rows = genes, cols = samples
  metadata = sample_metadata  # data.frame: rows = samples (matching colnames of counts)
), "my_experiment.rds")
```

- `counts` — raw (un-normalized) integer count matrix
- `metadata` — sample sheet with at least one grouping column (e.g. `condition`, `treatment`)
- Column names of `counts` **must exactly match** row names of `metadata`

### Option B — Build an RDS in the browser (no R needed)

Use the built-in **Data Prep Tool** at `http://localhost:3000/prep` to merge individual count files into an RDS entirely in your browser using WebR.

Supported count file formats:

| Format | How it's detected | Notes |
|--------|-------------------|-------|
| Full count matrix (TSV/CSV) | Any tab/comma file | First column = gene IDs; remaining = samples |
| HTSeq-count files | Per-sample files | One file per sample; automatically merged |
| **STAR** `ReadsPerGene.out.tab` | Auto-detected (4 columns + summary rows) | Strandedness picker shown with column-sum suggestion |
| featureCounts output | Auto-detected by structure | Multi-sample or per-sample files both accepted |

**Steps:**
1. Go to `http://localhost:3000/prep`
2. Drag-and-drop your count files
3. Fill in the sample metadata table (group assignments)
4. Click **Download RDS**
5. Upload the downloaded `.rds` file to the main app

---

## Workflow Overview

```
Upload RDS → Review Metadata → Design Contrasts → Run DESeq2 → Explore Results → GSEA → Compare
```

| Step | Panel | What you do |
|------|-------|-------------|
| 1 | **Upload** | Drag-and-drop your `.rds` file |
| 2 | **Metadata** | Review sample assignments, edit groups, rename samples |
| 3 | **Design** | Choose treatment vs reference, add contrasts, set DESeq2 parameters |
| 4 | *(running)* | DESeq2 runs in parallel; progress shown in real time |
| 5 | **Results** | Explore PCA, MA plot, count distributions, DE results table |
| 6 | **Annotate** | Map Ensembl/gene IDs to symbols and descriptions |
| 7 | **GSEA** | Run gene set enrichment against MSigDB collections |
| 8 | **Compare** | Heatmaps, UpSet plots, cross-contrast gene tables |

---

## Features

### Differential Expression
- **Full DESeq2 pipeline** — negative binomial GLM, empirical Bayes dispersion shrinkage, optional apeglm LFC shrinkage
- **Multiple contrasts in one run** — all processed in parallel via `mirai` (4 worker threads)
- **Flexible filtering** — configurable minimum count, minimum samples, FDR threshold, LFC threshold

### Visualizations
- **MA plot** — log₂FC vs mean expression; click any gene for annotation details
- **PCA** — interactive 2D/3D scatter; color and shape by any metadata column; customizable PC axes
- **Count distributions** — per-sample kernel density plots (raw log₂ and VST-normalized)
- **Results table** — searchable, sortable; includes gene symbol, LFC, p-value, padj, and per-group mean counts; CSV export

### GSEA & Pathway Analysis
- **10 MSigDB collections** — Hallmarks, KEGG, Reactome, WikiPathways, GO (BP/MF/CC), Oncogenic, ImmuneSigDB, Cell Types
- **3 gene ranking methods** — log₂FC, Wald statistic, sign(LFC) × −log₁₀(padj)
- **Run all contrasts at once** — parallel GSEA across all contrasts with a real-time progress bar
- **Mountain plots** — enrichment score curves with leading-edge gene tables
- **Pathway heatmaps** — VST expression of leading-edge genes across all samples

### Compare Panel (2+ contrasts)
- **Heatmap** — hierarchically clustered heatmap of top DEGs; custom color palettes; annotation bars with color pickers
- **UpSet plot** — overlap of significant DEGs across contrasts
- **Gene Explorer** — per-gene multi-group violin plots with Kruskal-Wallis and pairwise Wilcoxon tests
- **Table Explorer** — wide-format table: all contrasts × LFC/pval/padj; CSV export

### Gene Annotation
| Method | Best for |
|--------|----------|
| **g:Profiler** | Ensembl IDs; runs in the browser, no backend call |
| **BioMart** | Non-model organisms, Ensembl IDs |
| **GTF / GFF upload** | Custom genomes, bacteria, viruses |
| **NCBI E-utilities** | Numeric NCBI gene IDs, RefSeq accessions (NM_, XM_, …) |

### Session & Notifications
- **Persistent sessions** — SQLite-backed; results survive app restarts; up to 5 sessions per account
- **Email notifications** — get an email with a summary table when your analysis completes (optional; zero configuration required for end users)

---

## DESeq2 Parameters

All configurable from the Design panel before each run:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `alpha` | `0.05` | FDR significance threshold (adjusted p-value cutoff) |
| `lfcThreshold` | `0` | Minimum \|log₂FC\| to test against (0 = standard two-sided test) |
| `minCount` | `1` | Minimum count per gene in at least `minSamples` samples |
| `minSamples` | `2` | Number of samples that must meet `minCount` |
| `fitType` | `parametric` | Dispersion estimation: `parametric`, `local`, or `mean` |
| `independentFiltering` | `TRUE` | Automatic low-count filtering to improve power |
| `cooksCutoff` | `TRUE` | Flag outlier samples via Cook's distance |

---

## Troubleshooting

### 🪟 Windows

<details>
<summary><strong>"Docker Desktop is not running" error</strong></summary>

The whale icon 🐳 must be visible in the system tray (bottom-right taskbar) and not animated before you run `launch.bat`.

1. Open Docker Desktop from the Start Menu
2. Wait 1–2 minutes for the whale to stop spinning
3. Run `launch.bat` again

If Docker Desktop won't open at all, try restarting your computer.
</details>

<details>
<summary><strong>"WSL 2 installation is incomplete" or WSL errors</strong></summary>

Open PowerShell as Administrator and run:
```powershell
wsl --install
wsl --update
wsl --set-default-version 2
```
Restart your computer, then try again.
</details>

<details>
<summary><strong>"Virtualization is not enabled" or Hyper-V errors</strong></summary>

You need to enable virtualization in your BIOS/UEFI:
1. Restart your PC and press the BIOS key during startup (usually `Del`, `F2`, `F10`, or `F12` — varies by manufacturer)
2. Find the "Virtualization Technology", "Intel VT-x", or "AMD-V" setting
3. Enable it and save
4. Boot back into Windows and try again

Search your PC brand + model + "enable virtualization" for specific instructions.
</details>

<details>
<summary><strong>Windows Defender / antivirus blocking Docker</strong></summary>

Docker needs to create network interfaces and virtual disks. If your antivirus blocks it:
- Add the Docker Desktop application to your antivirus exclusions
- Add `C:\Users\<YourName>\AppData\Local\Docker` to exclusions
</details>

<details>
<summary><strong>Port 3000 already in use</strong></summary>

Another app is using port 3000. Find and stop it, or change the port:

1. Open `docker-compose.desktop.yml` in a text editor
2. Change `"3000:80"` to `"3001:80"` (or any free port)
3. Update `APP_URL=http://localhost:3001` in the same file
4. Run `launch.bat` again, then open http://localhost:3001
</details>

<details>
<summary><strong>launch.bat opens and closes instantly</strong></summary>

Right-click `launch.bat` → **Run as administrator**. If it still fails, open Command Prompt, navigate to the folder, and run:
```cmd
launch.bat
```
This keeps the window open so you can read any error messages.
</details>

---

### 🍎 macOS

<details>
<summary><strong>"Cannot connect to Docker daemon"</strong></summary>

Docker Desktop is not running. Open it from Applications, wait for the whale icon 🐳 in the menu bar to stop animating, then run `bash launch.sh` again.
</details>

<details>
<summary><strong>Permission denied when running launch.sh</strong></summary>

```bash
chmod +x launch.sh stop.sh
bash launch.sh
```
</details>

<details>
<summary><strong>App is very slow on Apple Silicon (M1/M2/M3/M4)</strong></summary>

The launcher automatically sets `DOCKER_DEFAULT_PLATFORM=linux/amd64` for ARM Macs, which runs the amd64 image via Rosetta 2. This works correctly but may be slightly slower than a native arm64 image. A native arm64 build is included in the image manifest — if you see performance issues, try:
```bash
docker pull --platform linux/arm64 bixbeta/deseq2-explorer:latest
```
Then edit `docker-compose.desktop.yml` and add `platform: linux/arm64` under the `app:` service.
</details>

<details>
<summary><strong>Port 3000 already in use</strong></summary>

Find what's using port 3000:
```bash
lsof -i :3000
```
Stop that process, or change the port in `docker-compose.desktop.yml` (change `"3000:80"` to another port like `"3001:80"`).
</details>

---

### 🐧 Linux

<details>
<summary><strong>Permission denied when running Docker commands</strong></summary>

Add yourself to the docker group:
```bash
sudo usermod -aG docker $USER
newgrp docker
```
If that doesn't work, log out and log back in.
</details>

<details>
<summary><strong>docker compose command not found</strong></summary>

Install the compose plugin:
```bash
sudo apt-get install docker-compose-plugin   # Ubuntu/Debian
sudo dnf install docker-compose-plugin       # Fedora
```
Or install standalone:
```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```
</details>

---

### 🌐 All platforms

<details>
<summary><strong>App takes a very long time to start</strong></summary>

On first launch, Docker downloads the app image (~1 GB). This is normal — subsequent launches are much faster.

After downloading, the app needs ~60 seconds to initialise the R environment. The launcher waits automatically.

If startup takes more than 5 minutes, check the logs:
```bash
docker logs deseq2-explorer
```
</details>

<details>
<summary><strong>Browser opens but shows an error page</strong></summary>

The app might still be starting. Wait 30–60 seconds and refresh the page. If it still fails:
```bash
docker logs deseq2-explorer
```
Look for R or nginx errors at the bottom of the log.
</details>

<details>
<summary><strong>Analysis fails or freezes</strong></summary>

Check available memory. DESeq2 requires at least 2–4 GB of RAM:
- **Docker Desktop (Windows/Mac):** Open Docker Desktop → Settings → Resources → increase Memory to at least 4 GB
- **Linux:** Ensure at least 4 GB system RAM is available

Restart the app after changing memory settings:
```bash
bash stop.sh
bash launch.sh
```
</details>

<details>
<summary><strong>How do I view app logs?</strong></summary>

```bash
docker logs deseq2-explorer          # all logs
docker logs deseq2-explorer --tail 50  # last 50 lines
docker logs -f deseq2-explorer       # live stream
```
</details>

<details>
<summary><strong>How do I completely reset the app and delete all data?</strong></summary>

> ⚠️ This deletes all saved sessions, uploaded files, and results permanently.

```bash
bash stop.sh   # or stop.bat on Windows
docker volume rm deseq2_data
bash launch.sh # fresh start
```
</details>

---

## Server / Institutional Deployment

For deploying on a shared server or cloud instance:

### Prerequisites
- Docker Engine + Docker Compose plugin
- Minimum 4 GB RAM (8 GB recommended)
- Port 80 open (or use a reverse proxy)

### Deploy

```bash
git clone https://github.com/bixBeta/deseq2-explorer.git
cd deseq2-explorer
docker compose up -d
```

The app is available at **http://your-server-ip** (port 80).

### HTTPS (recommended for shared servers)

Place a reverse proxy (e.g. Caddy or nginx) in front of the container. Caddy example:

```
your.domain.com {
    reverse_proxy localhost:80
}
```

Caddy handles SSL certificates automatically via Let's Encrypt.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `http://localhost:3000` | Base URL shown in email notification links |
| `NOTIFY_URL` | *(baked into image)* | Cloudflare Worker relay endpoint |
| `NOTIFY_TOKEN` | *(baked into image)* | Bearer token for relay auth |
| `DB_PATH` | `/data/sessions.db` | SQLite database path |
| `UPLOAD_DIR` | `/data/uploads` | Uploaded RDS file directory |
| `RESULTS_DIR` | `/data/results` | Cached DESeq2 result directory |

> `NOTIFY_URL` and `NOTIFY_TOKEN` are baked into the pre-built image via GitHub Actions — desktop users never need to set these.

### Recommended cloud specs

| Dataset size | RAM | CPU |
|---|---|---|
| < 20 samples | 4 GB | 2 cores |
| 20–50 samples | 8 GB | 4 cores |
| 50–100+ samples | 16 GB+ | 8+ cores |

> The **Oracle Cloud Always Free** tier (4 OCPU ARM, 24 GB RAM) is excellent for most research datasets and costs nothing.

> AWS/GCP/Azure free tiers (1 GB RAM) are **not** sufficient for real RNA-seq data.

---

## Architecture

```
┌─────────────────────────────────────┐
│  Docker Container (:80 / :3000)     │
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

The app runs as a **single Docker container** managed by supervisord. nginx serves the React frontend and proxies all `/api/` requests to the R/plumber backend. All persistent data lives in the `deseq2_data` Docker volume.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 5, Tailwind CSS 3, Plotly.js |
| Backend | R 4.4, plumber, DESeq2, clusterProfiler, fgsea, msigdbr, mirai, heatmaply, UpSetR, ggpubr, httr2 |
| Database | SQLite (RSQLite + DBI) |
| Proxy | nginx (reverse proxy, SPA routing, 512 MB upload limit) |
| Process mgmt | supervisord |
| Container | Docker (multi-arch: amd64 + arm64), Docker Compose |
| CI/CD | GitHub Actions — auto-build and push to Docker Hub on every push to `main` |
| Email relay | Cloudflare Worker + Resend — zero-config notifications; credentials never on user machines |

---

## Acknowledgements

- [DESeq2](https://bioconductor.org/packages/DESeq2/) — Love et al., *Genome Biology* 2014
- [clusterProfiler](https://bioconductor.org/packages/clusterProfiler/) — Wu et al., *Innovation* 2021
- [fgsea](https://bioconductor.org/packages/fgsea/) — Fast gene set enrichment
- [msigdbr](https://cran.r-project.org/package=msigdbr) — MSigDB gene sets in R
- [heatmaply](https://github.com/talgalili/heatmaply) — Interactive cluster heatmaps
- [UpSetR](https://github.com/hms-dbmi/UpSetR) — UpSet visualizations
- [ggpubr](https://github.com/kassambara/ggpubr) — Publication-ready plots
- [mirai](https://github.com/shikokuchuo/mirai) — Minimal async framework for R
- [plumber](https://www.rplumber.io/) — R REST API framework
- [Plotly.js](https://plotly.com/javascript/) — Interactive charts
- [Resend](https://resend.com) — Transactional email delivery
- [Cloudflare Workers](https://workers.cloudflare.com) — Serverless notification relay

---

## License

MIT
