#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER_NAME="${KUBEQUEST_CLUSTER:-kubequest}"

if command -v kind >/dev/null 2>&1; then
  KIND=(kind)
elif [[ -x "$ROOT/bin/kind" ]]; then
  KIND=("$ROOT/bin/kind")
else
  ARCH=$(uname -m)
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$ARCH" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64) ARCH=amd64 ;;
  esac
  mkdir -p "$ROOT/bin"
  curl -fsSL -o "$ROOT/bin/kind" "https://kind.sigs.k8s.io/dl/v0.27.0/kind-${OS}-${ARCH}"
  chmod +x "$ROOT/bin/kind"
  KIND=("$ROOT/bin/kind")
fi

if ! command -v docker >/dev/null; then
  echo "Docker is required. Install Docker Desktop and start it."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and retry."
  exit 1
fi

if "${KIND[@]}" get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "✅ kind cluster '$CLUSTER_NAME' already exists"
else
  echo "🚀 Creating kind cluster '$CLUSTER_NAME'…"
  "${KIND[@]}" create cluster --name "$CLUSTER_NAME" --wait 120s
fi

kubectl cluster-info --context "kind-${CLUSTER_NAME}"
kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl create namespace kubequest --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace kubequest app=kubequest --overwrite
kubectl wait --for=jsonpath='{.status.phase}'=Active namespace/kubequest --timeout=60s

echo ""
echo "✅ Ready! Run:  npm ci && npm ci --prefix server && npm start"
echo "   Audit:       npm run audit"
echo ""
