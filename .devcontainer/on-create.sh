#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing kind"
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
esac
curl -fsSL -o /tmp/kind "https://kind.sigs.k8s.io/dl/v0.27.0/kind-linux-${ARCH}"
sudo install -m 0755 /tmp/kind /usr/local/bin/kind
kind version
kubectl version --client

echo "==> npm ci"
cd /workspaces/kubequest 2>/dev/null || cd "$(git rev-parse --show-toplevel)"
npm ci
npm ci --prefix server

echo "==> on-create done"
