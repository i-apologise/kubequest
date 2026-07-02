#!/usr/bin/env bash
cat <<'MOTD'

  KUBEQUEST on GitHub Codespaces
  ------------------------------
    npm start          game terminal + live UI on port 3847
    npm run game       terminal only
    npm run dashboard  UI only
    npm run audit      full e2e missions 1–12

  Open forwarded port 3847 for the live cluster/traces/metrics UI.
  Suspend the codespace when idle to save free hours.

MOTD
