import { get } from 'svelte/store';
import { token } from './store.js';

// 배포(합친 서비스): VITE_API_BASE='' 로 빌드 → same-origin 상대경로(/api/...).
// dev: 미설정 → localhost:8787. '' 가 falsy로 떨어지지 않게 ?? (nullish) 사용.
const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

async function req(path, opts = {}) {
  const t = get(token);
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    token.set(null);
    throw new Error('인증이 만료되었습니다. 다시 로그인하세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

export const api = {
  base: BASE,
  login: (passcode) => req('/api/login', { method: 'POST', body: JSON.stringify({ passcode }) }),
  briefing: () => req('/api/briefing'),
  briefingById: (id) => req(`/api/briefing/${id}`),
  moreNext: (id, n) => req(`/api/briefing/${id}/more`, { method: 'POST', body: JSON.stringify({ n }) }),
  briefings: () => req('/api/briefings'),
  best: (period) => req(`/api/best?period=${period}`),
  read: (itemId) => req('/api/read', { method: 'POST', body: JSON.stringify({ itemId }) }),
  feedback: (itemId, kind, reason) =>
    req('/api/feedback', { method: 'POST', body: JSON.stringify({ itemId, kind, reason }) }),
  dashboard: () => req('/api/dashboard'),
  getConfig: () => req('/api/config'),
  setConfig: (cfg) => req('/api/config', { method: 'PUT', body: JSON.stringify(cfg) }),
  sources: () => req('/api/sources'),
  addSource: (s) => req('/api/sources', { method: 'POST', body: JSON.stringify(s) }),
  updateSource: (id, s) => req(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(s) }),
  deleteSource: (id) => req(`/api/sources/${id}`, { method: 'DELETE' }),
  pushKey: () => req('/api/push/key'),
  subscribe: (sub) => req('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
};
