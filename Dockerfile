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

# ── CRAN packages via Posit Package Manager (pre-compiled binaries for noble)
#    rocker/r-ver:4.4 is Ubuntu 24.04 (noble); use the matching PPM snapshot so
#    shared-library versions (libicu74, libssl3, etc.) align with the base image.
RUN R -e " \
  options( \
    repos   = c(PPM = 'https://packagemanager.posit.co/cran/__linux__/noble/latest'), \
    timeout = 300 \
  ); \
  install.packages(c( \
    'BiocManager','plumber','jsonlite','DBI','RSQLite','uuid','digest', \
    'httr2','httr','base64enc','matrixStats','mirai', \
    'ggplot2','ggpubr','plotly','heatmaply','UpSetR','msigdbr' \
  ), Ncpus = 4)"

# ── Bioconductor packages via BiocManager ─────────────────────────────────────
#    Pass the same PPM repo so any CRAN deps BiocManager pulls are also binaries.
RUN R -e " \
  options( \
    repos   = c(PPM = 'https://packagemanager.posit.co/cran/__linux__/noble/latest'), \
    timeout = 300 \
  ); \
  BiocManager::install( \
    c('DESeq2','clusterProfiler','enrichplot'), \
    ask = FALSE, update = FALSE \
  )"

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
