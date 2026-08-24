// 배포(합친 서비스): VITE_API_BASE='' 로 빌드 → same-origin 상대경로(/api/...).
// dev: 미설정 → localhost:8787. '' 가 falsy로 떨어지지 않게 ?? (nullish) 사용.
const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

export const api = {
  base: BASE,
  briefing: () => req('/api/briefing'),
  briefingById: (id) => req(`/api/briefing/${id}`),
  briefingByDate: (date) => req(`/api/briefing/by-date/${date}`),
  moreNext: (id, n) => req(`/api/briefing/${id}/more`, { method: 'POST', body: JSON.stringify({ n }) }),
  recommend: (id) => req(`/api/briefing/${id}/recommend`, { method: 'POST' }),
  item: (id) => req(`/api/item/${id}`),
  itemDeep: (id) => req(`/api/item/${id}/deep`, { method: 'POST' }),
  itemAsk: (id, question, history) =>
    req(`/api/item/${id}/ask`, { method: 'POST', body: JSON.stringify({ question, history }) }),
  briefings: () => req('/api/briefings'),
  collectBriefing: () => req('/api/collect/briefing', { method: 'POST' }),
  collectBest: () => req('/api/collect/best', { method: 'POST' }),
  collectGithub: () => req('/api/collect/github', { method: 'POST' }),
  best: (period) => req(`/api/best?period=${period}`),
  githubTrending: (period) => req(`/api/github-trending?period=${period}`),
  read: (itemId) => req('/api/read', { method: 'POST', body: JSON.stringify({ itemId }) }),
  updateStatus: (itemId, status) =>
    req('/api/status', { method: 'POST', body: JSON.stringify({ itemId, ...status }) }),
  bookmarks: () => req('/api/bookmarks'),
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
