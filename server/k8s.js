import * as k8s from '@kubernetes/client-node';
import { NAMESPACE } from './missions.js';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const core = kc.makeApiClient(k8s.CoreV1Api);
export const apps = kc.makeApiClient(k8s.AppsV1Api);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ensureNamespace() {
  for (let i = 0; i < 90; i++) {
    try {
      const ns = await core.readNamespace({ name: NAMESPACE });
      const phase = ns.status?.phase;
      if (phase === 'Active') return;
      // Terminating or unknown — wait it out before recreating
      await sleep(1000);
      continue;
    } catch {
      try {
        await core.createNamespace({
          body: {
            metadata: {
              name: NAMESPACE,
              labels: { app: 'kubequest', 'kubequest.io/game': 'true' },
            },
          },
        });
      } catch {
        /* may still be terminating */
      }
      await sleep(1000);
    }
  }
  throw new Error(`namespace ${NAMESPACE} not Active in time — try: kubectl delete ns ${NAMESPACE}`);
}

export async function getClusterSnapshot() {
  const [podsRes, depsRes, svcsRes, cmsRes] = await Promise.all([
    core.listNamespacedPod({ namespace: NAMESPACE }).catch(() => ({ items: [] })),
    apps.listNamespacedDeployment({ namespace: NAMESPACE }).catch(() => ({ items: [] })),
    core.listNamespacedService({ namespace: NAMESPACE }).catch(() => ({ items: [] })),
    core.listNamespacedConfigMap({ namespace: NAMESPACE }).catch(() => ({ items: [] })),
  ]);

  const pods = (podsRes.items || []).map((p) => ({
    name: p.metadata?.name,
    phase: p.status?.phase,
    ready: (p.status?.containerStatuses || []).length > 0
      && (p.status?.containerStatuses || []).every((c) => c.ready)
      && p.status?.phase === 'Running',
    ip: p.status?.podIP || null,
    node: p.spec?.nodeName || null,
    labels: p.metadata?.labels || {},
    containers: (p.spec?.containers || []).map((c) => ({
      name: c.name,
      image: c.image,
    })),
    restarts: (p.status?.containerStatuses || []).reduce((s, c) => s + (c.restartCount || 0), 0),
    createdAt: p.metadata?.creationTimestamp,
  }));

  const deployments = (depsRes.items || []).map((d) => ({
    name: d.metadata?.name,
    replicas: d.spec?.replicas ?? 0,
    readyReplicas: d.status?.readyReplicas ?? 0,
    availableReplicas: d.status?.availableReplicas ?? 0,
    images: (d.spec?.template?.spec?.containers || []).map((c) => c.image),
    labels: d.metadata?.labels || {},
  }));

  const services = (svcsRes.items || [])
    .filter((s) => s.metadata?.name !== 'kubernetes')
    .map((s) => ({
      name: s.metadata?.name,
      type: s.spec?.type,
      clusterIP: s.spec?.clusterIP,
      ports: (s.spec?.ports || []).map((p) => ({
        port: p.port,
        targetPort: p.targetPort,
        protocol: p.protocol,
      })),
      selector: s.spec?.selector || {},
    }));

  const configMaps = (cmsRes.items || [])
    .filter((c) => !c.metadata?.name?.startsWith('kube-'))
    .map((c) => ({
      name: c.metadata?.name,
      dataKeys: Object.keys(c.data || {}),
    }));

  return { namespace: NAMESPACE, pods, deployments, services, configMaps };
}

