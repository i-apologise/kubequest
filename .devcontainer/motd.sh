#!/usr/bin/env bash
NAME="${CODESPACE_NAME:-<codespace>}"
cat <<MOTD

  KUBEQUEST on GitHub Codespaces
  ------------------------------
  Use TWO terminals:

    Terminal 1 (play here):     npm start
                                → type kubectl at:  kubequest m1 xp:0 $

    Terminal 2 (keep running):  npm run dashboard
                                → serves port 3847 for the live UI / Pages bridge

  Ports → 3847 → Public
  Bridge URL: https://${NAME}-3847.app.github.dev
  Pages:      https://i-apologise.github.io/kubequest/  (Play → Connect live)

  Optional one-shot both:  npm run start:all
  (mirror logs are quiet unless MIRROR_VERBOSE=1)

MOTD
