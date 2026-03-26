#!/usr/bin/env bash
# =============================================================================
# DESeq2 ExploreR — Oracle Cloud Always Free (Ubuntu 22.04 ARM64) setup
# Run once as the default ubuntu user after SSH-ing into the VM:
#   bash deploy/oracle-setup.sh
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/bixBeta/deseq2-explorer.git"
APP_DIR="$HOME/deseq2-app"

echo "==> Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y

# ── Docker ────────────────────────────────────────────────────────────────────
echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

# Docker Compose v2 plugin (comes with modern Docker install, confirm it)
docker compose version >/dev/null 2>&1 || {
  echo "==> Installing docker-compose-plugin separately..."
  sudo apt-get install -y docker-compose-plugin
}

# ── Open port 80 in iptables (Oracle Ubuntu blocks it by default) ─────────────
echo "==> Opening port 80 in iptables..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo apt-get install -y iptables-persistent netfilter-persistent
sudo netfilter-persistent save

# ── Clone / update repo ───────────────────────────────────────────────────────
if [ -d "$APP_DIR" ]; then
  echo "==> Pulling latest changes..."
  git -C "$APP_DIR" pull
else
  echo "==> Cloning repository..."
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# ── .env file ─────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "==> .env created from .env.example."
  echo "    Edit it now if you want email notifications (optional):"
  echo "    nano $APP_DIR/.env"
  echo "    Then rerun: docker compose up -d --build"
  echo ""
fi

# ── Build and start ───────────────────────────────────────────────────────────
echo "==> Building Docker image (this will take 10-20 min first time — R packages)..."
sudo docker compose up -d --build

echo ""
echo "============================================================"
echo " Done! App should be available at http://$(curl -s ifconfig.me)"
echo ""
echo " IMPORTANT — One manual step remaining:"
echo " In Oracle Cloud Console → VCN → Security List:"
echo "   Add Ingress Rule: TCP, Source 0.0.0.0/0, Port 80"
echo "============================================================"
