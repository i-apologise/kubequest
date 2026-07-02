#!/usr/bin/env node
/**
 * KubeQuest — type real kubectl commands. We run them on your cluster.
 *
 *   npm start
 */
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { missions, NAMESPACE } from './server/missions.js';
import {
  ensureNamespace,
  getClusterSnapshot,
  checkMission,
  resetGame,
  clusterHealth,
} from './server/k8s.js';
import { prepareKubectl, runKubectl } from './server/kubectl-runner.js';

const require = createRequire(import.meta.url);
const c = require('chalk');

const progress = { done: new Set(), xp: 0, hintAt: {} };
const history = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
  historySize: 200,
});

let shuttingDown = false;
const ask = (q) =>
  new Promise((res) => {
    if (rl.closed || shuttingDown) return res('quit');
    rl.question(q, (a) => res(a ?? 'quit'));
  });

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    rl.close();
  } catch {
    /* ignore */
  }
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function locked(m) {
  return m.id > 1 && !progress.done.has(m.id - 1);
}

function nextMission() {
  return missions.find((m) => !progress.done.has(m.id) && !locked(m)) || null;
}

function printClusterMini(snap) {
  const parts = [];
  for (const d of snap.deployments || []) {
    parts.push(`deploy/${d.name} ${d.readyReplicas}/${d.replicas}`);
  }
  for (const p of snap.pods || []) {
    if (snap.deployments?.some((d) => d.name === p.labels?.app)) continue;
    parts.push(`pod/${p.name}${p.ready ? '' : '(' + (p.phase || '?') + ')'}`);
  }
  for (const s of snap.services || []) parts.push(`svc/${s.name}`);
  for (const cm of snap.configMaps || []) parts.push(`cm/${cm.name}`);
  if (!parts.length) return c.dim('(cluster empty)');
  return parts.map((p) => c.white(p)).join(c.dim(' · '));
}

async function showStatus(mission) {
  const snap = await getClusterSnapshot();
  console.log(c.dim('cluster  ') + printClusterMini(snap));
  if (mission && !progress.done.has(mission.id)) {
    const chk = await checkMission(mission);
    console.log(
      chk.met
        ? c.green('goal     MET — type "check" to claim XP')
        : c.yellow('goal     ' + chk.detail)
    );
  }
}

function printHelp() {
  console.log(`
${c.bold('You type real kubectl commands.')} They run on namespace ${c.cyan(NAMESPACE)}.

${c.bold('Game commands')} (not sent to the cluster):
  ${c.yellow('help')}      how to play
  ${c.yellow('goal')}      show current mission goal + starter ideas
  ${c.yellow('hint')}      reveal one hint command
  ${c.yellow('status')}    show cluster + goal progress
  ${c.yellow('check')}     check if you finished the mission
  ${c.yellow('missions')}  list missions
  ${c.yellow('mission N')} switch to mission N
  ${c.yellow('reset')}     wipe namespace + XP
  ${c.yellow('clear')}     clear screen
  ${c.yellow('quit')}      exit

${c.bold('Examples to type:')}
  kubectl get pods
  kubectl run beacon --image=nginx:alpine
  kubectl create deployment fleet --image=nginx:alpine --replicas=2
  kubectl apply -f manifests/healthy-app.yaml

${c.dim('Tip: you can omit the word kubectl — "get pods" works too.')}
`);
}

function printGoal(m) {
  console.log();
  console.log(c.bold.cyan(`Mission ${m.id}/${missions.length}: ${m.title}`) + c.dim(`  (+${m.xp} XP)`));
  console.log(c.white(m.what));
  console.log(c.bold.green('GOAL  ') + m.goal);
  console.log(c.dim('win when: ' + m.winHint));
  console.log(c.bold('Try:'));
  for (const line of m.starter) {
    if (line.startsWith('  ')) console.log(c.yellow(line));
    else console.log(c.dim(line));
  }
  console.log();
}

async function claimIfDone(m) {
  if (progress.done.has(m.id)) {
    console.log(c.dim('Already completed.'));
    return false;
  }
  const chk = await checkMission(m);
  if (!chk.met) {
    console.log(c.yellow('Not yet: ' + chk.detail));
    console.log(c.dim('Keep typing kubectl commands. Type "hint" if stuck, "goal" to re-read.'));
    return false;
  }
  progress.done.add(m.id);
  progress.xp += m.xp;
  console.log();
  console.log(c.bold.green('════════════════════════════════'));
  console.log(c.bold.green(`  ★ MISSION COMPLETE  +${m.xp} XP`));
  console.log(c.bold.green(`    ${m.title}`));
  console.log(c.bold.green('════════════════════════════════'));
  const n = nextMission();
  if (n) {
    console.log(c.white(`\nNext: mission ${n.id} — ${n.title}`));
    console.log(c.dim(`Type: mission ${n.id}`));
  } else {
    console.log(c.bold.yellow('\n★ Cluster Lord — you finished every mission!'));
    console.log(c.dim('Type reset to play again.'));
  }
  console.log();
  return true;
}

