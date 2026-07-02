#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER_NAME="${KUBEQUEST_CLUSTER:-kubequest}"
IMAGE="kubequest-telemetry-api:local"

kind_bin() {
  if [[ -x "$ROOT/bin/kind" ]]; then echo "$ROOT/bin/kind"; return; fi
  if command -v kind >/dev/null 2>&1; then command -v kind; return; fi
  echo ""
}

echo "==> Building $IMAGE"
docker build -t "$IMAGE" "$ROOT/telemetry-app"

KIND="$(kind_bin)"
if [[ -n "$KIND" ]] && "$KIND" get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "==> Loading image into kind cluster $CLUSTER_NAME via $KIND"
  "$KIND" load docker-image "$IMAGE" --name "$CLUSTER_NAME"
else
  echo "==> kind cluster '$CLUSTER_NAME' not found; skipped kind load"
  echo "    (kind bin: ${KIND:-none}; clusters: $($KIND get clusters 2>/dev/null | tr '\n' ' '))"
fi
echo "==> Done"
