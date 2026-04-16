# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: R + Nginx + supervisord ──────────────────────────────────────────
FROM rocker/r-ver:4.4

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libsqlite3-dev \
    libsodium-dev \
    zlib1g-dev \
    libpng-dev \
    libtiff-dev \
    libjpeg-dev \
    libcairo2-dev \
    libfontconfig1-dev \
    libfreetype6-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libxt-dev \
    libgit2-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Install pak for fast parallel package installation ────────────────────────
RUN R -e "install.packages('pak', repos='https://cloud.r-project.org')"

# Helper: install with up to 3 retries and a generous download timeout.
# Transient CRAN mirror blips or slow GHA runners won't kill the build.
ENV R_INSTALL_STAGED=false
RUN R -e " \
  retry_pak <- function(pkgs) { \
    options(timeout = 300); \
    for (i in seq_len(3)) { \
      ok <- tryCatch({ pak::pak(pkgs, ask=FALSE); TRUE }, \
                     error = function(e) { message('Attempt ', i, ' failed: ', e\$message); FALSE }); \
      if (ok) return(invisible(NULL)); \
      if (i < 3) Sys.sleep(20); \
    }; \
    stop('Installation failed after 3 attempts') \
  }; \
  # Group 1: core API + data layer \
  retry_pak(c('BiocManager','plumber','jsonlite','DBI','RSQLite','uuid','digest','httr2','httr','base64enc','matrixStats')); \
  # Group 2: async parallelism \
  retry_pak('mirai'); \
  # Group 3: base plotting \
  retry_pak(c('ggplot2','ggpubr')); \
  # Group 4: interactive / HTML widgets (largest dep tree) \
  retry_pak(c('plotly','heatmaply')); \
  # Group 5: set visualisation + gene sets \
  retry_pak(c('UpSetR','msigdbr'))"

# ── Bioconductor packages ──────────────────────────────────────────────────────
RUN R -e " \
  options(timeout = 300); \
  for (i in seq_len(3)) { \
    ok <- tryCatch({ pak::pak(c('bioc::DESeq2','bioc::clusterProfiler','bioc::enrichplot'), ask=FALSE); TRUE }, \
                   error = function(e) { message('Attempt ', i, ' failed: ', e\$message); FALSE }); \
    if (ok) break; \
    if (i == 3) stop('Bioc installation failed after 3 attempts'); \
    Sys.sleep(30); \
  }"

# Copy React build → nginx html dir
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Copy backend
WORKDIR /app/backend
COPY backend/ ./

# supervisord config: runs nginx + plumber
COPY supervisord.conf /etc/supervisor/conf.d/app.conf

# Data volume (SQLite DB + uploads + results)
VOLUME ["/data"]

# Notification relay — baked in at build time via GitHub Actions secrets.
# Users who pull the pre-built image get email working with zero configuration.
# hadolint ignore=DL3025
ARG  NOTIFY_URL=""
# hadolint ignore=DL3025
ARG  NOTIFY_TOKEN=""
# hadolint ignore=DL3025
ENV  NOTIFY_URL=${NOTIFY_URL}
# hadolint ignore=DL3025
ENV  NOTIFY_TOKEN=${NOTIFY_TOKEN}

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=8 \
  CMD curl -sf http://localhost/api/ping || exit 1

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/app.conf"]
