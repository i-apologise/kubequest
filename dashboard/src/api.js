const STORAGE_KEY = 'kq_api_base';
const PAGES_HOST = 'i-apologise.github.io';
const MIRROR_URL =
  import.meta.env.VITE_MIRROR_URL ||
  'https://raw.githubusercontent.com/i-apologise/kubequest/main/live/state.json';

export function getStoredApiBase() {
  const q = new URLSearchParams(window.location.search).get('api');
  if (q) {
    const normalized = q.replace(/\/$/, '');
    localStorage.setItem(STORAGE_KEY, normalized);
    return normalized;
  }
  return (localStorage.getItem(STORAGE_KEY) || '').replace(/\/$/, '');
}

export function setStoredApiBase(url) {
  const normalized = (url || '').trim().replace(/\/$/, '');
  if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
  else localStorage.removeItem(STORAGE_KEY);
  return normalized;
}

export function mirrorUrl() {
  return `${MIRROR_URL}?t=${Date.now()}`;
}

export function isPagesHost() {
  return window.location.hostname === PAGES_HOST || window.location.hostname.endsWith('.github.io');
}

export function makeApi(base) {
  const prefix = (base || '').replace(/\/$/, '');
  const join = (path) => (prefix ? `${prefix}${path}` : path);

  async function api(path, opts) {
    const r = await fetch(join(path), {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  function openEventSource() {
    return new EventSource(join('/api/events'));
  }

  return { api, openEventSource, base: prefix };
}

export async function fetchMirror() {
  const r = await fetch(mirrorUrl(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`mirror HTTP ${r.status}`);
  return r.json();
}
