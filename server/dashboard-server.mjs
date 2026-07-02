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

const app = express();
app.use(cors());
app.use(express.json());

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
  res.json(await clusterHealth());
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

const server = app.listen(PORT, async () => {
  console.log(`\n  📺 KubeQuest live UI  http://localhost:${PORT}`);
  console.log(`  📦 namespace: ${NAMESPACE}\n`);
  try {
    await ensureNamespace();
    await ensureTelemetryForwards();
  } catch (e) {
    console.log('  (forwards will retry when services exist)');
  }
  refreshLoop();
});

process.on('exit', stopAllForwards);
process.on('SIGINT', () => {
  stopAllForwards();
  server.close(() => process.exit(0));
});
