#!/usr/bin/env node
/**
 * Full audit: every mission's suggested commands + win checks.
 */
import { missions, NAMESPACE } from '../server/missions.js';
import {
  ensureNamespace,
  resetGame,
  checkMission,
  clusterHealth,
  getClusterSnapshot,
} from '../server/k8s.js';
import { prepareKubectl, runKubectl } from '../server/kubectl-runner.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const log = (...a) => console.log(...a);
const fail = (msg) => {
  failed++;
  console.error('FAIL:', msg);
};
const ok = (msg) => console.log('OK  ', msg);

async function waitReady(mission, timeoutMs = 120000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const chk = await checkMission(mission);
    last = chk.detail;
    if (chk.met) return chk;
    await sleep(2000);
  }
  return { met: false, detail: `timeout: ${last}` };
}

async function runLine(line) {
  const prep = prepareKubectl(line);
  if (prep.error) return { prepError: prep.error, line };
  const display = ['kubectl', ...prep.argv].join(' ');
  const result = await runKubectl(prep.argv, 90000);
  return { display, ...result, line };
}

async function mustRun(line, { allowFail = false } = {}) {
  const r = await runLine(line);
  if (r.prepError) {
    fail(`${line} => prep: ${r.prepError}`);
    return r;
  }
  log('  →', r.display);
  if (r.stdout?.trim()) log(r.stdout.trim().split('\n').map((l) => '    ' + l).join('\n'));
  if (r.stderr?.trim()) log('    stderr:', r.stderr.trim().split('\n')[0]);
  if (!allowFail && r.code !== 0) fail(`${line} exit ${r.code}: ${(r.stderr || r.stdout || '').slice(0, 200)}`);
  return r;
}

// Unit tests for prepareKubectl
function unitTests() {
  log('\n=== unit: namespace injection ===');
  const cases = [
    {
      in: 'kubectl run x --image=busybox --command -- sleep 1',
      expectIncludesBeforeDD: ['-n', NAMESPACE],
    },
    {
      in: 'exec messenger -- printenv MESSAGE',
      expectIncludesBeforeDD: ['-n', NAMESPACE],
    },
    {
      in: 'get pods -n kubequest',
      expectArgv: ['get', 'pods', '-n', 'kubequest'],
    },
    {
      in: 'apply -f manifests/messenger.yaml',
      expectPathAbsolute: true,
    },
    {
      in: 'get pods -w',
      expectError: true,
    },
    {
      in: 'get pods | grep x',
      expectError: true,
    },
    {
      in: 'get deploy fleet -o jsonpath="{.spec.replicas}"',
      expectOk: true,
    },
  ];

  for (const tc of cases) {
    const p = prepareKubectl(tc.in);
    if (tc.expectError) {
      if (p.error) ok(`blocked: ${tc.in}`);
      else fail(`should block: ${tc.in} => ${JSON.stringify(p.argv)}`);
      continue;
    }
    if (p.error) {
      fail(`${tc.in} => ${p.error}`);
      continue;
    }
    if (tc.expectIncludesBeforeDD) {
      const dd = p.argv.indexOf('--');
      const before = dd === -1 ? p.argv : p.argv.slice(0, dd);
      const idx = before.indexOf('-n');
      if (idx >= 0 && before[idx + 1] === NAMESPACE) ok(`ns before -- : ${tc.in}`);
      else fail(`ns not before -- : ${p.argv.join(' ')}`);
    }
    if (tc.expectArgv) {
      if (JSON.stringify(p.argv) === JSON.stringify(tc.expectArgv)) ok(`argv exact: ${tc.in}`);
      else fail(`argv ${p.argv.join(' ')} != ${tc.expectArgv.join(' ')}`);
    }
    if (tc.expectPathAbsolute) {
      const fi = p.argv.indexOf('-f');
      const fp = p.argv[fi + 1];
      if (fp?.startsWith('/')) ok(`absolute -f path: ${fp}`);
      else fail(`path not absolute: ${fp}`);
    }
    if (tc.expectOk) ok(`parses: ${tc.in}`);
  }
}