export async function checkWinCondition(condition) {
  const snap = await getClusterSnapshot();

  switch (condition.type) {
    case 'podReady': {
      const pod = snap.pods.find((p) => p.name === condition.name || p.name?.startsWith(condition.name + '-'));
      const exact = snap.pods.find((p) => p.name === condition.name);
      const target = exact || pod;
      return { met: !!(target && target.ready), detail: target ? `${target.name}: ${target.phase}${target.ready ? ' Ready' : ''}` : `${condition.name} not found` };
    }
    case 'deploymentReady': {
      const d = snap.deployments.find((x) => x.name === condition.name);
      if (!d) return { met: false, detail: 'deployment not found' };
      const need = condition.replicas ?? d.replicas;
      const ok = d.replicas >= need && d.readyReplicas >= need;
      return {
        met: ok,
        detail: `${d.name}: ${d.readyReplicas}/${d.replicas} ready (need ${need})`,
      };
    }
    case 'serviceExists': {
      const s = snap.services.find((x) => x.name === condition.name);
      return { met: !!s, detail: s ? `${s.name} ${s.type} ${s.clusterIP}` : 'service not found' };
    }
    case 'deploymentImage': {
      const d = snap.deployments.find((x) => x.name === condition.name);
      if (!d) return { met: false, detail: 'deployment not found' };
      const img = (d.images || []).join(',');
      const ok = img.includes(condition.imageContains) && d.readyReplicas >= 1;
      return { met: ok, detail: `images: ${img}, ready: ${d.readyReplicas}` };
    }
    default:
      return { met: false, detail: 'unknown condition' };
  }
}

export async function checkMission(mission) {
  const base = await checkWinCondition(mission.winCondition);
  if (!base.met) return base;

  if (mission.extraCheck === 'configMapEnv') {
    const snap = await getClusterSnapshot();
    const cm = snap.configMaps.find((x) => x.name === 'quest-config');
    if (!cm) return { met: false, detail: 'configmap/quest-config missing' };
    if (!cm.dataKeys?.includes('MESSAGE')) {
      return { met: false, detail: 'configmap/quest-config needs key MESSAGE' };
    }
    try {
      const pod = await core.readNamespacedPod({ name: 'messenger', namespace: NAMESPACE });
      const envs = pod.spec?.containers?.[0]?.env || [];
      const ok = envs.some(
        (e) => e.name === 'MESSAGE' && e.valueFrom?.configMapKeyRef?.name === 'quest-config'
      );
      if (!ok) return { met: false, detail: 'pod/messenger MESSAGE env is not from configmap/quest-config (delete pod, then: kubectl apply -f manifests/messenger.yaml)' };
    } catch {
      return { met: false, detail: 'pod/messenger not found' };
    }
  }

  if (mission.extraCheck === 'hasProbes') {
    const name = mission.probeDeploy;
    try {
      const d = await apps.readNamespacedDeployment({ name, namespace: NAMESPACE });
      const c0 = d.spec?.template?.spec?.containers?.[0];
      if (!c0?.livenessProbe || !c0?.readinessProbe) {
        return { met: false, detail: 'deployment needs both livenessProbe and readinessProbe' };
      }
    } catch {
      return { met: false, detail: `deployment/${name} not found` };
    }
  }

  if (mission.extraCheck === 'hasResources') {
    const name = mission.resourceDeploy;
    try {
      const d = await apps.readNamespacedDeployment({ name, namespace: NAMESPACE });
      const r = d.spec?.template?.spec?.containers?.[0]?.resources || {};
      const ok = r.requests?.cpu && r.requests?.memory && r.limits?.cpu && r.limits?.memory;
      if (!ok) return { met: false, detail: 'container needs resources.requests and resources.limits (cpu + memory)' };
    } catch {
      return { met: false, detail: `deployment/${name} not found` };
    }
  }



  if (mission.extraCheck === 'telemetryStack') {
    for (const name of mission.stackDeployments || ['jaeger', 'otel-collector', 'prometheus']) {
      const c = await checkWinCondition({ type: 'deploymentReady', name, replicas: 1 });
      if (!c.met) return { met: false, detail: c.detail };
    }
    return { met: true, detail: 'telemetry stack deployments Ready' };
  }
  if (mission.extraCheck === 'jaegerServices') {
    const r = await inClusterCurl('http://jaeger:16686/api/services');
    if (!r.ok) return { met: false, detail: `jaeger query not reachable (${r.error || r.phase || 'no body'})` };
    try {
      const data = JSON.parse(r.body);
      const services = data.data || [];
      return services.length
        ? { met: true, detail: `jaeger services: ${services.join(', ')}` }
        : { met: false, detail: 'jaeger is up but reports zero services yet' };
    } catch {
      return { met: false, detail: 'jaeger returned non-JSON' };
    }
  }

  if (mission.extraCheck === 'jaegerHasTraces') {
    const svc = mission.traceService || 'telemetry-api';
    const r = await inClusterCurl(`http://jaeger:16686/api/traces?service=${encodeURIComponent(svc)}&limit=5`);
    if (!r.ok) return { met: false, detail: `cannot query jaeger traces (${r.error || r.phase})` };
    try {
      const data = JSON.parse(r.body);
      const traces = data.data || [];
      if (!traces.length) return { met: false, detail: `no traces for service ${svc} yet — hit /api/hello and wait a few seconds` };
      return { met: true, detail: `${traces.length} trace(s) for ${svc}` };
    } catch {
      return { met: false, detail: 'jaeger traces response not JSON' };
    }
  }

  if (mission.extraCheck === 'prometheusMetric') {
    const q = mission.promQuery || 'kq_http_requests_total';
    const r = await inClusterCurl(`http://prometheus:9090/api/v1/query?query=${encodeURIComponent(q)}`);
    if (!r.ok) return { met: false, detail: `prometheus not reachable (${r.error || r.phase})` };
    try {
      const data = JSON.parse(r.body);
      const results = data?.data?.result || [];
      if (data.status !== 'success') return { met: false, detail: 'prometheus query failed' };
      if (!results.length) return { met: false, detail: `metric ${q} has no series yet — generate traffic` };
      return { met: true, detail: `${q}: ${results.length} series` };
    } catch {
      return { met: false, detail: 'prometheus returned non-JSON' };
    }
  }

  return base;
}

