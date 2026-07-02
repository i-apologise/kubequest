# KubeQuest

Terminal command game: type real `kubectl` commands against a [kind](https://kind.sigs.k8s.io/) cluster. Missions check live cluster state and award XP.

## Play free in the cloud (Codespaces)

No Docker on your laptop.

1. Open **https://github.com/i-apologise/kubequest**
2. **Code → Codespaces → Create codespace on main**
3. Pick at least **2-core / 8GB** (4-core / 16GB is smoother for kind)
4. Wait for the devcontainer build + kind bootstrap (first launch ~3–5 min)
5. In the cloud terminal:

```bash
npm start
```

Suspend or delete the codespace when you stop so you do not burn free core-hours.

| Command | Purpose |
|---|---|
| `npm start` | Play |
| `npm run audit` | Full automated mission e2e |
| `npm run setup` | Recreate kind cluster if needed |

Devcontainer pieces live in `.devcontainer/` (Docker-in-Docker, kubectl, kind, `npm ci`, auto namespace `kubequest`).

## Play locally (optional)

```bash
npm run setup          # Docker required
npm ci && npm ci --prefix server
npm start
```

## Game commands

Prompt: `kubequest m1 xp:0 $` — type kubectl yourself (`get pods` works without the prefix).

| Input | Meaning |
|---|---|
| `goal` | Mission goal + starter commands |
| `hint` | One spoiler command |
| `status` | Cluster snapshot |
| `check` | Claim XP if goal is met |
| `mission N` | Switch mission |
| `reset` | Wipe namespace + XP |
| `help` / `quit` | Help / exit |

## CI

GitHub Actions (`.github/workflows/e2e.yml`) boots kind on Ubuntu and runs `npm run audit` on every push/PR.

## Layout

- `game.mjs` — terminal game
- `server/` — k8s client, kubectl runner, missions
- `manifests/` — sample YAML for later missions
- `scripts/e2e-audit.mjs` — automated checks
- `.devcontainer/` — Codespaces setup
- `client/` — legacy unused web UI
