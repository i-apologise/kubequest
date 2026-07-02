#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
CLUSTER_NAME="${KUBEQUEST_CLUSTER:-kubequest}"

echo "==> Waiting for Docker"
for i in $(seq 1 60); do
  docker info >/dev/null 2>&1 && break
  sleep 2
  [[ $i -eq 60 ]] && { echo "Docker not ready"; exit 1; }
done

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "==> kind cluster exists"
  kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
else
  echo "==> Creating kind cluster"
  kind create cluster --name "$CLUSTER_NAME" --wait 180s
fi

kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl create namespace kubequest --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace kubequest app=kubequest --overwrite >/dev/null
kubectl wait --for=jsonpath='{.status.phase}'=Active namespace/kubequest --timeout=60s >/dev/null

echo "==> Building + loading telemetry app image"
bash scripts/build-telemetry-image.sh

echo "==> Cluster ready"