export async function runAction(actionId) {
  await ensureNamespace();

  switch (actionId) {
    case 'spawn-beacon': {
      try {
        await core.readNamespacedPod({ name: 'beacon', namespace: NAMESPACE });
        return { ok: true, message: 'Pod beacon already exists' };
      } catch {
        /* create */
      }
      await core.createNamespacedPod({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: 'beacon',
            labels: { app: 'beacon', mission: 'first-pod', 'kubequest.io/visual': 'pod' },
          },
          spec: {
            containers: [
              {
                name: 'nginx',
                image: 'nginx:alpine',
                ports: [{ containerPort: 80 }],
              },
            ],
          },
        },
      });
      return { ok: true, message: 'Pod beacon created — waiting for Running…' };
    }

    case 'spawn-fleet': {
      try {
        await apps.readNamespacedDeployment({ name: 'fleet', namespace: NAMESPACE });
        return { ok: true, message: 'Deployment fleet already exists' };
      } catch {
        /* create */
      }
      await apps.createNamespacedDeployment({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: 'fleet',
            labels: { app: 'fleet', mission: 'deployment' },
          },
          spec: {
            replicas: 2,
            selector: { matchLabels: { app: 'fleet' } },
            template: {
              metadata: {
                labels: { app: 'fleet', 'kubequest.io/visual': 'pod' },
              },
              spec: {
                containers: [
                  {
                    name: 'nginx',
                    image: 'nginx:alpine',
                    ports: [{ containerPort: 80 }],
                  },
                ],
              },
            },
          },
        },
      });
      return { ok: true, message: 'Deployment fleet created with 2 replicas' };
    }

    case 'scale-fleet-4': {
      const dep = await apps.readNamespacedDeployment({ name: 'fleet', namespace: NAMESPACE });
      dep.spec.replicas = 4;
      await apps.replaceNamespacedDeployment({
        name: 'fleet',
        namespace: NAMESPACE,
        body: dep,
      });
      return { ok: true, message: 'Scaled fleet to 4 replicas' };
    }

    case 'expose-fleet': {
      try {
        await core.readNamespacedService({ name: 'fleet-svc', namespace: NAMESPACE });
        return { ok: true, message: 'Service fleet-svc already exists' };
      } catch {
        /* create */
      }
      await core.createNamespacedService({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: 'fleet-svc',
            labels: { app: 'fleet', mission: 'service' },
          },
          spec: {
            type: 'ClusterIP',
            selector: { app: 'fleet' },
            ports: [{ port: 80, targetPort: 80, protocol: 'TCP' }],
          },
        },
      });
      return { ok: true, message: 'Service fleet-svc created (ClusterIP)' };
    }

    case 'spawn-config': {
      try {
        await core.readNamespacedConfigMap({ name: 'quest-config', namespace: NAMESPACE });
      } catch {
        await core.createNamespacedConfigMap({
          namespace: NAMESPACE,
          body: {
            metadata: { name: 'quest-config', labels: { mission: 'configmap' } },
            data: {
              MESSAGE: 'Hello from ConfigMap — config is not baked into the image!',
              LEVEL: '5',
            },
          },
        });
      }
      try {
        await core.readNamespacedPod({ name: 'messenger', namespace: NAMESPACE });
        return { ok: true, message: 'messenger Pod already exists' };
      } catch {
        /* create */
      }
      await core.createNamespacedPod({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: 'messenger',
            labels: { app: 'messenger', mission: 'configmap', 'kubequest.io/visual': 'pod' },
          },
          spec: {
            containers: [
              {
                name: 'app',
                image: 'busybox:1.36',
                command: ['sh', '-c', 'echo "MESSAGE=$MESSAGE"; echo "LEVEL=$LEVEL"; sleep 3600'],
                env: [
                  {
                    name: 'MESSAGE',
                    valueFrom: {
                      configMapKeyRef: { name: 'quest-config', key: 'MESSAGE' },
                    },
                  },
                  {
                    name: 'LEVEL',
                    valueFrom: {
                      configMapKeyRef: { name: 'quest-config', key: 'LEVEL' },
                    },
                  },
                ],
              },
            ],
          },
        },
      });
      return { ok: true, message: 'ConfigMap quest-config + Pod messenger created' };
    }

    case 'roll-fleet': {
      const dep = await apps.readNamespacedDeployment({ name: 'fleet', namespace: NAMESPACE });
      const containers = dep.spec?.template?.spec?.containers || [];
      if (!containers.length) throw new Error('fleet has no containers');
      containers[0].image = 'nginx:1.27-alpine';
      // trigger rollout
      if (!dep.spec.template.metadata) dep.spec.template.metadata = {};
      if (!dep.spec.template.metadata.annotations) dep.spec.template.metadata.annotations = {};
      dep.spec.template.metadata.annotations['kubequest.io/rolled-at'] = new Date().toISOString();
      await apps.replaceNamespacedDeployment({
        name: 'fleet',
        namespace: NAMESPACE,
        body: dep,
      });
      return { ok: true, message: 'Rolling update started → nginx:1.27-alpine' };
    }

    case 'spawn-healthy': {
      try {
        await apps.readNamespacedDeployment({ name: 'healthy-app', namespace: NAMESPACE });
        return { ok: true, message: 'healthy-app already exists' };
      } catch {
        /* create */
      }
      await apps.createNamespacedDeployment({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: 'healthy-app',
            labels: { app: 'healthy-app', mission: 'health' },
          },
          spec: {
            replicas: 2,
            selector: { matchLabels: { app: 'healthy-app' } },
            template: {
              metadata: {
                labels: { app: 'healthy-app', 'kubequest.io/visual': 'pod' },
              },
              spec: {
                containers: [
                  {
                    name: 'nginx',
                    image: 'nginx:alpine',
                    ports: [{ containerPort: 80 }],
                    readinessProbe: {
                      httpGet: { path: '/', port: 80 },
                      initialDelaySeconds: 2,
                      periodSeconds: 5,
                    },
                    livenessProbe: {
                      httpGet: { path: '/', port: 80 },
                      initialDelaySeconds: 5,
                      periodSeconds: 10,
                    },
                  },
                ],
              },
            },
          },
        },
      });
      return { ok: true, message: 'healthy-app deployed with readiness + liveness probes' };
    }

    case 'spawn-bounded': {
      try {
        await apps.readNamespacedDeployment({ name: 'bounded-app', namespace: NAMESPACE });
        return { ok: true, message: 'bounded-app already exists' };
      } catch {
        /* create */
      }
      await apps.createNamespacedDeployment({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: 'bounded-app',
            labels: { app: 'bounded-app', mission: 'resources' },
          },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: 'bounded-app' } },
            template: {
              metadata: {
                labels: { app: 'bounded-app', 'kubequest.io/visual': 'pod' },
              },
              spec: {
                containers: [
                  {
                    name: 'nginx',
                    image: 'nginx:alpine',
                    ports: [{ containerPort: 80 }],
                    resources: {
                      requests: { cpu: '50m', memory: '64Mi' },
                      limits: { cpu: '200m', memory: '128Mi' },
                    },
                  },
                ],
              },
            },
          },
        },
      });
      return { ok: true, message: 'bounded-app deployed with CPU/memory requests & limits' };
    }

    default:
      throw new Error(`Unknown action: ${actionId}`);
  }
}

