# KubeQuest

Terminal command game: you type real `kubectl` commands against a local [kind](https://kind.sigs.k8s.io/) cluster. Missions check live cluster state and award XP.

## Play locally

```bash
# needs Docker + Node 20+
npm run setup
npm ci && npm ci --prefix server
npm start
```

Prompt looks like `kubequest m1 xp:0 $`. Type kubectl yourself (`get pods` works without the `kubectl` prefix).

| Game command | Meaning |
|---|---|
| `goal` | Mission goal + starter commands |
| `hint` | One spoiler command |
| `status` | Cluster snapshot |
| `check` | Claim XP if goal is met |
| `mission N` | Switch mission |
| `reset` | Wipe namespace + XP |
| `help` / `quit` | Help / exit |

## Tests

Full mission walkthrough (creates real workloads in `kubequest` ns):

```bash
npm run audit
```

CI (GitHub Actions) boots kind on Ubuntu and runs the same audit on every push/PR.

## Layout

- `game.mjs` — terminal game loop
- `server/` — k8s client, kubectl runner, mission defs
- `manifests/` — sample YAML for later missions
- `scripts/e2e-audit.mjs` — automated end-to-end checks
- `.github/workflows/e2e.yml` — CI with kind

Legacy unused web UI lives under `client/` (not required to play).
