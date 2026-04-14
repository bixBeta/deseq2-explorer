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

# ── CRAN packages (pak resolves deps in parallel — much faster than install.packages) ──
RUN R -e " \
  pkgs <- c('BiocManager','plumber','jsonlite','DBI','RSQLite','uuid','digest', \
            'httr2','httr','base64enc','matrixStats','mirai', \
            'ggplot2','ggpubr','heatmaply','plotly','UpSetR','msigdbr'); \
  pak::pak(pkgs); \
  missing <- pkgs[!sapply(pkgs, requireNamespace, quietly=TRUE)]; \
  if (length(missing)) stop(paste('Failed to install:', paste(missing, collapse=', ')))"

# ── Bioconductor packages ──────────────────────────────────────────────────────
RUN R -e " \
  pak::pak(c('bioc::DESeq2','bioc::clusterProfiler','bioc::enrichplot')); \
  missing <- c('DESeq2','clusterProfiler','enrichplot')[!sapply(c('DESeq2','clusterProfiler','enrichplot'), requireNamespace, quietly=TRUE)]; \
  if (length(missing)) stop(paste('Failed to install:', paste(missing, collapse=', ')))"

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
ARG  NOTIFY_URL=""
ARG  NOTIFY_TOKEN=""
ENV  NOTIFY_URL=${NOTIFY_URL}
ENV  NOTIFY_TOKEN=${NOTIFY_TOKEN}

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=8 \
  CMD curl -sf http://localhost/api/ping || exit 1

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/app.conf"]