function giveHint(m) {
  const i = progress.hintAt[m.id] || 0;
  if (!m.hints?.length) {
    console.log(c.dim('No hints for this mission.'));
    return;
  }
  if (i >= m.hints.length) {
    console.log(c.yellow('No more hints. Commands so far:'));
    m.hints.forEach((h) => console.log('  ' + c.cyan(h)));
    return;
  }
  console.log(c.yellow('Hint: ') + c.cyan(m.hints[i]));
  progress.hintAt[m.id] = i + 1;
  if (i + 1 < m.hints.length) console.log(c.dim(`(${m.hints.length - i - 1} hint(s) left — type hint again)`));
}

async function waitForGoal(mission, timeoutMs = 90000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const chk = await checkMission(mission);
    last = chk.detail;
    if (chk.met) return chk;
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(c.dim(`\r  waiting for goal… ${last} (${elapsed}s)   `));
    await sleep(2000);
  }
  process.stdout.write('\n');
  return { met: false, detail: last };
}

async function syncProgressFromCluster() {
  for (const m of missions) {
    if (m.id > 1 && !progress.done.has(m.id - 1)) break;
    try {
      const chk = await checkMission(m);
      if (chk.met && !progress.done.has(m.id)) {
        progress.done.add(m.id);
        progress.xp += m.xp;
      }
    } catch {
      break;
    }
  }
}

async function waitPodReady(name, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await getClusterSnapshot();
    const pod = snap.pods.find((p) => p.name === name);
    if (pod?.ready) return true;
    const detail = pod ? `${pod.name}: ${pod.phase}` : `${name} not found`;
    process.stdout.write(c.dim(`\r  waiting for pod/${name} Ready… ${detail}   `));
    await sleep(2000);
  }
  process.stdout.write('\n');
  return false;
}

function execPodName(argv) {
  if (argv[0] !== 'exec') return null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a.startsWith('-')) {
      if (a === '-n' || a === '--namespace' || a === '-c' || a === '--container') {
        i++;
        continue;
      }
      if (a.includes('=')) continue;
      continue;
    }
    return a.replace(/^pod\//, '');
  }
  return null;
}

async function runPlayerCommand(line) {
  const prepared = prepareKubectl(line);
  if (prepared.error) {
    console.log(c.red(prepared.error));
    return { mutating: false, code: 1 };
  }
  const display = ['kubectl', ...prepared.argv].join(' ');
  console.log(c.dim('→ ' + display));

  const podForExec = execPodName(prepared.argv);
  if (podForExec) {
    const ready = await waitPodReady(podForExec);
    if (ready) process.stdout.write('\n');
    else {
      console.log(c.yellow(`pod/${podForExec} not Ready yet. Try: kubectl get pod ${podForExec}`));
      return { mutating: false, code: 1 };
    }
  }

  const result = await runKubectl(prepared.argv);
  if (result.stdout?.trim()) process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : result.stdout + '\n');
  if (result.stderr?.trim()) {
    const errText = result.stderr.endsWith('\n') ? result.stderr : result.stderr + '\n';
    // rollout status writes progress to stderr — don't paint it scary red
    if (prepared.argv[0] === 'rollout' && result.code === 0) process.stdout.write(c.dim(errText));
    else process.stderr.write(c.red(errText));
  }
  if (result.code !== 0) console.log(c.dim(`(exit ${result.code})`));
  const err = `${result.stderr || ''}${result.stdout || ''}`;
  if (/pod updates may not change fields/i.test(err)) {
    console.log(
      c.yellow(
        'Tip: Pod specs are immutable. delete the pod and recreate it with env set (see goal / manifests/messenger.yaml). set env works on deploy/…, not live pods.'
      )
    );
  }
  if (/already exists/i.test(err)) {
    console.log(c.yellow('Tip: resource already exists. Continue, or delete it first and recreate.'));
  }
  if (/--from=configmap/i.test(display) && /set env/i.test(display) && /pod\//i.test(display)) {
    console.log(c.yellow('Tip: use  kubectl apply -f manifests/messenger.yaml  after creating the configmap.'));
  }
  if (/NotFound|not found/i.test(err) && /configmap.*quest-config|quest-config/i.test(err)) {
    console.log(c.yellow('Tip: create the configmap first: kubectl create configmap quest-config --from-literal=MESSAGE=hello-from-cm'));
  }
  history.push(display);
  return { mutating: !!prepared.mutating, code: result.code };
}

function listMissions() {
  console.log();
  for (const m of missions) {
    let mark;
    if (progress.done.has(m.id)) mark = c.green('✓');
    else if (locked(m)) mark = c.gray('🔒');
    else mark = c.yellow('▸');
    const title = progress.done.has(m.id) || locked(m) ? c.dim(m.title) : c.bold(m.title);
    console.log(`  ${mark} ${String(m.id).padStart(2)}  ${title}  ${c.dim('+' + m.xp)}`);
  }
  console.log();
}

