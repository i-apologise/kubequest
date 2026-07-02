# KubeQuest

Learn Kubernetes with real `kubectl` on a real cluster, plus a live UI for cluster state, OpenTelemetry traces, and metrics.

## Play without using your laptop

### GitHub Pages
**https://i-apologise.github.io/kubequest/**

Pages is static, but it can **reflect Codespace changes** in two ways:

1. **Live bridge (near real-time)**  
   Codespace port `3847` set to **Public** → paste `https://<codespace>-3847.app.github.dev` into the site’s **Connect** form. The Pages app calls your Codespace API (cluster SSE, traces, metrics).

2. **Mirror feed (~15s)**  
   While `npm start` runs in Codespaces, the API writes `live/state.json` on `main` (`[skip ci]`). Pages polls  
   `https://raw.githubusercontent.com/i-apologise/kubequest/main/live/state.json`  
   so the site updates even without pasting a URL (as long as the Codespace is running and `GITHUB_TOKEN` can write).

### One-click Codespace
[![Open in GitHub Codespaces](https://img.shields.io/badge/Codespaces-Play%20KubeQuest-blue?logo=github)](https://codespaces.new/i-apologise/kubequest?quickstart=1)

```bash
npm start
# Ports → 3847 → Public
# Open https://i-apologise.github.io/kubequest/ → Play → Connect live
```

## Missions
- **Core 1–8:** Pod through resource limits
- **Telemetry 9–12:** OTel collector, Jaeger traces, Prometheus metrics

## CI
- `e2e` — kind + missions 1–12 (ignores `live/**` mirror commits)
- `pages` — deploys the static UI (ignores `live/**`)
