import { useCallback, useEffect, useMemo, useState } from 'react';
import ClusterView from './ClusterView.jsx';

async function api(path, opts) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

export default function App() {
  const [tab, setTab] = useState('cluster');
  const [cluster, setCluster] = useState(null);
  const [missions, setMissions] = useState([]);
  const [live, setLive] = useState(false);
  const [telStatus, setTelStatus] = useState(null);
  const [traces, setTraces] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [range, setRange] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refreshMissions = useCallback(() => {
    api('/api/missions').then((d) => setMissions(d.missions || [])).catch(() => {});
  }, []);

  const refreshTelemetry = useCallback(async () => {
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
      /* stack not up yet */
    }
  }, []);

  useEffect(() => {
    api('/api/cluster').then(setCluster).catch(() => {});
    refreshMissions();
    refreshTelemetry();
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
  }, [refreshMissions, refreshTelemetry]);

  const stats = useMemo(() => ({
    pods: cluster?.pods?.length || 0,
    ready: cluster?.pods?.filter((p) => p.ready).length || 0,
    deps: cluster?.deployments?.length || 0,
    svcs: cluster?.services?.length || 0,
    cms: cluster?.configMaps?.length || 0,
  }), [cluster]);

  const sendTraffic = async () => {
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
    const series = range?.data?.result?.[0]?.values || [];
    return series.slice(-40).map(([, v]) => Number(v) || 0);
  }, [range]);
  const maxBar = Math.max(0.001, ...bars);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">KUBE<span>QUEST</span> LIVE</div>
        <nav className="tabs">
          {['cluster', 'traces', 'metrics', 'missions'].map((id) => (
            <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {id}
            </button>
          ))}
        </nav>
        <div className="row" style={{ margin: 0 }}>
          <span className={`pill ${live ? 'on' : 'off'}`}>{live ? 'SSE live' : 'connecting'}</span>
          <span className={`pill ${telStatus?.jaeger?.ok ? 'on' : 'off'}`}>jaeger</span>
          <span className={`pill ${telStatus?.prometheus?.ok ? 'on' : 'off'}`}>prom</span>
          <span className={`pill ${telStatus?.telemetryApi?.ok ? 'on' : 'off'}`}>api</span>
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
          {tab === 'cluster' && (
            <>
              <div className="grid cards">
                <div className="card"><div className="label">Pods ready</div><div className="value">{stats.ready}/{stats.pods}</div></div>
                <div className="card"><div className="label">Deployments</div><div className="value">{stats.deps}</div></div>
                <div className="card"><div className="label">Services</div><div className="value">{stats.svcs}</div></div>
                <div className="card"><div className="label">ConfigMaps</div><div className="value">{stats.cms}</div></div>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>
                Updates stream as you run kubectl in the game terminal.
              </p>
              <div className="canvas-wrap">
                <ClusterView cluster={cluster} />
              </div>
              <ResourceTables cluster={cluster} />
            </>
          )}

          {tab === 'traces' && (
            <>
              <div className="row">
                <button type="button" className="btn" disabled={busy} onClick={sendTraffic}>Generate traffic</button>
                <button type="button" className="btn secondary" onClick={refreshTelemetry}>Refresh</button>
                {msg && <span className="mono" style={{ fontSize: '.8rem', color: 'var(--accent)' }}>{msg}</span>}
              </div>
              {!traces.length && (
                <div className="empty">No traces yet. Deploy the telemetry stack (missions 9–11), then generate traffic.</div>
              )}
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
                    <td>
                      <span className={`dot ${m.met ? 'ok' : 'wait'}`} />
                      {m.detail}
                    </td>
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
