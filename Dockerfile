# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: R + Nginx + supervisord ──────────────────────────────────────────
FROM rocker/r-ver:4.4

# System deps
# - curl/ssl/xml: R package compilation + httr/blastula
# - sqlite3: RSQLite
# - zlib/png/tiff/jpeg: image I/O for ggplot2 / heatmaply PNG output
# - cairo/fontconfig/freetype/harfbuzz/fribidi: required by systemfonts → textshaping → ggplot2
# - libxt: R graphics device fallback
# - libgit2: dep of some tidyverse install-time packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libsqlite3-dev \
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

# ── CRAN packages ──────────────────────────────────────────────────────────────
# Core infrastructure
RUN R -e "install.packages(c('BiocManager','plumber','jsonlite','DBI','RSQLite','uuid','digest','blastula','httr','base64enc'), repos='https://cloud.r-project.org')"

# Computation & parallelism
RUN R -e "install.packages(c('matrixStats','mirai'), repos='https://cloud.r-project.org')"

# Visualisation (ggpubr pulls ggplot2 + rstatix; heatmaply pulls plotly + dendextend)
RUN R -e "install.packages(c('ggplot2','ggpubr','heatmaply','plotly','UpSetR'), repos='https://cloud.r-project.org')"

# GSEA gene-set data
RUN R -e "install.packages('msigdbr', repos='https://cloud.r-project.org')"

# ── Bioconductor packages ──────────────────────────────────────────────────────
# DESeq2 first (large dependency tree — separate layer for cache efficiency)
RUN R -e "BiocManager::install('DESeq2', ask=FALSE, update=FALSE)"

# GSEA analysis + visualisation (clusterProfiler pulls fgsea, DOSE, enrichplot)
RUN R -e "BiocManager::install(c('clusterProfiler','enrichplot'), ask=FALSE, update=FALSE)"

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

EXPOSE 80

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/app.conf"]
