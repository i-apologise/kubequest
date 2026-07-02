#!/usr/bin/env bash
NAME="${CODESPACE_NAME:-<codespace>}"
cat <<MOTD

  KUBEQUEST on GitHub Codespaces
  ------------------------------
    npm start

  Live UI in codespace: port 3847
  Public bridge for GitHub Pages:
    https://${NAME}-3847.app.github.dev
  (Ports panel → 3847 → Port Visibility → Public)

  GitHub Pages reads that bridge OR mirrored snapshots at:
    https://i-apologise.github.io/kubequest/
  Mirror uses GITHUB_TOKEN automatically in Codespaces.

MOTD
