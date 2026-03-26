#!/usr/bin/env bash
# =============================================================================
# DESeq2 ExploreR — Arch Linux (x86_64) server setup
# Run once as a user with sudo privileges:
#   bash deploy/arch-setup.sh
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Installing Docker..."
sudo pacman -Sy --noconfirm docker docker-compose

echo "==> Enabling and starting Docker service..."
sudo systemctl enable --now docker

echo "==> Adding $USER to docker group..."
sudo usermod -aG docker "$USER"
echo "    Note: log out and back in (or run 'newgrp docker') for group to take effect."

# ── Open port 80 if firewalld is active ───────────────────────────────────────
if systemctl is-active --quiet firewalld; then
  echo "==> Opening port 80 in firewalld..."
  sudo firewall-cmd --permanent --add-port=80/tcp
  sudo firewall-cmd --reload
fi

cd "$APP_DIR"

# ── .env file ─────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> .env created from .env.example — edit it to configure SMTP if needed."
fi

# ── Build and start ───────────────────────────────────────────────────────────
echo "==> Building and starting the app..."
sudo docker compose up -d --build

echo ""
echo "============================================================"
echo " Done! App running at http://localhost"
echo " To expose publicly, make sure port 80 is open in your"
echo " router/firewall and point your domain/IP here."
echo "============================================================"
