#!/usr/bin/env bash
# =============================================================================
# DESeq2 ExploreR — Pull latest changes and redeploy (Oracle or Arch)
# Run from the repo root: bash deploy/update.sh
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "==> Pulling latest changes from git..."
git pull

echo "==> Rebuilding and restarting app (zero-downtime swap)..."
docker compose up -d --build

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done. Running containers:"
docker compose ps
