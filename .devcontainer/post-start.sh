#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

CLUSTER_NAME="${KUBEQUEST_CLUSTER:-kubequest}"

echo "==> Waiting for Docker"
for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 2
  if [[ $i -eq 60 ]]; then
    echo "Docker did not become ready. Rebuild the codespace with the devcontainer config."
    exit 1
  fi
done

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "==> kind cluster '$CLUSTER_NAME' already exists"
  kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
else
  echo "==> Creating kind cluster '$CLUSTER_NAME' (first start takes a couple minutes)"
  kind create cluster --name "$CLUSTER_NAME" --wait 180s
fi

kubectl cluster-info --context "kind-${CLUSTER_NAME}" >/dev/null
kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl create namespace kubequest --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace kubequest app=kubequest --overwrite >/dev/null
kubectl wait --for=jsonpath='{.status.phase}'=Active namespace/kubequest --timeout=60s >/dev/null

echo "==> Cluster ready (context: kind-${CLUSTER_NAME})"