async function main() {
  const health = await clusterHealth();
  if (!health.connected) {
    console.log(c.red('\nNo Kubernetes cluster. Run: npm run setup\n'));
    console.log(c.dim(health.error || ''));
    process.exit(1);
  }
  await ensureNamespace();

  // clean slate prompt once
  console.log(c.bold.cyan('\nKUBEQUEST') + c.dim(' — type real kubectl commands on a real cluster\n'));
  console.log(c.white('You write the commands. We execute them in namespace ') + c.cyan(NAMESPACE) + c.white('.'));
  console.log(c.white('Finish the GOAL, then type ') + c.yellow('check') + c.white(' for XP.'));
  console.log(c.dim('Game cmds: goal · hint · status · check · missions · help · quit\n'));

  const wipe = (await ask(c.dim('Reset namespace for a clean run? [y/N] > '))).trim().toLowerCase();
  if (wipe === 'y' || wipe === 'yes') {
    process.stdout.write(c.dim('resetting… '));
    await resetGame();
    progress.done.clear();
    progress.xp = 0;
    progress.hintAt = {};
    console.log(c.green('done'));
  }

  process.stdout.write(c.dim('syncing progress from cluster… '));
  await syncProgressFromCluster();
  console.log(c.green(`done (xp:${progress.xp}, cleared:${progress.done.size})`));

  let mission = nextMission() || missions[missions.length - 1];
  if (progress.done.size === missions.length) {
    console.log(c.bold.yellow('\nAll missions already satisfied in the cluster. Type reset to replay.\n'));
  }
  printGoal(mission);
  await showStatus(mission);
  console.log(c.dim('Type kubectl below (example already in GOAL). help = full help.\n'));

  while (true) {
    const xp = c.dim(`xp:${progress.xp}`);
    const mid = c.cyan(`m${mission.id}`);
    const line = (await ask(`${c.green('kubequest')} ${mid} ${xp} ${c.green('$')} `)).trim();
    if (!line) continue;

    const low = line.toLowerCase();

    if (low === 'quit' || low === 'exit' || low === 'q') {
      console.log(c.dim(`\nBye. Workloads left in: kubectl get pods -n ${NAMESPACE}\n`));
      shutdown(0);
      return;
    }
    if (low === 'help' || low === '?') {
      printHelp();
      continue;
    }
    if (low === 'clear') {
      process.stdout.write('\x1b[2J\x1b[H');
      continue;
    }
    if (low === 'goal' || low === 'mission') {
      printGoal(mission);
      await showStatus(mission);
      continue;
    }
    if (low === 'hint') {
      giveHint(mission);
      continue;
    }
    if (low === 'status' || low === 's') {
      await showStatus(mission);
      continue;
    }
    if (low === 'check' || low === 'done' || low === 'verify') {
      const finished = await claimIfDone(mission);
      if (finished) {
        const n = nextMission();
        if (n) {
          mission = n;
          printGoal(mission);
        }
      }
      continue;
    }
    if (low === 'missions' || low === 'ls') {
      listMissions();
      continue;
    }
    if (low.startsWith('mission ')) {
      const n = parseInt(low.split(/\s+/)[1], 10);
      const m = missions.find((x) => x.id === n);
      if (!m) {
        console.log(c.red('Unknown mission.'));
        continue;
      }
      if (locked(m)) {
        console.log(c.yellow(`Finish mission ${m.id - 1} first.`));
        continue;
      }
      mission = m;
      printGoal(mission);
      await showStatus(mission);
      continue;
    }
    if (low === 'reset') {
      const ok = (await ask(c.yellow('Wipe namespace and XP? [y/N] > '))).trim().toLowerCase();
      if (ok === 'y') {
        await resetGame();
        progress.done.clear();
        progress.xp = 0;
        progress.hintAt = {};
        mission = missions[0];
        console.log(c.green('Reset. Back to mission 1.'));
        printGoal(mission);
      }
      continue;
    }
    if (low === 'history') {
      history.slice(-20).forEach((h) => console.log(c.dim('  ' + h)));
      continue;
    }

    // treat as kubectl
    const ran = await runPlayerCommand(line);
    if (ran?.mutating && ran.code === 0 && !progress.done.has(mission.id)) {
      const chk = await waitForGoal(mission, 90000);
      process.stdout.write('\n');
      if (chk.met) {
        console.log(c.green('Goal looks complete! Type ') + c.bold('check') + c.green(' to claim XP.'));
      }
    } else {
      await sleep(500);
    }
    await showStatus(mission);
    const chk = await checkMission(mission);
    if (chk.met && !progress.done.has(mission.id)) {
      console.log(c.green('\nGoal looks complete! Type ') + c.bold('check') + c.green(' to claim XP.\n'));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
