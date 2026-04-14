# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: R + Nginx + supervisord ──────────────────────────────────────────
# Built on top of qcchecker which already has:
#   DESeq2, heatmaply, plotly, ggplot2, matrixStats, jsonlite, blastula,
#   digest, BiocManager, and all their system dependencies
FROM bixbeta/qcchecker:amd64

# Additional system packages not in base image
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Additional CRAN packages not in qcchecker ─────────────────────────────────
RUN R -e "install.packages(c('plumber','DBI','RSQLite','uuid','httr','base64enc','ggpubr','UpSetR','mirai'), repos='https://cloud.r-project.org')"

# ── Additional Bioconductor packages not in qcchecker ─────────────────────────
# msigdbr is CRAN; clusterProfiler + enrichplot pull fgsea, DOSE, enrichplot
RUN R -e "install.packages('msigdbr', repos='https://cloud.r-project.org')"
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

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=8 \
  CMD curl -sf http://localhost/api/ping || exit 1

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/app.conf"]
