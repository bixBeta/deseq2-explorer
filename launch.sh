#!/usr/bin/env bash
# =============================================================================
# DESeq2 Explorer — Desktop Launcher (macOS / Linux)
# Usage: bash launch.sh
# =============================================================================
set -euo pipefail

IMAGE="bixbeta/deseq2-explorer:latest"
COMPOSE_FILE="docker-compose.desktop.yml"
PORT=3000
URL="http://localhost:${PORT}"

BOLD=$(tput bold 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)

info()    { echo "${GREEN}==>${RESET} $*"; }
warn()    { echo "${YELLOW}[!]${RESET} $*"; }
error()   { echo "${RED}[x]${RESET} $*" >&2; }

# ── 1. Check Docker is running ────────────────────────────────────────────────
info "Checking Docker..."
if ! docker info &>/dev/null; then
  error "Docker is not running."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    warn "Please open Docker Desktop and wait for it to start, then run this script again."
    open -a "Docker Desktop" 2>/dev/null || true
  else
    warn "Please start Docker and try again (e.g. sudo systemctl start docker)."
  fi
  exit 1
fi

# ── 2. Detect architecture — force amd64 on ARM via Rosetta 2 ─────────────────
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
  warn "ARM CPU detected ($ARCH) — running amd64 image via Rosetta 2"
  export DOCKER_DEFAULT_PLATFORM=linux/amd64
else
  info "CPU: $ARCH"
fi

# ── 3. Pull latest image ──────────────────────────────────────────────────────
info "Pulling latest image (first run may take a few minutes)..."
docker pull "$IMAGE"

# ── 4. Ensure data volume exists ─────────────────────────────────────────────
docker volume create deseq2_data &>/dev/null || true

# ── 5. Start container ────────────────────────────────────────────────────────
info "Starting DESeq2 Explorer..."
docker compose -f "$COMPOSE_FILE" up -d

# ── 6. Wait until healthy ─────────────────────────────────────────────────────
info "Waiting for the app to be ready..."
TIMEOUT=120
ELAPSED=0
while true; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' deseq2-explorer 2>/dev/null || echo "none")
  if [[ "$STATUS" == "healthy" ]]; then
    break
  fi
  # Fallback: direct curl check (for systems without health-check support)
  if curl -sf "${URL}/api/ping" &>/dev/null; then
    break
  fi
  if (( ELAPSED >= TIMEOUT )); then
    error "App did not become ready within ${TIMEOUT}s."
    error "Check logs with: docker compose -f ${COMPOSE_FILE} logs"
    exit 1
  fi
  sleep 3
  (( ELAPSED += 3 ))
  echo -n "."
done
echo ""

# ── 7. Open browser ───────────────────────────────────────────────────────────
info "Opening ${BOLD}${URL}${RESET}"
if [[ "$OSTYPE" == "darwin"* ]]; then
  open "$URL"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$URL"
else
  warn "Open your browser and go to: ${URL}"
fi

echo ""
echo "${GREEN}DESeq2 Explorer is running at ${BOLD}${URL}${RESET}"
echo "To stop the app, run: ${BOLD}bash stop.sh${RESET}"
