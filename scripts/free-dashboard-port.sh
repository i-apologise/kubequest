#!/usr/bin/env bash
set -euo pipefail
PORT="${1:-3847}"
echo "Looking for processes on port $PORT..."
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti ":$PORT" || true)
elif command -v fuser >/dev/null 2>&1; then
  PIDS=$(fuser -t "${PORT}/tcp" || true)
else
  PIDS=$(ss -lptn "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u || true)
fi
if [[ -z "${PIDS:-}" ]]; then
  echo "Nothing listening on $PORT"
  exit 0
fi
echo "Killing: $PIDS"
kill $PIDS 2>/dev/null || true
sleep 1
kill -9 $PIDS 2>/dev/null || true
echo "Port $PORT should be free now."
