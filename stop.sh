#!/usr/bin/env bash
# =============================================================================
# DESeq2 Explorer — Stop (macOS / Linux)
# Usage: bash stop.sh
# =============================================================================
set -euo pipefail

COMPOSE_FILE="docker-compose.desktop.yml"

echo "==> Stopping DESeq2 Explorer..."
docker compose -f "$COMPOSE_FILE" down

echo "==> Done. Your data is preserved in the 'deseq2_data' Docker volume."
