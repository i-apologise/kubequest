import { useCallback, useEffect, useMemo, useState } from 'react';
import ClusterView from './ClusterView.jsx';
import { animateDemoCluster, demoCluster, demoMissions, demoTraces } from './demoData.js';
import {
  fetchMirror,
  getStoredApiBase,
  isPagesHost,
  makeApi,
  setStoredApiBase,
} from './api.js';

const CODESPACE_URL =
  import.meta.env.VITE_CODESPACE_URL ||
  'https://codespaces.new/i-apologise/kubequest?quickstart=1';
const REPO_URL = 'https://github.com/i-apologise/kubequest';

export default function App() {
  const [tab, setTab] = useState(isPagesHost() ? 'play' : 'cluster');
  const [mode, setMode] = useState('connecting'); // connecting | live | mirror | demo
  const [apiBase, setApiBase] = useState(() => getStoredApiBase());
  const [apiInput, setApiInput] = useState(() => getStoredApiBase());
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
  const [mirrorMeta, setMirrorMeta] = useState({ updatedAt: null, source: null, publicApiUrl: null });
  const [connectError, setConnectError] = useState('');

  const client = useMemo(() => makeApi(apiBase), [apiBase]);

  const applySnapshot = useCallback((snap, nextMode) => {
    if (!snap) return;
    setCluster(snap.cluster || null);
    setMissions(snap.missions || []);
    setTelStatus(snap.telemetry || null);
    setTraces(snap.traces || []);
    setMetrics(snap.metrics || null);
    setMirrorMeta({
      updatedAt: snap.updatedAt || null,
      source: snap.source || null,
      publicApiUrl: snap.publicApiUrl || null,
    });
    if (snap.publicApiUrl && !getStoredApiBase()) {
      setApiInput(snap.publicApiUrl);
    }
    setMode(nextMode);
  }, []);

  const refreshTelemetry = useCallback(async () => {
    if (mode !== 'live') return;
    try {
      const s = await client.api('/api/telemetry/status');
      setTelStatus(s);
      if (s.jaeger?.ok) {
        const t = await client.api('/api/telemetry/traces?service=telemetry-api&limit=15');
        setTraces(t.traces || []);
      }
      if (s.prometheus?.ok) {
        const m = await client.api('/api/telemetry/metrics?query=kq_http_requests_total');
        setMetrics(m);
        const rr = await client.api('/api/telemetry/metrics/range?query=rate(kq_http_requests_total[1m])&seconds=300');
        setRange(rr);
      }
    } catch {
      /* optional */
    }
  }, [client, mode]);

  const refreshMissions = useCallback(() => {
    if (mode !== 'live') return;
    client.api('/api/missions').then((d) => setMissions(d.missions || [])).catch(() => {});
  }, [client, mode]);

  const connectLive = useCallback(async (base) => {
    const normalized = setStoredApiBase(base);
    setApiBase(normalized);
    setApiInput(normalized);
    setConnectError('');
    const c = makeApi(normalized);
    try {
      const health = await c.api('/api/health');
      const snap = await c.api('/api/snapshot').catch(async () => ({
        cluster: await c.api('/api/cluster'),
        missions: (await c.api('/api/missions')).missions,
        updatedAt: new Date().toISOString(),
        source: 'live-api',
        publicApiUrl: health.bridge?.publicApiUrl || normalized,
      }));
      applySnapshot({ ...snap, publicApiUrl: snap.publicApiUrl || normalized }, 'live');
      setMsg(`Connected to ${normalized}`);
      return true;
    } catch (e) {
      setConnectError(e.message);
      setMode((m) => (m === 'live' ? 'mirror' : m));
      return false;
    }
  }, [applySnapshot]);

  // Bootstrap: try explicit API, then mirror, then demo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = getStoredApiBase();
      if (stored) {
        const ok = await connectLive(stored);
        if (ok || cancelled) return;
      }
      if (!isPagesHost()) {
        try {
          await makeApi('').api('/api/health');
          if (cancelled) return;
          await connectLive('');
          return;
        } catch {
          /* fall through */
        }
      }
      try {
        const snap = await fetchMirror();
        if (cancelled) return;
        if (snap?.cluster || snap?.updatedAt) {
          applySnapshot(snap, 'mirror');
          return;
        }
      } catch {
        /* fall through */
      }
      if (cancelled) return;
      setMode('demo');
      setCluster(demoCluster);
      setMissions(demoMissions);
      setTraces(demoTraces);
      setMetrics({
        data: {
          result: [
            { metric: { route: '/api/hello', status: '200' }, value: [Date.now() / 1000, '42'] },
          ],
        },
      });
    })();
    return () => { cancelled = true; };
  }, [applySnapshot, connectLive]);

  // Live SSE + polling
  useEffect(() => {
    if (mode !== 'live') return undefined;
    let es;
    try {
      es = client.openEventSource();
      es.addEventListener('cluster', (ev) => {
        setLive(true);
        try { setCluster(JSON.parse(ev.data)); } catch { /* ignore */ }
      });
      es.onerror = () => setLive(false);
    } catch {
      setLive(false);
    }
    const t = setInterval(() => {
      refreshMissions();
      refreshTelemetry();
      client.api('/api/snapshot').then((snap) => applySnapshot(snap, 'live')).catch(() => {});
    }, 5000);
    return () => {
      es?.close();
      clearInterval(t);
    };
  }, [mode, client, refreshMissions, refreshTelemetry, applySnapshot]);

  // Mirror polling for GitHub Pages without direct codespace link
  useEffect(() => {
    if (mode !== 'mirror' && !(mode === 'demo' && isPagesHost())) return undefined;
    const t = setInterval(async () => {
      try {
        const snap = await fetchMirror();
        if (snap?.updatedAt) applySnapshot(snap, 'mirror');
      } catch {
        /* keep current */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [mode, applySnapshot]);

  useEffect(() => {
    if (mode !== 'demo') return undefined;
    const t = setInterval(() => setTick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, [mode]);

  useEffect(() => {
    if (mode === 'demo') setCluster(animateDemoCluster(demoCluster, tick));
  }, [mode, tick]);

  const stats = useMemo(() => ({
    pods: cluster?.pods?.length || 0,
    ready: cluster?.pods?.filter((p) => p.ready).length || 0,
    deps: cluster?.deployments?.length || 0,
    svcs: cluster?.services?.length || 0,
    cms: cluster?.configMaps?.length || 0,
  }), [cluster]);

  const sendTraffic = async () => {
    if (mode !== 'live') {
      setMsg(mode === 'mirror'
        ? 'Mirror mode is read-only. Connect the public Codespace API URL for traffic.'
        : 'Launch Codespaces and connect the public API URL to generate traffic.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const r = await client.api('/api/telemetry/traffic', {
        method: 'POST',
        body: JSON.stringify({ count: 8, path: '/api/hello' }),
      });
      setMsg(`Sent ${r.sent} requests`);
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
    if (series.length) return series.slice(-40).map(([, v]) => Number(v) || 0);
    const total = Number(metrics?.data?.result?.[0]?.value?.[1] || 0);
    return Array.from({ length: 20 }, (_, i) => (total ? (i + 1) / 20 * total : 0));
  }, [range, mode, tick, metrics]);
  const maxBar = Math.max(0.001, ...bars);

  const modeLabel = {
    connecting: 'connecting',
    live: live ? 'live bridge' : 'live api',
    mirror: 'mirror feed',
    demo: 'static demo',
  }[mode];

  return (
    <div className="app">
      <div className={`banner ${mode === 'live' ? 'banner-live' : ''}`}>
        <div>
          <strong>
            {mode === 'live' && 'Linked to your Codespace — updates reflect real kubectl changes.'}
            {mode === 'mirror' && 'Reading mirrored snapshots from the repo (updated by Codespace every ~15s).'}
            {mode === 'demo' && 'Static GitHub Pages demo — connect a Codespace to mirror live changes here.'}
            {mode === 'connecting' && 'Connecting…'}
          </strong>
          <div className="banner-sub">
            {mirrorMeta.updatedAt && mode === 'mirror' && `Last mirror: ${mirrorMeta.updatedAt} (${mirrorMeta.source || 'unknown'})`}
            {mode === 'live' && (apiBase || 'same-origin API')}
            {mode === 'demo' && 'Pages cannot run Kubernetes; it can only display data from a public Codespace API or mirrored JSON.'}
          </div>
        </div>
        <div className="banner-actions">
          <a className="btn" href={CODESPACE_URL} target="_blank" rel="noreferrer">Open Codespaces</a>
          <button type="button" className="btn secondary" onClick={() => setTab('play')}>Connect</button>
        </div>
      </div>

      <header className="top">
        <div className="brand">KUBE<span>QUEST</span></div>
        <nav className="tabs">
          {['cluster', 'traces', 'metrics', 'missions', 'play'].map((id) => (
            <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {id}
            </button>
          ))}
        </nav>
        <div className="row" style={{ margin: 0 }}>
          <span className={`pill ${mode === 'live' ? 'on' : mode === 'mirror' ? 'on' : 'off'}`}>{modeLabel}</span>
          <span className={`pill ${telStatus?.jaeger?.ok ? 'on' : 'off'}`}>jaeger</span>
          <span className={`pill ${telStatus?.prometheus?.ok ? 'on' : 'off'}`}>prom</span>
          <span className="pill mono">ns/{cluster?.namespace || 'kubequest'}</span>
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
        </aside>

        <section className="content">
          {tab === 'play' && (
            <div className="play-panel">
              <h2>Reflect Codespace changes on GitHub Pages</h2>
              <ol>
                <li>Open <a href={CODESPACE_URL} target="_blank" rel="noreferrer">Codespaces</a> and run <code className="mono">npm start</code>.</li>
                <li>In <strong>Ports</strong>, set port <strong>3847</strong> to visibility <strong>Public</strong>.</li>
                <li>Copy the public URL (shape <code className="mono">https://&lt;name&gt;-3847.app.github.dev</code>).</li>
                <li>Paste it below and click <strong>Connect live</strong> — this tab talks to your Codespace API directly.</li>
                <li>Leave Codespace running: it also mirrors snapshots to <code className="mono">live/state.json</code> so this site updates even without a pasted URL (every ~15s).</li>
              </ol>

              <label className="connect-label" htmlFor="api-url">Codespace public API URL</label>
              <div className="connect-row">
                <input
                  id="api-url"
                  className="connect-input mono"
                  placeholder="https://your-codespace-3847.app.github.dev"
                  value={apiInput}
                  onChange={(e) => setApiInput(e.target.value)}
                />
                <button type="button" className="btn" onClick={() => connectLive(apiInput)}>Connect live</button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setStoredApiBase('');
                    setApiBase('');
                    setApiInput('');
                    setMode('connecting');
                    fetchMirror().then((s) => applySnapshot(s, 'mirror')).catch(() => setMode('demo'));
                  }}
                >
                  Use mirror only
                </button>
              </div>
              {connectError && <p className="error-text">Connect failed: {connectError}. Is 3847 Public?</p>}
              {msg && <p className="mono" style={{ color: 'var(--accent)' }}>{msg}</p>}
              {mirrorMeta.publicApiUrl && (
                <p>
                  Last mirror advertised bridge:
                  <button type="button" className="linkish mono" onClick={() => { setApiInput(mirrorMeta.publicApiUrl); connectLive(mirrorMeta.publicApiUrl); }}>
                    {mirrorMeta.publicApiUrl}
                  </button>
                </p>
              )}
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
              <div className="canvas-wrap"><ClusterView cluster={cluster} /></div>
              <ResourceTables cluster={cluster} />
            </>
          )}

          {tab === 'traces' && (
            <>
              <div className="row">
                <button type="button" className="btn" disabled={busy || mode !== 'live'} onClick={sendTraffic}>Generate traffic</button>
                <button type="button" className="btn secondary" onClick={refreshTelemetry}>Refresh</button>
                {msg && <span className="mono" style={{ fontSize: '.8rem', color: 'var(--accent)' }}>{msg}</span>}
              </div>
              {!traces.length && <div className="empty">No traces in the current feed.</div>}
              {traces.map((t) => (
                <div key={t.traceID} className="trace">
                  <div className="mono id">{t.traceID}</div>
                  <div><strong>{t.rootOperation}</strong> · {t.spans} spans · {(t.durationUs / 1000).toFixed(1)} ms</div>
                </div>
              ))}
            </>
          )}

          {tab === 'metrics' && (
            <>
              <div className="row">
                <button type="button" className="btn" disabled={busy || mode !== 'live'} onClick={sendTraffic}>Generate traffic</button>
              </div>
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="label">kq_http_requests_total</div>
                <div className="value mono" style={{ fontSize: '1rem' }}>
                  {(metrics?.data?.result || []).length
                    ? metrics.data.result.map((s, i) => <div key={i}>{JSON.stringify(s.metric)} = {s.value?.[1]}</div>)
                    : 'no data'}
                </div>
              </div>
              <div className="chart">
                {bars.map((v, i) => <i key={i} style={{ height: `${Math.max(4, (v / maxBar) * 100)}%` }} />)}
              </div>
            </>
          )}

          {tab === 'missions' && (
            <table>
              <thead><tr><th>ID</th><th>Title</th><th>Track</th><th>Status</th></tr></thead>
              <tbody>
                {missions.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.id}</td>
                    <td>{m.title}</td>
                    <td>{m.track}</td>
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
        <thead><tr><th>Pod</th><th>Phase</th><th>IP</th></tr></thead>
        <tbody>
          {(cluster.pods || []).map((p) => (
            <tr key={p.name}>
              <td className="mono"><span className={`dot ${p.ready ? 'ok' : 'wait'}`} />{p.name}</td>
              <td>{p.ready ? 'Ready' : p.phase}</td>
              <td className="mono">{p.ip || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
