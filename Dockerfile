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

# ── CRAN packages — pre-compiled noble binaries from PPM ─────────────────────
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

# ── Bioconductor packages — three-step process for ggtree compat ─────────────
#
#  ggtree 3.14.0 (Bioc 3.20) has importFrom(ggplot2, check_linewidth) but
#  ggplot2 3.5 removed that export → ggtree fails → enrichplot fails →
#  clusterProfiler fails.
#
#  Step A: First BiocManager pass — installs all transitive deps.
#          ggtree/enrichplot/clusterProfiler fail with R warnings (exit 0).
RUN R -e " \
  options( \
    repos   = c(PPM = 'https://packagemanager.posit.co/cran/__linux__/noble/latest'), \
    timeout = 300 \
  ); \
  BiocManager::install( \
    c('DESeq2','clusterProfiler','enrichplot'), \
    ask = FALSE, update = FALSE \
  )"

#  Step B: Download ggtree source, remove the broken importFrom line,
#          add a local no-op stub, install from patched source.
#          All deps are now present from Step A so repos=NULL is fine.
RUN R -q -e " \
  options(timeout = 300); \
  tmp <- tempdir(); \
  download.file( \
    'https://bioconductor.org/packages/3.20/bioc/src/contrib/ggtree_3.14.0.tar.gz', \
    file.path(tmp, 'ggtree.tar.gz'), quiet = TRUE); \
  untar(file.path(tmp, 'ggtree.tar.gz'), exdir = tmp); \
  gd <- file.path(tmp, 'ggtree'); \
  writeLines( \
    grep('check_linewidth', readLines(file.path(gd,'NAMESPACE')), \
         value = TRUE, invert = TRUE), \
    file.path(gd, 'NAMESPACE')); \
  writeLines( \
    'check_linewidth <- function(data, name) invisible(NULL)', \
    file.path(gd, 'R', 'compat-ggplot2-35.R')); \
  install.packages(gd, repos = NULL, type = 'source', Ncpus = 4); \
  if (!requireNamespace('ggtree', quietly = TRUE)) stop('ggtree install failed')"

#  Step C: Second BiocManager pass — enrichplot + clusterProfiler are missing
#          (removed when ggtree failed in Step A); ggtree is now present so
#          both install cleanly. Verify all three load.
RUN R -e " \
  options( \
    repos   = c(PPM = 'https://packagemanager.posit.co/cran/__linux__/noble/latest'), \
    timeout = 300 \
  ); \
  BiocManager::install( \
    c('DESeq2','clusterProfiler','enrichplot'), \
    ask = FALSE, update = FALSE \
  ); \
  bad <- Filter(function(p) !requireNamespace(p, quietly = TRUE), \
                c('DESeq2','clusterProfiler','enrichplot')); \
  if (length(bad)) stop('Bioc install incomplete — missing: ', paste(bad, collapse = ', '))"

# ── Verify every package the app needs actually loads ─────────────────────────
#    This RUN step fails the build immediately if any library() call errors,
#    so a broken image can never be pushed to the registry.
RUN R -e " \
  pkgs <- c( \
    'plumber','jsonlite','DBI','RSQLite','uuid','digest', \
    'httr2','httr','base64enc','matrixStats','mirai', \
    'ggplot2','ggpubr','plotly','heatmaply','UpSetR','msigdbr', \
    'DESeq2','clusterProfiler','enrichplot' \
  ); \
  failed <- character(0); \
  for (p in pkgs) { \
    ok <- tryCatch({ library(p, character.only=TRUE); TRUE }, \
                   error = function(e) { message('MISSING: ', p, ' — ', e\$message); FALSE }); \
    if (!ok) failed <- c(failed, p); \
  }; \
  if (length(failed)) stop('Build failed — packages not loadable: ', paste(failed, collapse=', '))"

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
