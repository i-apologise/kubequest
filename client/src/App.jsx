import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import ClusterCanvas from './components/ClusterCanvas.jsx';

export default function App() {
  const [health, setHealth] = useState(null);
  const [missions, setMissions] = useState([]);
  const [progress, setProgress] = useState({ xp: 0, completed: [], currentMission: 1 });
  const [activeId, setActiveId] = useState(1);
  const [mission, setMission] = useState(null);
  const [cluster, setCluster] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const log = useCallback((msg, type = 'info') => {
    setLogs((prev) => [{ msg, type, t: Date.now() }, ...prev].slice(0, 40));
  }, []);

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(null), 3200);
  };

  const refreshMissions = useCallback(async () => {
    const data = await api.missions();
    setMissions(data.missions);
    setProgress(data.progress);
    return data;
  }, []);

  const refreshCluster = useCallback(async () => {
    try {
      const snap = await api.cluster();
      setCluster(snap);
    } catch (e) {
      /* cluster may not be ready */
    }
  }, []);

  const loadMission = useCallback(async (id) => {
    const m = await api.mission(id);
    setMission(m);
    setActiveId(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setHealth(h);
        if (h.progress) setProgress(h.progress);
        const data = await refreshMissions();
        const start = data.progress?.currentMission || 1;
        await loadMission(start);
        await refreshCluster();
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMissions, refreshCluster, loadMission]);

  // Live poll cluster
  useEffect(() => {
    if (!health?.connected) return;
    const t = setInterval(refreshCluster, 2000);
    return () => clearInterval(t);
  }, [health?.connected, refreshCluster]);

  const runAction = async (actionId) => {
    setBusy(true);
    try {
      const r = await api.action(actionId);
      log(r.message || 'Action applied', 'ok');
      await refreshCluster();
      // auto-check after a short wait for pods to schedule
      setTimeout(() => checkMission(false), 2500);
    } catch (e) {
      log(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const checkMission = async (manual = true) => {
    if (!mission) return;
    setBusy(true);
    try {
      const r = await api.check(mission.id);
      log(r.detail || (r.met ? 'Condition met' : 'Not yet'), r.met ? 'ok' : 'info');
      if (r.progress) setProgress(r.progress);
      if (r.leveledUp) {
        showToast(`🏆 Mission complete! +${r.mission.xp} XP — ${r.mission.title}`);
        await refreshMissions();
        const next = Math.min(mission.id + 1, 8);
        if (next !== mission.id) await loadMission(next);
      } else if (manual && !r.met) {
        log('Keep going — win condition not met yet', 'info');
      }
      await refreshCluster();
    } catch (e) {
      log(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm('Wipe the kubequest namespace and reset progress?')) return;
    setBusy(true);
    try {
      await api.reset();
      log('Sandbox reset', 'ok');
      showToast('Cluster sandbox wiped');
      await refreshMissions();
      await loadMission(1);
      await refreshCluster();
    } catch (e) {
      log(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="boot-screen">
        <h1>KUBEQUEST</h1>
        <p>Cannot reach the game API. Start the server:</p>
        <p><code>npm run dev</code></p>
        <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{error}</p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="boot-screen">
        <h1 className="pulse">KUBEQUEST</h1>
        <p>Connecting to cluster control plane…</p>
      </div>
    );
  }

  if (!health.connected) {
    return (
      <div className="boot-screen">
        <h1>KUBEQUEST</h1>
        <p>
          No Kubernetes cluster found. This game spawns <strong>real</strong> Pods —
          set up a local kind cluster:
        </p>
        <p><code>npm run setup</code></p>
        <p style={{ fontSize: '0.8rem' }}>Then restart with <code>npm run dev</code></p>
        <p style={{ color: '#f87171', fontSize: '0.8rem' }}>{health.error}</p>
      </div>
    );
  }

  const maxXp = missions.reduce((s, m) => s + (m.xp || 0), 0) || 1;
  const xpPct = Math.min(100, Math.round((progress.xp / maxXp) * 100));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>KUBEQUEST</h1>
          <p>Learn Kubernetes by commanding a real cluster</p>
        </div>
        <div className="xp-bar">
          <div className="row">
            <span>Commander XP</span>
            <strong>{progress.xp} / {maxXp}</strong>
          </div>
          <div className="xp-track">
            <div className="xp-fill" style={{ width: `${xpPct}%` }} />
          </div>
        </div>
        <div className="mission-list">
          {missions.map((m) => {
            const done = progress.completed?.includes(m.id);
            const locked =
              m.id > 1 &&
              !progress.completed?.includes(m.id - 1) &&
              m.id > (progress.currentMission || 1);
            return (
              <button
                key={m.id}
                type="button"
                className={`mission-item ${activeId === m.id ? 'active' : ''} ${done ? 'done' : ''}`}
                disabled={locked}
                onClick={() => loadMission(m.id)}
              >
                <span className="ico">{done ? '✅' : m.icon}</span>
                <span className="meta">
                  <div className="title">
                    {m.id}. {m.title}
                  </div>
                  <div className="sub">
                    {m.rank} · {m.xp} XP
                    {done && <span className="badge"> · cleared</span>}
                    {locked && ' · locked'}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="stage">
        <div className="stage-header">
          <h2>
            <span className={`status-dot ${health.connected ? 'on' : 'off'}`} />
            Live cluster view
          </h2>
          <span className="ns">ns/{cluster?.namespace || 'kubequest'}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {cluster?.pods?.length || 0} pods · {cluster?.deployments?.length || 0} deploys ·{' '}
            {cluster?.services?.length || 0} svcs
          </span>
        </div>
        <ClusterCanvas cluster={cluster} />
      </main>

      <aside className="panel">
        <div className="panel-scroll">
          {mission && (
            <>
              <div className="mission-icon">{mission.icon}</div>
              <h2>{mission.title}</h2>
              <div className="rank">
                Rank: {mission.rank} · +{mission.xp} XP
              </div>
              <div className="lore">{mission.lore}</div>
              <div className="objective">
                <strong>Objective:</strong> {mission.objective}
              </div>
              <div className="concepts">
                {mission.concepts?.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <div className="tips">
                <h3>Field notes</h3>
                <ul>
                  {mission.tips?.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="actions">
                {mission.actions?.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || progress.completed?.includes(mission.id)}
                    onClick={() => runAction(a.id)}
                  >
                    ⚡ {a.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-check"
                  disabled={busy}
                  onClick={() => checkMission(true)}
                >
                  🔍 Verify win condition
                </button>
              </div>
              <div className="log">
                {logs.length === 0 && (
                  <div className="line">Events will appear here…</div>
                )}
                {logs.map((l) => (
                  <div key={l.t + l.msg} className={`line ${l.type}`}>
                    › {l.msg}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="panel-footer">
          <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>
            Reset sandbox
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refreshCluster}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      </aside>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
