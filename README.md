# KubeQuest

Learn Kubernetes by typing **real kubectl commands** on a real cluster, with a live UI for cluster state, OpenTelemetry traces, and metrics.

## Play in the browser (no local install)

### 1. Dashboard on GitHub Pages
**https://i-apologise.github.io/kubequest/**

Pages hosts the UI preview + instructions. It cannot run Kubernetes itself (static hosting only).

### 2. Real game in Codespaces (one click)
[![Open in GitHub Codespaces](https://img.shields.io/badge/Codespaces-Play%20KubeQuest-blue?logo=github)](https://codespaces.new/i-apologise/kubequest?quickstart=1)

1. Click **Play in Codespaces** on the Pages site (or the badge above)
2. Wait for devcontainer bootstrap (kind + telemetry image)
3. In the Codespace terminal: `npm start`
4. Open forwarded port **3847** for the *live* UI wired to your cluster
5. Type `kubectl` in the game prompt; watch pods/traces/metrics update

Suspend the codespace when idle to save free core-hours.

## Missions
- **Core 1–8:** Pod, Deployment, Scale, Service, ConfigMap, Rollout, Probes, Resources
- **Telemetry 9–12:** Jaeger + OTel Collector + Prometheus, instrumented app, live traces & metrics

## CI
- `e2e` — kind cluster, all 12 missions
- `pages` — deploys the dashboard to GitHub Pages

## Local (optional)
```bash
npm run install:all && npm run build:ui && npm run setup && npm start
```