export async function resetGame() {
  try {
    await core.deleteNamespace({ name: NAMESPACE });
  } catch {
    /* ignore */
  }
  // wait until fully gone (Active read during Terminating is NOT gone)
  for (let i = 0; i < 120; i++) {
    try {
      await core.readNamespace({ name: NAMESPACE });
      await sleep(1000);
    } catch {
      break;
    }
    if (i === 119) {
      throw new Error(`namespace ${NAMESPACE} stuck terminating — run: kubectl delete ns ${NAMESPACE} --wait=true`);
    }
  }
  await ensureNamespace();
  // sanity: can list pods
  await core.listNamespacedPod({ namespace: NAMESPACE });
  return { ok: true, message: 'Namespace recreated — cluster sandbox wiped' };
}

export async function clusterHealth() {
  try {
    const nodes = await core.listNode();
    return {
      connected: true,
      nodes: (nodes.items || []).map((n) => ({
        name: n.metadata?.name,
        ready: (n.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True'),
      })),
    };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

/** Run a short-lived in-cluster curl and return stdout. */
export async function inClusterCurl(url, { timeoutSec = 30 } = {}) {
  const name = `kq-curl-${Date.now().toString(36)}`;
  const create = await import('./kubectl-runner.js').then((m) =>
    m.runKubectl(
      [
        'run',
        name,
        '-n',
        NAMESPACE,
        '--restart=Never',
        '--image=curlimages/curl:8.5.0',
        '--labels=kq.stack=probe',
        '--command',
        '--',
        'curl',
        '-sf',
        '--max-time',
        '10',
        url,
      ],
      30000
    )
  );
  if (create.code !== 0 && !/created/i.test(create.stdout + create.stderr)) {
    return { ok: false, body: '', error: create.stderr || create.stdout };
  }
  const { runKubectl } = await import('./kubectl-runner.js');
  let phase = '';
  for (let i = 0; i < timeoutSec; i++) {
    const st = await runKubectl(
      ['get', 'pod', name, '-n', NAMESPACE, '-o', 'jsonpath={.status.phase}'],
      15000
    );
    phase = (st.stdout || '').trim();
    if (phase === 'Succeeded' || phase === 'Failed') break;
    await sleep(1000);
  }
  const logs = await runKubectl(['logs', name, '-n', NAMESPACE], 15000);
  await runKubectl(['delete', 'pod', name, '-n', NAMESPACE, '--ignore-not-found'], 15000);
  const body = (logs.stdout || '').trim();
  return { ok: phase === 'Succeeded' && body.length > 0, body, phase, error: logs.stderr || '' };
}
