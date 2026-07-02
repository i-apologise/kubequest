const BASE = '/api';

async function req(path, opts) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

export const api = {
  health: () => req('/health'),
  missions: () => req('/missions'),
  mission: (id) => req(`/missions/${id}`),
  cluster: () => req('/cluster'),
  action: (id) => req(`/actions/${id}`, { method: 'POST' }),
  check: (id) => req(`/missions/${id}/check`, { method: 'POST' }),
  reset: () => req('/reset', { method: 'POST' }),
};
