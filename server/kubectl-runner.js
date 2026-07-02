import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMESPACE } from './missions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BLOCKED = [
  /\bdelete\s+n(s|amespace)\b/i,
  /\bdelete\s+node\b/i,
  /\bdrain\b/i,
  /\bcordon\b/i,
  /\buncordon\b/i,
  /\btaint\b/i,
  /\b--kubeconfig\b/i,
  /\b--context\b/i,
  /\bproxy\b/i,
  /\bport-forward\b/i,
  /\battach\b/i,
  /\bedit\b/i,
  /\bapi-resources\b/i,
  /\bcluster-info\b/i,
  /\bcertificate\b/i,
];

const NAMESPACED_VERBS = new Set([
  'get', 'describe', 'logs', 'log', 'create', 'apply', 'delete', 'expose',
  'scale', 'set', 'rollout', 'run', 'label', 'annotate', 'exec', 'top',
  'wait', 'patch', 'replace', 'auth', 'api-versions', 'explain',
]);

const READ_VERBS = new Set(['get', 'describe', 'logs', 'log', 'top', 'auth', 'api-versions', 'explain']);

/** Parse a shell-ish command line into argv (supports simple quotes). */
export function parseCommand(line) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Args before `--` are kubectl flags; after are container/command args. */
function kubectlArgSpan(argv) {
  const dd = argv.indexOf('--');
  return dd === -1 ? argv.length : dd;
}

function hasFlag(argv, name) {
  const end = kubectlArgSpan(argv);
  for (let i = 0; i < end; i++) {
    const a = argv[i];
    if (a === name || a.startsWith(`${name}=`)) return true;
  }
  return false;
}

function flagValue(argv, name) {
  const end = kubectlArgSpan(argv);
  for (let i = 0; i < end; i++) {
    const a = argv[i];
    if (a === name) return argv[i + 1];
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

function injectNamespace(argv) {
  const verb = argv[0];
  if (!NAMESPACED_VERBS.has(verb)) return argv;
  if (
    hasFlag(argv, '-n') ||
    hasFlag(argv, '--namespace') ||
    hasFlag(argv, '-A') ||
    hasFlag(argv, '--all-namespaces')
  ) {
    return argv;
  }
  if (verb === 'get' || verb === 'describe' || verb === 'explain') {
    const res = (argv[1] || '').toLowerCase();
    if (/^(nodes?|ns|namespaces?|pv|persistentvolumes?|sc|storageclasses?|csinodes?)$/.test(res)) {
      return argv;
    }
  }
  // Insert BEFORE `--` so flags aren't eaten by `kubectl run/exec ... -- cmd`
  const end = kubectlArgSpan(argv);
  return [...argv.slice(0, end), '-n', NAMESPACE, ...argv.slice(end)];
}

function rewriteApplyPaths(argv) {
  return argv.map((arg, i) => {
    const prev = argv[i - 1];
    if (prev === '-f' || prev === '--filename') {
      if (arg.startsWith('/') || arg.includes('://')) return arg;
      return path.resolve(ROOT, arg);
    }
    if (arg.startsWith('-f=') || arg.startsWith('--filename=')) {
      const [k, v] = arg.split('=');
      if (v.startsWith('/') || v.includes('://')) return arg;
      return `${k}=${path.resolve(ROOT, v)}`;
    }
    return arg;
  });
}

/** Avoid hanging forever on rollout status. */
function ensureRolloutTimeout(argv) {
  if (argv[0] !== 'rollout' || argv[1] !== 'status') return argv;
  if (hasFlag(argv, '--timeout')) return argv;
  const end = kubectlArgSpan(argv);
  return [...argv.slice(0, end), '--timeout=90s', ...argv.slice(end)];
}

function shellMetaError(line) {
  if (/[|;&<>]/.test(line) || /\s&&\s/.test(line) || /\s\|\|/.test(line)) {
    return 'Shell operators (| && || ; < >) are not supported here. Run one kubectl command at a time (no pipes).';
  }
  if (line.includes('`') || /\$\(/.test(line)) {
    return 'Shell substitution is not supported. Type a plain kubectl command.';
  }
  return null;
}

export function prepareKubectl(line) {
  const trimmed = line.trim();
  if (!trimmed) return { error: 'Empty command.' };

  const meta = shellMetaError(trimmed);
  if (meta) return { error: meta };

  for (const re of BLOCKED) {
    if (re.test(trimmed)) {
      return { error: 'That command is blocked in the game sandbox. Stay inside namespace work.' };
    }
  }

  let argv = parseCommand(trimmed);
  if (argv[0] === 'kubectl') argv = argv.slice(1);
  if (!argv.length) return { error: 'Type a kubectl command, e.g. kubectl get pods' };

  const end = kubectlArgSpan(argv);
  const head = argv.slice(0, end);
  if (head.includes('-w') || head.includes('--watch') || head.includes('--watch-only')) {
    return {
      error: 'Watch mode (-w) hangs the game prompt. Run without -w, or type: status',
    };
  }

  argv = injectNamespace(argv);
  argv = rewriteApplyPaths(argv);
  argv = ensureRolloutTimeout(argv);

  const nsVal = flagValue(argv, '-n') || flagValue(argv, '--namespace');
  if (nsVal && nsVal !== NAMESPACE && nsVal !== 'kube-system') {
    return { error: `Stay in namespace "${NAMESPACE}" for this game (or omit -n, we add it).` };
  }

  const mutating = !READ_VERBS.has(argv[0]);
  return { argv, mutating };
}

export function runKubectl(argv, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const child = spawn('kubectl', argv, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: 124, stdout, stderr: stderr + '\n(command timed out)' });
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export { ROOT, NAMESPACE, READ_VERBS };
