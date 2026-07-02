#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureNamespace,
  getClusterSnapshot,
  checkMission,
  clusterHealth,
  inClusterCurl,
} from './k8s.js';
import { missions, NAMESPACE } from './missions.js';
import { ensureTelemetryForwards, stopAllForwards } from './portforward.js';
import { runKubectl } from './kubectl-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.DASHBOARD_PORT || 3847);

const PAGES_ORIGIN = process.env.PAGES_ORIGIN || 'https://i-apologise.github.io';
const app = express();
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (origin === PAGES_ORIGIN || origin.startsWith(`${PAGES_ORIGIN}`)) return cb(null, true);
    if (/\.github\.io$/.test(new URL(origin).host)) return cb(null, true);
    if (/\.app\.github\.dev$/.test(new URL(origin).host)) return cb(null, true);
    if (/^https?:\/\/localhost(?::\d+)?$/.test(origin)) return cb(null, true);
    return cb(null, true);
  },
}));
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

let lastSnap = null;
const clients = new Set();

function broadcast(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

async function refreshLoop() {
  for (;;) {
    try {
      await ensureNamespace();
      lastSnap = await getClusterSnapshot();
      broadcast('cluster', lastSnap);
    } catch (e) {
      broadcast('error', { message: e.message });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

app.get('/api/health', async (_req, res) => {
  const health = await clusterHealth();
  const codespace = process.env.CODESPACE_NAME || null;
  res.json({
    ...health,
    bridge: {
      pagesOrigin: PAGES_ORIGIN,
      codespace,
      publicApiUrl: codespace ? `https://${codespace}-3847.app.github.dev` : null,
      mirrorEnabled: Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN),
    },
  });
});

app.get('/api/snapshot', async (_req, res) => {
  try {
    const snap = await buildSnapshot();
    res.json(snap);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cluster', async (_req, res) => {
  try {
    const snap = await getClusterSnapshot();
    lastSnap = snap;
    res.json(snap);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/missions', async (_req, res) => {
  const out = [];
  for (const m of missions) {
    let status = { met: false, detail: 'unchecked' };
    try {
      status = await checkMission(m);
    } catch (e) {
      status = { met: false, detail: e.message };
    }
    out.push({
      id: m.id,
      title: m.title,
      xp: m.xp,
      track: m.track || 'core',
      goal: m.goal,
      winHint: m.winHint,
      ...status,
    });
  }
  res.json({ namespace: NAMESPACE, missions: out });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  clients.add(res);
  if (lastSnap) res.write(`event: cluster\ndata: ${JSON.stringify(lastSnap)}\n\n`);
  req.on('close', () => clients.delete(res));
});

async function fetchJson(url) {
  const r = await fetch(url);
  const text = await r.text();
  try {
    return { ok: r.ok, status: r.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: r.status, data: null, text };
  }
}

app.get('/api/telemetry/status', async (_req, res) => {
  await ensureTelemetryForwards();
  const [jaeger, prom, api] = await Promise.all([
    fetchJson('http://127.0.0.1:16686/api/services').catch((e) => ({ ok: false, error: e.message })),
    fetchJson('http://127.0.0.1:19090/-/ready').catch((e) => ({ ok: false, error: e.message })),
    fetchJson('http://127.0.0.1:18080/healthz').catch((e) => ({ ok: false, error: e.message })),
  ]);
  res.json({
    jaeger: { ok: !!jaeger.ok, services: jaeger.data?.data || [] },
    prometheus: { ok: !!prom.ok || prom.status === 200 },
    telemetryApi: { ok: !!api.ok, body: api.data },
  });
});

app.get('/api/telemetry/traces', async (req, res) => {
  await ensureTelemetryForwards();
  const service = req.query.service || 'telemetry-api';
  const limit = req.query.limit || '20';
  const url = `http://127.0.0.1:16686/api/traces?service=${encodeURIComponent(service)}&limit=${limit}`;
  try {
    const r = await fetchJson(url);
    if (!r.ok) return res.status(502).json({ error: 'jaeger unreachable', detail: r.text || r.error });
    const traces = (r.data?.data || []).map((t) => summarizeTrace(t));
    res.json({ service, traces });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/telemetry/services', async (_req, res) => {
  await ensureTelemetryForwards();
  try {
    const r = await fetchJson('http://127.0.0.1:16686/api/services');
    res.json({ services: r.data?.data || [] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/telemetry/metrics', async (req, res) => {
  await ensureTelemetryForwards();
  const query = req.query.query || 'kq_http_requests_total';
  const url = `http://127.0.0.1:19090/api/v1/query?query=${encodeURIComponent(query)}`;
  try {
    const r = await fetchJson(url);
    if (!r.ok) return res.status(502).json({ error: 'prometheus unreachable' });
    res.json(r.data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/telemetry/metrics/range', async (req, res) => {
  await ensureTelemetryForwards();
  const query = req.query.query || 'rate(kq_http_requests_total[1m])';
  const end = Math.floor(Date.now() / 1000);
  const start = end - Number(req.query.seconds || 300);
  const step = req.query.step || '5';
  const url = `http://127.0.0.1:19090/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`;
  try {
    const r = await fetchJson(url);
    res.json(r.data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/telemetry/traffic', async (req, res) => {
  const count = Math.min(Number(req.body?.count || 5), 20);
  const pathName = req.body?.path || '/api/hello';
  const results = [];
  for (let i = 0; i < count; i++) {
    const r = await inClusterCurl(`http://telemetry-api:8080${pathName}`);
    results.push({ ok: r.ok, body: r.body.slice(0, 120) });
  }
  res.json({ sent: count, results });
});

function summarizeTrace(trace) {
  const spans = trace.spans || [];
  const root = spans.reduce((a, b) => (a.startTime < b.startTime ? a : b), spans[0] || {});
  const duration = spans.reduce((max, s) => Math.max(max, (s.startTime || 0) + (s.duration || 0)), 0)
    - Math.min(...spans.map((s) => s.startTime || 0));
  return {
    traceID: trace.traceID,
    spans: spans.length,
    rootOperation: root?.operationName || 'unknown',
    durationUs: duration,
    services: [...new Set((trace.processes ? Object.values(trace.processes) : []).map((p) => p.serviceName))],
  };
}

const dist = path.join(ROOT, 'dashboard', 'dist');
app.use(express.static(dist));
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(404).send('Dashboard UI not built. Run: npm run build:ui');
  });
});


async function buildSnapshot() {
  const [health, cluster, missionRows, telStatus, traces, metrics] = await Promise.all([
    clusterHealth(),
    getClusterSnapshot().catch(() => null),
    Promise.all(missions.map(async (m) => {
      try {
        const status = await checkMission(m);
        return { id: m.id, title: m.title, xp: m.xp, track: m.track || 'core', goal: m.goal, winHint: m.winHint, ...status };
      } catch (e) {
        return { id: m.id, title: m.title, xp: m.xp, track: m.track || 'core', met: false, detail: e.message };
      }
    })),
    (async () => {
      try {
        await ensureTelemetryForwards();
        const [jaeger, prom, apiHealth] = await Promise.all([
          fetch('http://127.0.0.1:16686/api/services').then((r) => r.json()).then((d) => ({ ok: true, services: d.data || [] })).catch(() => ({ ok: false, services: [] })),
          fetch('http://127.0.0.1:19090/-/ready').then((r) => ({ ok: r.ok })).catch(() => ({ ok: false })),
          fetch('http://127.0.0.1:18080/healthz').then((r) => r.json()).then((d) => ({ ok: true, body: d })).catch(() => ({ ok: false })),
        ]);
        return { jaeger, prometheus: prom, telemetryApi: apiHealth };
      } catch {
        return { jaeger: { ok: false }, prometheus: { ok: false }, telemetryApi: { ok: false } };
      }
    })(),
    (async () => {
      try {
        await ensureTelemetryForwards();
        const r = await fetch('http://127.0.0.1:16686/api/traces?service=telemetry-api&limit=15');
        if (!r.ok) return [];
        const data = await r.json();
        return (data.data || []).map((t) => summarizeTrace(t));
      } catch { return []; }
    })(),
    (async () => {
      try {
        await ensureTelemetryForwards();
        const r = await fetch('http://127.0.0.1:19090/api/v1/query?query=kq_http_requests_total');
        if (!r.ok) return null;
        return r.json();
      } catch { return null; }
    })(),
  ]);
  const codespace = process.env.CODESPACE_NAME || null;
  return {
    updatedAt: new Date().toISOString(),
    source: codespace ? `codespace:${codespace}` : 'local',
    publicApiUrl: codespace ? `https://${codespace}-3847.app.github.dev` : null,
    health,
    cluster,
    missions: missionRows,
    telemetry: telStatus,
    traces,
    metrics,
  };
}

async function mirrorSnapshotLoop() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || 'i-apologise/kubequest';
  const verbose = process.env.MIRROR_VERBOSE === '1';
  const log = (...args) => {
    if (verbose) console.log(...args);
  };
  if (!token) {
    console.log('  (mirror off — no GITHUB_TOKEN)');
    return;
  }
  console.log('  mirror on (quiet; set MIRROR_VERBOSE=1 for per-snapshot logs)');
  let lastSha = null;
  let lastPayload = '';
  let failures = 0;
  for (;;) {
    try {
      const snap = await buildSnapshot();
      const payload = JSON.stringify(snap, null, 2) + '\n';
      if (payload === lastPayload) {
        await new Promise((r) => setTimeout(r, Number(process.env.MIRROR_INTERVAL_MS || 15000)));
        continue;
      }
      lastPayload = payload;
      const filePath = 'live/state.json';
      const metaUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'kubequest-mirror',
      };
      if (!lastSha) {
        const cur = await fetch(metaUrl, { headers });
        if (cur.ok) {
          const body = await cur.json();
          lastSha = body.sha;
        }
      }
      const body = {
        message: '[skip ci] mirror: live cluster snapshot for GitHub Pages',
        content: Buffer.from(payload).toString('base64'),
        branch: process.env.MIRROR_BRANCH || 'main',
      };
      if (lastSha) body.sha = lastSha;
      const put = await fetch(metaUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (put.ok) {
        const saved = await put.json();
        lastSha = saved.content?.sha || lastSha;
        failures = 0;
        log(`  mirrored snapshot @ ${snap.updatedAt}`);
      } else {
        const err = await put.text();
        failures += 1;
        if (failures <= 2 || verbose) {
          console.log(`  mirror failed: ${put.status} ${err.slice(0, 200)}`);
        }
        lastSha = null;
      }
    } catch (e) {
      failures += 1;
      if (failures <= 2 || verbose) console.log(`  mirror error: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, Number(process.env.MIRROR_INTERVAL_MS || 15000)));
  }
}

const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, async () => {
  console.log(`\n  📺 KubeQuest live UI  http://127.0.0.1:${PORT} (bound on ${HOST})`);
  console.log(`  📦 namespace: ${NAMESPACE}`);
  console.log(`  ❤ health check: http://127.0.0.1:${PORT}/api/health\n`);
  try {
    await ensureNamespace();
    await ensureTelemetryForwards();
  } catch (e) {
    console.log(`  (forwards will retry when services exist: ${e.message})`);
  }
  const codespace = process.env.CODESPACE_NAME;
  if (codespace) {
    console.log(`  🌉 Public bridge URL: https://${codespace}-3847.app.github.dev`);
    console.log('     Ports panel → 3847 → Public, then paste that URL on GitHub Pages.');
    console.log('     If you see 502, this process is not running — keep npm start / npm run dashboard alive.\n');
  }
  refreshLoop().catch((e) => console.error('refreshLoop', e));
  mirrorSnapshotLoop().catch((e) => console.error('mirrorLoop', e));
});

server.on('error', (err) => {
  console.error(`Failed to bind ${HOST}:${PORT}:`, err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} is already taken (old dashboard still running).`);
    console.error('  Fix:  npm run free:ui');
    console.error('  Then: npm run dashboard');
    console.error('  Play in another terminal with: npm start');
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException (server keeps running):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection (server keeps running):', err);
});

process.on('exit', stopAllForwards);
process.on('SIGINT', () => {
  stopAllForwards();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  stopAllForwards();
  server.close(() => process.exit(0));
});
