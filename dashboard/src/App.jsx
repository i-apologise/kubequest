import { useCallback, useEffect, useMemo, useState } from 'react';
import ClusterView from './ClusterView.jsx';
import { animateDemoCluster, demoCluster, demoMissions, demoTraces } from './demoData.js';

const BASE = import.meta.env.BASE_URL || '/';
const CODESPACE_URL =
  import.meta.env.VITE_CODESPACE_URL ||
  'https://codespaces.new/i-apologise/kubequest?quickstart=1';
const REPO_URL = 'https://github.com/i-apologise/kubequest';

function apiUrl(path) {
  if (path.startsWith('/api')) return path;
  return path;
}

async function api(path, opts) {
  const r = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

export default function App() {
  const [tab, setTab] = useState('cluster');
  const [mode, setMode] = useState('connecting'); // connecting | live | demo
  const [cluster, setCluster] = useState(null);
  const [missions, setMissions] = useState([]);
  const [live, setLive] = useState(false);
  const [telStatus, setTelStatus] = useState(null);
  const [traces, setTraces] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [range, setRange] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);

  const refreshMissions = useCallback(() => {
    if (mode === 'demo') return;
    api('/api/missions').then((d) => setMissions(d.missions || [])).catch(() => {});
  }, [mode]);

  const refreshTelemetry = useCallback(async () => {
    if (mode === 'demo') return;
    try {
      const s = await api('/api/telemetry/status');
      setTelStatus(s);
      if (s.jaeger?.ok) {
        const t = await api('/api/telemetry/traces?service=telemetry-api&limit=15');
        setTraces(t.traces || []);
      }
      if (s.prometheus?.ok) {
        const m = await api('/api/telemetry/metrics?query=kq_http_requests_total');
        setMetrics(m);
        const rr = await api('/api/telemetry/metrics/range?query=rate(kq_http_requests_total[1m])&seconds=300');
        setRange(rr);
      }
    } catch {
      /* stack not up */
    }
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api('/api/health');
        if (cancelled) return;
        setMode('live');
        const snap = await api('/api/cluster');
        setCluster(snap);
        refreshMissions();
        refreshTelemetry();
      } catch {
        if (cancelled) return;
        setMode('demo');
        setCluster(demoCluster);
        setMissions(demoMissions);
        setTraces(demoTraces);
        setMetrics({
          data: {
            result: [
              { metric: { route: '/api/hello', status: '200' }, value: [Date.now() / 1000, '42'] },
              { metric: { route: '/api/boom', status: '500' }, value: [Date.now() / 1000, '3'] },
            ],
          },
        });
        setTelStatus({ jaeger: { ok: false }, prometheus: { ok: false }, telemetryApi: { ok: false } });
      }
    })();
    return () => { cancelled = true; };
  }, [refreshMissions, refreshTelemetry]);

  useEffect(() => {
    if (mode !== 'live') return undefined;
    const es = new EventSource('/api/events');
    es.addEventListener('cluster', (ev) => {
      setLive(true);
      try { setCluster(JSON.parse(ev.data)); } catch { /* ignore */ }
    });
    es.onerror = () => setLive(false);
    const t = setInterval(() => {
      refreshMissions();
      refreshTelemetry();
    }, 5000);
    return () => { es.close(); clearInterval(t); };
  }, [mode, refreshMissions, refreshTelemetry]);

  useEffect(() => {
    if (mode !== 'demo') return undefined;
    const t = setInterval(() => setTick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, [mode]);

  useEffect(() => {
    if (mode === 'demo') setCluster(animateDemoCluster(demoCluster, tick));
  }, [mode, tick]);

  const viewCluster = cluster;
  const stats = useMemo(() => ({
    pods: viewCluster?.pods?.length || 0,
    ready: viewCluster?.pods?.filter((p) => p.ready).length || 0,
    deps: viewCluster?.deployments?.length || 0,
    svcs: viewCluster?.services?.length || 0,
    cms: viewCluster?.configMaps?.length || 0,
  }), [viewCluster]);

  const sendTraffic = async () => {
    if (mode === 'demo') {
      setMsg('Demo mode on GitHub Pages — launch Codespaces to hit a real cluster.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const r = await api('/api/telemetry/traffic', {
        method: 'POST',
        body: JSON.stringify({ count: 8, path: '/api/hello' }),
      });
      setMsg(`Sent ${r.sent} requests to telemetry-api`);
      setTimeout(refreshTelemetry, 3000);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const bars = useMemo(() => {
    if (mode === 'demo') {
      return Array.from({ length: 40 }, (_, i) => 0.2 + Math.abs(Math.sin((tick + i) / 3)) * 0.8);
    }
    const series = range?.data?.result?.[0]?.values || [];
    return series.slice(-40).map(([, v]) => Number(v) || 0);
  }, [range, mode, tick]);
  const maxBar = Math.max(0.001, ...bars);

  return (
    <div className="app">
      {mode !== 'live' && (
        <div className="banner">
          <div>
            <strong>Play KubeQuest in the cloud — no local Docker.</strong>
            <div className="banner-sub">
              GitHub Pages only hosts this UI. Real kubectl + kind + OpenTelemetry run in a free Codespace.
              {mode === 'demo' ? ' Showing an animated demo preview.' : ' Connecting…'}
            </div>
          </div>
          <div className="banner-actions">
            <a className="btn" href={CODESPACE_URL} target="_blank" rel="noreferrer">Play in Codespaces</a>
            <a className="btn secondary" href={REPO_URL} target="_blank" rel="noreferrer">Repo</a>
          </div>
        </div>
      )}

      <header className="top">
        <div className="brand">KUBE<span>QUEST</span> {mode === 'demo' ? 'DEMO' : 'LIVE'}</div>
        <nav className="tabs">
          {['cluster', 'traces', 'metrics', 'missions', 'play'].map((id) => (
            <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {id}
            </button>
          ))}
        </nav>
        <div className="row" style={{ margin: 0 }}>
          <span className={`pill ${mode === 'live' && live ? 'on' : mode === 'demo' ? 'off' : 'off'}`}>
            {mode === 'live' ? (live ? 'SSE live' : 'live api') : 'pages demo'}
          </span>
          <span className={`pill ${telStatus?.jaeger?.ok ? 'on' : 'off'}`}>jaeger</span>
          <span className={`pill ${telStatus?.prometheus?.ok ? 'on' : 'off'}`}>prom</span>
          <span className="pill mono">ns/{viewCluster?.namespace || 'kubequest'}</span>
        </div>
      </header>

      <div className="main">
        <aside className="side">
          <h3>Missions</h3>
          {missions.map((m) => (
            <div key={m.id} className={`mission ${m.met ? 'met' : ''}`}>
              <div className="t">{m.met ? '✓ ' : ''}{m.id}. {m.title}</div>
              <div className="d">{m.track} · {m.detail}</div>
            </div>
          ))}
          <a className="btn" style={{ display: 'block', textAlign: 'center', marginTop: '1rem', textDecoration: 'none' }} href={CODESPACE_URL} target="_blank" rel="noreferrer">
            Play for real
          </a>
        </aside>

        <section className="content">
          {tab === 'play' && (
            <div className="play-panel">
              <h2>How to play (zero local setup)</h2>
              <ol>
                <li>Click <strong>Play in Codespaces</strong> (2-core is fine; 4-core is smoother).</li>
                <li>Wait for the devcontainer to finish (kind cluster + telemetry image).</li>
                <li>In the Codespace terminal run <code className="mono">npm start</code>.</li>
                <li>Open forwarded port <strong>3847</strong> for the live UI tied to your real cluster.</li>
                <li>Type real <code className="mono">kubectl</code> commands in the game prompt; watch this UI update.</li>
              </ol>
              <p>Codespaces free tier includes monthly core-hours. Suspend the codespace when you stop.</p>
              <div className="row">
                <a className="btn" href={CODESPACE_URL} target="_blank" rel="noreferrer">Open Codespace</a>
                <a className="btn secondary" href={`${REPO_URL}/actions`} target="_blank" rel="noreferrer">CI e2e runs</a>
              </div>
            </div>
          )}

          {tab === 'cluster' && (
            <>
              <div className="grid cards">
                <div className="card"><div className="label">Pods ready</div><div className="value">{stats.ready}/{stats.pods}</div></div>
                <div className="card"><div className="label">Deployments</div><div className="value">{stats.deps}</div></div>
                <div className="card"><div className="label">Services</div><div className="value">{stats.svcs}</div></div>
                <div className="card"><div className="label">ConfigMaps</div><div className="value">{stats.cms}</div></div>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>
                {mode === 'live' ? 'Updates stream as you run kubectl in the game terminal.' : 'Demo preview only on GitHub Pages. Launch Codespaces for a live cluster mirror.'}
              </p>
              <div className="canvas-wrap">
                <ClusterView cluster={viewCluster} />
              </div>
              <ResourceTables cluster={viewCluster} />
            </>
          )}

          {tab === 'traces' && (
            <>
              <div className="row">
                <button type="button" className="btn" disabled={busy} onClick={sendTraffic}>Generate traffic</button>
                <button type="button" className="btn secondary" onClick={refreshTelemetry}>Refresh</button>
                {msg && <span className="mono" style={{ fontSize: '.8rem', color: 'var(--accent)' }}>{msg}</span>}
              </div>
              {!traces.length && <div className="empty">No traces yet.</div>}
              {traces.map((t) => (
                <div key={t.traceID} className="trace">
                  <div className="mono id">{t.traceID}</div>
                  <div><strong>{t.rootOperation}</strong> · {t.spans} spans · {(t.durationUs / 1000).toFixed(1)} ms</div>
                  <div className="mono" style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{(t.services || []).join(', ')}</div>
                </div>
              ))}
            </>
          )}

          {tab === 'metrics' && (
            <>
              <div className="row">
                <button type="button" className="btn" disabled={busy} onClick={sendTraffic}>Generate traffic</button>
                <button type="button" className="btn secondary" onClick={refreshTelemetry}>Refresh</button>
              </div>
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="label">kq_http_requests_total series</div>
                <div className="value mono" style={{ fontSize: '1rem' }}>
                  {(metrics?.data?.result || []).length
                    ? metrics.data.result.map((s, i) => (
                        <div key={i}>{JSON.stringify(s.metric)} = {s.value?.[1]}</div>
                      ))
                    : 'no data'}
                </div>
              </div>
              <div className="label" style={{ marginBottom: '.4rem' }}>rate(kq_http_requests_total[1m])</div>
              <div className="chart">
                {bars.length ? bars.map((v, i) => (
                  <i key={i} style={{ height: `${Math.max(4, (v / maxBar) * 100)}%` }} title={String(v)} />
                )) : <div className="empty" style={{ width: '100%' }}>No metric samples yet</div>}
              </div>
            </>
          )}

          {tab === 'missions' && (
            <table>
              <thead>
                <tr><th>ID</th><th>Title</th><th>Track</th><th>XP</th><th>Status</th></tr>
              </thead>
              <tbody>
                {missions.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.id}</td>
                    <td>{m.title}</td>
                    <td>{m.track}</td>
                    <td>{m.xp}</td>
                    <td><span className={`dot ${m.met ? 'ok' : 'wait'}`} />{m.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function ResourceTables({ cluster }) {
  if (!cluster) return null;
  return (
    <div className="grid" style={{ marginTop: '1rem' }}>
      <table>
        <thead>
          <tr><th>Pod</th><th>Phase</th><th>IP</th><th>Restarts</th></tr>
        </thead>
        <tbody>
          {(cluster.pods || []).map((p) => (
            <tr key={p.name}>
              <td className="mono"><span className={`dot ${p.ready ? 'ok' : p.phase === 'Running' ? 'wait' : 'bad'}`} />{p.name}</td>
              <td>{p.ready ? 'Ready' : p.phase}</td>
              <td className="mono">{p.ip || '—'}</td>
              <td>{p.restarts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
