import { useMemo } from 'react';

const COLORS = {
  pod: '#38bdf8',
  podReady: '#34d399',
  podPending: '#fbbf24',
  podFailed: '#f87171',
  svc: '#a78bfa',
  dep: '#2dd4bf',
  cm: '#fbbf24',
};

function podColor(pod) {
  if (pod.ready) return COLORS.podReady;
  if (pod.phase === 'Pending' || pod.phase === 'ContainerCreating') return COLORS.podPending;
  if (pod.phase === 'Failed' || pod.phase === 'Unknown') return COLORS.podFailed;
  return COLORS.pod;
}

function layout(cluster) {
  const pods = cluster?.pods || [];
  const services = cluster?.services || [];
  const deployments = cluster?.deployments || [];
  const configMaps = cluster?.configMaps || [];

  const W = 900;
  const H = 560;
  const cx = W / 2;
  const cy = H / 2 + 10;

  // Group pods by app label when possible
  const nodes = [];
  const edges = [];

  // Place deployments as anchors on a ring
  const anchors = Math.max(deployments.length, 1);
  deployments.forEach((d, i) => {
    const angle = (i / anchors) * Math.PI * 2 - Math.PI / 2;
    const r = 160;
    nodes.push({
      id: `dep-${d.name}`,
      kind: 'deployment',
      name: d.name,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r * 0.75,
      data: d,
    });
  });

  // Place pods near their deployment or in a circle
  pods.forEach((p, i) => {
    const app = p.labels?.app;
    const parent = nodes.find((n) => n.kind === 'deployment' && n.name === app);
    let x, y;
    if (parent) {
      const siblings = pods.filter((x) => x.labels?.app === app);
      const idx = siblings.findIndex((x) => x.name === p.name);
      const n = siblings.length;
      const a = (idx / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
      const pr = 55 + n * 4;
      x = parent.x + Math.cos(a) * pr;
      y = parent.y + Math.sin(a) * pr * 0.85;
      edges.push({ from: parent.id, to: `pod-${p.name}`, type: 'owns' });
    } else {
      const a = (i / Math.max(pods.length, 1)) * Math.PI * 2;
      const pr = 120;
      x = cx + Math.cos(a) * pr;
      y = cy + Math.sin(a) * pr * 0.7;
    }
    nodes.push({
      id: `pod-${p.name}`,
      kind: 'pod',
      name: p.name,
      x,
      y,
      data: p,
    });
  });

  // Services on outer ring, link to selected pods
  services.forEach((s, i) => {
    const angle = (i / Math.max(services.length, 1)) * Math.PI * 2 + Math.PI / 6;
    const r = 240;
    const sx = cx + Math.cos(angle) * r;
    const sy = cy + Math.sin(angle) * r * 0.7;
    const sid = `svc-${s.name}`;
    nodes.push({
      id: sid,
      kind: 'service',
      name: s.name,
      x: sx,
      y: sy,
      data: s,
    });
    const sel = s.selector || {};
    pods.forEach((p) => {
      const match = Object.entries(sel).every(([k, v]) => p.labels?.[k] === v);
      if (match) edges.push({ from: sid, to: `pod-${p.name}`, type: 'routes' });
    });
  });

  // ConfigMaps top-leftish
  configMaps.forEach((c, i) => {
    nodes.push({
      id: `cm-${c.name}`,
      kind: 'configmap',
      name: c.name,
      x: 80 + i * 30,
      y: 60 + i * 40,
      data: c,
    });
    const messenger = nodes.find((n) => n.kind === 'pod' && n.name === 'messenger');
    if (messenger && c.name === 'quest-config') {
      edges.push({ from: `cm-${c.name}`, to: messenger.id, type: 'config' });
    }
  });

  return { nodes, edges, W, H };
}

export default function ClusterCanvas({ cluster }) {
  const { nodes, edges, W, H } = useMemo(() => layout(cluster), [cluster]);
  const empty = !nodes.length;

  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div className="cluster-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="podGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </radialGradient>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" className="grid-bg" fill="none" />
          </pattern>
        </defs>

        <rect width={W} height={H} fill="url(#grid)" opacity="0.5" />

        {/* cluster ring */}
        <ellipse
          cx={W / 2}
          cy={H / 2 + 10}
          rx={280}
          ry={200}
          fill="none"
          stroke="#1e3a5f"
          strokeWidth="1"
          strokeDasharray="6 8"
          opacity="0.6"
        />
        <text
          x={W / 2}
          y={36}
          textAnchor="middle"
          fill="#475569"
          fontFamily="JetBrains Mono, monospace"
          fontSize="11"
        >
          namespace / kubequest — live resources
        </text>

        {/* edges */}
        {edges.map((e, i) => {
          const a = pos[e.from];
          const b = pos[e.to];
          if (!a || !b) return null;
          const color =
            e.type === 'routes' ? COLORS.svc : e.type === 'config' ? COLORS.cm : '#334155';
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={color}
              strokeWidth={e.type === 'routes' ? 2 : 1.5}
              strokeDasharray={e.type === 'owns' ? '4 4' : e.type === 'config' ? '2 3' : '0'}
              opacity={0.7}
            />
          );
        })}

        {/* nodes */}
        {nodes.map((n) => {
          if (n.kind === 'pod') {
            const c = podColor(n.data);
            return (
              <g key={n.id} className="node-pod" transform={`translate(${n.x},${n.y})`}>
                {n.data.ready && (
                  <circle r="22" fill="none" stroke={c} strokeWidth="1.5" className="pod-ring" />
                )}
                <circle r="28" fill="url(#podGlow)" opacity={n.data.ready ? 1 : 0.3} />
                <circle r="16" fill={c} filter="url(#softGlow)" opacity="0.9" />
                <circle r="8" fill="#0f172a" opacity="0.35" />
                <text className="node-label" y="32">
                  {shortName(n.name)}
                </text>
                <text className="node-sub" y="44">
                  {n.data.ready ? 'Ready' : n.data.phase || '…'}
                  {n.data.ip ? ` · ${n.data.ip}` : ''}
                </text>
              </g>
            );
          }
          if (n.kind === 'deployment') {
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <rect
                  x="-36"
                  y="-18"
                  width="72"
                  height="36"
                  rx="8"
                  fill="#0f2a28"
                  stroke={COLORS.dep}
                  strokeWidth="1.5"
                  filter="url(#softGlow)"
                />
                <text className="node-label" y="4" fontSize="10">
                  deploy/{shortName(n.name)}
                </text>
                <text className="node-sub" y="28">
                  {n.data.readyReplicas}/{n.data.replicas} ready
                </text>
              </g>
            );
          }
          if (n.kind === 'service') {
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <polygon
                  points="0,-20 18,-8 18,12 0,24 -18,12 -18,-8"
                  fill="#1e1535"
                  stroke={COLORS.svc}
                  strokeWidth="1.5"
                  filter="url(#softGlow)"
                />
                <text className="node-label" y="40">
                  svc/{shortName(n.name)}
                </text>
                <text className="node-sub" y="52">
                  {n.data.type} {n.data.clusterIP || ''}
                </text>
              </g>
            );
          }
          if (n.kind === 'configmap') {
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <rect
                  x="-28"
                  y="-14"
                  width="56"
                  height="28"
                  rx="4"
                  fill="#2a2010"
                  stroke={COLORS.cm}
                  strokeWidth="1.5"
                />
                <text className="node-label" y="4" fontSize="9">
                  cm/{shortName(n.name)}
                </text>
              </g>
            );
          }
          return null;
        })}
      </svg>

      {empty && (
        <div className="empty-cluster">
          <div className="big pulse">🌑</div>
          <p>Cluster sandbox is empty</p>
          <p style={{ fontSize: '0.8rem' }}>Run a mission action to spawn real workloads</p>
        </div>
      )}

      <div className="legend">
        <span><i style={{ background: COLORS.podReady }} /> Pod Ready</span>
        <span><i style={{ background: COLORS.podPending }} /> Pending</span>
        <span><i style={{ background: COLORS.dep, borderRadius: 2 }} /> Deployment</span>
        <span><i style={{ background: COLORS.svc, borderRadius: 2 }} /> Service</span>
        <span><i style={{ background: COLORS.cm, borderRadius: 2 }} /> ConfigMap</span>
      </div>
    </div>
  );
}

function shortName(name) {
  if (!name) return '';
  if (name.length <= 18) return name;
  return name.slice(0, 8) + '…' + name.slice(-6);
}
