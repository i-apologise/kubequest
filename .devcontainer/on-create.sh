#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "==> Installing kind"
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
esac
curl -fsSL -o /tmp/kind "https://kind.sigs.k8s.io/dl/v0.27.0/kind-linux-${ARCH}"
sudo install -m 0755 /tmp/kind /usr/local/bin/kind

echo "==> npm ci (root, server, dashboard)"
npm ci
npm ci --prefix server
npm ci --prefix dashboard
npm run build:ui

echo "==> on-create done"
