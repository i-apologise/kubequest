import { useMemo } from 'react';

export default function ClusterView({ cluster }) {
  const { nodes, edges, W, H } = useMemo(() => layout(cluster), [cluster]);
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="360" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1a2336" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#g)" />
      {!nodes.length && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize="14">
          Cluster empty — run kubectl in the game
        </text>
      )}
      {edges.map((e, i) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.color} strokeWidth="1.5" strokeDasharray={e.dash || '0'} opacity="0.7" />;
      })}
      {nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          {n.kind === 'pod' && (
            <>
              <circle r="14" fill={n.color} opacity="0.9" />
              <text y="28" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontFamily="JetBrains Mono, monospace">{short(n.name)}</text>
              <text y="40" textAnchor="middle" fill="#94a3b8" fontSize="9">{n.ready ? 'Ready' : n.phase}</text>
            </>
          )}
          {n.kind === 'deployment' && (
            <>
              <rect x="-34" y="-14" width="68" height="28" rx="6" fill="#0f2a28" stroke="#2dd4bf" />
              <text y="4" textAnchor="middle" fill="#e2e8f0" fontSize="9" fontFamily="JetBrains Mono, monospace">deploy/{short(n.name)}</text>
              <text y="26" textAnchor="middle" fill="#94a3b8" fontSize="9">{n.ready}/{n.replicas}</text>
            </>
          )}
          {n.kind === 'service' && (
            <>
              <polygon points="0,-16 14,-6 14,10 0,20 -14,10 -14,-6" fill="#1e1535" stroke="#a78bfa" />
              <text y="34" textAnchor="middle" fill="#e2e8f0" fontSize="9" fontFamily="JetBrains Mono, monospace">svc/{short(n.name)}</text>
            </>
          )}
          {n.kind === 'configmap' && (
            <>
              <rect x="-24" y="-10" width="48" height="20" rx="3" fill="#2a2010" stroke="#fbbf24" />
              <text y="4" textAnchor="middle" fill="#e2e8f0" fontSize="8" fontFamily="JetBrains Mono, monospace">cm/{short(n.name)}</text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

function short(n) {
  if (!n) return '';
  return n.length > 16 ? `${n.slice(0, 7)}…${n.slice(-5)}` : n;
}

function layout(cluster) {
  const W = 900;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2 + 10;
  const nodes = [];
  const edges = [];
  const pods = cluster?.pods || [];
  const deployments = cluster?.deployments || [];
  const services = cluster?.services || [];
  const configMaps = cluster?.configMaps || [];

  deployments.forEach((d, i) => {
    const a = (i / Math.max(deployments.length, 1)) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      id: `d-${d.name}`, kind: 'deployment', name: d.name,
      x: cx + Math.cos(a) * 150, y: cy + Math.sin(a) * 100,
      replicas: d.replicas, ready: d.readyReplicas,
    });
  });

  pods.forEach((p, i) => {
    const app = p.labels?.app;
    const parent = nodes.find((n) => n.kind === 'deployment' && n.name === app);
    let x; let y;
    if (parent) {
      const sibs = pods.filter((x) => x.labels?.app === app);
      const idx = sibs.findIndex((x) => x.name === p.name);
      const a = (idx / Math.max(sibs.length, 1)) * Math.PI * 2;
      x = parent.x + Math.cos(a) * 48;
      y = parent.y + Math.sin(a) * 40;
      edges.push({ from: parent.id, to: `p-${p.name}`, color: '#334155', dash: '4 4' });
    } else {
      const a = (i / Math.max(pods.length, 1)) * Math.PI * 2;
      x = cx + Math.cos(a) * 90;
      y = cy + Math.sin(a) * 60;
    }
    nodes.push({
      id: `p-${p.name}`, kind: 'pod', name: p.name, x, y,
      ready: p.ready, phase: p.phase,
      color: p.ready ? '#34d399' : p.phase === 'Pending' ? '#fbbf24' : '#38bdf8',
    });
  });

  services.forEach((s, i) => {
    const a = (i / Math.max(services.length, 1)) * Math.PI * 2 + 0.4;
    const id = `s-${s.name}`;
    nodes.push({ id, kind: 'service', name: s.name, x: cx + Math.cos(a) * 220, y: cy + Math.sin(a) * 130 });
    pods.forEach((p) => {
      const sel = s.selector || {};
      if (Object.entries(sel).every(([k, v]) => p.labels?.[k] === v)) {
        edges.push({ from: id, to: `p-${p.name}`, color: '#a78bfa' });
      }
    });
  });

  configMaps.forEach((c, i) => {
    nodes.push({ id: `c-${c.name}`, kind: 'configmap', name: c.name, x: 70, y: 50 + i * 36 });
  });

  return { nodes, edges, W, H };
}
