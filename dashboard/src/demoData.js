export const demoCluster = {
  namespace: 'kubequest',
  pods: [
    { name: 'telemetry-api-a', phase: 'Running', ready: true, ip: '10.244.0.11', restarts: 0, labels: { app: 'telemetry-api' } },
    { name: 'telemetry-api-b', phase: 'Running', ready: true, ip: '10.244.0.12', restarts: 0, labels: { app: 'telemetry-api' } },
    { name: 'jaeger-0', phase: 'Running', ready: true, ip: '10.244.0.20', restarts: 0, labels: { app: 'jaeger' } },
    { name: 'otel-collector-0', phase: 'Running', ready: true, ip: '10.244.0.21', restarts: 0, labels: { app: 'otel-collector' } },
    { name: 'prometheus-0', phase: 'Running', ready: true, ip: '10.244.0.22', restarts: 0, labels: { app: 'prometheus' } },
    { name: 'fleet-x', phase: 'Running', ready: true, ip: '10.244.0.30', restarts: 0, labels: { app: 'fleet' } },
    { name: 'fleet-y', phase: 'Running', ready: true, ip: '10.244.0.31', restarts: 0, labels: { app: 'fleet' } },
  ],
  deployments: [
    { name: 'telemetry-api', replicas: 2, readyReplicas: 2, images: ['kubequest-telemetry-api:local'] },
    { name: 'jaeger', replicas: 1, readyReplicas: 1, images: ['jaegertracing/all-in-one:1.57'] },
    { name: 'otel-collector', replicas: 1, readyReplicas: 1, images: ['otel/opentelemetry-collector-contrib:0.96.0'] },
    { name: 'prometheus', replicas: 1, readyReplicas: 1, images: ['prom/prometheus:v2.51.2'] },
    { name: 'fleet', replicas: 2, readyReplicas: 2, images: ['nginx:1.27-alpine'] },
  ],
  services: [
    { name: 'telemetry-api', type: 'ClusterIP', clusterIP: '10.96.10.1', selector: { app: 'telemetry-api' } },
    { name: 'jaeger', type: 'ClusterIP', clusterIP: '10.96.10.2', selector: { app: 'jaeger' } },
    { name: 'prometheus', type: 'ClusterIP', clusterIP: '10.96.10.3', selector: { app: 'prometheus' } },
    { name: 'fleet-svc', type: 'ClusterIP', clusterIP: '10.96.10.4', selector: { app: 'fleet' } },
  ],
  configMaps: [
    { name: 'otel-collector-config', dataKeys: ['config.yaml'] },
    { name: 'quest-config', dataKeys: ['MESSAGE'] },
  ],
};

export const demoMissions = [
  { id: 1, title: 'Your First Pod', track: 'core', xp: 100, met: true, detail: 'demo' },
  { id: 2, title: 'Deployments', track: 'core', xp: 150, met: true, detail: 'demo' },
  { id: 9, title: 'Observability Stack', track: 'telemetry', xp: 300, met: true, detail: 'demo' },
  { id: 10, title: 'Instrumented Service', track: 'telemetry', xp: 300, met: true, detail: 'demo' },
  { id: 11, title: 'Live Traces', track: 'telemetry', xp: 350, met: false, detail: 'launch codespace to play' },
  { id: 12, title: 'Live Metrics', track: 'telemetry', xp: 350, met: false, detail: 'launch codespace to play' },
];

export const demoTraces = [
  { traceID: 'demotrace001', spans: 3, rootOperation: 'hello-handler', durationUs: 42000, services: ['telemetry-api'] },
  { traceID: 'demotrace002', spans: 2, rootOperation: 'GET /api/hello', durationUs: 31000, services: ['telemetry-api'] },
];

export function animateDemoCluster(base, tick) {
  const pods = base.pods.map((p, i) => ({
    ...p,
    ready: true,
    restarts: p.restarts + ((tick + i) % 7 === 0 ? 0 : 0),
  }));
  if (tick % 6 === 0) {
    pods.push({
      name: `fleet-ephemeral-${tick}`,
      phase: 'Pending',
      ready: false,
      ip: null,
      restarts: 0,
      labels: { app: 'fleet' },
    });
  }
  return { ...base, pods: pods.filter((p) => !p.name.startsWith('fleet-ephemeral-') || tick % 6 < 3) };
}
