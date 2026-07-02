# KubeQuest

Learn Kubernetes by typing **real kubectl commands** against a real cluster, with a **live UI** that mirrors cluster state plus OpenTelemetry **traces and metrics**.

## Quick start (Codespaces — recommended)

1. Open https://github.com/i-apologise/kubequest → **Code → Codespaces**
2. Wait for devcontainer + kind + image build
3. Run:

```bash
npm start
```

- Terminal: type `kubectl` (game prompt)
- Browser: open forwarded port **3847** for the live dashboard

## Quick start (local)

```bash
npm run setup          # kind cluster + telemetry image
npm run install:all
npm run build:ui
npm start              # game + dashboard
```

## What you get

| Surface | Purpose |
|---|---|
| `npm run game` | Terminal missions — you type kubectl |
| `npm run dashboard` | Live UI on `:3847` — cluster map, traces, metrics |
| `npm start` | Both together |
| `npm run audit` | Automated missions 1–12 on a real cluster |

### Live UI tabs
- **Cluster** — SSE-updated pods/deployments/services as commands change reality
- **Traces** — Jaeger query API (`telemetry-api` spans)
- **Metrics** — Prometheus `kq_http_requests_total` + rate chart
- **Missions** — goal status for all levels

Game extras: `traffic` (generate in-cluster load), `ui` (print dashboard URL), `check`, `hint`, `goal`.

## Mission tracks

**Core (1–8):** Pod, Deployment, Scale, Service, ConfigMap, Rollout, Probes, Resources

**Telemetry (9–12):**
9. Deploy Jaeger + OTel Collector + Prometheus  
10. Deploy instrumented `telemetry-api` (OTLP to collector)  
11. Generate traffic; verify **live traces** in Jaeger  
12. Verify **live metrics** in Prometheus  

Sample app: `telemetry-app/` (OpenTelemetry Node SDK). Manifests: `manifests/telemetry/`.

## CI

GitHub Actions boots kind, builds the telemetry image, builds the UI, runs `npm run audit`.