async function playAll() {
  log('\n=== reset namespace ===');
  const h = await clusterHealth();
  if (!h.connected) {
    fail('no cluster');
    return;
  }
  await resetGame();
  ok('namespace reset');

  const steps = [
    {
      missionId: 1,
      commands: [
        'kubectl run beacon --image=nginx:alpine',
        'kubectl get pods',
      ],
    },
    {
      missionId: 2,
      commands: [
        'kubectl create deployment fleet --image=nginx:alpine --replicas=2',
        'kubectl get deploy,pods',
      ],
    },
    {
      missionId: 3,
      commands: [
        'kubectl scale deploy/fleet --replicas=4',
        'kubectl get deploy fleet',
      ],
    },
    {
      missionId: 4,
      commands: [
        'kubectl expose deploy/fleet --name=fleet-svc --port=80 --target-port=80',
        'kubectl get svc',
      ],
    },
    {
      missionId: 5,
      commands: [
        'kubectl create configmap quest-config --from-literal=MESSAGE=hello-from-cm',
        'kubectl delete pod messenger --ignore-not-found',
        'kubectl apply -f manifests/messenger.yaml',
      ],
      waitBeforeExec: true,
      exec: 'kubectl exec messenger -- printenv MESSAGE',
      expectStdoutIncludes: 'hello-from-cm',
    },
    {
      missionId: 6,
      commands: [
        'kubectl set image deploy/fleet nginx=nginx:1.27-alpine',
        'kubectl rollout status deploy/fleet --timeout=90s',
      ],
    },
    {
      missionId: 7,
      commands: [
        'kubectl apply -f manifests/healthy-app.yaml',
        'kubectl get deploy healthy-app',
      ],
    },
    {
      missionId: 8,
      commands: [
        'kubectl apply -f manifests/bounded-app.yaml',
        'kubectl get deploy bounded-app',
      ],
    },
  ];

  for (const step of steps) {
    const m = missions.find((x) => x.id === step.missionId);
    log(`\n=== mission ${m.id}: ${m.title} ===`);
    for (const cmd of step.commands) {
      await mustRun(cmd, {
        allowFail: cmd.includes('--ignore-not-found'),
      });
    }
    const chk = await waitReady(m);
    if (chk.met) ok(`checkMission passed: ${chk.detail}`);
    else fail(`mission ${m.id} not met: ${chk.detail}`);

    if (step.exec) {
      const lastExec = await mustRun(step.exec);
      if (step.expectStdoutIncludes) {
        if (lastExec?.stdout?.includes(step.expectStdoutIncludes)) ok(`exec output has ${step.expectStdoutIncludes}`);
        else fail(`exec missing ${step.expectStdoutIncludes}: ${lastExec?.stdout || lastExec?.stderr}`);
      }
    }
  }

  log('\n=== snapshot ===');
  const snap = await getClusterSnapshot();
  log(JSON.stringify({
    pods: snap.pods.map((p) => `${p.name}:${p.ready}`),
    deps: snap.deployments.map((d) => `${d.name}:${d.readyReplicas}/${d.replicas}:${d.images}`),
    svcs: snap.services.map((s) => s.name),
    cms: snap.configMaps.map((c) => c.name),
  }, null, 2));
}

async function testBadCommands() {
  log('\n=== bad commands UX ===');
  await mustRun('kubectl delete pod immutest --ignore-not-found', { allowFail: true });
  await mustRun('kubectl run immutest --image=busybox:1.36 --restart=Never --command -- sleep 3600');
  await sleep(3000);
  const r1 = prepareKubectl('kubectl set env pod/immutest MESSAGE=nope');
  if (!r1.error) {
    const res = await runKubectl(r1.argv);
    if (res.code !== 0 && /may not change fields|Forbidden/i.test(res.stderr + res.stdout)) {
      ok('set env on pod fails as expected (immutable)');
    } else if (res.code !== 0) {
      ok(`set env on pod failed (exit ${res.code})`);
    } else {
      fail('expected set env on bare pod to fail');
    }
  }
  await mustRun('kubectl delete pod immutest --ignore-not-found', { allowFail: true });
  const r2 = prepareKubectl('kubectl get pods -n default');
  if (r2.error) ok(`wrong ns blocked: ${r2.error}`);
  else fail('default ns should be blocked');
}

async function main() {
  unitTests();
  await playAll();
  await testBadCommands();
  log('\n=== RESULT ===');
  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
