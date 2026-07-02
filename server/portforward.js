import { spawn } from 'node:child_process';
import { NAMESPACE } from './missions.js';

const forwards = new Map();

export function startPortForward(name, resource, localPort, remotePort) {
  const key = `${resource}:${localPort}`;
  if (forwards.has(key)) return forwards.get(key);

  const args = [
    'port-forward',
    '-n',
    NAMESPACE,
    resource,
    `${localPort}:${remotePort}`,
  ];
  const child = spawn('kubectl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { child, localPort, resource, ready: false, lastError: '' };
  child.stdout.on('data', (d) => {
    if (/Forwarding from/i.test(d.toString())) entry.ready = true;
  });
  child.stderr.on('data', (d) => {
    entry.lastError = d.toString();
    if (/Forwarding from/i.test(entry.lastError)) entry.ready = true;
  });
  child.on('exit', () => {
    forwards.delete(key);
  });
  forwards.set(key, entry);
  return entry;
}

export async function ensureTelemetryForwards() {
  const specs = [
    ['jaeger', 'svc/jaeger', 16686, 16686],
    ['prometheus', 'svc/prometheus', 19090, 9090],
    ['telemetry-api', 'svc/telemetry-api', 18080, 8080],
  ];
  for (const [, resource, localPort, remotePort] of specs) {
    startPortForward(resource, resource, localPort, remotePort);
  }
  // give kubectl a moment
  await new Promise((r) => setTimeout(r, 1500));
}

export function stopAllForwards() {
  for (const entry of forwards.values()) {
    try {
      entry.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  forwards.clear();
}
