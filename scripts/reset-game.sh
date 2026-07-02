#!/usr/bin/env bash
set -euo pipefail
kubectl delete namespace kubequest --ignore-not-found --wait=true
kubectl wait --for=delete namespace/kubequest --timeout=120s 2>/dev/null || true
kubectl create namespace kubequest
kubectl label namespace kubequest app=kubequest --overwrite
kubectl wait --for=jsonpath='{.status.phase}'=Active namespace/kubequest --timeout=60s
echo "Sandbox reset."
