#!/usr/bin/env bash
cat <<'MOTD'

  KUBEQUEST on GitHub Codespaces
  ------------------------------
  Cluster and deps are prepared on start.

    npm start     play the game (type real kubectl)
    npm run audit run full mission e2e checks

  Stop/suspend the codespace when you finish to save free hours.
  Machine size: prefer 4-core / 16GB if kind feels slow.

MOTD
